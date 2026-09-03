#!/usr/bin/env node
/**
 * With/without benchmark. Same model, same task prompt, three arms (design §7.3):
 *   B0  recall-limited paste — the operator's own paste (benchmark/<fixture>/raw-paste.txt)
 *   B1  full-store document — the whole v1 store rendered as markdown in the system prompt
 *   T   the MCP server connected (context.check + history.record), no paste
 *
 * Provenance: restored from commit 4d51385 (the 311-line runner that 8974e52 replaced with a
 * hardcoded table) and adapted to the two-tool server: the store is copied to a temp dir per run
 * so a write cannot pollute the fixture (unchanged), tool-call ARGUMENTS and per-round usage are
 * now recorded (§7.3), a B1 arm and n runs per arm were added, and the verdict is computed from
 * the §7.5 gates — never a constant.
 *
 * Refuses to score until the grader has fired on known-bad answers and stayed quiet on known-good
 * ones (assertGraderInstrument throws before any model call).
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ContextStore } from '../store.js';
import type { OperatingContext } from '../types.js';
import { assertGraderInstrument, factsFromStore, gradeAnswer, GRADER_VERSION, INSTRUMENT_MUST_FIRE, INSTRUMENT_MUST_FIRE_EACH, INSTRUMENT_MUST_STAY_QUIET, INSTRUMENT_MUST_STAY_QUIET_EACH, INSTRUMENT_MUST_STAY_QUIET_REJECTION, type GradedError } from './grader.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const flag = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const LARGE = argv.includes('--large');
const filesAfter = (name: string) => { const i = argv.indexOf(name); if (i < 0) return undefined; const out: string[] = []; for (const a of argv.slice(i + 1)) { if (a.startsWith('--')) break; out.push(a); } return out; };
const POOL = filesAfter('--pool');
const REGRADE = filesAfter('--regrade');
const FIXTURE = join(ROOT, LARGE ? 'benchmark/fixture-large' : 'benchmark/fixture');
const STORE_DIR = join(FIXTURE, 'store');
const MODEL = flag('--model') || process.env.ECOM_CONTEXT_BENCH_MODEL || 'gpt-4o-mini';
const N = Number(flag('--n') || process.env.ECOM_CONTEXT_BENCH_N || 5);
const ARMS = (flag('--arms') || 'B0,B1,T').split(',') as Arm[];
const RESULTS = flag('--out') || join(ROOT, `benchmark/results${LARGE ? '-large' : ''}${MODEL === 'gpt-4o-mini' ? '' : `-${MODEL}`}.json`);
const API_URL = 'https://api.openai.com/v1/chat/completions';
const MAX_ROUNDS = 8;

export type Arm = 'B0' | 'B1' | 'T';
export type ToolDef = { name: string; description: string; parameters: unknown };
export type ToolCallRec = { name: string; arguments: Record<string, unknown> };
export type RoundRec = { prompt_tokens: number; completion_tokens: number; cache_read_tokens?: number; cache_write_tokens?: number; tool_calls: ToolCallRec[]; content_types?: string[]; empty_retries?: number };
export type LoopResult = { answer: string; rounds: RoundRec[]; tool_calls: ToolCallRec[]; stop_reason: string };

type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
type ChatMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string };
type Usage = { prompt_tokens: number; completion_tokens: number; total_tokens: number };

function loadText(name: string): string { return readFileSync(join(FIXTURE, name), 'utf8').trim(); }
function openaiName(mcpName: string): string { return mcpName.replace(/\./g, '_'); }
function mcpName(openaiName: string): string { return openaiName.replace('_', '.'); } // context.check, history.record — one dot each

async function chat(messages: ChatMessage[], tools?: unknown[]): Promise<{ message: ChatMessage; usage: Usage; finish: string }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');
  const body: Record<string, unknown> = { model: MODEL, temperature: 0, max_tokens: 800, messages };
  if (tools && tools.length > 0) { body.tools = tools; body.tool_choice = 'auto'; }
  const res = await fetch(API_URL, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = (await res.json()) as { error?: { message?: string }; choices?: Array<{ message: ChatMessage; finish_reason?: string }>; usage?: Usage };
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${data.error?.message || res.statusText}`);
  const message = data.choices?.[0]?.message; const usage = data.usage;
  if (!message || !usage) throw new Error('OpenAI response missing message or usage');
  return { message, usage, finish: data.choices?.[0]?.finish_reason ?? 'unknown' };
}

/** OpenAI tool loop (the restored 4d51385 loop, now recording arguments and per-round usage). */
async function openaiLoop(opts: { system: string; user: string; tools?: ToolDef[]; onTool: (call: ToolCallRec) => Promise<string> }): Promise<LoopResult> {
  const tools = opts.tools?.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const messages: ChatMessage[] = [{ role: 'system', content: opts.system }, { role: 'user', content: opts.user }];
  const rounds: RoundRec[] = []; const called: ToolCallRec[] = [];
  while (rounds.length < MAX_ROUNDS) {
    const { message, usage, finish } = await chat(messages, tools);
    const round: RoundRec = { prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, tool_calls: [] };
    rounds.push(round);
    messages.push({ role: 'assistant', content: message.content, tool_calls: message.tool_calls });
    const toolCalls = message.tool_calls || [];
    if (toolCalls.length === 0) return { answer: message.content || '', rounds, tool_calls: called, stop_reason: finish };
    for (const call of toolCalls) {
      const args = call.function.arguments && call.function.arguments.trim() ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
      const rec: ToolCallRec = { name: call.function.name, arguments: args };
      round.tool_calls.push(rec); called.push(rec);
      messages.push({ role: 'tool', tool_call_id: call.id, content: await opts.onTool(rec) });
    }
  }
  throw new Error('tool loop exceeded max rounds');
}

