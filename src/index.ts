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
        'Compact INDEX of the four stores, not a dump. Includes: latest memory notes, channel headline metrics (no approaches), every forbid rule, and the last decision per target. Call channels.performance, governance.rules, or history.decisions only if you need approaches, require-rules, or older decisions. Do not call this twice.',
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
        'Full record for a channel, including approaches tried and outcomes. Headline metrics are already in context.brief — pass channel_id for the one channel you need. Do not call this twice for the same id.',
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
        'Typed rules. Forbid rules are already listed in context.brief. Call this to filter by domain or effect, or to read require rules. Not free-text policy.',
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
        'Typed decision log. context.brief already has the last decision per target. Call this for older decisions or to filter by target_type or outcome.',
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
        'Append a free-text memory note. The only write path. Do not put rules or decisions here. Do not call this while drafting from existing context.',
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
