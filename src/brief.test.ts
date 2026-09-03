import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildBrief } from './brief.js';
import type { OperatingContext } from './types.js';

function ctx(overrides: Partial<OperatingContext> = {}): OperatingContext {
  return {
    memory: [
      {
        id: 'mem_1',
        written_at: '2026-01-05T00:00:00.000Z',
        topic: 'positioning',
        text: 'Marrow & Co sells freeze-dried organ treats.',
      },
    ],
    channels: [
      {
        id: 'email',
        name: 'Klaviyo',
        kind: 'email',
        status: 'active',
        window: '30d',
        revenue: 18420,
        spend: null,
        orders: 410,
        approaches: [
          { id: 'ap_1', tried_at: '2026-02-10T00:00:00.000Z', kind: 'frequency', outcome: 'worked' },
        ],
      },
      {
        id: 'meta',
        name: 'Meta prospecting',
        kind: 'paid_social',
        status: 'paused',
        window: '30d',
        revenue: 6200,
        spend: 8900,
        orders: 55,
        approaches: [
          { id: 'ap_2', tried_at: '2026-03-01T00:00:00.000Z', kind: 'creative', outcome: 'did_not_work' },
        ],
      },
    ],
    governance: [
      {
        id: 'gov_no_medical',
        effect: 'forbid',
        domain: 'copy',
        action: 'claim',
        object: 'medical_outcome',
        created_at: '2026-01-12T00:00:00.000Z',
      },
      {
        id: 'gov_unsub',
        effect: 'require',
        domain: 'legal',
        action: 'send',
        object: 'unsubscribe_in_footer',
        created_at: '2026-01-12T00:00:00.000Z',
      },
    ],
    history: [
      {
        id: 'dec_stop_meta',
        decided_at: '2026-03-08T00:00:00.000Z',
        actor: 'operator',
        action: 'stop',
        target_type: 'channel',
        target_id: 'meta',
        outcome: 'negative',
        metric: 'cac',
        before: 40,
        after: 72,
      },
      {
        id: 'dec_keep_email',
        decided_at: '2026-03-08T00:00:00.000Z',
        actor: 'operator',
        action: 'keep',
        target_type: 'channel',
        target_id: 'email',
        outcome: 'positive',
        metric: 'revenue',
        before: 15100,
        after: 18420,
      },
    ],
    ...overrides,
  };
}

describe('buildBrief', () => {
  it('does not dump approaches or the full history log', () => {
    const brief = buildBrief(ctx());
    const raw = JSON.stringify(brief);
    assert.equal(raw.includes('"approaches"'), false);
    assert.equal(Array.isArray((brief as { history?: { log?: unknown } }).history.log), false);
    assert.ok(!('channels' in brief && Array.isArray((brief as { channels: unknown }).channels)));
  });

  it('surfaces channel headline metrics and points at channels.performance for the rest', () => {
    const brief = buildBrief(ctx());
    assert.equal(brief.channels.count, 2);
    const meta = brief.channels.headline.find((c) => c.id === 'meta');
    assert.equal(meta?.status, 'paused');
    assert.equal(meta?.revenue, 6200);
    assert.match(brief.channels.more, /channels\.performance/);
  });

  it('surfaces forbid rules as typed envelopes and points at governance.rules', () => {
    const brief = buildBrief(ctx());
    assert.equal(brief.governance.count, 2);
    assert.equal(brief.governance.forbids.length, 1);
    assert.equal(brief.governance.forbids[0].object, 'medical_outcome');
    assert.equal(brief.governance.requires_count, 1);
    assert.match(brief.governance.more, /governance\.rules/);
  });

  it('surfaces the last decision per target, including the Meta stop, and points at history.decisions', () => {
    const brief = buildBrief(ctx());
    assert.equal(brief.history.count, 2);
    assert.equal(brief.history.last_by_target.meta.action, 'stop');
    assert.equal(brief.history.last_stop_by_target.meta.after, 72);
    assert.equal(brief.history.last_by_target.meta.after, 72);
    assert.match(brief.history.more, /history\.decisions/);
  });

  it('keeps the last stop visible when a later keep exists on the same target', () => {
    const brief = buildBrief(
      ctx({
        history: [
          {
            id: 'dec_stop_meta',
            decided_at: '2026-03-08T00:00:00.000Z',
            actor: 'operator',
            action: 'stop',
            target_type: 'channel',
            target_id: 'meta',
            outcome: 'negative',
            metric: 'cac',
            before: 40,
            after: 72,
          },
          {
            id: 'dec_keep_meta',
            decided_at: '2026-08-10T00:00:00.000Z',
            actor: 'operator',
            action: 'keep',
            target_type: 'channel',
            target_id: 'meta',
            outcome: 'negative',
          },
        ],
      }),
    );
    assert.equal(brief.history.last_by_target.meta.action, 'keep');
    assert.equal(brief.history.last_stop_by_target.meta.action, 'stop');
    assert.equal(brief.history.last_stop_by_target.meta.after, 72);
  });

  it('stays smaller than the raw store once approaches and a long log exist', () => {
    const long: OperatingContext = ctx({
      history: Array.from({ length: 30 }, (_, i) => ({
        id: `dec_${i}`,
        decided_at: `2025-06-${String((i % 27) + 1).padStart(2, '0')}T00:00:00.000Z`,
        actor: 'operator',
        action: i % 2 === 0 ? 'keep' : 'test',
        target_type: 'channel',
        target_id: i % 2 === 0 ? 'email' : 'meta',
        outcome: 'inconclusive' as const,
      })),
    });
    const full = JSON.stringify(long).length;
    const brief = JSON.stringify(buildBrief(long)).length;
    assert.ok(brief < full, `brief ${brief} should be < store ${full}`);
  });
});
