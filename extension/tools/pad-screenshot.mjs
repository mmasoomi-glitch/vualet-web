#!/usr/bin/env -S node --no-warnings
//
// pad-screenshot.mjs — resize a browser-side-panel screenshot to a Chrome Web Store
//                       asset: fit inside 1280×800 (or 640×400) centred on a solid
//                       background, emitting 8-bit RGB (colour type 2).
//
// Dependencies: NONE (node:fs, node:path, node:zlib only)
//
// USAGE:
//   node extension/tools/pad-screenshot.mjs <input.png> [--size 1280x800] [--out <path>] [--bg RRGGBB]
//
// PNG FORMAT REFERENCE (RFC 2083):
// ───────────────────────────────
// A PNG file is an 8-byte signature followed by a sequence of chunks.
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
//   PLTE — palette (required for colour type 3; invalid with types 2, 4, 6)
//   IDAT — one or more image data chunks, each containing compressed scanlines
//   IEND — end marker (zero-length data)
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
//   row_bytes = floor((width * bitsPerPixel + 7) / 8)
//   This is ceil(width * channels * bitDepth / 8) when bitDepth=8.
//   NOTE: NOT width * channels — that only works when bitDepth is a
//   multiple of 8 AND channels is already in bytes (i.e. for 8-bit RGB/A).
//   The formula above is the one PNG actually uses and avoids off-by-one.
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

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, basename, extname, join } from "node:path";
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

// ─── Colour type constants ────────────────────────────────────────────────────
const COLOR_TYPES = {
  GREYSCALE: 0,
  TRUECOLOR: 2,
  INDEXED: 3,
  GREY_ALPHA: 4,
  RGBA: 6,
};

// ─── Argument parsing ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error(
    "ERROR: no input file specified.\n" +
    "Usage: node extension/tools/pad-screenshot.mjs <input.png> [--size 1280x800] [--out <path>] [--bg RRGGBB]"
  );
  process.exit(1);
}

const inputPath = args[0];

let targetW = 1280;
let targetH = 800;
let outputPath = null;
let bgHex = "F6F3EC";

for (let i = 1; i < args.length; i++) {
  const a = args[i];
  if (a === "--size" && args[i + 1]) {
    const m = args[++i].match(/^(\d+)x(\d+)$/);
    if (!m) {
      console.error(`ERROR: --size value "${args[i]}" is not WxH (e.g., 1280x800).`);
      process.exit(1);
    }
    targetW = parseInt(m[1], 10);
    targetH = parseInt(m[2], 10);
  } else if (a === "--out" && args[i + 1]) {
    outputPath = resolve(process.cwd(), args[++i]);
  } else if (a === "--bg" && args[i + 1]) {
    const val = args[++i];
    if (!/^[0-9a-fA-F]{6}$/.test(val)) {
      console.error(`ERROR: --bg value "${val}" is not a 6-digit hex colour (e.g., F6F3EC).`);
      process.exit(1);
    }
    bgHex = val;
  } else {
    console.error(`ERROR: unknown argument "${a}".`);
    process.exit(1);
  }
}

// Parse background colour into R, G, B components
const bgR = parseInt(bgHex.slice(0, 2), 16);
const bgG = parseInt(bgHex.slice(2, 4), 16);
const bgB = parseInt(bgHex.slice(4, 6), 16);

// Default output path: same stem as input, target size appended, .png extension
if (!outputPath) {
  const base = basename(inputPath, extname(inputPath));
  const dir = dirname(inputPath);
  outputPath = resolve(dir, `${base}-${targetW}x${targetH}.png`);
}

console.log(`Input:  ${inputPath}`);
console.log(`Target: ${targetW}x${targetH}`);
console.log(`Output: ${outputPath}`);

// ─── 1. Read input PNG ────────────────────────────────────────────────────────
let source;
try {
  source = readFileSync(inputPath);
} catch (err) {
  console.error(`ERROR: cannot read input: ${err.message}`);
  process.exit(1);
}

