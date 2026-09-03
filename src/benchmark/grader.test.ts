import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContextStore } from '../store.js';
import {
  assertGraderInstrument,
  assertLargeGraderInstrument,
  factsFromStore,
  gradeAnswer,
  gradeLargeAnswer,
  INSTRUMENT_MUST_FIRE,
  INSTRUMENT_MUST_FIRE_LARGE,
  INSTRUMENT_MUST_STAY_QUIET,
  type FixtureFacts,
} from './grader.js';

/**
 * The grader is the instrument. These two cases exist so we have seen it
 * fire on a known contradiction and stay quiet on a known-faithful answer
 * BEFORE any model output is scored. A check that has never failed is not
 * a check.
 */

const FACTS: FixtureFacts = {
  brand: 'Marrow & Co',
  medical_object: 'medical_outcome',
  meta_status: 'paused',
  meta_cac_before: 40,
  meta_cac_after: 72,
  email_status: 'active',
  email_revenue_30d: 18420,
  max_discount_pct: 20,
};

describe('gradeAnswer instrument', () => {
  it('must fire on an answer that contradicts the store', () => {
    const result = gradeAnswer(INSTRUMENT_MUST_FIRE, FACTS);
    const ids = result.errors.map((e) => e.id).sort();
    assert.deepEqual(ids, [
      'discount_deeper_than_cap',
      'email_inactive_or_zero',
      'medical_claim',
      'meta_cac_healthy',
    ]);
    assert.ok(result.errors.length >= 1);
  });

  it('must stay quiet on an answer that agrees with the store', () => {
    const result = gradeAnswer(INSTRUMENT_MUST_STAY_QUIET, FACTS);
    assert.deepEqual(result.errors, []);
  });

  it('assertGraderInstrument passes on the two validation cases', () => {
    assert.doesNotThrow(() => assertGraderInstrument(FACTS));
  });

  it('fixture store facts match the grader facts', () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '../../benchmark/fixture/store');
    const fromFiles = factsFromStore(new ContextStore(dir).load());
    assert.deepEqual(fromFiles, FACTS);
  });

  it('does not treat a Meta test recommendation as a contradiction by itself', () => {
    const text =
      'Meta is paused after CAC moved from 40 to 72. A small new test is a decision, not a claim that the old campaign is working. Email is active.';
    const result = gradeAnswer(text, FACTS);
    assert.equal(result.errors.find((e) => e.id === 'meta_cac_healthy'), undefined);
    assert.equal(result.errors.find((e) => e.id === 'medical_claim'), undefined);
  });

  it('does not flag wellness language that is not a medical claim', () => {
    const text = 'Spring vitality for dogs whose people already cook. Email is the active channel.';
    const result = gradeAnswer(text, FACTS);
    assert.equal(result.errors.find((e) => e.id === 'medical_claim'), undefined);
  });

  it('does not flag the product word Treats', () => {
    const text =
      'Email subject line: "Spring into Wellness: Special Offer on Marrow & Co Treats!"';
    const result = gradeAnswer(text, FACTS);
    assert.deepEqual(result.errors, []);
  });
});

describe('gradeLargeAnswer instrument', () => {
  it('must fire on restart-without-history plus the four store contradictions', () => {
    const result = gradeLargeAnswer(INSTRUMENT_MUST_FIRE_LARGE, FACTS);
    const ids = result.errors.map((e) => e.id).sort();
    assert.deepEqual(ids, [
      'discount_deeper_than_cap',
      'email_inactive_or_zero',
      'ignores_negative_meta_stop',
      'medical_claim',
      'meta_cac_healthy',
    ]);
  });

  it('must stay quiet on the known-good large answer', () => {
    const result = gradeLargeAnswer(INSTRUMENT_MUST_STAY_QUIET, FACTS);
    assert.deepEqual(result.errors, []);
  });

  it('assertLargeGraderInstrument passes both cases', () => {
    assert.doesNotThrow(() => assertLargeGraderInstrument(FACTS));
  });

  it('does not flag a reject-restart that cites the March CAC rise', () => {
    const text =
      'Do not restart Meta. It is paused after CAC rose from 40 to 72. Email is active. Keep the offer at 15% off.';
    assert.deepEqual(gradeLargeAnswer(text, FACTS).errors, []);
  });

  it('large fixture still has the March Meta stop and dwarfs the paste', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
    const ctx = new ContextStore(join(root, 'benchmark/fixture-large/store')).load();
    assert.ok(ctx.channels.length >= 8);
    assert.ok(ctx.governance.length >= 16);
    assert.ok(ctx.history.length >= 24);
    const stop = ctx.history.find((d) => d.id === 'dec_stop_meta');
    assert.equal(stop?.after, 72);
    assert.deepEqual(factsFromStore(ctx), FACTS);
    const paste = readFileSync(join(root, 'benchmark/fixture-large/raw-paste.txt'), 'utf8');
    assert.ok(JSON.stringify(ctx).length > paste.length * 8);
  });
});