const isClaude = MODEL.startsWith('claude');
async function loop(opts: { system: string; user: string; tools?: ToolDef[]; onTool: (call: ToolCallRec) => Promise<string> }): Promise<LoopResult> {
  if (!isClaude) return openaiLoop(opts);
  const { anthropicLoop } = await import('./anthropicChat.js');
  return anthropicLoop({ model: MODEL, maxRounds: MAX_ROUNDS, maxTokens: 16000, ...opts });
}

const SYSTEM_B0 = 'You are an e-commerce operator\'s assistant. The operator pasted the notes they would actually paste into chat. Use them. Do not invent facts they did not provide.';
const SYSTEM_B1 = 'You are an e-commerce operator\'s assistant. The operator\'s complete operating-context document is below. Use it. Do not invent facts it does not contain.';
const SYSTEM_T = 'You are an e-commerce operator\'s assistant. An operating-context tool (context.check) is connected. Call it before you draft or recommend; pass the targets the task touches and what you propose. Use history.record only when the operator asks to record a decision. Do not invent governance, performance, or history.';

/** B1: the whole store as a markdown document — the CLAUDE.md upper bound (design §7.3). */
export function renderStoreDocument(ctx: OperatingContext): string {
  const lines = ['# Operating context (complete store)', '', '## Brand', ctx.brand.trim(), '', '## Targets'];
  for (const t of ctx.targets) lines.push(`- ${t.id} — ${t.name} (${t.kind}, ${t.status})${t.aliases.length ? ` aliases: ${t.aliases.join(', ')}` : ''}${t.note ? ` — ${t.note}` : ''}`);
  lines.push('', '## Rules');
  for (const r of ctx.governance) lines.push(`- ${r.id}: ${r.effect} ${r.action} ${r.object}${r.op ? ` (${r.op} ${JSON.stringify(r.value)})` : ''}${r.applies_to ? ` applies to ${r.applies_to.join(', ')}` : ''}${r.superseded_by ? ` [superseded by ${r.superseded_by}]` : ''}${r.note ? ` — ${r.note}` : ''}`);
  lines.push('', `## Decisions (${ctx.history.length}, oldest first)`);
  for (const d of [...ctx.history].sort((a, b) => Date.parse(a.decided_at) - Date.parse(b.decided_at))) lines.push(`- ${d.decided_at.slice(0, 10)} ${d.actor} ${d.action} ${d.target}: ${d.outcome}${d.metric ? ` (${d.metric} ${d.before ?? ''}->${d.after ?? ''})` : ''}${d.params ? ` ${JSON.stringify(d.params)}` : ''}${d.status === 'proposed' ? ' [proposed, unconfirmed]' : ''}${d.note ? ` — ${d.note}` : ''}`);
  return lines.join('\n');
}

