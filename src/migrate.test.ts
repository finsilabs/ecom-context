import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { migrateContext, migrateDir } from './migrate.js';
import { ContextStore } from './store.js';
import { compileConstraints } from './check.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('migrate', () => {
  it('converts the pre-v1 small fixture as committed at 4d51385 into a loadable v1 store', () => {
    const d = mkdtempSync(join(tmpdir(), 'ecom-context-mig-'));
    for (const f of ['channels.json', 'governance.json', 'history.json', 'memory.json']) writeFileSync(join(d, f), readFileSync(join(ROOT, 'benchmark/legacy-fixture', f)));
    const warnings = migrateDir(d);
    assert.deepEqual(warnings, []);
    assert.ok(existsSync(join(d, 'channels.json.migrated')) && !existsSync(join(d, 'channels.json')));
    const ctx = new ContextStore(d).load();
    assert.equal(ctx.targets.length, 2); assert.equal(ctx.governance.find((r) => r.id === 'gov_discount_cap')?.op, 'gt');
    assert.ok(ctx.brand.includes('Marrow & Co')); assert.ok(ctx.history.some((x) => x.id === 'dec_ap_meta_creative' && x.action === 'test'));
    assert.deepEqual(compileConstraints(ctx, ctx.targets).map((c) => [c.target, c.constraint]), [['email', 'protect'], ['meta', 'no_start']]);
  });
  it('drops notes over the brand cap with a warning and refuses to migrate twice', () => {
    const big = 'x'.repeat(3000);
    const { ctx, warnings } = migrateContext({ channels: [], rules: [], decisions: [], notes: [{ id: 'a', text: big }, { id: 'b', text: big }] });
    assert.equal(ctx.brand, big); assert.match(warnings[0], /note b dropped/);
    const d = mkdtempSync(join(tmpdir(), 'ecom-context-mig-')); writeFileSync(join(d, 'memory.json'), '{"notes":[]}'); migrateDir(d);
    writeFileSync(join(d, 'memory.json'), '{"notes":[]}'); assert.throws(() => migrateDir(d), /already has targets.json/);
  });
});
