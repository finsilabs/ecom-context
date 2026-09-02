#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { buildBrief } from './brief.js';
import { ContextStore, StoreError, storeDirFromEnv } from './store.js';
import {
  DecisionOutcome,
  DecisionTargetType,
  GovernanceDomain,
  GovernanceEffect,
} from './types.js';

function jsonResult(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(err: unknown) {
  const message = err instanceof StoreError ? err.message : err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
  };
}

function createServer(store: ContextStore): McpServer {
  const server = new McpServer({
    name: 'ecom-context',
    version: '0.1.0',
  });

  server.registerTool(
    'context.brief',
    {
      title: 'Operating brief',
      description:
        'Compact operating brief assembled from memory, channels, governance, and history. Governance and history are typed records; free text is only in memory.',
      inputSchema: z.object({}),
    },
    async () => {
      try {
        return jsonResult(buildBrief(store.load()));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'channels.performance',
    {
      title: 'Channel performance',
      description:
        'Typed per-channel performance and approaches already tried, with outcomes. Not a metrics dump and not prose.',
      inputSchema: z.object({
        channel_id: z.string().min(1).optional().describe('If set, return only this channel'),
      }),
    },
    async ({ channel_id }) => {
      try {
        let channels = store.loadChannels();
        if (channel_id) {
          channels = channels.filter((channel) => channel.id === channel_id);
        }
        return jsonResult({ channels });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'governance.rules',
    {
      title: 'Governance rules',
      description:
        'Typed rules the agent must obey (effect, domain, action, object). Not free-text policy. Filter by domain or effect.',
      inputSchema: z.object({
        domain: GovernanceDomain.optional(),
        effect: GovernanceEffect.optional(),
      }),
    },
    async ({ domain, effect }) => {
      try {
        let rules = store.loadGovernance();
        if (domain) rules = rules.filter((rule) => rule.domain === domain);
        if (effect) rules = rules.filter((rule) => rule.effect === effect);
        return jsonResult({ rules });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'history.decisions',
    {
      title: 'Decision history',
      description:
        'Typed decisions: when, who, action, target, outcome, optional metric before/after. Not a changelog narrative.',
      inputSchema: z.object({
        target_type: DecisionTargetType.optional(),
        outcome: DecisionOutcome.optional(),
      }),
    },
    async ({ target_type, outcome }) => {
      try {
        let decisions = store.loadHistory();
        if (target_type) {
          decisions = decisions.filter((decision) => decision.target_type === target_type);
        }
        if (outcome) {
          decisions = decisions.filter((decision) => decision.outcome === outcome);
        }
        return jsonResult({ decisions });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'memory.write',
    {
      title: 'Write memory',
      description:
        'Append a free-text memory note. This is the only store that accepts prose. Do not put rules or decisions here.',
      inputSchema: z.object({
        topic: z.string().min(1).describe('Short tag, e.g. positioning, customer, product'),
        text: z.string().min(1).describe('Free-text note about the business'),
      }),
    },
    async ({ topic, text }) => {
      try {
        const note = store.writeMemory({ topic, text });
        return jsonResult({ written: note });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  return server;
}

async function main(): Promise<void> {
  const dir = storeDirFromEnv();
  const store = new ContextStore(dir);
  store.ensure();
  const server = createServer(store);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`ecom-context MCP server on stdio (store=${dir})`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
