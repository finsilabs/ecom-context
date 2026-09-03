/**
 * Fills the README's results and payload tables from the result files so no number in the README is typed by hand.
 * Run: npx tsx src/benchmark/renderReadme.ts benchmark/results.json benchmark/results-large.json [...]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encode } from 'gpt-tokenizer/model/gpt-4o-mini';
import { ContextStore } from '../store.js';
import { evaluate } from '../check.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const files = process.argv.slice(2);
const rows: string[] = [];
const fmt = (n: number) => n.toLocaleString('en-US');
rows.push('| fixture | model | arm | n | errors/run | error ids (count over n runs) | input tokens mean [min–max] | output mean | rounds | tool calls/run | verdict (§7.5) |');
rows.push('|---|---|---|---:|---:|---|---|---:|---:|---:|---|');
for (const f of files) {
  const r = JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
  const label = r.pooled_from ? `pooled (${r.models.join(' + ')})` : f.includes('attempt1') ? `${r.model} — first attempt, kept: 2 of 5 B0 completions ended with no text and score as wrong_business` : r.model;
  for (const arm of ['B0', 'B1', 'T']) {
    const s = r.arms[arm]; if (!s) continue;
    const runs = (r.runs ?? []).filter((x: any) => x.arm === arm);
    const calls = runs.length ? (runs.reduce((a: number, x: any) => a + x.tool_calls.length, 0) / runs.length).toFixed(1) : '';
    const ids = Object.entries(s.error_ids).map(([k, v]) => `${k} ${v}`).join(', ') || '—';
    rows.push(`| ${r.fixture} | ${label} | ${arm} | ${s.n} | **${s.errors_per_run}** | ${ids} | ${fmt(s.tokens_in_mean)} [${fmt(s.tokens_in_min)}–${fmt(s.tokens_in_max)}] | ${fmt(s.tokens_out_mean)} | ${s.rounds_mean} | ${arm === 'T' ? calls : '—'} | ${arm === 'T' ? `**${r.verdict}** — ${r.verdict_basis}` : ''} |`);
  }
}
const payload: string[] = ['| store | call | verdict | chars | o200k tokens (compact, as emitted) | o200k (pretty, the pre-v1 wire format) |', '|---|---|---|---:|---:|---:|'];
for (const [label, dir] of [['repo `store/`', 'store'], ['`benchmark/fixture` (2 targets, 2 rules, 4 decisions)', 'benchmark/fixture/store'], ['`benchmark/fixture-large` (10 targets, 20 rules, 44 decisions)', 'benchmark/fixture-large/store']] as const) {
  const ctx = new ContextStore(join(ROOT, dir)).load();
  for (const [name, input] of [['orientation, no targets', {}], ['orientation, resolved target', { targets: ['meta'] }], ['orientation, unresolved target', { targets: ['Spring campaign'] }], ['check: start meta + 35% + claim', { targets: ['meta'], proposal: { action: 'start', target: 'meta', discount_pct: 35, claims: ['treats joint stiffness'] } }], ['check: 15% off on email', { targets: ['email'], proposal: { discount_pct: 15 } }]] as const) {
    const out = evaluate(ctx, input as any); const c = JSON.stringify(out); const p = JSON.stringify(out, null, 2);
    payload.push(`| ${label} | ${name} | ${out.verdict} | ${fmt(c.length)} | ${fmt(encode(c).length)} | ${fmt(encode(p).length)} |`);
  }
}
// Control task, store-size sweep and neutral-prompt tables, from whatever result files exist.
const controlFiles = ['benchmark/results-control.json', 'benchmark/results-control-claude-opus-5.json'].filter((f) => existsSync(join(ROOT, f)));
const control: string[] = ['| model | arm | n | over_caution/run | over_caution ids | errors/run | error ids | input tokens mean | calls/run |', '|---|---|---:|---:|---|---:|---|---:|---:|'];
for (const f of controlFiles) {
  const r = JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
  for (const arm of ['B0', 'B1', 'T']) { const s = r.arms[arm]; if (!s) continue; const runs = r.runs.filter((x: any) => x.arm === arm); const calls = runs.length ? (runs.reduce((a: number, x: any) => a + x.tool_calls.length, 0) / runs.length).toFixed(1) : '';
    control.push(`| ${r.model} | ${arm} | ${s.n} | **${s.over_caution_per_run ?? 0}** | ${Object.entries(s.over_caution_ids ?? {}).map(([k, v]) => `${k} ${v}`).join(', ') || '—'} | ${s.errors_per_run} | ${Object.entries(s.error_ids).map(([k, v]) => `${k} ${v}`).join(', ') || '—'} | ${fmt(s.tokens_in_mean)} | ${arm === 'T' ? calls : '—'} |`); }
}
const scaleFiles = [10, 50, 200].flatMap((n) => [`benchmark/results-scale-${n}.json`, `benchmark/results-scale-${n}-claude-opus-5.json`]).filter((f) => existsSync(join(ROOT, f)));
const scale: string[] = ['| decisions in store | model | B1 input tokens (full document) | T input tokens (tool) | T errors/run | T calls/run | n |', '|---:|---|---:|---:|---:|---:|---:|'];
const large = ['benchmark/results-large.json', 'benchmark/results-large-claude-opus-5.json'].filter((f) => existsSync(join(ROOT, f)));
for (const f of [...scaleFiles, ...large].sort((a, b) => { const d = (x: string) => JSON.parse(readFileSync(join(ROOT, x), 'utf8')).store_decisions ?? 44; return d(a) - d(b); })) {
  const r = JSON.parse(readFileSync(join(ROOT, f), 'utf8')); const t = r.runs.filter((x: any) => x.arm === 'T'); const calls = t.length ? (t.reduce((a: number, x: any) => a + x.tool_calls.length, 0) / t.length).toFixed(1) : '';
  scale.push(`| ${r.store_decisions ?? 44} | ${r.model} | ${fmt(r.arms.B1?.tokens_in_mean ?? NaN)} | ${fmt(r.arms.T?.tokens_in_mean ?? NaN)} | ${r.arms.T?.errors_per_run ?? ''} | ${calls} | ${r.arms.T?.n ?? ''} |`);
}
const neutralFiles = ['benchmark/results-large-neutral.json', 'benchmark/results-large-neutral-claude-opus-5.json'].filter((f) => existsSync(join(ROOT, f)));
const neutral: string[] = ['| model | system prompt | n | tool called | orientation only | errors/run | error ids | input tokens mean | calls/run |', '|---|---|---:|---:|---:|---:|---|---:|---:|'];
for (const f of [...large, ...neutralFiles]) {
  const r = JSON.parse(readFileSync(join(ROOT, f), 'utf8')); const s = r.arms.T; if (!s) continue; const t = r.runs.filter((x: any) => x.arm === 'T'); const calls = (t.reduce((a: number, x: any) => a + x.tool_calls.length, 0) / t.length).toFixed(1);
  neutral.push(`| ${r.model} | ${r.system_variant === 'neutral' ? 'does not name the tool' : 'names the tool'} | ${s.n} | ${Math.round((s.tool_called_rate ?? 0) * 100)}% | ${Math.round((s.orientation_only_rate ?? 0) * 100)}% | ${s.errors_per_run} | ${Object.entries(s.error_ids).map(([k, v]) => `${k} ${v}`).join(', ') || '—'} | ${fmt(s.tokens_in_mean)} | ${calls} |`);
}
const readme = join(ROOT, 'README.md');
let md = readFileSync(readme, 'utf8');
const fill = (tag: string, body: string) => { md = md.replace(new RegExp(`<!-- ${tag}:begin -->[\\s\\S]*?<!-- ${tag}:end -->`), `<!-- ${tag}:begin -->\n${body}\n<!-- ${tag}:end -->`); };
fill('results', `Result files: ${files.map((f) => `\`${f}\``).join(', ')}. Every answer, tool-call argument list and per-round usage is in the file.\n\n${rows.join('\n')}`);
fill('payload', payload.join('\n'));
fill('control', controlFiles.length ? `Result files: ${controlFiles.map((f) => `\`${f}\``).join(', ')}.\n\n${control.join('\n')}` : '(no control-task result files yet)');
fill('scale', scaleFiles.length ? `Result files: ${scaleFiles.map((f) => `\`${f}\``).join(', ')} plus the 44-decision large-task files.\n\n${scale.join('\n')}` : '(no store-size sweep result files yet)');
fill('neutral', neutralFiles.length ? `Result files: ${neutralFiles.map((f) => `\`${f}\``).join(', ')}.\n\n${neutral.join('\n')}` : '(no neutral-prompt result files yet)');
writeFileSync(readme, md);
console.log(`rendered ${files.length} result files into README`);
