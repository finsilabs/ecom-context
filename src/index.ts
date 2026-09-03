#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ContextStore, storeDirFromEnv } from './store.js';
import { cli, createServer } from './server.js';

async function main() {
  const store = new ContextStore(storeDirFromEnv());
  if (process.argv[2]) { process.exitCode = await cli(store, process.argv.slice(2)); return; }
  store.ensure();
  const s = createServer(store);
  await s.connect(new StdioServerTransport());
  console.error(`ecom-context MCP server on stdio (store=${store.dir})`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
