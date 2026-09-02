import type { OperatingContext } from './types.js';

/** Compact operating brief: typed records, not a narrative the agent must parse. */
export function buildBrief(ctx: OperatingContext): {
  generated_at: string;
  memory: OperatingContext['memory'];
  channels: OperatingContext['channels'];
  governance: OperatingContext['governance'];
  history: OperatingContext['history'];
} {
  return {
    generated_at: new Date().toISOString(),
    memory: ctx.memory,
    channels: ctx.channels,
    governance: ctx.governance,
    history: ctx.history,
  };
}
