import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CheckRefused, compileConstraints, evaluate, exitCodeFor, ORIENTATION_MAX_CONSTRAINED_TARGETS, type CheckResponse, type OrientationResponse } from './check.js';
import type { OperatingContext } from './types.js';

const ctx: OperatingContext = {
  brand: 'Dog treats',
  targets: [
    { id: 'meta', name: 'Meta', kind: 'channel', status: 'paused', aliases: ['facebook'] },
    { id: 'vip', name: 'VIP', kind: 'offer', status: 'active', aliases: [] },
    { id: 'vip_seg', name: 'VIP customers', kind: 'audience', status: 'active', aliases: ['vip-audience'] },
    { id: 'email', name: 'Email', kind: 'channel', status: 'active', aliases: [] },
  ],
  governance: [
    { id: 'cap', effect: 'forbid', domain: 'offers', action: 'discount', object: 'cap', op: 'gt', value: 20, created_at: '2026-01-01', created_by: 'op' },
    { id: 'medical', effect: 'forbid', domain: 'copy', action: 'claim', object: 'medical', patterns: ['treats? joint stiffness'], created_at: '2026-01-01', created_by: 'op' },
    { id: 'compare', effect: 'forbid', domain: 'offers', action: 'compare_at', object: 'compare', created_at: '2026-01-01', created_by: 'op' },
    { id: 'ship', effect: 'require', domain: 'offers', action: 'free_shipping', object: 'free_ship_over_50', created_at: '2026-01-01', created_by: 'op' },
  ],
  history: [
    { id: 'stop', decided_at: '2026-01-01', actor: 'op', action: 'stop', target: 'meta', outcome: 'negative', metric: 'cac', before: 40, after: 72, status: 'confirmed', recorded_by: 'operator' },
    { id: 'test', decided_at: '2025-01-01', actor: 'op', action: 'test', target: 'vip', outcome: 'negative', params: { discount_pct: 30 }, status: 'confirmed', recorded_by: 'operator' },
    { id: 'seg_keep', decided_at: '2025-06-01', actor: 'op', action: 'keep', target: 'vip_seg', outcome: 'positive', status: 'confirmed', recorded_by: 'operator' },
  ],
};
const asCheck = (x: unknown) => x as CheckResponse;
const asOrient = (x: unknown) => x as OrientationResponse;

describe('context.check orientation (no proposal)', () => {
  it('has the closed field set, verdict unchecked, and never a rule', () => {
    const out = asOrient(evaluate(ctx, {}));
    assert.deepEqual(Object.keys(out).sort(), ['brand', 'lift_requires', 'mode', 'next', 'standing_constraints', 'unresolved_targets', 'verdict']);
    assert.equal(out.mode, 'orientation'); assert.equal(out.verdict, 'unchecked');
    assert.equal(JSON.stringify(out).includes('rule_id'), false); assert.equal(JSON.stringify(out).includes('"effect"'), false);
    assert.equal(exitCodeFor(out.verdict), 3);
  });
  it('returns the registry only when something did not resolve', () => {
    assert.equal(asOrient(evaluate(ctx, { targets: ['meta'] })).registry, undefined);
    const out = asOrient(evaluate(ctx, { targets: ['Spring campaign'] }));
    assert.deepEqual(out.unresolved_targets, ['Spring campaign']); assert.equal(out.registry?.length, 4);
    assert.ok(out.standing_constraints.some((c) => c.target === 'meta'), 'falls back to every constrained target');
  });
  it('grows with constrained targets only, and stops listing above the cap', () => {
    const targets = Array.from({ length: ORIENTATION_MAX_CONSTRAINED_TARGETS + 1 }, (_, i) => ({ id: `t${i}`, name: `T${i}`, kind: 'channel' as const, status: 'paused' as const, aliases: [] }));
    const history = targets.map((t) => ({ id: `s_${t.id}`, decided_at: '2026-01-01', actor: 'op', action: 'stop' as const, target: t.id, outcome: 'negative' as const, status: 'confirmed' as const, recorded_by: 'operator' as const }));
    const big: OperatingContext = { brand: 'x', targets, governance: Array.from({ length: 200 }, (_, i) => ({ id: `r${i}`, effect: 'forbid' as const, domain: 'copy' as const, action: 'claim' as const, object: `o${i}`, created_at: '2026-01-01', created_by: 'op' })), history };
    const out = asOrient(evaluate(big, {}));
    assert.equal(out.standing_constraints.length, 0); assert.equal(out.standing_constraint_count, ORIENTATION_MAX_CONSTRAINED_TARGETS + 1); assert.equal(out.registry?.length, ORIENTATION_MAX_CONSTRAINED_TARGETS + 1);
    const withRules = JSON.stringify(evaluate(big, { targets: ['t1'] })).length;
    const withoutRules = JSON.stringify(evaluate({ ...big, governance: [] }, { targets: ['t1'] })).length;
    assert.equal(withRules, withoutRules, 'orientation size is independent of rule count');
  });
});

