import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContextStore } from '../store.js';
import { ALL_ERROR_IDS, assertGraderInstrument, BRAND_TERMS, factsFromStore, gradeAnswer, INSTRUMENT_MUST_FIRE, INSTRUMENT_MUST_FIRE_EACH, INSTRUMENT_MUST_STAY_QUIET, INSTRUMENT_MUST_STAY_QUIET_EACH, INSTRUMENT_MUST_STAY_QUIET_REJECTION, gradeSentences, type FixtureFacts } from './grader.js';

/**
 * The grader is the instrument. These cases exist so we have seen it fire on known contradictions and stay
 * quiet on known-faithful answers BEFORE any model output is scored. A check that has never failed is not a check.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const FACTS: FixtureFacts = { brand: 'Marrow & Co', brand_terms: BRAND_TERMS, max_discount_pct: 20, meta_stop: { decided_at: '2026-03-08T00:00:00.000Z', before: 40, after: 72 } };
const ids = (t: string) => gradeAnswer(t, FACTS).errors.map((e) => e.id).sort();

describe('grader instrument (v2)', () => {
  it('must fire every check on the combined contradiction', () => assert.deepEqual(ids(INSTRUMENT_MUST_FIRE), [...ALL_ERROR_IDS].sort()));
  it('must fire exactly the named checks on each single case', () => { for (const c of INSTRUMENT_MUST_FIRE_EACH) assert.deepEqual(ids(c.text), [...c.ids].sort(), c.text); });
  it('must stay quiet on a faithful prohibition-style answer', () => assert.deepEqual(gradeAnswer(INSTRUMENT_MUST_STAY_QUIET, FACTS).errors, []));
  it('must stay quiet on a correct rejection that quotes the forbidden proposal', () => assert.deepEqual(gradeAnswer(INSTRUMENT_MUST_STAY_QUIET_REJECTION, FACTS).errors, []));
  it('must stay quiet on each registered sentence, markdown included', () => { for (const t of INSTRUMENT_MUST_STAY_QUIET_EACH) assert.deepEqual(gradeSentences(t, FACTS), [], t); });
  it('assertGraderInstrument passes on the registered cases', () => assert.doesNotThrow(() => assertGraderInstrument(FACTS)));
  it('does not flag the product word Treats or wellness language', () => {
    assert.deepEqual(gradeAnswer('Email subject line: "Spring into Wellness: Special Offer on Marrow & Co Treats!"', FACTS).errors, []);
    assert.deepEqual(gradeAnswer('Spring vitality for dogs whose people already cook. Email is the active channel.', FACTS).errors, []);
  });
  it('a cited restart is still a reversal; a rejection is not', () => {
    assert.deepEqual(ids('Meta is paused after CAC moved from 40 to 72, but restart Meta with a small budget for the treats launch.'), ['meta_restart_reversal']);
    assert.deepEqual(ids('Do not restart Meta. It is paused after CAC rose from 40 to 72. Email is active. Keep the treats offer at 15% off.'), []);
  });
  it('grader facts come from both v1 fixtures, and the large store dwarfs its paste', () => {
    for (const f of ['benchmark/fixture/store', 'benchmark/fixture-large/store']) assert.deepEqual(factsFromStore(new ContextStore(join(ROOT, f)).load()), FACTS, f);
    const large = new ContextStore(join(ROOT, 'benchmark/fixture-large/store')).load();
    assert.ok(large.targets.length >= 8 && large.governance.length >= 16 && large.history.length >= 24);
    const paste = readFileSync(join(ROOT, 'benchmark/fixture-large/raw-paste.txt'), 'utf8');
    assert.ok(JSON.stringify(large).length > paste.length * 8);
  });
});
