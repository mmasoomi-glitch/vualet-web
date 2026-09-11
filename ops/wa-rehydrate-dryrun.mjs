/**
 * wa-rehydrate-dryrun.mjs — STRICTLY READ-ONLY diagnostic.
 *
 * Mira's WhatsApp gateway went dead on 2026-09-07. Every on-disk Baileys
 * credential file was deleted, so no device is linked and Mira can neither
 * send nor receive. Three sessions still hold an `encrypted_auth` blob in
 * Postgres. This script answers one question: is that blob usable?
 *
 * It runs SELECTs only. It writes nothing, restarts nothing, and prints no
 * secret — only shapes, key names, lengths and booleans.
 *
 * Run it from /opt/mira so that `pg` resolves:
 *
 *   cd /opt/mira && sudo -u mira env \
 *     $(grep -E '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|CONTENT_KEK)=' .env | xargs) \
 *     WA_CRYPTO_PATH=/opt/mira/packages/state/src/crypto.mjs \
 *     node ops/wa-rehydrate-dryrun.mjs
 *
 * Result when run on 2026-09-11: all three rows listed, `kekConfigured()`
 * returned true, and `decrypt()` failed with "Unsupported state or unable to
 * authenticate data" — an AES-GCM authentication-tag failure. Why that is has
 * NOT been established; do not assume the key rotated without checking.
 *
 * Authored by qwen3-coder via the sophia MCP.
 */
import pg from "pg";
import { pathToFileURL } from "node:url";

let c;
try {
  c = new pg.Client();
  await c.connect();

  const { rows } = await c.query(
    "SELECT id, tenant_id, connection_status, kek_version, last_connected_at, octet_length(encrypted_auth) AS bytes " +
      "FROM whatsapp_sessions WHERE connection_status = $1 AND encrypted_auth IS NOT NULL " +
      "ORDER BY last_connected_at DESC",
    ["connected"],
  );

  if (!rows.length) {
    console.log("NO RESTORABLE SESSIONS");
    process.exit(0);
  }
  for (const r of rows) {
    console.log(
      "ROW " + r.id + " tenant=" + r.tenant_id + " kek=" + r.kek_version +
        " bytes=" + r.bytes + " last=" + r.last_connected_at,
    );
  }

  const cryptoMod = await import(pathToFileURL(process.env.WA_CRYPTO_PATH).href);
  console.log("kekConfigured:", cryptoMod.kekConfigured());

  const first = rows[0];
  const { rows: sRows } = await c.query(
    "SELECT encrypted_auth FROM whatsapp_sessions WHERE id = $1",
    [first.id],
  );

  const decrypted = await cryptoMod.decrypt(first.tenant_id, sRows[0].encrypted_auth);
  let obj = decrypted;
  if (typeof decrypted === "string") obj = JSON.parse(decrypted);
  const creds = obj.creds || obj;

  console.log("type:", typeof decrypted);
  console.log("objKeys:", Object.keys(obj).sort().join(","));
  console.log("credsKeys:", Object.keys(creds).sort().join(","));

  // The fields Baileys needs before it will consider a session logged in.
  for (const f of [
    "noiseKey", "pairingEphemeralKeyPair", "signedIdentityKey", "signedPreKey",
    "registrationId", "advSecretKey", "me", "account", "signalIdentities",
    "myAppStateKeyId", "registered", "platform",
  ]) {
    console.log("  " + f + ": " + (creds[f] !== undefined ? "PRESENT" : "MISSING"));
  }

  const isReg = !!creds.registered;
  const hasMe = !!(creds.me && creds.me.id);
  const hasSig = Array.isArray(creds.signalIdentities) && creds.signalIdentities.length > 0;
  console.log("VERDICT registered=" + isReg + " meHasId=" + hasMe + " signalIdentities=" + hasSig);
  if (!hasMe || !isReg) {
    console.log("=> EXPLAINS not-logged-in: Baileys will attempt fresh registration.");
  } else {
    console.log("=> AUTH LOOKS COMPLETE: failure is elsewhere.");
  }

  // Counts only — never values.
  if (obj.keys && typeof obj.keys === "object") {
    const n = {};
    for (const k of Object.keys(obj.keys)) {
      const p = k.split("-")[0];
      n[p] = (n[p] || 0) + 1;
    }
    console.log("keyCounts:", JSON.stringify(n));
  }
} catch (e) {
  console.error("ERR:", e.message);
  process.exitCode = 1;
} finally {
  if (c) await c.end();
}
