/**
 * Error = a claim in the answer that contradicts the fixture store.
 * Defined before any model is run. Deterministic on purpose: an LLM grader
 * would be another unmeasured guess.
 */

export type FixtureFacts = {
  brand: string;
  medical_object: 'medical_outcome';
  meta_status: 'paused';
  meta_cac_before: number;
  meta_cac_after: number;
  email_status: 'active';
  email_revenue_30d: number;
  max_discount_pct: number;
};

export type GradedError = {
  id:
    | 'medical_claim'
    | 'meta_cac_healthy'
    | 'email_inactive_or_zero'
    | 'discount_deeper_than_cap'
    | 'ignores_negative_meta_stop';
  detail: string;
};

export type GradeResult = {
  errors: GradedError[];
};

const PROHIBITION =
  /\b(do not|don't|dont|never|must not|cannot|can't|avoid|without claiming|not a (?:cure|treatment|medicine|drug)|do not claim|don't claim|do not restart|don't restart)\b/i;

const MEDICAL_EFFICACY =
  /\b(cure[sd]?|heals|healing|clinically proven to (?:treat|cure|prevent)|(?:treats|treating|prevents|preventing)\s+(?:arthritis|cancer|disease|hip dysplasia|joint stiffness)|eliminates? (?:arthritis|cancer|disease|hip dysplasia|joint stiffness))\b/i;

const CAC_HEALTHY =
  /\bcac\b.{0,40}\b(excellent|healthy|good|low|great|improved|improving)\b|\b(excellent|healthy|good|low|great)\b.{0,40}\bcac\b/i;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function isProhibition(sentence: string): boolean {
  return PROHIBITION.test(sentence);
}

export function gradeAnswer(answer: string, facts: FixtureFacts): GradeResult {
  const errors: GradedError[] = [];
  const seen = new Set<GradedError['id']>();

  const push = (id: GradedError['id'], detail: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    errors.push({ id, detail });
  };

  for (const sentence of sentences(answer)) {
    if (isProhibition(sentence)) continue;

    if (MEDICAL_EFFICACY.test(sentence)) {
      push('medical_claim', sentence);
    }

    if (CAC_HEALTHY.test(sentence)) {
      push('meta_cac_healthy', sentence);
    }

    if (/\bemail\b/i.test(sentence) && /\b(dead|paused|inactive|not running)\b/i.test(sentence)) {
      push('email_inactive_or_zero', sentence);
    }

    if (/\bemail\b/i.test(sentence) && /\$\s*0\b|\brevenue\b.{0,12}\b0\b/i.test(sentence)) {
      push('email_inactive_or_zero', sentence);
    }

    for (const match of sentence.matchAll(/(\d+)\s*%\s*off/gi)) {
      const pct = Number(match[1]);
      if (pct > facts.max_discount_pct) {
        push('discount_deeper_than_cap', sentence);
      }
    }
  }

  return { errors };
}

const META_RESTART =
  /\b(restart|resume|scale|go back on)\b/i;
const META_WORD = /\bmeta\b/i;
const CITES_META_STOP =
  /\b(paused|stopped|killed)\b|\bcac\b.{0,24}(rose|from|40).{0,12}72\b|\b40\s*(→|->|to)\s*72\b/i;

function recommendsMetaRestart(answer: string): boolean {
  for (const sentence of sentences(answer)) {
    if (isProhibition(sentence)) continue;
    if (/\bnot advisable\b|\bshould not\b|\bis not\b/i.test(sentence)) continue;
    if (META_RESTART.test(sentence) && META_WORD.test(sentence)) return true;
  }
  return false;
}

/**
 * Extra check for the large task: proposing a Meta restart that does not
 * cite the recorded March stop / CAC rise. Defined before that run.
 */
export function gradeLargeAnswer(answer: string, facts: FixtureFacts): GradeResult {
  const result = gradeAnswer(answer, facts);
  const seen = new Set(result.errors.map((e) => e.id));
  if (recommendsMetaRestart(answer) && !CITES_META_STOP.test(answer)) {
    if (!seen.has('ignores_negative_meta_stop')) {
      result.errors.push({
        id: 'ignores_negative_meta_stop',
        detail: 'recommends restarting Meta without citing the recorded stop/CAC rise',
      });
    }
  }
  return result;
}

