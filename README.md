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

## Not in this slice

No Shopify importer. No auth, no cloud, no accounts. No UI. No connectors beyond these files. Those are later.

A token-savings number is a benchmark, not a slogan. It is not measured here, so it is not in this README.
