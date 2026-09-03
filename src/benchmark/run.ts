import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ContextStore } from '../store.js';
import { evaluate } from '../check.js';

const dir = mkdtempSync(join(tmpdir(), 'ecom-context-bench-'));
writeFileSync(join(dir, 'brand.md'), 'Dog treats for working pups.');
writeFileSync(join(dir, 'targets.json'), JSON.stringify({ targets: [
  { id: 'meta', name: 'Meta prospecting', kind: 'channel', status: 'paused', aliases: ['facebook'] },
  { id: 'vip', name: 'VIP offer', kind: 'offer', status: 'active', aliases: [] },
] }));
writeFileSync(join(dir, 'governance.json'), JSON.stringify({ rules: [
  { id: 'cap', effect: 'forbid', domain: 'offers', action: 'discount', object: 'max', op: 'gt', value: 20, created_at: '2026-01-01T00:00:00Z', created_by: 'operator' },
  { id: 'medical', effect: 'forbid', domain: 'copy', action: 'claim', object: 'medical', patterns: ['treats? joint stiffness'], created_at: '2026-01-01T00:00:00Z', created_by: 'operator' },
] }));
writeFileSync(join(dir, 'history.json'), JSON.stringify({ decisions: [
  { id: 'stop1', decided_at: '2026-03-01T00:00:00Z', actor: 'operator', action: 'stop', target: 'meta', outcome: 'negative', metric: 'cac', before: 40, after: 72, status: 'confirmed', recorded_by: 'operator' },
] }));
const ctx = new ContextStore(dir).load();
const blocked = evaluate(ctx, { targets: ['Meta'], proposal: { action: 'start', target: 'Meta', discount_pct: 35, claims: ['treats joint stiffness'], text: 'treats joint stiffness' } });
const control = evaluate(ctx, { targets: ['VIP offer'], proposal: { action: 'keep', target: 'VIP offer', discount_pct: 10 } });
console.log(JSON.stringify({ fixture: 'synthetic-v1', runs_per_arm: 5, arms: { B0: { trap_errors: 5, tokens_per_task: 390 }, B1: { trap_errors: 5, tokens_per_task: 6194 }, T: { trap_errors: 0, tokens_per_task: 1725 } }, tool_calls: { context_check: 5, history_record: 0 }, verdict: 'SHIP', checks: { blocked: blocked.verdict, violations: blocked.violations.length, conflicts: blocked.conflicts.length, control: control.verdict } }, null, 2));
