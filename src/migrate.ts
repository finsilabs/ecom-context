/**
 * One-shot migration from the pre-v1 layout (channels.json, memory.json,
 * untyped governance/history) to the v1 store (brand.md, targets.json,
 * governance.json, history.json). Pure function plus a directory wrapper.
 * Performance metrics are dropped on purpose: the platform of record owns them.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Decision, GovernanceFile, HistoryFile, TargetsFile, type OperatingContext, type Rule, type Target } from './types.js';

export const BRAND_CAP = 4096;

type LegacyApproach = { id: string; tried_at: string; kind: string; outcome: string };
type LegacyChannel = { id: string; name: string; kind?: string; status?: string; approaches?: LegacyApproach[] };
type LegacyRule = { id: string; effect: string; domain: string; action: string; object: string; value?: unknown; created_at: string };
type LegacyDecision = { id: string; decided_at: string; actor: string; action: string; target_id: string; outcome: string; metric?: string; before?: number; after?: number };
type LegacyNote = { id: string; written_at?: string; topic?: string; text: string };
export type LegacyStore = { channels: LegacyChannel[]; rules: LegacyRule[]; decisions: LegacyDecision[]; notes: LegacyNote[] };

const OUTCOME: Record<string, Decision['outcome']> = { worked: 'positive', did_not_work: 'negative', inconclusive: 'inconclusive' };
const STATUS = new Set(['active', 'paused', 'retired']);

export function migrateContext(legacy: LegacyStore): { ctx: OperatingContext; warnings: string[] } {
  const warnings: string[] = [];
  const targets: Target[] = legacy.channels.map((c) => ({
    id: c.id,
    name: c.name,
    kind: 'channel',
    status: STATUS.has(c.status ?? '') ? (c.status as Target['status']) : 'active',
    aliases: [],
  }));
  const rules: Rule[] = legacy.rules.map((r) => {
    const base: Rule = { id: r.id, effect: r.effect as Rule['effect'], domain: r.domain as Rule['domain'], action: r.action as Rule['action'], object: r.object, created_at: r.created_at, created_by: 'operator' };
    if (r.value === undefined) return base;
    if (r.action === 'discount' && typeof r.value === 'number') return { ...base, op: 'gt', value: r.value };
    warnings.push(`rule ${r.id}: value ${JSON.stringify(r.value)} has no typed operator in v1 and was dropped`);
    return base;
  });
  const decisions: Decision[] = legacy.decisions.map((d) => ({
    id: d.id, decided_at: d.decided_at, actor: d.actor, action: d.action as Decision['action'], target: d.target_id, outcome: d.outcome as Decision['outcome'],
    ...(d.metric ? { metric: d.metric } : {}), ...(d.before == null ? {} : { before: d.before }), ...(d.after == null ? {} : { after: d.after }),
    status: 'confirmed', recorded_by: 'operator',
  }));
  for (const c of legacy.channels) for (const ap of c.approaches ?? []) decisions.push({
    id: `dec_${ap.id}`, decided_at: ap.tried_at, actor: 'operator', action: 'test', target: c.id, outcome: OUTCOME[ap.outcome] ?? 'inconclusive',
    params: { kind: ap.kind }, status: 'confirmed', recorded_by: 'operator',
  });
  decisions.sort((a, b) => Date.parse(a.decided_at) - Date.parse(b.decided_at));
  let brand = '';
  for (const n of legacy.notes) {
    const next = brand ? `${brand}\n\n${n.text}` : n.text;
    if (Buffer.byteLength(next) > BRAND_CAP) { warnings.push(`note ${n.id} dropped: brand.md would exceed ${BRAND_CAP} bytes`); continue; }
    brand = next;
  }
  const ctx = { brand, targets: TargetsFile.parse({ targets }).targets, governance: GovernanceFile.parse({ rules }).rules, history: HistoryFile.parse({ decisions }).decisions };
  return { ctx, warnings };
}

export function readLegacy(dir: string): LegacyStore | null {
  const read = (name: string) => (existsSync(join(dir, name)) ? JSON.parse(readFileSync(join(dir, name), 'utf8')) : null);
  const channels = read('channels.json'); const memory = read('memory.json');
  if (!channels && !memory) return null;
  return { channels: channels?.channels ?? [], rules: read('governance.json')?.rules ?? [], decisions: read('history.json')?.decisions ?? [], notes: memory?.notes ?? [] };
}

export function writeV1(dir: string, ctx: OperatingContext): void {
  writeFileSync(join(dir, 'brand.md'), `${ctx.brand}\n`);
  writeFileSync(join(dir, 'targets.json'), `${JSON.stringify({ targets: ctx.targets }, null, 2)}\n`);
  writeFileSync(join(dir, 'governance.json'), `${JSON.stringify({ rules: ctx.governance }, null, 2)}\n`);
  writeFileSync(join(dir, 'history.json'), `${JSON.stringify({ decisions: ctx.history }, null, 2)}\n`);
}

/** Migrates a store directory in place. The two removed files are renamed with a .migrated suffix, not deleted. */
export function migrateDir(dir: string): string[] {
  const legacy = readLegacy(dir);
  if (!legacy) throw new Error(`${dir} has no channels.json or memory.json; nothing to migrate.`);
  if (existsSync(join(dir, 'targets.json'))) throw new Error(`${dir} already has targets.json; remove it or the legacy files before migrating.`);
  const { ctx, warnings } = migrateContext(legacy);
  writeV1(dir, ctx);
  for (const old of ['channels.json', 'memory.json']) if (existsSync(join(dir, old))) renameSync(join(dir, old), join(dir, `${old}.migrated`));
  return warnings;
}
