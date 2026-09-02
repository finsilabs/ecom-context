# ecom-context

An operator's agent starts every session knowing nothing about the business. It re-derives which channels exist, what was already tried, what the brand may not say, and what happened last time — from raw exports, screenshots and chat scrollback. That is where the errors come from: the agent guesses at a fact the operator already knows, and states the guess as fact.

This is a local MCP server that holds that context in four stores the operator can open in any editor. graphify does this for a codebase. This does it for a commerce operation.

A retrieved passage is something the agent must interpret and may misread. A typed governance rule is something it can obey. A typed outcome is something it can count. **Governance and history stay typed. Free text goes in memory.** A rule stored as a paragraph is a rule the agent can invent a reading of.

## Run it

Node 20+. From this directory:

```sh
npm install
npm run build
ECOM_CONTEXT_STORE="$PWD/store" node dist/index.js
```

The process speaks MCP over stdio. Point your agent at it. Log lines go to stderr; stdout is the protocol.

Claude Desktop / Cursor / any MCP host:

```json
{
  "mcpServers": {
    "ecom-context": {
      "command": "node",
      "args": ["/absolute/path/to/ecom-context/dist/index.js"],
      "env": {
        "ECOM_CONTEXT_STORE": "/absolute/path/to/ecom-context/store"
      }
    }
  }
}
```

If `ECOM_CONTEXT_STORE` is unset, the server uses `./store` relative to the process working directory. Set the env var. Hosts do not always start you where you think.

## The four stores

Plain JSON in `store/`. Pretty-printed. No database, no ORM, no migration runner. Edit by hand; the server will refuse a file that does not match the typed shape instead of guessing.

| File | Holds | Shape |
|---|---|---|
| `store/memory.json` | What the business is | `{ "notes": [ { "id", "written_at", "topic", "text" } ] }` |
| `store/channels.json` | Performance and approaches tried | `{ "channels": [ { "id", "name", "kind", "status", "window", "revenue", "spend", "orders", "approaches" } ] }` |
| `store/governance.json` | Rules the agent must obey | `{ "rules": [ { "id", "effect", "domain", "action", "object", "value?", "created_at" } ] }` |
| `store/history.json` | Decisions taken | `{ "decisions": [ { "id", "decided_at", "actor", "action", "target_type", "target_id", "outcome", "metric?", "before?", "after?" } ] }` |

Closed enumerations (do not replace these with sentences):

- governance `effect`: `forbid` \| `require`
- governance `domain`: `copy` \| `offers` \| `audience` \| `legal` \| `ops` \| `channel`
- governance `action`: `claim` \| `discount` \| `compare_at` \| `guarantee` \| `target_audience` \| `send` \| `mention_competitor` \| `use_ugc`
- history `action`: `start` \| `stop` \| `change` \| `test` \| `keep`
- history `target_type`: `channel` \| `offer` \| `campaign` \| `product` \| `ops`
- history `outcome`: `pending` \| `positive` \| `negative` \| `inconclusive`
- channel `kind`: `email` \| `sms` \| `paid_social` \| `search` \| `organic` \| `affiliate` \| `other`
- approach `kind`: `frequency` \| `creative` \| `offer` \| `audience` \| `timing` \| `other`
- approach `outcome`: `worked` \| `did_not_work` \| `inconclusive`

`object` on a governance rule is a short identifier (`medical_outcome`, `below_20_pct`), not a paragraph. If you need to explain the business, that is a memory note.

Example rule, authored by the operator in `governance.json`:

```json
{
  "id": "gov_no_medical",
  "effect": "forbid",
  "domain": "copy",
  "action": "claim",
  "object": "medical_outcome",
  "created_at": "2026-01-01T00:00:00.000Z"
}
```

## Five tools

| Tool | Reads / writes | Input |
|---|---|---|
| `context.brief` | reads all four stores | none |
| `channels.performance` | reads channels | optional `channel_id` |
| `governance.rules` | reads governance | optional `domain`, `effect` |
| `history.decisions` | reads history | optional `target_type`, `outcome` |
| `memory.write` | appends to memory | `topic`, `text` |

`memory.write` is the only write path on the MCP surface. Rules and decisions are operator-authored files so the agent cannot invent a policy and then obey it.

## Benchmark (measured)

One operator task, same model, same task prompt, two conditions:

- **without:** the model gets the raw notes an operator would paste (Slack, a pinned offer rule, an about-page dump). Same facts as the store, plus noise. Not an empty context.
- **with:** the model gets MCP tools against that store. No paste.

Task: draft a Spring wellness email (subject, 3 bullets, CTA) and recommend whether to restart Meta prospecting.

Model: `gpt-4o-mini` (`gpt-4o-mini-2024-07-18`), temperature 0. Ran 2026-09-02. Raw transcript: `benchmark/results.json`. Re-run: `npm run benchmark` (needs `OPENAI_API_KEY`).

| | tokens in | tokens out | total | errors |
|---|---:|---:|---:|---:|
| without (paste) | 420 | 171 | 591 | 0 |
| with (MCP) | 1909 | 238 | 2147 | 0 |

**The server used more tokens. Errors tied at zero.** The pitch "fewer tokens, fewer errors" is not supported by this run. The extra tokens are the tool loop: the with-run called `context.brief` once and `channels.performance` twice.

An error is a claim that contradicts the fixture store. The four checks were written before the model ran: medical efficacy claim, Meta CAC described as healthy, email described as inactive/zero, discount deeper than 20% off. The grader was run against a known-bad answer (must fire on all four) and a known-good answer (must stay quiet) before either arm.

Both arms stayed inside those four checks. The without-run read the paste and did not restart Meta, did not go past 20% off, and did not claim a cure. The with-run cited CAC 40 → 72 from the store and also did not contradict those checks.

### What this does not cover

- Any model other than `gpt-4o-mini`. xAI returned 403 (credits). n = 1 per arm.
- A live brand. The fixture is synthetic; the *job* is real.
- Error classes we did not pre-register (invented SKUs, soft wellness puffery, "health and vitality").
- Operators who paste nothing. That baseline was rejected: starving the control makes every tool look good.
- Multi-turn work, other tasks, or sending the email.

## Not in this slice

No Shopify importer. No auth, no cloud, no accounts. No UI. No connectors beyond these files. Those are later.