async function runT(task: string, storeDir: string): Promise<LoopResult> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') env[k] = v;
  env.ECOM_CONTEXT_STORE = storeDir;
  const transport = new StdioClientTransport({ command: 'node', args: [join(ROOT, 'dist/index.js')], env, stderr: 'pipe', cwd: ROOT });
  const client = new Client({ name: 'ecom-context-benchmark', version: '0.2.0' });
  await client.connect(transport);
  try {
    const listed = await client.listTools();
    const tools: ToolDef[] = listed.tools.map((t) => ({ name: openaiName(t.name), description: t.description || t.name, parameters: t.inputSchema || { type: 'object', properties: {} } }));
    return await loop({ system: SYSTEM_T, user: task, tools, onTool: async (call) => {
      const result = await client.callTool({ name: mcpName(call.name), arguments: call.arguments });
      return (result.content as Array<{ type: string; text?: string }>).map((c) => (c.type === 'text' ? c.text : '')).join('\n');
    } });
  } finally { await client.close(); }
}

export type RunRecord = {
  arm: Arm; run: number; tokens_in: number; tokens_out: number; cache_read: number; rounds: number; round_detail: RoundRec[]; tool_calls: ToolCallRec[];
  tool_called: boolean; orientation_only: boolean; stop_reason: string; error_count: number; errors: GradedError[]; answer: string;
};
export type ArmSummary = { n: number; errors_per_run: number; error_counts: number[]; error_ids: Record<string, number>; tokens_in_mean: number; tokens_in_min: number; tokens_in_max: number; tokens_out_mean: number; rounds_mean: number; tool_called_rate?: number; orientation_only_rate?: number };

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function summarizeArm(runs: RunRecord[]): ArmSummary {
  const ids: Record<string, number> = {};
  for (const r of runs) for (const e of r.errors) ids[e.id] = (ids[e.id] ?? 0) + 1;
  const s: ArmSummary = { n: runs.length, errors_per_run: r3(mean(runs.map((r) => r.error_count))), error_counts: runs.map((r) => r.error_count), error_ids: ids, tokens_in_mean: Math.round(mean(runs.map((r) => r.tokens_in))), tokens_in_min: Math.min(...runs.map((r) => r.tokens_in)), tokens_in_max: Math.max(...runs.map((r) => r.tokens_in)), tokens_out_mean: Math.round(mean(runs.map((r) => r.tokens_out))), rounds_mean: r3(mean(runs.map((r) => r.rounds))) };
  if (runs[0]?.arm === 'T') { s.tool_called_rate = r3(mean(runs.map((r) => (r.tool_called ? 1 : 0)))); s.orientation_only_rate = r3(mean(runs.map((r) => (r.orientation_only ? 1 : 0)))); }
  return s;
}

type Gate = { pass: boolean; measured: true; value: unknown; threshold: string } | { measured: false; reason: string };

