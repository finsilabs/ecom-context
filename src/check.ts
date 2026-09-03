/**
 * context.check evaluator. Two response types, discriminated on `mode`:
 *  - orientation: no proposal was given; nothing was evaluated; verdict is always 'unchecked'.
 *  - check: a non-empty proposal was evaluated against rules and compiled history.
 * OrientationResponse shares no field list with CheckResponse on purpose (design §6.2, amended):
 * a field is admitted to it only with a measurement showing the material is obeyed rather than weighed.
 */
import { resolve } from './store.js';
import type { Decision, OperatingContext, Rule, Target } from './types.js';

export type Proposal = {
  action?: 'start' | 'stop' | 'change' | 'test' | 'keep' | 'send' | 'publish';
  target?: string;
  discount_pct?: number;
  free_shipping?: boolean;
  compare_at?: boolean;
  guarantee?: boolean;
  mentions_competitor?: boolean;
  uses_ugc?: boolean;
  audience?: string;
  channel?: string;
  claims?: string[];
  text?: string;
};
export type CheckInput = { targets?: string[]; proposal?: Proposal };

export type Constraint = {
  target: string;
  constraint: 'no_start' | 'paused' | 'protect' | 'avoid_repeat';
  since: string;
  decision_id: string;
  reason: string;
  field?: string;
  value?: number;
};

export type OrientationResponse = {
  mode: 'orientation';
  brand: string;
  standing_constraints: Constraint[];
  unresolved_targets: string[];
  registry?: { id: string; name: string; kind: string }[];
  unresolved_suggestions?: Record<string, string[]>;
  standing_constraint_count?: number;
  lift_requires: string;
  verdict: 'unchecked';
  next: string;
};

export type CheckResponse = {
  mode: 'check';
  brand: string;
  targets: Target[];
  unresolved_targets: string[];
  registry?: { id: string; name: string; kind: string }[];   // only when unresolved_targets is non-empty (design §6.5), so the agent can name a target
  unresolved_suggestions?: Record<string, string[]>;         // unresolved name -> registry ids sharing a word with it; suggestions, never resolution
  next?: string;                                              // only with unresolved names: what to do about them, so an agent does not retry the same words
  rules: Rule[];
  requirements: Rule[];
  standing_constraints: Constraint[];
  lift_requires: string;
  last_decisions: Record<string, Decision | null>;
  pending: Decision[];
  violations: { rule_id: string; field: string; proposed: unknown; allowed?: unknown; detail: string }[];
  conflicts: { target: string; constraint: string; decision_id: string; detail: string }[];
  self_check: { rule_id: string; object: string; detail: string }[];
  pattern_hits: { rule_id: string; pattern: string; excerpt: string }[];
  verdict: 'ok' | 'blocked' | 'review';
  verdict_reason: string;
};

export const LIFT_REQUIRES = 'a new confirmed operator decision on this target';
export const ORIENTATION_NEXT = 'call context.check again with a proposal before you draft, recommend, or act';
export const ORIENTATION_NAME_A_TARGET = 'too many constrained targets to list; name the targets the task touches and call context.check again';
export const ORIENTATION_MAX_CONSTRAINED_TARGETS = 24;
export const UNRESOLVED_NEXT = 'Some names are not in the registry. If a suggested or listed registry id is what you meant, call once more with that id; otherwise do not call again: proceed, and tell the operator which names were not in the registry.';

