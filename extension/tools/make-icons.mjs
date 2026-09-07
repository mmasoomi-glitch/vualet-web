#!/usr/bin/env -S node --no-warnings
//
// make-icons.mjs — generate extension/icons/icon{16,32,48,128}.png from a source PNG
//
// Dependencies: NONE (node:fs, node:path, node:zlib only)
//
// PNG FORMAT REFERENCE (RFC 2083):
// ───────────────────────────────
// A PNG file is a 8-byte signature followed by a sequence of chunks.
//
// Each chunk layout:
//   [4 bytes length] [4 bytes type] [length bytes data] [4 bytes CRC-32]
//
//   length — big-endian uint32, length of the data field only
//   type   — 4 ASCII chars; first must be uppercase (a-z is forbidden)
//   data   — chunk-specific binary data
//   CRC-32 — computed over type + data (not length)
//
// Critical chunks (must appear in order):
//   IHDR — image header (width, height, bit depth, colour type, compression, filter, interlace)
//   PLTE — palette (required for colour type 3; invalid with types 2,4,6)
// IDAT  — one or more image data chunks, each containing compressed scanlines
// IEND  — end marker (zero-length data)
//
// Colour types (IHDR byte 9):
//   0 = greyscale    2 = truecolour (RGB)    3 = indexed (palette)
//   4 = greyscale+α  6 = truecolour+α (RGBA)
//
// Bit depths (IHDR byte 8):
//   1,2,4,8 for most types; 8 for RGB; 1,2,4,8,16 for RGBA
//   We support 8-bit only (bit depth 8).
//
// Filter types per scanline (IHDR byte 11, always 0):
//   Each scanline is prefixed by a filter byte:
//     0 = None   — raw copy
//     1 = Sub    — each byte = raw[i] - raw[i-bp] + bp (left neighbor)
//     2 = Up     — each byte = raw[i] - above[i] + bp (pixel above)
//     3 = Average— avg(raw[i]-bp, above[i]-bp)
//     4 = Paeth  — complex predictor based on left, above, above-left
//
// Scanline width in bytes (before filtering):
//   bpp = bits per pixel;  bp = ceil(bpp/8) — bytes per pixel rounded up
//   row_bytes = floor((width * bpp + 7) / 8)
//
// Compression: always 0 (deflate/Zlib)
// Interlace:  0 = none (we only support non-interlaced)
//             1 = Adam7 (not handled — honest failure)
//
// Re-encoding:
//   We emit filter type 0 (None) on every scanline for simplicity.
//   Deflate level is 9 (maximum compression) via zlib.deflateSync.
//   CRC-32 uses IEEE polynomial 0xEDB88320 (reflected form).
//

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { inflateSync, deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

// ─── CRC-32 lookup table (IEEE 802.3 / Ethernet polynomial, reflected form) ───
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let crc = i;
  for (let j = 0; j < 8; j++) {
    crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  CRC_TABLE[i] = crc;
}

/**
 * Compute CRC-32 over a buffer (or a chunk of it).
 * Uses the standard reflected polynomial 0xEDB88320.
 * This matches the CRC used by PNG, ZIP, gzip, and Ethernet.
 */
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Pack a 4-byte big-endian uint32 into a buffer.
 */
function u32be(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

/**
 * Build a PNG chunk: [length][type][data][crc32(type||data)]
 */
function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = u32be(data.length);
  const crc = u32be(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

// ─── PNG signature ────────────────────────────────────────────────────────────
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

// ─── Constants ────────────────────────────────────────────────────────────────
const TARGET_SIZES = [16, 32, 48, 128];
const COLOR_TYPES = {
  GREYSCALE: 0,
  TRUECOLOR: 2,
  INDEXED: 3,
  GREY_ALPHA: 4,
  RGBA: 6,
};

// ─── Main ─────────────────────────────────────────────────────────────────────

// Resolve from THIS file rather than a hardcoded path or the caller's cwd, so the
// script runs from any checkout and any working directory. extension/tools -> repo root.
const root = fileURLToPath(new URL("../../", import.meta.url));
// SOURCE: the real Mira mark, 512x512 8-bit RGBA, non-interlaced.
// NOT public/brand/motif-orb.jpg — despite the extension, that file and eight
// of its neighbours are actually JPEGs, so they carry no alpha channel and a
// round toolbar icon cut from one would sit on an opaque rectangle.
const srcPath = resolve(root, "public/mira/mira-logo-color-512.png");
const outDir = resolve(root, "extension/icons");

// 1. Read source
let source;
try {
  source = readFileSync(srcPath);
} catch (err) {
  console.error(`ERROR: cannot read source: ${err.message}`);
  process.exit(1);
}

// 2. Verify PNG signature (8 bytes: 89 50 4E 47 0D 0A 1A 0A)
if (!source.slice(0, 8).equals(PNG_SIG)) {
  const actual = source.slice(0, 4).toString("hex");
  // Try to identify the actual format
  let fmt = "unknown";
  if (source[0] === 0xff && source[1] === 0xd8) fmt = "JPEG";
  else if (source[0] === 0x8b && source[1] === 0x47) fmt = "GZIP";
  else if (source.slice(0, 2).equals(Buffer.from("PK"))) fmt = "ZIP/PKWARE";
  else if (source[0] === 0x52 && source[1] === 0x44) fmt = "WebP/RIFF";

  console.error(
    `ERROR: source is not a PNG file (signature: ${actual}).`
  );
  console.error(`       Detected format: ${fmt}.`);
  console.error(`       This script only handles PNG sources.`);
  console.error(`       Source: ${srcPath}`);
  console.error(
    `       A PNG would begin with bytes 89 50 4E 47 0D 0A 1A 0A.`
  );
  console.error(
    `       Please convert the source to PNG first (e.g., via an image editor or dependency such as sharp/ffmpeg).`
  );
  process.exit(1);
}

// 3. Walk chunks: find IHDR, collect IDAT payload, locate IEND
let offset = 8;
let ihdrData = null;
let idatBuffers = [];
let hasPlte = false;

while (offset < source.length) {
  const length = source.readUInt32BE(offset);
  const type = source.slice(offset + 4, offset + 8).toString("ascii");
  const data = source.slice(offset + 8, offset + 8 + length);
  const crc = source.readUInt32BE(offset + 8 + length);

  // Verify CRC (optional safety check — not fatal)
  const expectedCrc = crc32(Buffer.concat([source.slice(offset + 4, offset + 8), data]));
  if (crc !== expectedCrc) {
    console.error(`WARNING: CRC mismatch on chunk "${type}" (got 0x${crc.toString(16)}, expected 0x${expectedCrc.toString(16)})`);
  }

  if (type === "IHDR") {
    if (ihdrData !== null) {
      console.error("ERROR: multiple IHDR chunks found.");
      process.exit(1);
    }
    ihdrData = data;
  } else if (type === "IDAT") {
    idatBuffers.push(data);
  } else if (type === "PLTE") {
    hasPlte = true;
  } else if (type === "IEND") {
    break; // done walking
  }

  offset += 12 + length;
  // Guard against runaway chunks
  if (offset > source.length + 100) {
    console.error("ERROR: chunk walk exceeded file size — file may be corrupted.");
    process.exit(1);
  }
}

if (!ihdrData) {
  console.error("ERROR: no IHDR chunk found in source PNG.");
  process.exit(1);
}

if (idatBuffers.length === 0) {
  console.error("ERROR: no IDAT chunks found in source PNG.");
  process.exit(1);
}

// 4. Parse IHDR
const w = ihdrData.readUInt32BE(0);
const h = ihdrData.readUInt32BE(4);
const bitDepth = ihdrData[8];
const colourType = ihdrData[9];
const compression = ihdrData[10];
const filterMethod = ihdrData[11];
const interlace = ihdrData[12];

console.log(`Source PNG: ${w}x${h}  bitDepth=${bitDepth}  colorType=${colourType}  compression=${compression}  filter=${filterMethod}  interlace=${interlace}`);

// 5. Validate — exit with honest failure if we cannot handle it
if (interlace === 1) {
  console.error(`ERROR: source is Adam7 interlaced. We do not support interlaced PNG decoding.`);
  console.error(`       Please convert the source to non-interlaced PNG (e.g., ImageMagick: convert input.png -interlace None out.png).`);
  process.exit(1);
}

if (bitDepth !== 8) {
  console.error(`ERROR: source bit depth is ${bitDepth} (we only support 8-bit).`);
  console.error(`       Please convert the source to 8-bit PNG.`);
  process.exit(1);
}

if (colourType === COLOR_TYPES.INDEXED) {
  console.error("ERROR: source uses indexed colour (palette). We do not handle palette decoding.");
  console.error(`       ${hasPlte ? "PLTE chunk found." : "No PLTE chunk found."}`);
  console.error(`       Please convert to truecolour+alpha (RGB or RGBA).`);
  process.exit(1);
}

if (colourType === COLOR_TYPES.GREYSCALE) {
  console.error("ERROR: source is greyscale. We only handle truecolour and truecolour+alpha.");
  process.exit(1);
}

if (colourType === COLOR_TYPES.GREY_ALPHA) {
  console.error("ERROR: source is greyscale+alpha. We only handle RGB and RGBA.");
  process.exit(1);
}

if (colourType !== COLOR_TYPES.TRUECOLOR && colourType !== COLOR_TYPES.RGBA) {
  console.error(`ERROR: unknown colour type ${colourType}.`);
  process.exit(1);
}

// colourType 2 = RGB (no alpha), 6 = RGBA (with alpha)
const hasAlpha = colourType === COLOR_TYPES.RGBA;
const channels = hasAlpha ? 4 : 3;

if (compression !== 0) {
  console.error(`ERROR: compression method ${compression} — PNG specifies method 0.`);
  process.exit(1);
}

if (filterMethod !== 0) {
  console.error(`ERROR: filter method ${filterMethod} — PNG specifies method 0.`);
  process.exit(1);
}

console.log(`OK: ${w}x${h}  ${hasAlpha ? "RGBA" : "RGB"}  8-bit  non-interlaced  — decodable.`);

// 6. Decompress IDAT → raw scanline bytes (with filter bytes prepended)
const idatData = Buffer.concat(idatBuffers);
let raw;
try {
  // PNG IDAT is a plain ZLIB stream (RFC 1950). windowBits 31 selects GZIP
  // framing and rejects it outright — that was the bug here. Pass no windowBits
  // and let zlib read the stream header it actually has.
  raw = inflateSync(idatData, { chunkSize: 1024 * 1024 });
} catch (err) {
  console.error(`ERROR: zlib inflate failed: ${err.message}`);
  console.error(`       The IDAT data may be corrupted or not actually deflate-compressed.`);
  process.exit(1);
}

// Bytes per scanline = ceil(width * channels * bitDepth / 8). The bug here was
// treating `channels` as bits-per-pixel: for 8-bit RGBA that gave 256 bytes per
// row instead of 2048, so a perfectly good image was rejected as corrupt.
const expectedRowBytes = (w * channels * bitDepth + 7) >>> 3;
const expectedRawLen = h * (1 + expectedRowBytes); // +1 per row for filter byte
if (raw.length !== expectedRawLen) {
  console.error(`ERROR: inflated data is ${raw.length} bytes but expected ${expectedRawLen} (${h} rows × (${expectedRowBytes}+1) bytes).`);
  console.error(`       Row byte count: ${expectedRowBytes} = ceil(${w}*${channels}*${bitDepth}/8)`);
  process.exit(1);
}

// 7. Undo filters → unfiltered pixel rows
//    filter types: 0=None 1=Sub 2=Up 3=Average 4=Paeth
const pixelData = Buffer.alloc(h * expectedRowBytes);

function undoFilter(type, rowStart, prevRowStart) {
  const filtered = raw.subarray(rowStart, rowStart + expectedRowBytes);
  const dest = pixelData.subarray(prevRowStart, prevRowStart + expectedRowBytes);

  if (type === 0) {
    // None: copy as-is
    filtered.copy(dest);
    return;
  }

  const src = Buffer.from(filtered); // need writable copy for in-place edits
  const bp = channels; // bytes per pixel (bitDepth is 8, so bpp = channels)

  if (type === 1) {
    // Sub: dst[i] = src[i] + dst[i-bp], for i >= bp
    for (let i = 0; i < expectedRowBytes; i++) {
      src[i] = (src[i] + (i >= bp ? dst[i - bp] : 0)) & 0xff;
    }
  } else if (type === 2) {
    // Up: dst[i] = src[i] + above[i]
    for (let i = 0; i < expectedRowBytes; i++) {
      src[i] = (src[i] + (prevRowStart >= 0 ? dst[i] : 0)) & 0xff;
    }
  } else if (type === 3) {
    // Average: dst[i] = src[i] + floor((left + above) / 2)
    for (let i = 0; i < expectedRowBytes; i++) {
      const left = i >= bp ? dst[i - bp] : 0;
      const above = prevRowStart >= 0 ? dst[i] : 0;
      src[i] = (src[i] + ((left + above) >>> 1)) & 0xff;
    }
  } else if (type === 4) {
    // Paeth: complex predictor
    for (let i = 0; i < expectedRowBytes; i++) {
      const a = i >= bp ? dst[i - bp] : 0;
      const b = prevRowStart >= 0 ? dst[i] : 0;
      const c = (prevRowStart >= 0 && i >= bp) ? dst[i - bp - expectedRowBytes] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      let pr;
      if (pa <= pa && pa <= pb) pr = a;
      else if (pb <= pc) pr = b;
      else pr = c;
      src[i] = (src[i] + pr) & 0xff;
    }
  }

  src.copy(dest);
}

// Rebuild with correct variable references
{
  const bp = channels; // bytes per pixel

  for (let y = 0; y < h; y++) {
    const rowStart = y * (1 + expectedRowBytes);
    const filterByte = raw[rowStart];
    const prevRowStart = y > 0 ? (y - 1) * expectedRowBytes : -1;
    const destOffset = y * expectedRowBytes;
    const dest = pixelData.subarray(destOffset, destOffset + expectedRowBytes);
    const src = Buffer.from(raw.subarray(rowStart + 1, rowStart + 1 + expectedRowBytes));

    if (filterByte === 0) {
      // None
      src.copy(dest);
    } else if (filterByte === 1) {
      // Sub
      for (let i = 0; i < expectedRowBytes; i++) {
        dest[i] = (src[i] + (i >= bp ? dest[i - bp] : 0)) & 0xff;
      }
    } else if (filterByte === 2) {
      // Up
      for (let i = 0; i < expectedRowBytes; i++) {
        dest[i] = (src[i] + (y > 0 ? pixelData.subarray((y - 1) * expectedRowBytes, y * expectedRowBytes)[i] : 0)) & 0xff;
      }
    } else if (filterByte === 3) {
      // Average
      for (let i = 0; i < expectedRowBytes; i++) {
        const left = i >= bp ? dest[i - bp] : 0;
        const above = y > 0 ? pixelData.subarray((y - 1) * expectedRowBytes, y * expectedRowBytes)[i] : 0;
        dest[i] = (src[i] + ((left + above) >>> 1)) & 0xff;
      }
    } else if (filterByte === 4) {
      // Paeth
      for (let i = 0; i < expectedRowBytes; i++) {
        const a = i >= bp ? dest[i - bp] : 0;
        const b = y > 0 ? pixelData.subarray((y - 1) * expectedRowBytes, y * expectedRowBytes)[i] : 0;
        const c = (y > 0 && i >= bp) ? pixelData.subarray((y - 1) * expectedRowBytes, y * expectedRowBytes)[i - bp] : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        let pr;
        if (pa <= pb && pa <= pc) pr = a;
        else if (pb <= pc) pr = b;
        else pr = c;
        dest[i] = (src[i] + pr) & 0xff;
      }
    } else {
      console.error(`ERROR: unknown filter type ${filterByte} at row ${y}.`);
      process.exit(1);
    }
  }
}

console.log(`Filtered → unfiltered: ${h} rows of ${expectedRowBytes} bytes, ${channels} channels/pixel.`);

// 8. Box-sample resize function
//    For each destination pixel, average all source pixels that map to it.
//    This is a proper box filter, not nearest-neighbour.
//
//    Mapping: dst_pixel i covers src range [floor(i * srcSize / dstSize), ceil((i+1) * srcSize / dstSize))
//
function boxSample(srcW, srcH, dstW, dstH, srcPixels) {
  const dstBpp = channels;
  const dstRowBytes = dstW * dstBpp;
  const out = Buffer.alloc(dstH * dstRowBytes);

  for (let dy = 0; dy < dstH; dy++) {
    // Source row range that maps to this destination row
    const sr0 = (dy * srcH) / dstH;
    const sr1 = ((dy + 1) * srcH) / dstH;
    const sr0Floor = Math.floor(sr0);
    const sr1Floor = Math.floor(sr1);

    for (let dx = 0; dx < dstW; dx++) {
      const sc0 = (dx * srcW) / dstW;
      const sc1 = ((dx + 1) * srcW) / dstW;
      const sc0Floor = Math.floor(sc0);
      const sc1Floor = Math.floor(sc1);

      // Sum all source pixels in the rectangle [sc0Floor..sc1Floor] x [sr0Floor..sr1Floor]
      let r = 0, g = 0, b = 0, a = 0;
      let count = 0;

      for (let sy = sr0Floor; sy <= sr1Floor; sy++) {
        const srcRowStart = sy * srcW * dstBpp;
        const yw = Math.min(sy, srcH - 1); // clamp
        for (let sx = sc0Floor; sx <= sc1Floor; sx++) {
          const p = Math.min(sx, srcW - 1); // clamp
          const off = (yw * srcW + p) * dstBpp;
          r += srcPixels[off];
          g += srcPixels[off + 1];
          b += srcPixels[off + 2];
          a += srcPixels[off + 3];
          count++;
        }
      }

      const outOff = (dy * dstW + dx) * dstBpp;
      out[outOff] = Math.round(r / count);
      out[outOff + 1] = Math.round(g / count);
      out[outOff + 2] = Math.round(b / count);
      out[outOff + 3] = Math.round(a / count);
    }
  }

  return out;
}

// 9. Reshape source pixel data to RGBA (add alpha channel if source is RGB)
let srcPixels;
if (hasAlpha) {
  // Already RGBA, just copy
  srcPixels = Buffer.from(pixelData);
} else {
  // RGB → RGBA: insert alpha=255 for each pixel
  const rgba = Buffer.alloc(h * w * 4);
  for (let i = 0; i < h * w; i++) {
    rgba[i * 4] = pixelData[i * 3];
    rgba[i * 4 + 1] = pixelData[i * 3 + 1];
    rgba[i * 4 + 2] = pixelData[i * 3 + 2];
    rgba[i * 4 + 3] = 255;
  }
  srcPixels = rgba;
}

console.log(`Source pixels: ${h * w} RGBA pixels (${srcPixels.length} bytes).`);

// 10. Generate each target size
mkdirSync(outDir, { recursive: true });

for (const size of TARGET_SIZES) {
  console.log(`\n── Resizing ${w}x${h} → ${size}x${size} ──`);

  const sampled = boxSample(w, h, size, size, srcPixels);
  console.log(`  Box-sampled: ${sampled.length} bytes (${size}x${size} RGBA)`);

  // Re-encode as PNG
  // Each row gets filter byte 0 (None) since we pre-filter
  const outRowBytes = size * channels;
  const scanlines = Buffer.alloc(size * (1 + outRowBytes));
  for (let y = 0; y < size; y++) {
    scanlines[y * (1 + outRowBytes)] = 0; // filter = None
    sampled.copy(scanlines, y * (1 + outRowBytes) + 1, y * outRowBytes, (y + 1) * outRowBytes);
  }

  // Deflate
  let compressed;
  try {
    compressed = deflateSync(scanlines, { level: 9, chunkSize: 1024 * 1024 });
  } catch (err) {
    console.error(`ERROR: deflate failed for ${size}px: ${err.message}`);
    process.exit(1);
  }

  // Build PNG
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = hasAlpha ? COLOR_TYPES.RGBA : COLOR_TYPES.TRUECOLOR;
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const png = Buffer.concat([
    PNG_SIG,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", compressed),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);

  const outPath = resolve(outDir, `icon${size}.png`);
  writeFileSync(outPath, png);
  console.log(`  Wrote: ${outPath} (${png.length} bytes)`);
}

console.log("\nDone. All icons generated.");