/** Design §7.5, applied to what this runner measures. Gates the runner cannot feed are reported as unmeasured, and SHIP requires every gate. */
export function gatesFor(arms: Partial<Record<Arm, ArmSummary>>): { gates: Record<string, Gate>; verdict: 'SHIP' | 'STOP' | 'VOID' | 'RESHAPE'; verdict_basis: string } {
  const B0 = arms.B0, B1 = arms.B1, T = arms.T;
  const gates: Record<string, Gate> = {};
  gates.b0_discriminates = B0 ? { measured: true, value: B0.errors_per_run, threshold: 'B0 errors/run >= 0.4, else the tasks did not discriminate and the result is void', pass: B0.errors_per_run >= 0.4 } : { measured: false, reason: 'B0 arm not run' };
  gates.t_at_most_half_of_b0 = B0 && T ? { measured: true, value: { T: T.errors_per_run, B0: B0.errors_per_run, ratio: B0.errors_per_run ? r3(T.errors_per_run / B0.errors_per_run) : null }, threshold: 'T errors/run <= 0.5 x B0', pass: T.errors_per_run <= 0.5 * B0.errors_per_run } : { measured: false, reason: 'needs B0 and T' };
  gates.t_not_worse_than_b1 = B1 && T ? { measured: true, value: { T: T.errors_per_run, B1: B1.errors_per_run }, threshold: 'T errors/run <= B1 (the tool must not be worse than a perfectly maintained document)', pass: T.errors_per_run <= B1.errors_per_run } : { measured: false, reason: 'needs B1 and T' };
  gates.tool_not_called = T ? { measured: true, value: r3(1 - (T.tool_called_rate ?? 0)), threshold: '<= 0.10 of T runs', pass: 1 - (T.tool_called_rate ?? 0) <= 0.1 } : { measured: false, reason: 'T arm not run' };
  const noMechanism = T ? r3(1 - (T.tool_called_rate ?? 0) + (T.orientation_only_rate ?? 0)) : NaN;
  gates.tool_not_called_plus_orientation_only = T ? { measured: true, value: noMechanism, threshold: '<= 0.30 of T runs, else STOP: the mechanism never ran on a proposal', pass: noMechanism <= 0.3 } : { measured: false, reason: 'T arm not run' };
  gates.control_task_over_caution = { measured: false, reason: 'this runner has no control task (design §7.2 task 4)' };
  gates.tokens_flat_in_store_size = { measured: false, reason: 'needs the 10/50/200 decision-count sweep on one synthetic store (design §7.1); this runner has two fixtures of different shape' };
  const measured = Object.values(gates).filter((g): g is Extract<Gate, { measured: true }> => g.measured);
  const unmeasured = Object.entries(gates).filter(([, g]) => !g.measured).map(([k]) => k);
  const failed = Object.entries(gates).filter(([, g]) => g.measured && !g.pass).map(([k]) => k);
  let verdict: 'SHIP' | 'STOP' | 'VOID' | 'RESHAPE'; let basis: string;
  if (!B0 || !T) { verdict = 'VOID'; basis = 'primary comparison needs B0 and T'; }
  else if (B0.errors_per_run < 0.4) { verdict = 'VOID'; basis = `B0 made ${B0.errors_per_run} errors/run (< 0.4): the task does not discriminate, result void (design §7.5)`; }
  else if (T.errors_per_run >= B0.errors_per_run) { verdict = 'STOP'; basis = `T ${T.errors_per_run} errors/run >= B0 ${B0.errors_per_run}: the tool does not beat a recall-limited paste (design §7.5 STOP)`; }
  else if (noMechanism > 0.3) { verdict = 'STOP'; basis = `tool_not_called + orientation_only = ${noMechanism} > 0.30: the mechanism never ran on a proposal (design §7.5 STOP)`; }
  else if (failed.length === 0 && unmeasured.length === 0) { verdict = 'SHIP'; basis = 'every §7.5 gate measured and passed'; }
  else { verdict = 'RESHAPE'; basis = `${failed.length ? `failed: ${failed.join(', ')}. ` : ''}${unmeasured.length ? `unmeasured: ${unmeasured.join(', ')}. ` : ''}SHIP requires every gate; this run cannot reach it.`; }
  return { gates, verdict, verdict_basis: basis };
}

