# -*- coding: utf-8 -*-
# Mechanical splice of the judge-approved contact-signal counters into wa-observe.mjs
import hashlib, shutil, sys, time

F = r'C:\Ballerina-Motasadea-V1\apps\engine\src\wa-observe.mjs'
raw = open(F, 'rb').read()
crlf = b'\r\n' in raw
text = raw.decode('utf-8')
flat = text.replace('\r\n', '\n')

IMPORT_ANCHOR = "import { getDb } from '@mira/state';\n"
IMPORT_NEW = "import { getDb } from '@mira/state';\nimport { createHash } from 'node:crypto';\n"

FUNC_ANCHOR = """export async function observeOutgoing(tenantId, chatJid, text) {
  if (!tenantId || typeof text !== 'string' || !text) return;

  try {
    if ((await getObservationConsent(tenantId)) !== 'granted') return;

    ensureSweepTimer();
"""

FUNC_NEW = """// The classifier stores only this hash, never a number (owner ruling 2026-08-31).
function contactRef(chatJid) {
  const basis = waExternalId(chatJid) || String(chatJid);
  return createHash('sha256').update(basis).digest('hex').slice(0, 16);
}

async function bumpContactSignal(tenantId, chatJid) {
  await getDb().query(
    `INSERT INTO contact_signals (tenant_id, contact_ref, msgs_out, customer_initiated)
     VALUES ($1, $2, 1, 1)
     ON CONFLICT (tenant_id, contact_ref) DO UPDATE SET
       msgs_out = contact_signals.msgs_out + 1,
       -- A message after 4+ quiet hours counts as the customer starting a conversation - the initiation signal for VIP scoring.
       customer_initiated = contact_signals.customer_initiated + CASE WHEN contact_signals.last_seen < now() - interval '4 hours' THEN 1 ELSE 0 END,
       last_seen = now()`,
    [tenantId, contactRef(chatJid)]
  );
}

export async function observeOutgoing(tenantId, chatJid, text) {
  if (!tenantId || typeof text !== 'string' || !text) return;

  try {
    if ((await getObservationConsent(tenantId)) !== 'granted') return;

    if (chatJid) bumpContactSignal(tenantId, chatJid).catch(() => {});

    ensureSweepTimer();
"""

for name, needle in (('state import', IMPORT_ANCHOR), ('observeOutgoing head', FUNC_ANCHOR)):
    c = flat.count(needle)
    if c != 1:
        print(f'ABORT: {name} anchor count {c}'); sys.exit(1)
    print(f'  anchor ok: {name}')
if 'contact_signals' in flat or 'contactRef' in flat:
    print('ABORT: already applied'); sys.exit(1)

out = flat.replace(IMPORT_ANCHOR, IMPORT_NEW).replace(FUNC_ANCHOR, FUNC_NEW)
if crlf:
    out = out.replace('\n', '\r\n')

bak = F + '.bak-signals-' + time.strftime('%Y%m%d-%H%M%S')
shutil.copy2(F, bak)
open(F, 'wb').write(out.encode('utf-8'))
print('  backup:', bak)
print('  new sha:', hashlib.sha256(out.encode('utf-8')).hexdigest()[:16])
print('  contact_signals refs:', out.count('contact_signals'))
print('  bump call guarded:', out.count('if (chatJid) bumpContactSignal'))