describe('context.check evaluation', () => {
  it('refuses a proposal that declares nothing evaluable', () => {
    assert.throws(() => evaluate(ctx, { targets: ['email'], proposal: {} }), CheckRefused);
    assert.throws(() => evaluate(ctx, { proposal: { target: 'email' } }), CheckRefused);
  });
  it('blocks typed and semantic violations', () => {
    const out = asCheck(evaluate(ctx, { targets: ['meta'], proposal: { action: 'start', target: 'meta', discount_pct: 35, compare_at: true, text: 'treats joint stiffness' } }));
    assert.equal(out.mode, 'check'); assert.equal(out.verdict, 'blocked'); assert.equal(out.violations.length, 2); assert.equal(out.pattern_hits.length, 1); assert.equal(out.self_check.length, 1);
    assert.equal(out.conflicts.length, 1); assert.equal(out.conflicts[0].constraint, 'no_start');
  });
  it('require fires on explicit false, not on absence', () => {
    assert.equal(asCheck(evaluate(ctx, { targets: ['email'], proposal: { free_shipping: false } })).verdict, 'blocked');
    assert.equal(asCheck(evaluate(ctx, { targets: ['email'], proposal: { discount_pct: 10 } })).verdict, 'ok');
  });
  it('avoid_repeat compares with >=', () => {
    const at = (pct: number) => asCheck(evaluate(ctx, { targets: ['vip'], proposal: { action: 'test', target: 'vip', discount_pct: pct } })).conflicts.length;
    assert.equal(at(29), 0); assert.equal(at(30), 1); assert.equal(at(31), 1);
  });
  it('resolves proposal.audience by name or alias and reports its constraint', () => {
    const out = asCheck(evaluate(ctx, { proposal: { action: 'send', audience: 'vip-audience', discount_pct: 10 } }));
    assert.deepEqual(out.unresolved_targets, []); assert.ok('vip_seg' in out.last_decisions); assert.equal(out.standing_constraints[0]?.constraint, 'protect');
  });
  it('never hides blocked behind an unresolved target', () => {
    const out = asCheck(evaluate(ctx, { targets: ['missing'], proposal: { action: 'keep', target: 'missing', compare_at: true } }));
    assert.equal(out.unresolved_targets[0], 'missing'); assert.equal(out.verdict, 'blocked');
  });
  it('is review, never ok, with unresolved targets and no violations, and returns the registry so the agent can name a target', () => {
    const out = asCheck(evaluate(ctx, { targets: ['missing'], proposal: { discount_pct: 5 } }));
    assert.equal(out.verdict, 'review'); assert.equal(out.registry?.length, 4); assert.equal(out.unresolved_suggestions, undefined, 'no word overlap, no suggestion');
    const sug = asCheck(evaluate(ctx, { targets: ['email list'], proposal: { action: 'start', target: 'email campaign', discount_pct: 15 } }));
    assert.deepEqual(sug.unresolved_suggestions, { 'email list': ['email'], 'email campaign': ['email'] }); assert.ok(sug.next);
    assert.deepEqual((evaluate(ctx, { targets: ['meta_prospecting'] }) as any).unresolved_suggestions, { meta_prospecting: ['meta'] });
    assert.equal(asCheck(evaluate(ctx, { targets: ['email'], proposal: { discount_pct: 5 } })).registry, undefined, 'no registry when everything resolved');
  });
  it('fall-back scope lists constraints but does not manufacture conflicts (control task)', () => {
    const out = asCheck(evaluate(ctx, { targets: ['launch email'], proposal: { action: 'start', target: 'launch email', discount_pct: 15 } }));
    assert.equal(out.verdict, 'review'); assert.deepEqual(out.conflicts, []); assert.ok(out.standing_constraints.some((c) => c.target === 'meta' && c.constraint === 'no_start'));
    assert.equal(asCheck(evaluate(ctx, { targets: ['meta'], proposal: { action: 'start' } })).conflicts.length, 1, 'a resolved target in scope still conflicts');
  });
  it('a constraint that cannot conflict with the declared action does not gate the verdict; without an action it does', () => {
    assert.equal(asCheck(evaluate(ctx, { targets: ['vip_seg'], proposal: { action: 'send', audience: 'vip_seg', discount_pct: 10 } })).verdict, 'ok');
    assert.equal(asCheck(evaluate(ctx, { targets: ['vip_seg'], proposal: { discount_pct: 10 } })).verdict, 'review');
    assert.equal(asCheck(evaluate(ctx, { targets: ['vip_seg'], proposal: { action: 'stop', target: 'vip_seg' } })).verdict, 'review');
  });
});