function pool(files: string[]) {
  const reports = files.map((f) => JSON.parse(readFileSync(f, 'utf8')) as { model: string; fixture: string; grader_version: number; runs: RunRecord[] });
  const fixtures = new Set(reports.map((r) => r.fixture)); const graders = new Set(reports.map((r) => r.grader_version));
  if (fixtures.size !== 1 || graders.size !== 1) throw new Error(`refusing to pool across fixtures (${[...fixtures]}) or grader versions (${[...graders]})`);
  const runs = reports.flatMap((r) => r.runs.map((x) => ({ ...x, model: r.model })));
  const arms: Partial<Record<Arm, ArmSummary>> = {};
  for (const arm of ['B0', 'B1', 'T'] as Arm[]) { const rs = runs.filter((r) => r.arm === arm); if (rs.length) arms[arm] = summarizeArm(rs); }
  const out = { pooled_from: files.map((f) => f.replace(`${ROOT}/`, '')), models: reports.map((r) => r.model), fixture: [...fixtures][0], grader_version: [...graders][0], arms, ...gatesFor(arms) };
  const path = flag('--out') || join(ROOT, `benchmark/results${LARGE ? '-large' : ''}-pooled.json`);
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
  console.error(`wrote ${path}`);
  console.log(JSON.stringify({ arms: out.arms, verdict: out.verdict, verdict_basis: out.verdict_basis }, null, 2));
}

/** Re-grades stored answers with the current grader (deterministic; no model call) and recomputes summaries, gates and verdict. */
function regrade(files: string[]) {
  for (const f of files) {
    const report = JSON.parse(readFileSync(f, 'utf8'));
    const store = join(ROOT, report.fixture === 'large' ? 'benchmark/fixture-large/store' : 'benchmark/fixture/store');
    const facts = factsFromStore(new ContextStore(store).load());
    assertGraderInstrument(facts);
    const previous = report.grader_version;
    for (const run of report.runs as RunRecord[]) { const g = gradeAnswer(run.answer, facts); run.errors = g.errors; run.error_count = g.errors.length; }
    const arms: Partial<Record<Arm, ArmSummary>> = {};
    for (const arm of report.arms_run as Arm[]) arms[arm] = summarizeArm((report.runs as RunRecord[]).filter((r) => r.arm === arm));
    Object.assign(report, { arms, ...gatesFor(arms), grader_version: GRADER_VERSION, regraded_at: new Date().toISOString(), regraded_from_grader_version: previous, grader: { must_fire: INSTRUMENT_MUST_FIRE, must_fire_each: INSTRUMENT_MUST_FIRE_EACH, must_stay_quiet: INSTRUMENT_MUST_STAY_QUIET, must_stay_quiet_rejection: INSTRUMENT_MUST_STAY_QUIET_REJECTION, must_stay_quiet_each: INSTRUMENT_MUST_STAY_QUIET_EACH, error_definition: report.grader.error_definition } });
    writeFileSync(f, `${JSON.stringify(report, null, 2)}\n`);
    console.error(`regraded ${f}: ${report.verdict} — ${report.verdict_basis}`);
    console.log(JSON.stringify({ file: f.replace(`${ROOT}/`, ''), arms: Object.fromEntries(Object.entries(arms).map(([k, v]) => [k, { errors_per_run: v.errors_per_run, error_ids: v.error_ids }])), verdict: report.verdict }));
  }
}

