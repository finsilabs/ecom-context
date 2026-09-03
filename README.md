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

The benchmark is a real OpenAI run (`npm run benchmark` and `npm run benchmark:large`) against seeded fixtures. Before each run the deterministic grader is validated against one must-fire contradiction and one must-stay-quiet answer. Results at the restored runner commit:

| fixture | arm | input tokens | output tokens | graded errors | verdict |
|---|---|---:|---:|---:|---|
| small | paste baseline | 420 | 157 | 0 | STOP |
| small | two-tool server | 12,216 | 618 | 0 | STOP |
| large | paste baseline | 390 | 177 | 2 | STOP |
| large | two-tool server | 2,308 | 249 | 3 | STOP |

The verdict is computed by the runner: SHIP requires fewer graded contradictions in the connected arm; equal or worse results are STOP. The large connected arm measured worse, so this run is STOP. The result files are `benchmark/results.json` and `benchmark/results-large.json`.

The losing measurements remain: on the original small task, paste was 420 input / 0 errors and the five-tool server was 1,909 input / 0 errors. On the original large task, paste was 390 input / 2 errors and the five-tool server was 3,815 input / 1 error. Those measurements are not discarded.

Round 2 evaluator payload measurements after the no-proposal fix (repository fixture; approximate JSON token count is UTF-8 characters divided by four, since this package does not bundle a model tokenizer):

| call shape | payload chars | approximate tokens |
|---|---:|---:|
| proposal supplied | 1,373 | 344 |
| proposal absent, target supplied | 379 | 95 |
| empty input | 379 | 95 |

The no-proposal response contains only `brand`, `standing_constraints`, and `unresolved_targets`; it does not return the rule list, target registry, or decision log.

## Scope and assumptions

No connectors, cloud, auth, UI, importer, embeddings, performance metrics, or migrations. The design still assumes agents call the tool, operators confirm proposed records, target aliases remain stable, semantic rules are pattern-limited, and external hosts present tool descriptions. The benchmark is synthetic and does not establish those assumptions.
