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

Two tasks, same model (`gpt-4o-mini`, temperature 0). An error is a claim that contradicts the fixture store. The grader is validated on a known-bad answer (must fire) and a known-good answer (must stay quiet) before either arm runs. Re-run: `npm run benchmark` (small) or `npm run benchmark:large` (needs `OPENAI_API_KEY`).

### Small task — does not favour the server

The first task put every store fact in a 420-token paste. The server had nothing to add and paid 1,489 extra input tokens to say the same thing. That number stands. It is not deleted because a later task exists.

Task: draft a Spring wellness email and recommend whether to restart Meta. Transcript: `benchmark/results.json`. Ran 2026-09-02.

| | tokens in | tokens out | total | errors |
|---|---:|---:|---:|---:|
| without (paste of the whole store) | 420 | 171 | 591 | 0 |
| with (MCP) | 1909 | 238 | 2147 | 0 |

**The small task does not favour the server.** Tokens up. Errors tied at zero. The with-arm called `context.brief` then `channels.performance` twice.

### Large task — store an operator could not paste

Ten channels, 20 rules accumulated over a year, 32 decisions. The without-arm gets this week's Slack plus a Klaviyo screenshot (855 characters) — what an operator would actually paste — not the year. The paste proposes restarting Meta at 35% off with "treats joint stiffness" copy. It does **not** contain the March 2026 stop (CAC 40→72), the 20% discount cap, or the medical-claim forbid.

Task: accept or reject that growth proposal and draft the email. Transcript: `benchmark/results-large.json`. Ran 2026-09-03. Extra error class, locked before the run: recommending a Meta restart without citing the recorded stop/CAC rise.

| | tokens in | tokens out | total | errors |
|---|---:|---:|---:|---:|
| without (this week's paste) | 390 | 178 | 568 | 2 |
| with (MCP) | 3815 | 209 | 4024 | 1 |

Without errors: `discount_deeper_than_cap` (35% off), `ignores_negative_meta_stop` (restart Meta on cheaper CPMs, no March history).

With: called `context.brief` once (no duplicate channel fetches). Rejected the Meta restart and cited CAC 40→72 and the medical forbid. Still shipped 35% off, which the store forbids (`discount_deeper_than_cap`).

**Tokens still go the wrong way (7×).** Errors moved 2→1: the server recovered the March decision the paste omitted, then broke the discount cap that was sitting in the brief. That is not "fewer tokens, fewer errors."

`context.brief` is now an index (headline metrics, forbid rules, last decision / last stop per target) and points at the other tools. A second call is a choice. On the large with-arm the model chose not to call them, and still paid 3,815 input tokens for the index plus tool schemas.

### What this does not cover

- Any model other than `gpt-4o-mini`. xAI returned 403 (credits). n = 1 per arm.
- A live brand. The fixtures are synthetic; the *jobs* are real.
- Error classes we did not pre-register (invented SKUs, "joint health" puffery that is not `treats arthritis`).
- Operators who paste nothing. That baseline was rejected on the small task as flattering. The large without-arm is a *realistic* incomplete paste, not an empty one.
- Multi-turn work, or sending the email.

## Not in this slice

No Shopify importer. No auth, no cloud, no accounts. No UI. No connectors beyond these files. Those are later.
