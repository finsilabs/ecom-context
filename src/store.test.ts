import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ContextStore, StoreError } from './store.js';

function tmpStore(): ContextStore {
  const dir = mkdtempSync(join(tmpdir(), 'ecom-context-'));
  return new ContextStore(dir);
}

describe('ContextStore', () => {
  it('loads empty stores when files are missing', () => {
    const store = tmpStore();
    const ctx = store.load();
    assert.deepEqual(ctx, { memory: [], channels: [], governance: [], history: [] });
  });

  it('accepts a typed governance rule', () => {
    const store = tmpStore();
    store.ensure();
    writeFileSync(
      join(store.dir, 'governance.json'),
      JSON.stringify({
        rules: [
          {
            id: 'gov_no_medical',
            effect: 'forbid',
            domain: 'copy',
            action: 'claim',
            object: 'medical_outcome',
            created_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    );
    const rules = store.loadGovernance();
    assert.equal(rules.length, 1);
    assert.equal(rules[0].effect, 'forbid');
    assert.equal(rules[0].action, 'claim');
  });

  it('rejects a free-text governance blob instead of interpreting it', () => {
    const store = tmpStore();
    store.ensure();
    writeFileSync(
      join(store.dir, 'governance.json'),
      JSON.stringify({
        rules: [{ rule: 'Never claim medical outcomes in email copy.' }],
      }),
    );
    assert.throws(() => store.loadGovernance(), StoreError);
    try {
      store.loadGovernance();
    } catch (err) {
      assert.ok(err instanceof StoreError);
      assert.match(err.message, /Free text belongs in memory\.json/);
      assert.doesNotMatch(err.message, /Never claim medical/);
    }
  });

  it('rejects a free-text history blob', () => {
    const store = tmpStore();
    store.ensure();
    writeFileSync(
      join(store.dir, 'history.json'),
      JSON.stringify({
        decisions: [{ notes: 'We paused Meta in March because CAC spiked.' }],
      }),
    );
    assert.throws(() => store.loadHistory(), StoreError);
  });

  it('appends free text only through memory.write', () => {
    const store = tmpStore();
    const note = store.writeMemory({
      topic: 'positioning',
      text: 'We sell freeze-dried organs to pet owners who already cook.',
    });
    assert.equal(note.topic, 'positioning');
    assert.ok(note.id.startsWith('mem_'));
    const loaded = store.loadMemory();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].text, note.text);
  });

  it('accepts a typed decision and a typed channel', () => {
    const store = tmpStore();
    store.ensure();
    writeFileSync(
      join(store.dir, 'history.json'),
      JSON.stringify({
        decisions: [
          {
            id: 'dec_1',
            decided_at: '2026-03-01T00:00:00.000Z',
            actor: 'operator',
            action: 'stop',
            target_type: 'channel',
            target_id: 'meta',
            outcome: 'negative',
            metric: 'cac',
            before: 40,
            after: 72,
          },
        ],
      }),
    );
    writeFileSync(
      join(store.dir, 'channels.json'),
      JSON.stringify({
        channels: [
          {
            id: 'email',
            name: 'Klaviyo',
            kind: 'email',
            status: 'active',
            window: '30d',
            revenue: 12000,
            spend: null,
            orders: 310,
            approaches: [
              {
                id: 'ap_1',
                tried_at: '2026-02-01T00:00:00.000Z',
                kind: 'frequency',
                outcome: 'worked',
              },
            ],
          },
        ],
      }),
    );
    assert.equal(store.loadHistory()[0].action, 'stop');
    assert.equal(store.loadChannels()[0].approaches[0].outcome, 'worked');
  });
});
