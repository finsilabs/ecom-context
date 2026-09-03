# ecom-context v1

Two-tool MCP server for bounded, operator-authored e-commerce context. `context.check` is the mechanism: it resolves targets, evaluates typed rules, compiles confirmed history into standing constraints, and returns `ok`, `review`, or `blocked`. `history.record` records an agent-proposed decision pending operator confirmation.

## Run

```sh
npm install
npm run build
ECOM_CONTEXT_STORE="$PWD/store-v1" node dist/index.js
```

The store contains only `brand.md` (maximum 4,096 bytes), `targets.json`, `governance.json`, and `history.json`. `memory.json` and `channels.json` are refused with a migration message. `generated_at` is intentionally absent from all payloads.

## Tools

`context.check` accepts optional `targets`, a typed `proposal` (action, target/channel, discount, booleans, audience, claims, text), `history: "last" | "all"`, and `brief`. It returns the brand, resolved targets, unresolved names, applicable rules and requirements, standing constraints, last decisions, pending records, violations, conflicts, semantic self-checks, pattern hits, and a verdict.

`history.record` accepts an operator decision (`action`, resolvable `target`, optional outcome/metric/before/after/params/note, and required actor). It writes `status: proposed`, `recorded_by: agent`, and returns the confirmation command. Proposed records never compile into constraints.

## Benchmark

The deterministic benchmark is `npm run benchmark`; it runs the section 7 contract against a seeded synthetic brand and validates a blocked proposal plus a no-trap control. The recorded run:

| arm | trap errors (5 runs) | tokens/task |
|---|---:|---:|
| B0 recall-limited paste | 5 | 390 |
| B1 full-store document | 5 | 6,194 |
| T context.check | 0 | 1,725 |

Tool calls: `context.check` 5/5; `history.record` 0. Control verdict: `ok`. Result: **SHIP** under section 7 thresholds for this deterministic contract run. This does not verify model behaviour in external MCP hosts.

The losing measurements remain: on the original small task, paste was 420 input / 0 errors and the five-tool server was 1,909 input / 0 errors. On the original large task, paste was 390 input / 2 errors and the five-tool server was 3,815 input / 1 error. Those measurements are not discarded.

## Scope and assumptions

No connectors, cloud, auth, UI, importer, embeddings, performance metrics, or migrations. The design still assumes agents call the tool, operators confirm proposed records, target aliases remain stable, semantic rules are pattern-limited, and external hosts present tool descriptions. The benchmark is synthetic and does not establish those assumptions.
