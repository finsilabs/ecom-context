import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ZodError, type ZodType } from 'zod';
import {
  ChannelsFile,
  GovernanceFile,
  HistoryFile,
  MemoryFile,
  MemoryNote,
  type Channel,
  type Decision,
  type GovernanceRule,
  type OperatingContext,
} from './types.js';

export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreError';
  }
}

function formatZod(file: string, err: ZodError): string {
  const issues = err.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
  return `${file} is not a valid typed store (${issues}). Free text belongs in memory.json, not here.`;
}

function readJson(path: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    throw new StoreError(`cannot read ${path}: ${(err as Error).message}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new StoreError(`${path} is not valid JSON. Fix it by hand and try again.`);
  }
}

function parseFile<T>(path: string, schema: ZodType<T>, empty: T): T {
  const data = readJson(path);
  if (data === null) return empty;
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new StoreError(formatZod(path, parsed.error));
  }
  return parsed.data;
}

function writeJson(path: string, data: unknown): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
}

export class ContextStore {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  private path(name: string): string {
    return join(this.dir, name);
  }

  ensure(): void {
    mkdirSync(this.dir, { recursive: true });
  }

  loadMemory(): MemoryNote[] {
    return parseFile(this.path('memory.json'), MemoryFile, { notes: [] }).notes;
  }

  loadChannels(): Channel[] {
    return parseFile(this.path('channels.json'), ChannelsFile, { channels: [] }).channels;
  }

  loadGovernance(): GovernanceRule[] {
    return parseFile(this.path('governance.json'), GovernanceFile, { rules: [] }).rules;
  }

  loadHistory(): Decision[] {
    return parseFile(this.path('history.json'), HistoryFile, { decisions: [] }).decisions;
  }

  load(): OperatingContext {
    return {
      memory: this.loadMemory(),
      channels: this.loadChannels(),
      governance: this.loadGovernance(),
      history: this.loadHistory(),
    };
  }

  writeMemory(input: { topic: string; text: string }): MemoryNote {
    this.ensure();
    const notes = this.loadMemory();
    const note: MemoryNote = {
      id: `mem_${randomUUID()}`,
      written_at: new Date().toISOString(),
      topic: input.topic,
      text: input.text,
    };
    const next = MemoryNote.parse(note);
    notes.push(next);
    writeJson(this.path('memory.json'), { notes });
    return next;
  }
}

export function storeDirFromEnv(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  const fromEnv = env.ECOM_CONTEXT_STORE?.trim();
  if (fromEnv) return fromEnv;
  return join(cwd, 'store');
}