async function main(): Promise<void> {
  if (POOL) { pool(POOL); return; }
  if (REGRADE) { regrade(REGRADE); return; }
  const ctx = new ContextStore(STORE_DIR).load();
  const facts = factsFromStore(ctx);
  assertGraderInstrument(facts); // throws: no model call happens after a misbehaving instrument
  console.error(`grader v${GRADER_VERSION}: must-fire (${1 + INSTRUMENT_MUST_FIRE_EACH.length} cases) and must-stay-quiet (2 texts + ${INSTRUMENT_MUST_STAY_QUIET_EACH.length} sentences) passed`);
  if (isClaude) { const { verifyAnthropicModel } = await import('./anthropicChat.js'); console.error(`anthropic model verified: ${await verifyAnthropicModel(MODEL)}`); }
  const task = loadText('task.txt'); const paste = loadText('raw-paste.txt'); const doc = renderStoreDocument(ctx);
  console.error(`model=${MODEL} fixture=${LARGE ? 'large' : 'small'} n=${N} arms=${ARMS.join(',')}`);

  const runs: RunRecord[] = [];
  const record = (arm: Arm, run: number, r: LoopResult): RunRecord => {
    const grade = gradeAnswer(r.answer, facts);
    const checks = r.tool_calls.filter((c) => mcpName(c.name) === 'context.check');
    const last = checks.at(-1);
    return { arm, run, tokens_in: r.rounds.reduce((a, x) => a + x.prompt_tokens, 0), tokens_out: r.rounds.reduce((a, x) => a + x.completion_tokens, 0), cache_read: r.rounds.reduce((a, x) => a + (x.cache_read_tokens ?? 0), 0), rounds: r.rounds.length, round_detail: r.rounds, tool_calls: r.tool_calls, tool_called: checks.length > 0, orientation_only: checks.length > 0 && !('proposal' in (last?.arguments ?? {})), stop_reason: r.stop_reason, error_count: grade.errors.length, errors: grade.errors, answer: r.answer };
  };
  for (let i = 1; i <= N; i++) {
    for (const arm of ARMS) {
      console.error(`run ${i}/${N} arm ${arm}...`);
      let r: LoopResult;
      if (arm === 'B0') r = await loop({ system: SYSTEM_B0, user: `${task}\n\n--- operator paste ---\n${paste}`, onTool: async () => '' });
      else if (arm === 'B1') r = await loop({ system: `${SYSTEM_B1}\n\n${doc}`, user: task, onTool: async () => '' });
      else {
        const liveStore = mkdtempSync(join(tmpdir(), 'ecom-context-bench-'));
        cpSync(STORE_DIR, liveStore, { recursive: true }); // a history.record write lands here, never in the fixture
        try { r = await runT(task, liveStore); } finally { rmSync(liveStore, { recursive: true, force: true }); }
      }
      const rec = record(arm, i, r); runs.push(rec);
      console.error(`  tokens_in=${rec.tokens_in} rounds=${rec.rounds} errors=${rec.error_count}${rec.errors.length ? ` [${rec.errors.map((e) => e.id).join(',')}]` : ''}${arm === 'T' ? ` calls=${rec.tool_calls.map((c) => c.name).join(',')}${rec.orientation_only ? ' ORIENTATION_ONLY' : ''}` : ''}`);
    }
  }
  const arms: Partial<Record<Arm, ArmSummary>> = {};
  for (const arm of ARMS) arms[arm] = summarizeArm(runs.filter((r) => r.arm === arm));
  const { gates, verdict, verdict_basis } = gatesFor(arms);
  const report = {
    ran_at: new Date().toISOString(), model: MODEL, fixture: LARGE ? 'large' : 'small', n_per_arm: N, arms_run: ARMS, task, grader_version: GRADER_VERSION,
    grader: { must_fire: INSTRUMENT_MUST_FIRE, must_fire_each: INSTRUMENT_MUST_FIRE_EACH, must_stay_quiet: INSTRUMENT_MUST_STAY_QUIET, must_stay_quiet_rejection: INSTRUMENT_MUST_STAY_QUIET_REJECTION, must_stay_quiet_each: INSTRUMENT_MUST_STAY_QUIET_EACH, error_definition: 'A sentence that contradicts the store (medical efficacy, Meta CAC healthy, email inactive/zero, discount deeper than the cap), a recommendation to restart Meta (a recorded stop, cited or not), or an answer with no brand term at all.' },
    system_prompts: { B0: SYSTEM_B0, B1: SYSTEM_B1, T: SYSTEM_T }, b1_document_chars: doc.length,
    arms, gates, verdict, verdict_basis, runs,
  };
  writeFileSync(RESULTS, `${JSON.stringify(report, null, 2)}\n`);
  console.error(`wrote ${RESULTS}`);
  console.log(JSON.stringify({ model: MODEL, fixture: report.fixture, n_per_arm: N, arms, gates, verdict, verdict_basis }, null, 2));
}

main().catch((err) => { console.error(err instanceof Error ? err.stack || err.message : err); process.exit(1); });
