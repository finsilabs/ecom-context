import { z } from 'zod';

/**
 * Governance and history are typed records. A rule or decision the agent
 * must interpret as prose is a rule it can misread — that is the failure
 * this store exists to prevent. Free text belongs in memory, nowhere else.
 */

export const isoDatetime = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'must be an ISO-8601 datetime',
  });

export const GovernanceEffect = z.enum(['forbid', 'require']);
export const GovernanceDomain = z.enum([
  'copy',
  'offers',
  'audience',
  'legal',
  'ops',
  'channel',
]);
export const GovernanceAction = z.enum([
  'claim',
  'discount',
  'compare_at',
  'guarantee',
  'target_audience',
  'send',
  'mention_competitor',
  'use_ugc',
]);

export const GovernanceRule = z
  .object({
    id: z.string().min(1),
    effect: GovernanceEffect,
    domain: GovernanceDomain,
    action: GovernanceAction,
    object: z.string().min(1),
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
    created_at: isoDatetime,
  })
  .strict();
export type GovernanceRule = z.infer<typeof GovernanceRule>;

export const DecisionAction = z.enum(['start', 'stop', 'change', 'test', 'keep']);
export const DecisionTargetType = z.enum([
  'channel',
  'offer',
  'campaign',
  'product',
  'ops',
]);
export const DecisionOutcome = z.enum([
  'pending',
  'positive',
  'negative',
  'inconclusive',
]);

export const Decision = z
  .object({
    id: z.string().min(1),
    decided_at: isoDatetime,
    actor: z.string().min(1),
    action: DecisionAction,
    target_type: DecisionTargetType,
    target_id: z.string().min(1),
    outcome: DecisionOutcome,
    metric: z.string().min(1).optional(),
    before: z.number().optional(),
    after: z.number().optional(),
  })
  .strict();
export type Decision = z.infer<typeof Decision>;

export const ChannelKind = z.enum([
  'email',
  'sms',
  'paid_social',
  'search',
  'organic',
  'affiliate',
  'other',
]);
export const ChannelStatus = z.enum(['active', 'paused', 'retired']);
export const ApproachKind = z.enum([
  'frequency',
  'creative',
  'offer',
  'audience',
  'timing',
  'other',
]);
export const ApproachOutcome = z.enum(['worked', 'did_not_work', 'inconclusive']);

export const Approach = z
  .object({
    id: z.string().min(1),
    tried_at: isoDatetime,
    kind: ApproachKind,
    outcome: ApproachOutcome,
  })
  .strict();
export type Approach = z.infer<typeof Approach>;

export const Channel = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: ChannelKind,
    status: ChannelStatus,
    window: z.string().min(1),
    revenue: z.number().nullable(),
    spend: z.number().nullable(),
    orders: z.number().nullable(),
    approaches: z.array(Approach),
  })
  .strict();
export type Channel = z.infer<typeof Channel>;

export const MemoryNote = z
  .object({
    id: z.string().min(1),
    written_at: isoDatetime,
    topic: z.string().min(1),
    text: z.string().min(1),
  })
  .strict();
export type MemoryNote = z.infer<typeof MemoryNote>;

export const MemoryFile = z
  .object({ notes: z.array(MemoryNote) })
  .strict();
export const ChannelsFile = z
  .object({ channels: z.array(Channel) })
  .strict();
export const GovernanceFile = z
  .object({ rules: z.array(GovernanceRule) })
  .strict();
export const HistoryFile = z
  .object({ decisions: z.array(Decision) })
  .strict();

export type MemoryFile = z.infer<typeof MemoryFile>;
export type ChannelsFile = z.infer<typeof ChannelsFile>;
export type GovernanceFile = z.infer<typeof GovernanceFile>;
export type HistoryFile = z.infer<typeof HistoryFile>;

export type OperatingContext = {
  memory: MemoryNote[];
  channels: Channel[];
  governance: GovernanceRule[];
  history: Decision[];
};
