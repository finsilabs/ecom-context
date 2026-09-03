import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ContextStore } from './store.js';
import { cli, createServer } from './server.js';

function store() {
  const d = mkdtempSync(join(tmpdir(), 'ecom-context-srv-'));
  writeFileSync(join(d, 'brand.md'), 'Dog treats.');
  writeFileSync(join(d, 'targets.json'), JSON.stringify({ targets: [{ id: 'meta', name: 'Meta', kind: 'channel', status: 'paused', aliases: [] }] }));
  writeFileSync(join(d, 'governance.json'), JSON.stringify({ rules: [{ id: 'cap', effect: 'forbid', domain: 'offers', action: 'discount', object: 'cap', op: 'gt', value: 20, created_at: '2026-01-01', created_by: 'op' }] }));
  writeFileSync(join(d, 'history.json'), JSON.stringify({ decisions: [{ id: 's', decided_at: '2026-03-08', actor: 'op', action: 'stop', target: 'meta', outcome: 'negative', status: 'confirmed', recorded_by: 'operator' }] }));
  return new ContextStore(d);
}

describe('MCP surface', () => {
  it('serves both response types as compact text plus structuredContent, and refuses an empty proposal', async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createServer(store()).connect(a);
    const client = new Client({ name: 't', version: '0' }); await client.connect(b);
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(tools, ['context.check', 'history.record']);
    const orient = await client.callTool({ name: 'context.check', arguments: { targets: ['meta'] } }) as any;
    assert.equal(orient.structuredContent.verdict, 'unchecked'); assert.equal(orient.structuredContent.mode, 'orientation');
    assert.equal(orient.content[0].text, JSON.stringify(orient.structuredContent), 'wire text is compact JSON');
    const blocked = await client.callTool({ name: 'context.check', arguments: { targets: ['meta'], proposal: { action: 'start', discount_pct: 35 } } }) as any;
    assert.equal(blocked.structuredContent.verdict, 'blocked'); assert.equal(blocked.structuredContent.conflicts.length, 1);
    const refused = await client.callTool({ name: 'context.check', arguments: { proposal: {} } }) as any;
    assert.equal(refused.isError, true); assert.match(refused.content[0].text, /declares nothing to evaluate/);
    await client.close();
  });
  it('CLI check maps verdicts to exit codes 0/1/2/3/4 and reads stdin', async () => {
    const s = store(); const out: string[] = []; const io = { stdin: () => '{"targets":["meta"]}', log: (x: string) => out.push(x), warn: (x: string) => out.push(x) };
    assert.equal(await cli(s, ['check', '{"targets":["meta"]}'], io), 3);
    assert.equal(await cli(s, ['check', '-'], io), 3);
    assert.equal(await cli(s, ['check', '{"targets":["meta"],"proposal":{"action":"start"}}'], io), 1);
    assert.equal(await cli(s, ['check', '{"targets":["meta"],"proposal":{"discount_pct":50}}'], io), 2);
    assert.equal(await cli(s, ['check', '{"targets":["meta"],"proposal":{}}'], io), 4);
    const d = mkdtempSync(join(tmpdir(), 'ecom-context-ok-')); writeFileSync(join(d, 'targets.json'), JSON.stringify({ targets: [{ id: 'email', name: 'Email', kind: 'channel', status: 'active', aliases: [] }] }));
    assert.equal(await cli(new ContextStore(d), ['check', '{"targets":["email"],"proposal":{"discount_pct":5}}'], io), 0);
  });
});
