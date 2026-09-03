/**
 * Claude arm of the benchmark, on the official SDK. Same contract as the OpenAI loop in run.ts:
 * one system prompt, one user turn, optional tools, a callback that executes a tool call and
 * returns its text, and per-round usage back to the caller. No refusal fallback is enabled on
 * purpose: a benchmark that silently served a refused turn from another model would be measuring
 * the wrong model; a refusal is recorded as `stop_reason` and graded as the empty answer it is.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { ToolDef, ToolCallRec, RoundRec, LoopResult } from './run.js';

let client: Anthropic | undefined;
const api = () => (client ??= new Anthropic());

export async function verifyAnthropicModel(id: string): Promise<string> {
  const m = await api().models.retrieve(id);
  return m.id;
}

export async function anthropicLoop(opts: {
  model: string; system: string; user: string; tools?: ToolDef[]; maxRounds: number; maxTokens: number;
  onTool: (call: ToolCallRec) => Promise<string>;
}): Promise<LoopResult> {
  const tools: Anthropic.Tool[] | undefined = opts.tools?.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters as Anthropic.Tool.InputSchema }));
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: opts.user }];
  const rounds: RoundRec[] = [];
  const called: ToolCallRec[] = [];
  while (rounds.length < opts.maxRounds) {
    let response: Anthropic.Message | undefined; let emptyRetries = 0;
    // Observed 2/15 on claude-opus-5: end_turn with thinking blocks only and no text. That is not an answer; retry twice, record it, then score whatever came back.
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await api().messages.create({ model: opts.model, max_tokens: opts.maxTokens, system: opts.system, messages, ...(tools && tools.length ? { tools } : {}) });
      if (response.content.some((b) => b.type === 'text' || b.type === 'tool_use')) break;
      emptyRetries++;
    }
    const r = response!;
    const u = r.usage;
    const round: RoundRec = { prompt_tokens: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), completion_tokens: u.output_tokens, cache_read_tokens: u.cache_read_input_tokens ?? 0, cache_write_tokens: u.cache_creation_input_tokens ?? 0, tool_calls: [], content_types: r.content.map((b) => b.type), ...(emptyRetries ? { empty_retries: emptyRetries } : {}) };
    rounds.push(round);
    const response2 = r;
    const toolUses = response2.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (response2.stop_reason !== 'tool_use' || toolUses.length === 0) {
      const answer = response2.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n');
      return { answer, rounds, tool_calls: called, stop_reason: answer ? (response2.stop_reason ?? 'unknown') : `empty_after_${emptyRetries}_retries` };
    }
    messages.push({ role: 'assistant', content: response2.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const t of toolUses) {
      const call: ToolCallRec = { name: t.name, arguments: (t.input ?? {}) as Record<string, unknown> };
      round.tool_calls.push(call); called.push(call);
      results.push({ type: 'tool_result', tool_use_id: t.id, content: await opts.onTool(call) });
    }
    messages.push({ role: 'user', content: results });
  }
  throw new Error('tool loop exceeded max rounds');
}
