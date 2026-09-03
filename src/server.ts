import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ContextStore, StoreError, BRAND_CAP } from './store.js';
import { CheckRefused, evaluate, exitCodeFor, EVALUABLE_FIELDS } from './check.js';
import { migrateDir } from './migrate.js';
import { Decision, Rule, Target } from './types.js';

export const CHECK_DESCRIPTION = 'Call this once before you draft, recommend, or act. Pass the channels, offers, segments or products the task touches, and what you propose: the discount, any channel you would start or stop, any claim the copy will make. You get back who the brand is, the rules that apply to this proposal, standing constraints from past decisions, and a verdict. `blocked` means do not do it: revise the proposal and call again. `review` means proceed, but show the operator the listed constraints and conflicts in your answer; do not call again unless your proposal changes. If you do not have a proposal yet, call with `targets` only: you get who the brand is and the standing constraints on those targets, with verdict `unchecked`. `unchecked` is not permission; call again with your proposal before you draft, recommend, or act.';

const proposal = z.object({
  action: z.enum(['start', 'stop', 'change', 'test', 'keep', 'send', 'publish']).optional(), target: z.string().optional(), discount_pct: z.number().optional(),
  free_shipping: z.boolean().optional(), compare_at: z.boolean().optional(), guarantee: z.boolean().optional(), mentions_competitor: z.boolean().optional(), uses_ugc: z.boolean().optional(),
  audience: z.string().optional(), channel: z.string().optional(), claims: z.array(z.string()).optional(), text: z.string().optional(),
}).strict();
export const checkInput = z.object({ targets: z.array(z.string()).optional(), proposal: proposal.optional() }).strict();
const recordInput = z.object({
  action: z.enum(['start', 'stop', 'change', 'test', 'keep']), target: z.string(), outcome: z.enum(['pending', 'positive', 'negative', 'inconclusive']).default('pending'),
  metric: z.string().optional(), before: z.number().optional(), after: z.number().optional(), params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional(),
  note: z.string().max(200).optional(), actor: z.string().min(1),
}).strict();

const constraint = z.object({ target: z.string(), constraint: z.enum(['no_start', 'paused', 'protect', 'avoid_repeat']), since: z.string(), decision_id: z.string(), reason: z.string(), field: z.string().optional(), value: z.number().optional() });
const registryEntry = z.object({ id: z.string(), name: z.string(), kind: z.string() });
const orientationOut = z.object({ mode: z.literal('orientation'), brand: z.string(), standing_constraints: z.array(constraint), unresolved_targets: z.array(z.string()), registry: z.array(registryEntry).optional(), standing_constraint_count: z.number().optional(), lift_requires: z.string(), verdict: z.literal('unchecked'), next: z.string() }).strict();
const checkOut = z.object({
  mode: z.literal('check'), brand: z.string(), targets: z.array(Target), unresolved_targets: z.array(z.string()), rules: z.array(Rule), requirements: z.array(Rule), standing_constraints: z.array(constraint), lift_requires: z.string(),
  last_decisions: z.record(z.string(), Decision.nullable()), pending: z.array(Decision),
  violations: z.array(z.object({ rule_id: z.string(), field: z.string(), proposed: z.unknown(), allowed: z.unknown().optional(), detail: z.string() })),
  conflicts: z.array(z.object({ target: z.string(), constraint: z.string(), decision_id: z.string(), detail: z.string() })),
  self_check: z.array(z.object({ rule_id: z.string(), object: z.string(), detail: z.string() })),
  pattern_hits: z.array(z.object({ rule_id: z.string(), pattern: z.string(), excerpt: z.string() })),
  verdict: z.enum(['ok', 'blocked', 'review']), verdict_reason: z.string(),
}).strict();
/**
 * The two response types are a discriminated union in TypeScript (check.ts). The MCP SDK's `outputSchema`
 * only accepts an object schema (`normalizeObjectSchema` in server/zod-compat.js reads `.shape`), so on the
 * wire the union is declared as one object whose refinement enforces each mode's exact key set at runtime.
 */
