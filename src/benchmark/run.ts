#!/usr/bin/env node
/**
 * With/without benchmark. Same model, same task prompt.
 * Without = operator paste of the same facts (not an empty context).
 * With = MCP tools against the fixture store.
 *
 * Refuses to score until the grader has fired on a known-bad answer and
 * stayed quiet on a known-good one.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ContextStore } from '../store.js';
import {
  assertGraderInstrument,
  factsFromStore,
  gradeAnswer,
  type GradeResult,
} from './grader.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE = join(ROOT, 'benchmark/fixture');
const STORE_DIR = join(FIXTURE, 'store');
const MODEL = process.env.ECOM_CONTEXT_BENCH_MODEL || 'gpt-4o-mini';
const API_URL = 'https://api.openai.com/v1/chat/completions';

type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

type Usage = { prompt_tokens: number; completion_tokens: number; total_tokens: number };

function loadText(name: string): string {
  return readFileSync(join(FIXTURE, name), 'utf8').trim();
}

function openaiName(mcpName: string): string {
  return mcpName.replace(/\./g, '_');
}

function mcpName(openaiName: string): string {
  // tools are context.brief, channels.performance, governance.rules,
  // history.decisions, memory.write — one dot each.
  return openaiName.replace('_', '.');
}

async function chat(messages: ChatMessage[], tools?: unknown[]): Promise<{
  message: ChatMessage;
  usage: Usage;
}> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');
  const body: Record<string, unknown> = {
    model: MODEL,
    temperature: 0,
    max_tokens: 800,
    messages,
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as {
    error?: { message?: string };
    choices?: Array<{ message: ChatMessage }>;
    usage?: Usage;
  };
  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}: ${data.error?.message || res.statusText}`);
  }
  const message = data.choices?.[0]?.message;
  const usage = data.usage;
  if (!message || !usage) throw new Error('OpenAI response missing message or usage');
  return { message, usage };
}

function addUsage(a: Usage, b: Usage): Usage {
  return {
    prompt_tokens: a.prompt_tokens + b.prompt_tokens,
    completion_tokens: b.completion_tokens + a.completion_tokens,
    total_tokens: a.total_tokens + b.total_tokens,
  };
}

const ZERO: Usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

async function runWithout(task: string, paste: string): Promise<{ answer: string; usage: Usage; rounds: number }> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are an e-commerce operator\'s assistant. The operator pasted the notes they would actually paste into chat. Use them. Do not invent facts they did not provide.',
    },
    {
      role: 'user',
      content: `${task}\n\n--- operator paste ---\n${paste}`,
    },
  ];
  const { message, usage } = await chat(messages);
  return { answer: message.content || '', usage, rounds: 1 };
}

async function runWith(task: string, storeDir: string): Promise<{
  answer: string;
  usage: Usage;
  rounds: number;
  tool_calls: string[];
}> {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [join(ROOT, 'dist/index.js')],
    env: (() => {
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (typeof value === 'string') env[key] = value;
      }
      env.ECOM_CONTEXT_STORE = storeDir;
      return env;
    })(),
    stderr: 'pipe',
    cwd: ROOT,
  });
  const client = new Client({ name: 'ecom-context-benchmark', version: '0.1.0' });
  await client.connect(transport);
  try {
    const listed = await client.listTools();
    const tools = listed.tools.map((tool) => ({
      type: 'function',
      function: {
        name: openaiName(tool.name),
        description: tool.description || tool.name,
        parameters: tool.inputSchema || { type: 'object', properties: {} },
      },
    }));

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'You are an e-commerce operator\'s assistant. Operating-context tools are connected (context.brief, channels.performance, governance.rules, history.decisions, memory.write). Call them before you draft. Do not invent governance, performance, or history.',
      },
      { role: 'user', content: task },
    ];

    let usage = ZERO;
    const called: string[] = [];
    let rounds = 0;
    const maxRounds = 8;

    while (rounds < maxRounds) {
      rounds += 1;
      const { message, usage: u } = await chat(messages, tools);
      usage = addUsage(usage, u);
      messages.push({
        role: 'assistant',
        content: message.content,
        tool_calls: message.tool_calls,
      });
      const toolCalls = message.tool_calls || [];
      if (toolCalls.length === 0) {
        return { answer: message.content || '', usage, rounds, tool_calls: called };
      }
      for (const call of toolCalls) {
        called.push(mcpName(call.function.name));
        let args: Record<string, unknown> = {};
        if (call.function.arguments && call.function.arguments.trim()) {
          args = JSON.parse(call.function.arguments) as Record<string, unknown>;
        }
        const result = await client.callTool({
          name: mcpName(call.function.name),
          arguments: args,
        });
        const text = (result.content as Array<{ type: string; text?: string }>)
          .map((c) => (c.type === 'text' ? c.text : ''))
          .join('\n');
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: text,
        });
      }
    }
    throw new Error('tool loop exceeded max rounds');
  } finally {
    await client.close();
  }
}

function summarize(label: string, answer: string, usage: Usage, grade: GradeResult, extra: Record<string, unknown>) {
  return {
    label,
    model: MODEL,
    ...extra,
    tokens_in: usage.prompt_tokens,
    tokens_out: usage.completion_tokens,
    tokens_total: usage.total_tokens,
    error_count: grade.errors.length,
    errors: grade.errors,
    answer,
  };
}

async function main(): Promise<void> {
  const store = new ContextStore(STORE_DIR);
  const ctx = store.load();
  const facts = factsFromStore(ctx);
  assertGraderInstrument(facts);

  const task = loadText('task.txt');
  const paste = loadText('raw-paste.txt');

  console.error('grader instrument: must-fire and must-quiet passed');
  console.error(`model=${MODEL}`);
  console.error('running WITHOUT (paste baseline)...');
  const without = await runWithout(task, paste);
  const liveStore = mkdtempSync(join(tmpdir(), 'ecom-context-bench-'));
  cpSync(STORE_DIR, liveStore, { recursive: true });
  try {
    console.error('running WITH (MCP connected)...');
    const withRun = await runWith(task, liveStore);

  const gradeWithout = gradeAnswer(without.answer, facts);
  const gradeWith = gradeAnswer(withRun.answer, facts);

  const report = {
    ran_at: new Date().toISOString(),
    model: MODEL,
    task,
    grader: {
      must_fire: 'INSTRUMENT_MUST_FIRE in src/benchmark/grader.ts',
      must_stay_quiet: 'INSTRUMENT_MUST_STAY_QUIET in src/benchmark/grader.ts',
      error_definition:
        'A claim in the answer that contradicts the fixture store: medical efficacy, Meta CAC described as healthy, email described as inactive/zero, or a discount deeper than 20% off.',
    },
    without: summarize('without_server_paste_baseline', without.answer, without.usage, gradeWithout, {
      rounds: without.rounds,
    }),
    with: summarize('with_server', withRun.answer, withRun.usage, gradeWith, {
      rounds: withRun.rounds,
      tool_calls: withRun.tool_calls,
    }),
    delta: {
      tokens_in: withRun.usage.prompt_tokens - without.usage.prompt_tokens,
      tokens_out: withRun.usage.completion_tokens - without.usage.completion_tokens,
      tokens_total: withRun.usage.total_tokens - without.usage.total_tokens,
      error_count: gradeWith.errors.length - gradeWithout.errors.length,
    },
  };

  const outPath = join(ROOT, 'benchmark/results.json');
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.error(`wrote ${outPath}`);
  console.log(
    JSON.stringify(
      {
        model: MODEL,
        without: {
          tokens_in: report.without.tokens_in,
          tokens_out: report.without.tokens_out,
          errors: report.without.error_count,
        },
        with: {
          tokens_in: report.with.tokens_in,
          tokens_out: report.with.tokens_out,
          errors: report.with.error_count,
          tool_calls: withRun.tool_calls,
        },
        delta: report.delta,
      },
      null,
      2,
    ),
  );
  } finally {
    rmSync(liveStore, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