/** Word-overlap suggestions for an unresolved name: registry entries whose id, name or alias shares a whole word with it. Never resolves anything (design §6.5); the agent still has to choose. */
export function suggestionsFor(targets: Target[], name: string): string[] {
  const words = new Set(name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  return targets.filter((t) => [t.id, t.name, ...t.aliases].some((k) => k.toLowerCase().split(/[^a-z0-9]+/).some((w) => w.length > 2 && words.has(w)))).map((t) => t.id);
}
function suggestionMap(targets: Target[], unresolved: string[]): Record<string, string[]> | undefined {
  const out: Record<string, string[]> = {};
  for (const n of unresolved) { const s = suggestionsFor(targets, n); if (s.length) out[n] = s; }
  return Object.keys(out).length ? out : undefined;
}
export const EVALUABLE_FIELDS = ['action', 'discount_pct', 'free_shipping', 'compare_at', 'guarantee', 'mentions_competitor', 'uses_ugc', 'audience', 'channel', 'claims', 'text'] as const;

export class CheckRefused extends Error { constructor(message: string) { super(message); this.name = 'CheckRefused'; } }

const FIELD_FOR_ACTION: Record<string, keyof Proposal> = {
  discount: 'discount_pct', free_shipping: 'free_shipping', compare_at: 'compare_at', guarantee: 'guarantee',
  mention_competitor: 'mentions_competitor', use_ugc: 'uses_ugc', target_audience: 'audience', send: 'channel',
};

function compare(op: string, expected: unknown, actual: unknown): boolean {
  const a = actual as any; const e = expected as any;
  switch (op) {
    case 'gt': return a > e; case 'gte': return a >= e; case 'lt': return a < e; case 'lte': return a <= e;
    case 'eq': return a === e; case 'neq': return a !== e;
    case 'in': return Array.isArray(e) && e.includes(a);
    case 'not_in': return Array.isArray(e) && !e.includes(a);
    default: return false;
  }
}

export function hasEvaluableField(p: Proposal): boolean {
  return EVALUABLE_FIELDS.some((f) => p[f] !== undefined);
}

function scopeFor(ctx: OperatingContext, input: CheckInput) {
  const names = [...(input.targets ?? []), input.proposal?.target, input.proposal?.channel, input.proposal?.audience].filter((n): n is string => typeof n === 'string' && n.trim() !== '');
  const unique = [...new Set(names)];
  const resolved: Target[] = []; const unresolved: string[] = [];
  for (const n of unique) { const t = resolve(ctx.targets, n); if (t) { if (!resolved.includes(t)) resolved.push(t); } else unresolved.push(n); }
  return { resolved, unresolved };
}

/**
 * Compiles confirmed decisions into standing constraints, per target, in date order.
 * `start`, `stop` and `change` set the target's state and supersede earlier constraints.
 * `keep` reaffirms the current state and supersedes nothing (a `keep` on a stopped channel keeps it stopped).
 * A negative `test` adds `avoid_repeat` for each numeric param and never lifts a stop.
 * This departs from design §6.6's literal "any later decision supersedes" for `keep` and `test`;
 * see README "Standing constraints" for the fixture that shows why.
 */
export function compileConstraints(ctx: OperatingContext, scope: Target[]): Constraint[] {
  const out: Constraint[] = [];
  for (const target of scope) {
    const ds = ctx.history.filter((d) => d.status === 'confirmed' && d.target === target.id).sort((a, b) => Date.parse(a.decided_at) - Date.parse(b.decided_at));
    if (!ds.length) continue;
    let stateIdx = -1;
    ds.forEach((d, i) => { if (d.action === 'start' || d.action === 'stop' || d.action === 'change') stateIdx = i; });
    const state = stateIdx >= 0 ? ds[stateIdx] : undefined;
    const after = ds.slice(stateIdx + 1);
    const base = (d: Decision) => ({ target: target.id, since: d.decided_at, decision_id: d.id });
    if (state?.action === 'stop') {
      if (state.outcome === 'negative') out.push({ ...base(state), constraint: 'no_start', reason: `operator stopped ${target.name} on ${state.decided_at.slice(0, 10)}${state.metric ? ` after ${state.metric} ${state.before ?? ''}->${state.after ?? ''}` : ''}` });
      else out.push({ ...base(state), constraint: 'paused', reason: `${target.name} was stopped on ${state.decided_at.slice(0, 10)}; outcome not recorded` });
    } else {
      const keep = [...after].reverse().find((d) => d.action === 'keep');
      if (keep?.outcome === 'positive') out.push({ ...base(keep), constraint: 'protect', reason: `operator kept ${target.name} after a positive outcome` });
    }
    const worst = new Map<string, Decision & { value: number }>();
    for (const d of after) if (d.action === 'test' && d.outcome === 'negative') for (const [field, value] of Object.entries(d.params ?? {})) if (typeof value === 'number' && (!worst.has(field) || value < worst.get(field)!.value)) worst.set(field, { ...d, value });
    for (const [field, d] of worst) out.push({ ...base(d), constraint: 'avoid_repeat', reason: `negative test on ${target.name}: ${field} ${d.value}`, field, value: d.value });
  }
  return out;
}

function constrainedTargets(ctx: OperatingContext): Target[] {
  return ctx.targets.filter((t) => compileConstraints(ctx, [t]).length > 0);
}

export function evaluate(ctx: OperatingContext, input: CheckInput): OrientationResponse | CheckResponse {
  const { resolved, unresolved } = scopeFor(ctx, input);
  if (!input.proposal) return orientation(ctx, resolved, unresolved);
  if (!hasEvaluableField(input.proposal)) throw new CheckRefused(`proposal declares nothing to evaluate. Declare at least one of: ${EVALUABLE_FIELDS.join(', ')}. Omit proposal entirely for an orientation call.`);
  return check(ctx, input.proposal, resolved, unresolved);
}

function orientation(ctx: OperatingContext, resolved: Target[], unresolved: string[]): OrientationResponse {
  const registry = ctx.targets.map((t) => ({ id: t.id, name: t.name, kind: t.kind }));
  const common = { mode: 'orientation' as const, brand: ctx.brand, unresolved_targets: unresolved, lift_requires: LIFT_REQUIRES, verdict: 'unchecked' as const };
  const sm = suggestionMap(ctx.targets, unresolved);
  const sugg = unresolved.length ? { registry, ...(sm ? { unresolved_suggestions: sm } : {}) } : {};
  if (resolved.length) return { ...common, standing_constraints: compileConstraints(ctx, resolved), ...sugg, next: ORIENTATION_NEXT };
  const constrained = constrainedTargets(ctx);
  if (constrained.length > ORIENTATION_MAX_CONSTRAINED_TARGETS) return { ...common, standing_constraints: [], registry, standing_constraint_count: compileConstraints(ctx, constrained).length, next: ORIENTATION_NAME_A_TARGET };
  return { ...common, standing_constraints: compileConstraints(ctx, constrained), ...sugg, next: ORIENTATION_NEXT };
}

function check(ctx: OperatingContext, proposal: Proposal, resolved: Target[], unresolved: string[]): CheckResponse {
  const scope = resolved.length ? resolved : constrainedTargets(ctx);
  const constraints = compileConstraints(ctx, scope);
  const inScope = (x: string) => scope.some((t) => t.id === x || t.kind === x);
  const rules = ctx.governance.filter((r) => !r.superseded_by && (
    (FIELD_FOR_ACTION[r.action] !== undefined && proposal[FIELD_FOR_ACTION[r.action]] !== undefined)
    || (r.action === 'claim' && (proposal.claims !== undefined || proposal.text !== undefined))
    || (r.applies_to?.some(inScope) ?? false)
  ));
  const requirements = rules.filter((r) => r.effect === 'require');
  const violations: CheckResponse['violations'] = []; const self_check: CheckResponse['self_check'] = []; const pattern_hits: CheckResponse['pattern_hits'] = [];
  for (const r of rules) {
    if (r.action === 'claim') {
      if (proposal.claims !== undefined || proposal.text !== undefined) self_check.push({ rule_id: r.id, object: r.object, detail: r.note || 'operator review required' });
      if (proposal.text) for (const pattern of r.patterns ?? []) { const hit = proposal.text.match(new RegExp(pattern, 'i')); if (hit) pattern_hits.push({ rule_id: r.id, pattern, excerpt: hit[0] }); }
      continue;
    }
    const field = FIELD_FOR_ACTION[r.action];
    if (!field || proposal[field] === undefined) continue;
    const actual = proposal[field];
    if (r.action === 'send' && typeof actual === 'string') {
      const id = resolve(ctx.targets, actual)?.id;
      if (r.effect === 'forbid' && id && r.applies_to?.includes(id)) violations.push({ rule_id: r.id, field, proposed: actual, detail: `sending on ${id} is forbidden (${r.object})` });
      continue;
    }
    if (r.op && r.effect === 'forbid' && compare(r.op, r.value, actual)) violations.push({ rule_id: r.id, field, proposed: actual, allowed: r.value, detail: `${field} ${actual} violates forbid ${r.op} ${JSON.stringify(r.value)} (${r.id})` });
    if (!r.op && r.effect === 'forbid' && actual === true) violations.push({ rule_id: r.id, field, proposed: actual, allowed: false, detail: `${field} is forbidden (${r.id})` });
    if (r.effect === 'require' && actual === false) violations.push({ rule_id: r.id, field, proposed: actual, allowed: true, detail: `${field} is required (${r.id})` });
  }
  const explicit = [proposal.target, proposal.channel, proposal.audience].filter((x): x is string => !!x).map((x) => resolve(ctx.targets, x)?.id).filter((x): x is string => !!x);
  const conflicts: CheckResponse['conflicts'] = [];
  // Conflicts are raised only against targets the proposal actually touches. When nothing resolved, the scope is the
  // fall-back (every constrained target, design §6.5) so the constraints are visible and the verdict is review, but a
  // launch email does not "conflict" with Meta's stop just because "launch email" is not in the registry (control task).
  for (const c of constraints) {
    const touches = explicit.length ? explicit.includes(c.target) : resolved.length > 0 && scope.some((t) => t.id === c.target);
    if (!touches) continue;
    const push = (detail: string) => { if (!conflicts.some((x) => x.target === c.target && x.constraint === c.constraint)) conflicts.push({ target: c.target, constraint: c.constraint, decision_id: c.decision_id, detail }); };
    if ((c.constraint === 'no_start' || c.constraint === 'paused') && (proposal.action === 'start' || proposal.action === 'test')) push(c.reason);
    if (c.constraint === 'protect' && proposal.action === 'stop') push(c.reason);
    if (c.constraint === 'avoid_repeat' && c.field && typeof (proposal as any)[c.field] === 'number' && (proposal as any)[c.field] >= c.value!) push(`${c.field} ${(proposal as any)[c.field]} repeats a failed test at ${c.value}`);
  }
  const pending = ctx.history.filter((d) => d.status === 'proposed' && scope.some((t) => t.id === d.target));
  // A standing constraint forces `review` when the proposal declares no action, because the server cannot tell whether
  // it conflicts. With an action declared, a constraint that cannot conflict with it (a `protect` on a plain send) is
  // returned for visibility but does not gate the verdict; one that does conflict is in `conflicts` and gates it.
  const undecidable = constraints.length > 0 && proposal.action === undefined;
  const verdict: CheckResponse['verdict'] = violations.length ? 'blocked'
    : (conflicts.length || undecidable || self_check.length || pattern_hits.length || unresolved.length || pending.length || !scope.length) ? 'review' : 'ok';
  const reason = violations[0]?.detail ?? conflicts[0]?.detail ?? (unresolved.length ? `unresolved targets: ${unresolved.join(', ')}` : undecidable ? `standing constraints on ${constraints.map((c) => c.target).join(', ')} and no action declared` : self_check.length ? 'semantic rules need operator review' : pattern_hits.length ? 'copy matches an operator pattern' : pending.length ? 'pending records in scope' : !scope.length ? 'nothing resolved and nothing constrained' : constraints.length ? `no violations; standing constraints on ${constraints.map((c) => c.target).join(', ')} do not conflict with ${proposal.action}` : 'no applicable violations or constraints');
  return {
    mode: 'check', brand: ctx.brand, targets: scope, unresolved_targets: unresolved, ...(unresolved.length ? { registry: ctx.targets.map((t) => ({ id: t.id, name: t.name, kind: t.kind })), ...(suggestionMap(ctx.targets, unresolved) ? { unresolved_suggestions: suggestionMap(ctx.targets, unresolved) } : {}), next: UNRESOLVED_NEXT } : {}), rules, requirements, standing_constraints: constraints, lift_requires: LIFT_REQUIRES,
    last_decisions: Object.fromEntries(scope.map((t) => [t.id, ctx.history.filter((d) => d.status === 'confirmed' && d.target === t.id).sort((a, b) => Date.parse(b.decided_at) - Date.parse(a.decided_at))[0] ?? null])),
    pending, violations, conflicts, self_check, pattern_hits, verdict, verdict_reason: `${verdict}: ${reason}`,
  };
}

/** CLI exit code for a check response: 0 ok, 1 review, 2 blocked, 3 unchecked. A hook blocks on any non-zero code. */
export function exitCodeFor(verdict: OrientationResponse['verdict'] | CheckResponse['verdict']): number {
  return verdict === 'ok' ? 0 : verdict === 'review' ? 1 : verdict === 'blocked' ? 2 : 3;
}
