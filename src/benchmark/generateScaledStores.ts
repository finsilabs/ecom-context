/**
 * Store-size sweep for the bounded-cost gate (design §7.1, §7.5): the large store's decisions at 10, 50 and 200
 * confirmed decisions, with the planted traps preserved (the March Meta stop stays the latest state-changing decision
 * on Meta; every target keeps the same constraint kind). Filler decisions are deterministic: `keep`/positive on the
 * healthy channels and inconclusive `test`s on organic, spread over 18 months, never on a stopped target.
 * Task and paste are the large task's, copied so `--fixture benchmark/fixture-scale/<n>` runs unchanged.
 * Run: npx tsx src/benchmark/generateScaledStores.ts
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContextStore } from '../store.js';
import { compileConstraints } from '../check.js';
import { writeV1 } from '../migrate.js';
import type { Decision } from '../types.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const LARGE = join(ROOT, 'benchmark/fixture-large');
const base = new ContextStore(join(LARGE, 'store')).load();

/** Ten decisions that carry every target's constraint: the six stops, the three positive keeps, and the August keep/negative on Meta that must not lift its stop. */
const TEN = ['dec_aff_stop', 'dec_retail_stop', 'dec_push_pause', 'dec_sms_pause', 'dec_tt_stop', 'dec_stop_meta', 'dec_keep_email_mar', 'dec_google_keep', 'dec_ws_keep', 'dec_meta_still_paused'];
const FILLER_TARGETS = ['email', 'google', 'wholesale', 'organic'] as const;

function filler(n: number): Decision[] {
  let seed = 20260903; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const start = Date.parse('2025-06-10T00:00:00Z'), end = Date.parse('2026-08-25T00:00:00Z');
  const out: Decision[] = [];
  for (let i = 0; i < n; i++) {
    const target = FILLER_TARGETS[i % FILLER_TARGETS.length];
    const decided_at = new Date(start + Math.floor(rnd() * (end - start))).toISOString();
    const before = 1000 + Math.floor(rnd() * 9000);
    out.push(target === 'organic'
      ? { id: `dec_fill_${i}`, decided_at, actor: 'operator', action: 'test', target, outcome: 'inconclusive', params: { kind: 'creative' }, status: 'confirmed', recorded_by: 'operator' }
      : { id: `dec_fill_${i}`, decided_at, actor: 'operator', action: 'keep', target, outcome: 'positive', metric: 'revenue', before, after: before + Math.floor(rnd() * 500), status: 'confirmed', recorded_by: 'operator' });
  }
  return out;
}

const signature = (history: Decision[]) => compileConstraints({ ...base, history }, base.targets).map((c) => `${c.target}:${c.constraint}`).sort().join(' ');
const baseSig = signature(base.history);
for (const n of [10, 50, 200]) {
  const history = n === 10 ? base.history.filter((d) => TEN.includes(d.id)) : [...base.history, ...filler(n - base.history.length)];
  history.sort((a, b) => Date.parse(a.decided_at) - Date.parse(b.decided_at));
  if (history.length !== n) throw new Error(`scale ${n}: got ${history.length} decisions`);
  const sig = signature(history);
  if (sig !== baseSig) throw new Error(`scale ${n}: constraints changed\n  base: ${baseSig}\n  ${n}: ${sig}`);
  const meta = compileConstraints({ ...base, history }, base.targets.filter((t) => t.id === 'meta'))[0];
  if (meta?.decision_id !== 'dec_stop_meta') throw new Error(`scale ${n}: Meta constraint is not the March stop`);
  const dir = join(ROOT, `benchmark/fixture-scale/${n}`);
  mkdirSync(join(dir, 'store'), { recursive: true });
  writeV1(join(dir, 'store'), { ...base, history });
  for (const f of ['task.txt', 'raw-paste.txt']) copyFileSync(join(LARGE, f), join(dir, f));
  console.log(`wrote benchmark/fixture-scale/${n}: ${history.length} decisions, constraints unchanged (${sig.split(' ').length} targets constrained), Meta constraint from dec_stop_meta`);
}
