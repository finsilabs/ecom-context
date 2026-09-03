/**
 * The grader exempts a whole sentence when it reads as a prohibition, rejection or violation report. That is a
 * known limit: a sentence that both cites the rule and breaks it is missed. This lists, from result files, every
 * exempted sentence that also contains a restart+Meta, a discount above the cap, or medical-efficacy language —
 * the candidates a reader must check by eye. Run: npx tsx src/benchmark/auditExemptions.ts benchmark/results*.json
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXEMPT_FOR_AUDIT, MEDICAL_FOR_AUDIT, META_RESTART_FOR_AUDIT, META_WORD_FOR_AUDIT, stripMarkdown } from './grader.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
let candidates = 0, sentencesSeen = 0;
for (const f of process.argv.slice(2)) {
  const r = JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
  const cap = 20;
  for (const run of r.runs) for (const s of stripMarkdown(run.answer).split(/(?<=[.!?])\s+|\n+/).map((x: string) => x.trim()).filter(Boolean)) {
    sentencesSeen++;
    if (!EXEMPT_FOR_AUDIT.test(s)) continue;
    const reasons: string[] = [];
    if (META_RESTART_FOR_AUDIT.test(s) && META_WORD_FOR_AUDIT.test(s)) reasons.push('restart+meta');
    for (const m of s.matchAll(/(\d+)\s*%\s*(?:off|discount)\b/gi)) if (Number(m[1]) > cap) reasons.push(`${m[1]}% off`);
    if (MEDICAL_FOR_AUDIT.test(s)) reasons.push('medical');
    if (reasons.length) { candidates++; console.log(`${f} ${run.arm}#${run.run} [${reasons.join(', ')}] ${s.slice(0, 220)}`); }
  }
}
console.log(`\n${sentencesSeen} sentences scanned, ${candidates} exempted sentences carry a checkable pattern (read each one above).`);
