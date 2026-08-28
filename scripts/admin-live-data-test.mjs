import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (p.includes('node_modules')) continue;
    if (statSync(p).isDirectory()) {
      out.push(...walk(p));
    } else if (p.endsWith('.ts') || p.endsWith('.tsx')) {
      out.push(p);
    }
  }
  return out;
}

function read(p) {
  return readFileSync(p, 'utf8');
}

test('ADMIN LIVE: the stub is gone', () => {
  assert.equal(
    existsSync('src/lib/admin-stub.ts'),
    false,
    'admin-stub.ts must stay deleted - it was the source of every fabricated admin number'
  );
});

test('ADMIN LIVE: nothing imports admin-stub', () => {
  const offenders = walk('src').filter((p) => read(p).includes('admin-stub'));
  assert.deepEqual(offenders, []);
});

test('ADMIN LIVE: no fabricated figures survive', () => {
  // These exact tokens are the stub fingerprints; their absence is the
  // cheapest proof the fiction did not creep back.
  const tokens = ['312.4', '884.0', 'REVENUE_VS_COST_14D', 'getProviderHealth', 'getRefundRequests', 'getUsageHistory'];
  const files = [...walk('src/app/admin'), ...walk('src/components/admin')];
  const offenders = [];
  for (const p of files) {
    const hits = tokens.filter((t) => read(p).includes(t));
    if (hits.length > 0) offenders.push(p + ' -> ' + hits.join(', '));
  }
  assert.deepEqual([], offenders);
});

test('ADMIN LIVE: admin pages import the live layer', () => {
  const pages = [
    'src/app/admin/page.tsx',
    'src/app/admin/customers/page.tsx',
    'src/app/admin/billing/page.tsx'
  ];
  for (const p of pages) {
    assert.ok(read(p).includes('admin-data'), p + ' must import the live admin-data layer');
  }
  const route = read('src/app/api/admin/customers/route.ts');
  assert.ok(route.includes('getAdminCustomers'), 'customers route must read through getAdminCustomers');
  // The privacy projection survived the rewire.
  assert.ok(route.includes('toAdminCustomerMetadata'), 'customers route must project through toAdminCustomerMetadata');
});

test('ADMIN LIVE: unavailable metrics are declarations, not zeros', () => {
  for (const p of ['src/app/admin/page.tsx', 'src/app/admin/billing/page.tsx']) {
    const text = read(p);
    assert.ok(text.includes('UnavailableValue'), p + ' must declare unavailable metrics via UnavailableValue');
    assert.equal(
      text.includes('usd('),
      false,
      p + ': the currency formatter has no truthful input on this page any more'
    );
  }
});