// Verify PNG signature (8 bytes: 89 50 4E 47 0D 0A 1A 0A)
if (!source.slice(0, 8).equals(PNG_SIG)) {
  console.error(
    `ERROR: input is not a PNG file (first 4 bytes: 0x${source.slice(0, 4).toString("hex")}).`
  );
  console.error(`       A PNG would begin with bytes 89 50 4E 47 0D 0A 1A 0A.`);
  process.exit(1);
}

// ─── 2. Walk chunks: find IHDR, collect IDAT payload ──────────────────────────
let offset = 8;
let ihdrData = null;
let idatBuffers = [];

while (offset < source.length) {
  const length = source.readUInt32BE(offset);
  const type = source.slice(offset + 4, offset + 8).toString("ascii");
  const data = source.slice(offset + 8, offset + 8 + length);

  if (type === "IHDR") {
    ihdrData = data;
  } else if (type === "IDAT") {
    idatBuffers.push(data);
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
  console.error("ERROR: no IHDR chunk found in input PNG.");
  process.exit(1);
}

if (idatBuffers.length === 0) {
  console.error("ERROR: no IDAT chunks found in input PNG.");
  process.exit(1);
}

// ─── 3. Parse IHDR ────────────────────────────────────────────────────────────
const srcW = ihdrData.readUInt32BE(0);
const srcH = ihdrData.readUInt32BE(4);
const bitDepth = ihdrData[8];
const colourType = ihdrData[9];
const interlace = ihdrData[12];

console.log(
  `IHDR: ${srcW}x${srcH}  bitDepth=${bitDepth}  colorType=${colourType}  interlace=${interlace}`
);

// Validate: reject what we cannot handle (no guessing, no pixel invention)
if (interlace === 1) {
  console.error(
    `ERROR: input is Adam7 interlaced. We do not support interlaced PNG decoding.`
  );
  console.error(`       Please convert to non-interlaced PNG first.`);
  process.exit(1);
}

if (bitDepth !== 8) {
  console.error(
    `ERROR: input bit depth is ${bitDepth} (we only support 8-bit).`
  );
  console.error(`       Please convert to 8-bit PNG first.`);
  process.exit(1);
}

if (colourType === COLOR_TYPES.INDEXED) {
  console.error(
    "ERROR: input uses indexed colour (palette). We do not handle palette decoding."
  );
  console.error(`       Please convert to truecolour (RGB or RGBA).`);
  process.exit(1);
}

if (colourType === COLOR_TYPES.GREYSCALE) {
  console.error("ERROR: input is greyscale. We only handle RGB and RGBA.");
  process.exit(1);
}

if (colourType === COLOR_TYPES.GREY_ALPHA) {
  console.error("ERROR: input is greyscale+alpha. We only handle RGB and RGBA.");
  process.exit(1);
}

if (colourType !== COLOR_TYPES.TRUECOLOR && colourType !== COLOR_TYPES.RGBA) {
  console.error(`ERROR: unknown colour type ${colourType}.`);
  process.exit(1);
}

// colourType 2 = RGB (no alpha), 6 = RGBA (with alpha)
const hasAlpha = colourType === COLOR_TYPES.RGBA;
const channels = hasAlpha ? 4 : 3;

console.log(
  `Decoding: ${srcW}x${srcH}  ${hasAlpha ? "RGBA" : "RGB"}  8-bit  non-interlaced`
);

// ─── 4. Decompress IDAT → raw scanline bytes (with filter bytes prepended) ─────
const idatData = Buffer.concat(idatBuffers);
let raw;
try {
  // PNG IDAT is a plain ZLIB stream (RFC 1950). Pass no windowBits
  // and let zlib read the stream header it actually has.
  raw = inflateSync(idatData, { chunkSize: 1024 * 1024 });
} catch (err) {
  console.error(`ERROR: zlib inflate failed: ${err.message}`);
  process.exit(1);
}

// Bytes per scanline = ceil(width * channels * bitDepth / 8).
// This is the correct PNG formula: floor((width * bitsPerPixel + 7) / 8).
// NOTE: NOT width * channels — that would be wrong when channels is
// expressed in bytes but the formula expects bits-per-pixel.
// For 8-bit RGBA (4 channels): ceil(w*32/8) = 4w (correct).
// For 8-bit RGB  (3 channels): ceil(w*24/8) = 3w (correct).
const expectedRowBytes = (srcW * channels * bitDepth + 7) >>> 3;
const expectedRawLen = srcH * (1 + expectedRowBytes); // +1 per row for filter byte
if (raw.length !== expectedRawLen) {
  console.error(
    `ERROR: inflated data is ${raw.length} bytes but expected ${expectedRawLen} (${srcH} rows × (${expectedRowBytes}+1) bytes).`
  );
  console.error(
    `       Row byte count: ${expectedRowBytes} = ceil(${srcW}*${channels}*${bitDepth}/8)`
  );
  process.exit(1);
}

// ─── 5. Undo filters → unfiltered pixel rows ──────────────────────────────────
const pixelData = Buffer.alloc(srcH * expectedRowBytes);
const bp = channels; // bytes per pixel (bitDepth is 8, so bytes-per-pixel = channels)

for (let y = 0; y < srcH; y++) {
  const rowStart = y * (1 + expectedRowBytes);
  const filterByte = raw[rowStart];
  const prevRowStart = y > 0 ? (y - 1) * expectedRowBytes : -1;
  const destOffset = y * expectedRowBytes;
  const dest = pixelData.subarray(destOffset, destOffset + expectedRowBytes);
  const src = Buffer.from(raw.subarray(rowStart + 1, rowStart + 1 + expectedRowBytes));

  if (filterByte === 0) {
    // None: copy as-is
    src.copy(dest);
  } else if (filterByte === 1) {
    // Sub: dst[i] = src[i] + dst[i-bp]
    for (let i = 0; i < expectedRowBytes; i++) {
      dest[i] = (src[i] + (i >= bp ? dest[i - bp] : 0)) & 0xff;
    }
  } else if (filterByte === 2) {
    // Up: dst[i] = src[i] + above[i]
    for (let i = 0; i < expectedRowBytes; i++) {
      dest[i] = (src[i] + (y > 0 ? pixelData[(y - 1) * expectedRowBytes + i] : 0)) & 0xff;
    }
  } else if (filterByte === 3) {
    // Average: dst[i] = src[i] + floor((left + above) / 2)
    for (let i = 0; i < expectedRowBytes; i++) {
      const left = i >= bp ? dest[i - bp] : 0;
      const above = y > 0 ? pixelData[(y - 1) * expectedRowBytes + i] : 0;
      dest[i] = (src[i] + ((left + above) >>> 1)) & 0xff;
    }
  } else if (filterByte === 4) {
    // Paeth: complex predictor
    for (let i = 0; i < expectedRowBytes; i++) {
      const a = i >= bp ? dest[i - bp] : 0;
      const b = y > 0 ? pixelData[(y - 1) * expectedRowBytes + i] : 0;
      const c = (y > 0 && i >= bp) ? pixelData[(y - 1) * expectedRowBytes + i - bp] : 0;
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

console.log(`Decoded: ${srcH} rows of ${expectedRowBytes} bytes, ${channels} channels/pixel.`);

// ─── 6. Reshape source pixels to RGBA (add alpha if source is RGB) ────────────
let srcPixels;
if (hasAlpha) {
  srcPixels = Buffer.from(pixelData);
} else {
  const rgba = Buffer.alloc(srcH * srcW * 4);
  for (let i = 0; i < srcH * srcW; i++) {
    rgba[i * 4] = pixelData[i * 3];
    rgba[i * 4 + 1] = pixelData[i * 3 + 1];
    rgba[i * 4 + 2] = pixelData[i * 3 + 2];
    rgba[i * 4 + 3] = 255;
  }
  srcPixels = rgba;
}

// ─── 7. Compute scale factor and fit inside target ────────────────────────────
// Scale down to fit within target dimensions while preserving aspect ratio.
// Never upscale — upscaling a screenshot is blurry and reviewers notice.
const scaleX = targetW / srcW;
const scaleY = targetH / srcH;
const scale = Math.min(scaleX, scaleY, 1); // cap at 1 (no upscale)

let fitW = Math.round(srcW * scale);
let fitH = Math.round(srcH * scale);

console.log(
  `Aspect ratio: source ${srcW}/${srcH} = ${(srcW / srcH).toFixed(4)}, ` +
  `target ${targetW}/${targetH} = ${(targetW / targetH).toFixed(4)}`
);
console.log(`Scale factor: ${scale.toFixed(6)} (${srcW}x${srcH} → ${fitW}x${fitH})`);

// ─── 8. Box-sample resize function ────────────────────────────────────────────
// For each destination pixel, average all source pixels that map to it.
// This is a proper box filter, not nearest-neighbour.
//
// Mapping: dst_pixel i covers src range [floor(i * srcSize / dstSize), ceil((i+1) * srcSize / dstSize))
//
function boxSample(srcW, srcH, dstW, dstH, srcPixels) {
  const dstBpp = 4; // always RGBA internally for the canvas
  const dstRowBytes = dstW * dstBpp;
  const out = Buffer.alloc(dstH * dstRowBytes);

  for (let dy = 0; dy < dstH; dy++) {
    const sr0 = (dy * srcH) / dstH;
    const sr1 = ((dy + 1) * srcH) / dstH;
    const sr0Floor = Math.floor(sr0);
    const sr1Floor = Math.floor(sr1);

    for (let dx = 0; dx < dstW; dx++) {
      const sc0 = (dx * srcW) / dstW;
      const sc1 = ((dx + 1) * srcW) / dstW;
      const sc0Floor = Math.floor(sc0);
      const sc1Floor = Math.floor(sc1);

      let r = 0, g = 0, b = 0, a = 0;
      let count = 0;

      for (let sy = sr0Floor; sy <= sr1Floor; sy++) {
        const yw = Math.min(sy, srcH - 1);
        for (let sx = sc0Floor; sx <= sc1Floor; sx++) {
          const p = Math.min(sx, srcW - 1);
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

const sampled = boxSample(srcW, srcH, fitW, fitH, srcPixels);
console.log(`Box-sampled: ${fitW}x${fitH} RGBA = ${sampled.length} bytes.`);

// ─── 9. Centre the scaled image on target canvas with solid background ────────
// Canvas is targetW × targetH, colour type 2 (RGB, no alpha).
// Background is a solid fill colour (default: warm paper #F6F3EC).
// The scaled image is centred horizontally and vertically on this canvas.
//
// Colour type 2 output: 3 bytes per pixel (RGB), no alpha channel.
// Store-alpha is shown on an opaque page so alpha buys nothing.
//
const canvasRowBytes = targetW * 3; // colour type 2 = RGB
const canvas = Buffer.alloc(targetH * canvasRowBytes);

// Fill entire canvas with background colour
for (let y = 0; y < targetH; y++) {
  const rowOff = y * canvasRowBytes;
  for (let x = 0; x < targetW; x++) {
    const p = x * 3;
    canvas[rowOff + p] = bgR;
    canvas[rowOff + p + 1] = bgG;
    canvas[rowOff + p + 2] = bgB;
  }
}

// Centre offsets
const offsetX = Math.floor((targetW - fitW) / 2);
const offsetY = Math.floor((targetH - fitH) / 2);

// Copy sampled image onto canvas, converting RGBA → RGB as we go
for (let sy = 0; sy < fitH; sy++) {
  const canvasY = offsetY + sy;
  const canvasRowOff = canvasY * canvasRowBytes;
  const srcRowOff = sy * fitW * 4;

  for (let sx = 0; sx < fitW; sx++) {
    const canvasX = offsetX + sx;
    const canvasPixOff = canvasRowOff + canvasX * 3;
    const srcPixOff = srcRowOff + sx * 4;

    canvas[canvasPixOff] = sampled[srcPixOff]; // R
    canvas[canvasPixOff + 1] = sampled[srcPixOff + 1]; // G
    canvas[canvasPixOff + 2] = sampled[srcPixOff + 2]; // B
    // Alpha is discarded — colour type 2 has no alpha channel
  }
}

console.log(
  `Centred ${fitW}x${fitH} on ${targetW}x${targetH} canvas (bg #${bgHex}, offset ${offsetX},${offsetY}).`
);

// ─── 10. Re-encode as 8-bit RGB (colour type 2) PNG ───────────────────────────
// Each row gets filter byte 0 (None) since we pre-computed the final pixels.
//
const scanlines = Buffer.alloc(targetH * (1 + canvasRowBytes));
for (let y = 0; y < targetH; y++) {
  scanlines[y * (1 + canvasRowBytes)] = 0; // filter = None
  canvas.copy(
    scanlines,
    y * (1 + canvasRowBytes) + 1,
    y * canvasRowBytes,
    (y + 1) * canvasRowBytes
  );
}

// Deflate with maximum compression
let compressed;
try {
  compressed = deflateSync(scanlines, { level: 9, chunkSize: 1024 * 1024 });
} catch (err) {
  console.error(`ERROR: deflate failed: ${err.message}`);
  // Delete partial output if any
  try { writeFileSync(outputPath, Buffer.alloc(0)); } catch {}
  process.exit(1);
}

// Build IHDR for colour type 2 (RGB), 8-bit, no interlace
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(targetW, 0);
ihdr.writeUInt32BE(targetH, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = COLOR_TYPES.TRUECOLOR; // colour type 2 = RGB
ihdr[10] = 0; // compression method
ihdr[11] = 0; // filter method
ihdr[12] = 0; // interlace = none

// Assemble final PNG
const png = Buffer.concat([
  PNG_SIG,
  makeChunk("IHDR", ihdr),
  makeChunk("IDAT", compressed),
  makeChunk("IEND", Buffer.alloc(0)),
]);

// Write output
try {
  writeFileSync(outputPath, png);
} catch (err) {
  console.error(`ERROR: cannot write output: ${err.message}`);
  process.exit(1);
}

console.log(`Wrote: ${outputPath} (${png.length} bytes).`);

// ─── 11. Self-check: re-read output, parse IHDR, assert dimensions ─────────────
// A store asset that is one pixel off is rejected by the Chrome Web Store.
// Finding that out from Google is a slow way to learn.
console.log("\n── Self-check ──");
let check;
try {
  check = readFileSync(outputPath);
} catch (err) {
  console.error(`ERROR: cannot re-read output for self-check: ${err.message}`);
  try {
    require("node:fs").unlinkSync(outputPath);
  } catch {}
  process.exit(1);
}

if (!check.slice(0, 8).equals(PNG_SIG)) {
  console.error("ERROR: output file does not have a valid PNG signature.");
  process.exit(1);
}

// Walk chunks to find IHDR
let co = 8;
let foundIhdr = null;
while (co < check.length) {
  const cl = check.readUInt32BE(co);
  const ct = check.slice(co + 4, co + 8).toString("ascii");
  if (ct === "IHDR") {
    foundIhdr = check.slice(co + 8, co + 8 + cl);
    break;
  } else if (ct === "IEND") {
    break;
  }
  co += 12 + cl;
  if (co > check.length + 100) break;
}

if (!foundIhdr) {
  console.error("ERROR: output file has no IHDR chunk.");
  process.exit(1);
}

const checkW = foundIhdr.readUInt32BE(0);
const checkH = foundIhdr.readUInt32BE(4);

if (checkW !== targetW || checkH !== targetH) {
  console.error(
    `ERROR: self-check FAILED — output IHDR says ${checkW}x${checkH} but expected ${targetW}x${targetH}.`
  );
  console.error("       Deleting output file.");
  try {
    require("node:fs").unlinkSync(outputPath);
  } catch {}
  process.exit(1);
}

console.log(`Self-check PASSED: output IHDR confirms ${checkW}x${checkH} (expected ${targetW}x${targetH}).`);

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log("\n── Summary ──");
console.log(`  Input dimensions:      ${srcW}x${srcH}`);
console.log(`  Scale factor applied:  ${scale.toFixed(6)}`);
console.log(`  Output dimensions:     ${targetW}x${targetH}`);
console.log(`  Output path:           ${outputPath}`);
console.log(`  Output file size:      ${png.length} bytes`);
console.log("Done.");
