import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ContextStore, StoreError } from './store.js';

const dir = () => mkdtempSync(join(tmpdir(), 'ecom-context-'));
const meta = { id: 'meta', name: 'Meta', kind: 'channel', status: 'paused', aliases: ['facebook'] };
const seed = (d: string, extra: Record<string, unknown> = {}) => {
  writeFileSync(join(d, 'targets.json'), JSON.stringify({ targets: [meta, ...((extra.targets as unknown[]) ?? [])] }));
  if (extra.rules) writeFileSync(join(d, 'governance.json'), JSON.stringify({ rules: extra.rules }));
  if (extra.decisions) writeFileSync(join(d, 'history.json'), JSON.stringify({ decisions: extra.decisions }));
};
const conf = { id: 'conf1', decided_at: '2026-01-01T00:00:00Z', actor: 'op', action: 'keep', target: 'meta', outcome: 'positive', status: 'confirmed', recorded_by: 'operator' };

describe('v1 store', () => {
  it('loads the capped brand and typed registries', () => {
    const d = dir(); writeFileSync(join(d, 'brand.md'), 'Dog treats for working pups.'); seed(d);
    const c = new ContextStore(d).load(); assert.equal(c.brand, 'Dog treats for working pups.'); assert.equal(c.targets[0].id, 'meta');
  });
  it('refuses removed stores with the migration hint', () => {
    const d = dir(); writeFileSync(join(d, 'memory.json'), '{}');
    assert.throws(() => new ContextStore(d).load(), (e: Error) => e instanceof StoreError && /migrate/.test(e.message));
  });
  it('refuses duplicate resolution names, unknown applies_to, and decisions on unknown targets', () => {
    let d = dir(); seed(d, { targets: [{ id: 'fb', name: 'Facebook', kind: 'channel', status: 'active', aliases: [] }] });
    assert.throws(() => new ContextStore(d).load(), /resolves to both/);
    d = dir(); seed(d, { rules: [{ id: 'r', effect: 'forbid', domain: 'copy', action: 'claim', object: 'x', applies_to: ['nope'], created_at: '2026-01-01', created_by: 'op' }] });
    assert.throws(() => new ContextStore(d).load(), /applies_to 'nope'/);
    d = dir(); seed(d, { decisions: [{ ...conf, target: 'ghost' }] });
    assert.throws(() => new ContextStore(d).load(), /targets 'ghost'/);
  });
  it('records unresolved targets loudly and valid records as proposed', () => {
    const d = dir(); seed(d); const s = new ContextStore(d);
    assert.throws(() => s.record({ action: 'start', target: 'unknown', actor: 'agent', outcome: 'pending' }));
    const r = s.record({ action: 'stop', target: 'Facebook', actor: 'operator', outcome: 'negative' });
    assert.equal(r.status, 'proposed'); assert.equal(r.target, 'meta');
  });
  it('confirm flips proposed to confirmed; reject removes only proposed and fails closed on a missing id', () => {
    const d = dir(); seed(d, { decisions: [conf] }); const s = new ContextStore(d);
    const r = s.record({ action: 'stop', target: 'meta', actor: 'operator', outcome: 'negative' });
    s.confirm(r.id); assert.equal(s.load().history.find((x) => x.id === r.id)?.recorded_by, 'operator');
    const p = s.record({ action: 'keep', target: 'meta', actor: 'operator', outcome: 'pending' });
    assert.throws(() => s.reject('conf1'), /confirmed/); assert.throws(() => s.reject('nope'), /not found/);
    s.reject(p.id); assert.equal(s.load().history.length, 2); assert.ok(JSON.parse(readFileSync(join(d, 'history.json'), 'utf8')).decisions.some((x: { id: string }) => x.id === 'conf1'));
  });
});