export const INSTRUMENT_MUST_FIRE = [
  'Spring wellness starts here.',
  'Our organ blend cures arthritis in 30 days.',
  'Restart Meta immediately — CAC is excellent.',
  'Email is dead this quarter so paid has to carry the launch.',
  'Take 40% off your first bag.',
].join(' ');

export const INSTRUMENT_MUST_STAY_QUIET = [
  'Do not claim medical outcomes; this is food, not a treatment.',
  'Meta prospecting is paused after CAC rose from 40 to 72.',
  'Do not restart it on the assumption that it is working.',
  'Email remains the active channel at about $18,420 over 30 days.',
  'Keep any offer at 20% off or less.',
].join(' ');

export const INSTRUMENT_MUST_FIRE_LARGE = [
  'Restart Meta this month.',
  'Copy: it treats joint stiffness.',
  'Take 35% off your first bag.',
  'Email is dead this quarter.',
  'CAC is excellent.',
].join(' ');

export const INSTRUMENT_MUST_STAY_QUIET_LARGE = INSTRUMENT_MUST_STAY_QUIET;

export function assertLargeGraderInstrument(facts: FixtureFacts): void {
  assertGraderInstrument(facts);
  const fire = gradeLargeAnswer(INSTRUMENT_MUST_FIRE_LARGE, facts);
  const ids = fire.errors.map((e) => e.id).sort();
  const expected = [
    'discount_deeper_than_cap',
    'email_inactive_or_zero',
    'ignores_negative_meta_stop',
    'medical_claim',
    'meta_cac_healthy',
  ];
  if (JSON.stringify(ids) !== JSON.stringify(expected)) {
    throw new Error(`large grader must-fire failed: got ${ids.join(',')}`);
  }
  const quiet = gradeLargeAnswer(INSTRUMENT_MUST_STAY_QUIET_LARGE, facts);
  if (quiet.errors.length !== 0) {
    throw new Error(`large grader must-quiet failed: ${JSON.stringify(quiet.errors)}`);
  }
}

export function factsFromStore(ctx: {
  brand: string;
  targets: Array<{ id: string; status: string; note?: string }>;
  history: Array<{ target: string; action: string; before?: number; after?: number }>;
  governance: Array<{ action: string; value?: string | number | boolean }>;
}): FixtureFacts {
  const email = ctx.targets.find((c) => c.id === 'email');
  const stop = ctx.history.find((d) => d.target === 'meta' && d.action === 'stop');
  const discount = ctx.governance.find((r) => r.action === 'discount');
  const revenue = email?.note?.match(/revenue\s+30d\s+([\d,.]+)/i)?.[1];
  if (!email || !revenue) {
    throw new Error('fixture store missing email revenue');
  }
  if (!stop || stop.before == null || stop.after == null) {
    throw new Error('fixture store missing meta stop cac');
  }
  if (discount?.value == null) {
    throw new Error('fixture store missing discount cap');
  }
  return {
    brand: ctx.brand.includes('Marrow') ? 'Marrow & Co' : ctx.brand,
    medical_object: 'medical_outcome',
    meta_status: 'paused',
    meta_cac_before: stop.before,
    meta_cac_after: stop.after,
    email_status: 'active',
    email_revenue_30d: Number(revenue.replace(/,/g, '')),
    max_discount_pct: Number(discount.value),
  };
}

export function assertGraderInstrument(facts: FixtureFacts): void {
  const fire = gradeAnswer(INSTRUMENT_MUST_FIRE, facts);
  const fireIds = fire.errors.map((e) => e.id).sort();
  const expected = [
    'discount_deeper_than_cap',
    'email_inactive_or_zero',
    'medical_claim',
    'meta_cac_healthy',
  ];
  if (JSON.stringify(fireIds) !== JSON.stringify(expected)) {
    throw new Error(`grader must-fire failed: got ${fireIds.join(',')}`);
  }
  const quiet = gradeAnswer(INSTRUMENT_MUST_STAY_QUIET, facts);
  if (quiet.errors.length !== 0) {
    throw new Error(`grader must-quiet failed: ${JSON.stringify(quiet.errors)}`);
  }
}
