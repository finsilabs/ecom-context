import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
    const fromFiles = factsFromStore({
      brand: 'Marrow & Co', targets: [{ id: 'email', status: 'active', note: 'revenue 30d 18420' }],
      history: [{ target: 'meta', action: 'stop', before: 40, after: 72 }], governance: [{ action: 'discount', value: 20 }],
    });
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
    const channels = JSON.parse(readFileSync(join(root, 'benchmark/fixture-large/store/channels.json'), 'utf8')).channels;
    const governance = JSON.parse(readFileSync(join(root, 'benchmark/fixture-large/store/governance.json'), 'utf8')).rules;
    const history = JSON.parse(readFileSync(join(root, 'benchmark/fixture-large/store/history.json'), 'utf8')).decisions;
    assert.ok(channels.length >= 8);
    assert.ok(governance.length >= 16);
    assert.ok(history.length >= 24);
    const stop = history.find((d: any) => d.id === 'dec_stop_meta');
    assert.equal(stop?.after, 72);
    assert.deepEqual(factsFromStore({ brand: 'Marrow & Co', targets: channels.map((c: any) => ({id:c.id,status:c.status,note:c.revenue == null ? undefined : `revenue 30d ${c.revenue}`})), history: history.map((d:any)=>({target:d.target_id,action:d.action,before:d.before,after:d.after})), governance }), FACTS);
    const paste = readFileSync(join(root, 'benchmark/fixture-large/raw-paste.txt'), 'utf8');
    assert.ok(JSON.stringify({ channels, governance, history }).length > paste.length * 8);
  });
});