const ORIENTATION_KEYS = Object.keys(orientationOut.shape).sort().join(',');
const CHECK_KEYS = Object.keys(checkOut.shape).sort().join(',');
export const checkOutput = z.object({ ...checkOut.shape, ...orientationOut.shape, mode: z.enum(['orientation', 'check']), verdict: z.enum(['ok', 'blocked', 'review', 'unchecked']) })
  .partial().required({ mode: true, brand: true, verdict: true, standing_constraints: true, unresolved_targets: true, lift_requires: true })
  .superRefine((v, c) => {
    const keys = Object.keys(v).sort().join(',');
    const want = v.mode === 'orientation' ? orientationOut : checkOut;
    const parsed = want.safeParse(v);
    if (!parsed.success) c.addIssue({ code: 'custom', message: `${v.mode} response does not match its declared shape (${keys}; expected ${v.mode === 'orientation' ? ORIENTATION_KEYS : CHECK_KEYS}): ${parsed.error.issues.map((i) => i.message).join('; ')}` });
  });

/** Compact JSON on the wire: every byte of a tool result is input on every later turn. */
const result = (x: Record<string, unknown>) => ({ content: [{ type: 'text' as const, text: JSON.stringify(x) }], structuredContent: x });
const error = (e: unknown) => ({ isError: true, content: [{ type: 'text' as const, text: e instanceof Error ? e.message : String(e) }] });

export function createServer(store: ContextStore) {
  const s = new McpServer({ name: 'ecom-context', version: '1.0.0' });
  s.registerTool('context.check', {
    title: 'Check operating context', description: CHECK_DESCRIPTION, inputSchema: checkInput.shape, outputSchema: checkOutput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => { try { return result(evaluate(store.load(), input)); } catch (e) { return error(e); } });
  s.registerTool('history.record', {
    title: 'Record a decision', description: 'Record a decision the operator made or confirmed in this conversation. It is stored as proposed until the operator confirms it; proposed records do not create constraints. Do not record your own recommendations as decisions.',
    inputSchema: recordInput.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (input) => { try { const d = store.record(input); return result({ recorded: d, confirm: `Confirm with: ecom-context confirm ${d.id}` }); } catch (e) { return error(e); } });
  return s;
}

const USAGE = 'usage: ecom-context init|validate|migrate|compile|confirm <id>|reject <id>|check [<json>|-]   (check exit codes: 0 ok, 1 review, 2 blocked, 3 unchecked, 4 refused)';

export async function cli(store: ContextStore, args: string[], io = { stdin: () => readFileSync(0, 'utf8'), log: console.log, warn: console.error }): Promise<number> {
  const cmd = args[0];
  if (cmd === 'init') {
    store.ensure();
    writeFileSync(join(store.dir, 'brand.md'), `Describe this brand, its products and its audience in your own words. Hard cap ${BRAND_CAP} bytes: longer material belongs in a document the agent can be pointed at.\n`);
    writeFileSync(join(store.dir, 'targets.json'), '{"targets":[]}\n'); writeFileSync(join(store.dir, 'governance.json'), '{"rules":[]}\n'); writeFileSync(join(store.dir, 'history.json'), '{"decisions":[]}\n');
    io.log(`initialized ${store.dir}`); return 0;
  }
  if (cmd === 'migrate') { for (const w of migrateDir(store.dir)) io.warn(`warning: ${w}`); store.load(); io.log(`migrated ${store.dir}`); return 0; }
  const ctx = store.load();
  if (cmd === 'validate') { io.log('valid'); return 0; }
  if (cmd === 'compile') { io.log(JSON.stringify(evaluate(ctx, {}), null, 2)); return 0; }
  if (cmd === 'confirm') { store.confirm(args[1] ?? ''); io.log('confirmed'); return 0; }
  if (cmd === 'reject') { store.reject(args[1] ?? ''); io.log('rejected'); return 0; }
  if (cmd === 'check') {
    const raw = args[1] === undefined || args[1] === '-' ? io.stdin() : args[1];
    const input = checkInput.parse(JSON.parse(raw.trim() || '{}'));
    try { const out = evaluate(ctx, input); io.log(JSON.stringify(out, null, 2)); return exitCodeFor(out.verdict); }
    catch (e) { if (e instanceof CheckRefused) { io.warn(e.message); return 4; } throw e; }
  }
  throw new StoreError(USAGE);
}

export { StoreError, CheckRefused, EVALUABLE_FIELDS };
