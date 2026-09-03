import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { Decision, GovernanceFile, HistoryFile, TargetsFile, type Decision as DecisionType, type OperatingContext, type Target } from './types.js';

export class StoreError extends Error { constructor(message: string) { super(message); this.name = 'StoreError'; } }

export const BRAND_CAP = 4096;
const KINDS = new Set(['channel', 'offer', 'audience', 'product', 'campaign', 'ops']);

function read(path: string): unknown {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    if (e instanceof SyntaxError) throw new StoreError(`${path} is not valid JSON. Fix it by hand and try again.`);
    throw e;
  }
}

function parse<T>(path: string, schema: { parse(v: unknown): T }, empty: T): T {
  const raw = read(path);
  if (raw === null) return empty;
  try { return schema.parse(raw); }
  catch (e) {
    if (e instanceof ZodError) throw new StoreError(`${path} is not a valid typed store (${e.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}).`);
    throw e;
  }
}

function write(path: string, data: unknown) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, path);
}

/** Cross-file checks the schemas cannot express: unique resolution names, registry references. */
export function validateContext(ctx: OperatingContext): void {
  const ids = new Set(ctx.targets.map((t) => t.id));
  const owner = new Map<string, string>();
  for (const t of ctx.targets) for (const key of [t.id, t.name, ...t.aliases]) {
    const k = key.toLowerCase(); const prev = owner.get(k);
    if (prev && prev !== t.id) throw new StoreError(`targets.json: '${key}' resolves to both '${prev}' and '${t.id}'; ids, names and aliases must be unique across targets (case-insensitive).`);
    owner.set(k, t.id);
  }
  const ruleIds = new Set(ctx.governance.map((r) => r.id));
  for (const r of ctx.governance) {
    for (const a of r.applies_to ?? []) if (!ids.has(a) && !KINDS.has(a)) throw new StoreError(`governance.json: rule ${r.id} applies_to '${a}' is neither a target id nor a kind (targets: ${[...ids].join(', ') || 'none'}).`);
    if (r.superseded_by && !ruleIds.has(r.superseded_by)) throw new StoreError(`governance.json: rule ${r.id} is superseded_by unknown rule '${r.superseded_by}'.`);
  }
  for (const d of ctx.history) if (!ids.has(d.target)) throw new StoreError(`history.json: decision ${d.id} targets '${d.target}', which is not in the registry (targets: ${[...ids].join(', ') || 'none'}).`);
}

export class ContextStore {
  constructor(readonly dir: string) {}

  ensure() {
    mkdirSync(this.dir, { recursive: true });
    const brand = join(this.dir, 'brand.md');
    if (existsSync(brand) && readFileSync(brand).byteLength > BRAND_CAP) throw new StoreError(`brand.md exceeds the ${BRAND_CAP}-byte cap; put longer material in a document the agent can be pointed at.`);
    for (const old of ['memory.json', 'channels.json']) if (existsSync(join(this.dir, old))) throw new StoreError(`${old} is removed in v1; run ecom-context migrate.`);
  }

  load(): OperatingContext {
    this.ensure();
    const ctx: OperatingContext = {
      brand: existsSync(join(this.dir, 'brand.md')) ? readFileSync(join(this.dir, 'brand.md'), 'utf8') : '',
      targets: parse(join(this.dir, 'targets.json'), TargetsFile, { targets: [] }).targets,
      governance: parse(join(this.dir, 'governance.json'), GovernanceFile, { rules: [] }).rules,
      history: parse(join(this.dir, 'history.json'), HistoryFile, { decisions: [] }).decisions,
    };
    validateContext(ctx);
    return ctx;
  }

  record(input: Omit<DecisionType, 'id' | 'decided_at' | 'status' | 'recorded_by'>): DecisionType {
    const ctx = this.load();
    const target = resolve(ctx.targets, input.target);
    if (!target) throw new StoreError(`target '${input.target}' does not resolve; use a registry id, name or alias (${ctx.targets.map((t) => t.id).join(', ') || 'registry is empty'}).`);
    const d = Decision.parse({ ...input, id: `dec_${randomUUID()}`, decided_at: new Date().toISOString(), status: 'proposed', recorded_by: 'agent', target: target.id });
    write(join(this.dir, 'history.json'), { decisions: [...ctx.history, d] });
    return d;
  }

  confirm(id: string) {
    const ctx = this.load();
    const found = ctx.history.find((d) => d.id === id);
    if (!found) throw new StoreError(`decision '${id}' not found`);
    const decisions = ctx.history.map((d) => (d.id === id ? Decision.parse({ ...d, status: 'confirmed', recorded_by: 'operator' }) : d));
    write(join(this.dir, 'history.json'), { decisions });
  }

  /** Deletes a proposed record. Confirmed operator history is never deleted here; edit the file. */
  reject(id: string) {
    const ctx = this.load();
    const found = ctx.history.find((d) => d.id === id);
    if (!found) throw new StoreError(`decision '${id}' not found`);
    if (found.status !== 'proposed') throw new StoreError(`decision '${id}' is confirmed; reject only removes proposed records. Edit history.json to remove operator history.`);
    write(join(this.dir, 'history.json'), { decisions: ctx.history.filter((d) => d.id !== id) });
  }
}

export function resolve(targets: Target[], query: string): Target | undefined {
  const q = query.trim().toLowerCase();
  return targets.find((t) => t.id.toLowerCase() === q || t.name.toLowerCase() === q || t.aliases.some((a) => a.toLowerCase() === q));
}

export function storeDirFromEnv(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()) {
  return env.ECOM_CONTEXT_STORE?.trim() || join(cwd, 'store');
}
