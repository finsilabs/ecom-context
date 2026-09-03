import type { Channel, Decision, GovernanceRule, MemoryNote, OperatingContext } from './types.js';

export type BriefChannel = {
  id: string;
  name: string;
  kind: Channel['kind'];
  status: Channel['status'];
  window: string;
  revenue: number | null;
  spend: number | null;
  orders: number | null;
};

export type BriefForbid = {
  id: string;
  domain: GovernanceRule['domain'];
  action: GovernanceRule['action'];
  object: string;
  value?: string | number | boolean;
};

export type BriefLastDecision = {
  id: string;
  action: Decision['action'];
  outcome: Decision['outcome'];
  decided_at: string;
  metric?: string;
  before?: number;
  after?: number;
};

export type OperatingBrief = {
  generated_at: string;
  memory: {
    count: number;
    latest: Array<{ id: string; topic: string; text: string }>;
    more: string;
  };
  channels: {
    count: number;
    headline: BriefChannel[];
    more: string;
  };
  governance: {
    count: number;
    forbids: BriefForbid[];
    requires_count: number;
    more: string;
  };
  history: {
    count: number;
    last_by_target: Record<string, BriefLastDecision>;
    last_stop_by_target: Record<string, BriefLastDecision>;
    more: string;
  };
};

function compactDecision(d: Decision): BriefLastDecision {
  return {
    id: d.id,
    action: d.action,
    outcome: d.outcome,
    decided_at: d.decided_at,
    ...(d.metric ? { metric: d.metric } : {}),
    ...(d.before != null ? { before: d.before } : {}),
    ...(d.after != null ? { after: d.after } : {}),
  };
}

function lastByTarget(decisions: Decision[], onlyStop = false): Record<string, BriefLastDecision> {
  const sorted = [...decisions].sort((a, b) => a.decided_at.localeCompare(b.decided_at));
  const out: Record<string, BriefLastDecision> = {};
  for (const d of sorted) {
    if (onlyStop && d.action !== 'stop') continue;
    out[d.target_id] = compactDecision(d);
  }
  return out;
}

function headline(channel: Channel): BriefChannel {
  return {
    id: channel.id,
    name: channel.name,
    kind: channel.kind,
    status: channel.status,
    window: channel.window,
    revenue: channel.revenue,
    spend: channel.spend,
    orders: channel.orders,
  };
}

/**
 * Index, not a dump. Approaches, the full decision log, and require-rules
 * live behind the other tools so a second call is a choice.
 */
export function buildBrief(ctx: OperatingContext): OperatingBrief {
  const latest: MemoryNote[] = [...ctx.memory]
    .sort((a, b) => b.written_at.localeCompare(a.written_at))
    .slice(0, 3);
  const forbids = ctx.governance.filter((r) => r.effect === 'forbid');
  const requires = ctx.governance.filter((r) => r.effect === 'require');

  return {
    generated_at: new Date().toISOString(),
    memory: {
      count: ctx.memory.length,
      latest: latest.map((n) => ({ id: n.id, topic: n.topic, text: n.text })),
      more: 'Older notes are not in this brief; write new ones with memory.write.',
    },
    channels: {
      count: ctx.channels.length,
      headline: ctx.channels.map(headline),
      more: 'Approaches tried are not in this brief. Call channels.performance with channel_id for one channel.',
    },
    governance: {
      count: ctx.governance.length,
      forbids: forbids.map((r) => ({
        id: r.id,
        domain: r.domain,
        action: r.action,
        object: r.object,
        ...(r.value !== undefined ? { value: r.value } : {}),
      })),
      requires_count: requires.length,
      more: 'Require rules and filters: governance.rules with domain or effect.',
    },
    history: {
      count: ctx.history.length,
      last_by_target: lastByTarget(ctx.history),
      last_stop_by_target: lastByTarget(ctx.history, true),
      more: 'Full log: history.decisions with target_type or outcome. last_by_target is latest; last_stop_by_target is the last stop only.',
    },
  };
}