describe('standing constraints compile from state, not from the last record', () => {
  const t = [{ id: 'meta', name: 'Meta', kind: 'channel' as const, status: 'paused' as const, aliases: [] }];
  const d = (id: string, decided_at: string, action: 'start' | 'stop' | 'keep' | 'test' | 'change', outcome: 'positive' | 'negative' | 'inconclusive', extra: Record<string, unknown> = {}) =>
    ({ id, decided_at, actor: 'op', action, target: 'meta', outcome, status: 'confirmed' as const, recorded_by: 'operator' as const, ...extra });
  it('a keep or a failed test after a stop keeps the no_start', () => {
    const c = compileConstraints({ brand: '', targets: t, governance: [], history: [d('s', '2026-03-08', 'stop', 'negative'), d('t', '2026-06-15', 'test', 'negative'), d('k', '2026-08-10', 'keep', 'negative')] }, t);
    assert.deepEqual(c.map((x) => x.constraint), ['no_start']); assert.equal(c[0].decision_id, 's');
  });
  it('a later start lifts the stop; a later keep/positive protects', () => {
    assert.deepEqual(compileConstraints({ brand: '', targets: t, governance: [], history: [d('s', '2026-03-08', 'stop', 'negative'), d('r', '2026-09-01', 'start', 'pending')] }, t), []);
    assert.deepEqual(compileConstraints({ brand: '', targets: t, governance: [], history: [d('r', '2026-01-01', 'start', 'positive'), d('k', '2026-02-01', 'keep', 'positive')] }, t).map((x) => x.constraint), ['protect']);
  });
  it('avoid_repeat keeps the lowest failed value per field and ignores proposed records', () => {
    const c = compileConstraints({ brand: '', targets: t, governance: [], history: [d('a', '2025-11-01', 'test', 'negative', { params: { discount_pct: 30 } }), d('b', '2026-01-01', 'test', 'negative', { params: { discount_pct: 25 } }), { ...d('p', '2026-02-01', 'stop', 'negative'), status: 'proposed' as const }] }, t);
    assert.deepEqual(c.map((x) => [x.constraint, x.value]), [['avoid_repeat', 25]]);
  });
});
