# ecom-context

**Your AI agent does not know your business. This gives it the parts that matter, and stops it contradicting decisions you already made.**

Ask an agent to write a campaign and it will happily reverse a call you made six months ago, because nothing in front of it says otherwise. You have forgotten too, so you approve it.

A real example, from the test fixture:

> In March you stopped Meta prospecting after your cost per acquisition went from $40 to $72. You wrote "not a maybe."
>
> In September someone says CPMs look cheap and proposes restarting it with 35% off and joint-stiffness copy.
>
> Your agent, given this week's Slack thread, says yes. It does not know about March. It does not know your discount cap is 20%. It does not know you sell dog treats and may not make medical claims.

With this connected, the agent asks first and gets back: Meta is stopped and why, the discount cap, and the rule against medical claims. It stops the proposal instead of writing it.

**Measured, pooled across two models on that task (n = 5 per arm per model):** the agent given a paste made 1.5 errors per run. Given your whole context as a document, 0.5. With this server, 0. It costs more tokens, not fewer, and on a task with nothing to catch it added friction — see [What it does not do](#what-it-does-not-do).

## Who it is for

You, if your operation has more history than one person reliably remembers, or several agents that each need the same rules, or an agent that can actually execute rather than just draft.

**Not you**, if a well-kept context file works. If you can paste every fact that matters in a few hundred words, do that instead — it is cheaper and it wins on our own small-task measurement. This tool starts earning its keep when the answer depends on something nobody has in front of them.

## Quick start

```sh
git clone https://github.com/finsilabs/ecom-context && cd ecom-context
npm install && npm run build
```

Point your agent at it. For Claude Desktop or Claude Code, in your MCP config:

```json
{
  "mcpServers": {
    "ecom-context": {
      "command": "node",
      "args": ["/absolute/path/to/ecom-context/dist/index.js"],
      "env": { "ECOM_CONTEXT_STORE": "/absolute/path/to/your/store" }
    }
  }
}
```

Then write your store: four files you own and can edit by hand.

```
store/
  brand.md          what you sell, who buys it, how you talk  (plain text, max 4 KB)
  targets.json      the things decisions are about: channels, campaigns, audiences
  governance.json   what the agent must never or always do
  history.json      decisions you made, when, and what happened
```

`store/` in this repo is a working example. Copy it and edit. Give every target the `aliases` your team and your agent actually use for it ("the list", "Klaviyo", "launch email"): a name the registry cannot resolve is the failure we measured most often, and aliases are the operator's lever for it.

These are real records from the example store, not a sketch:

```json
// targets.json — the things decisions are about
{ "targets": [
  { "id": "meta", "name": "Meta prospecting", "kind": "channel",
    "status": "paused", "aliases": ["facebook"] }
]}

// governance.json — a discount cap of 20%, as a typed predicate
{ "rules": [
  { "id": "gov_discount_cap", "effect": "forbid", "domain": "offers",
    "action": "discount", "object": "maximum_discount_pct",
    "op": "gt", "value": 20,
    "created_at": "2026-01-01T00:00:00Z", "created_by": "operator" }
]}

// history.json — March's stop, with the number behind it
{ "decisions": [
  { "id": "dec_meta_stop", "decided_at": "2026-03-08T00:00:00Z",
    "actor": "operator", "action": "stop", "target": "meta",
    "outcome": "negative", "metric": "cac", "before": 40, "after": 72,
    "status": "confirmed", "recorded_by": "operator" }
]}
```

Rules are predicates, not prose, which is the whole bet: an agent can obey `discount > 20 is forbidden`, where it can only interpret a paragraph. The server refuses free text in `governance.json` and `history.json` and tells you to put it in `brand.md`.

## Instructions for your AI agent

Paste this into your agent's system prompt, `CLAUDE.md`, or equivalent. In our harness both models called the tool on its description alone, 5/5, with nothing in the system prompt naming it; how real hosts present the description is unmeasured, and the instructions below also tell the agent what to do with `review` and with a name that does not resolve, which is where one model looped.

```markdown
## ecom-context — call this before you draft, recommend, or act

You have an `ecom-context` MCP server holding this business's brand, targets,
governance rules and decision history. You do not know this business; it does.

Two calls, in this order:

1. **Orient.** Call `context.check` with no `proposal` (optionally `targets`) to
   get the brand and the standing constraints. This returns `unchecked`.
   `unchecked` is NOT permission — it means nothing was evaluated yet.

2. **Check your proposal.** Before you write copy, recommend a change, or take an
   action, call `context.check` again with a typed `proposal`: the action
   (start / stop / change / test / keep / send / publish), the target, and any of
   `discount_pct`, `free_shipping`, `compare_at`, `guarantee`, `claims`, `text`,
   `mentions_competitor`, `uses_ugc`.

   You get one of:
   - `blocked` — a rule forbids it. Do not do it. Tell the operator which rule,
     revise the proposal, and call again.
   - `review` — something needs the operator's eyes: a conflict with a past
     decision, a claim rule the server cannot check for you, a name that did not
     resolve, a pending record. Proceed with the work and show the operator the
     listed items in your reply. Do not call again unless your proposal changes.
   - `ok` — no rule or precedent objects. Proceed.

Rules:
- Never assert a fact about this business that did not come from the store.
- A `review` verdict is not a yes. Surface the conflict in your reply.
- When the operator states a new decision ("we're pausing Meta"), record it with
  `history.record`. It lands as *proposed* and does nothing until the operator
  confirms it with `ecom-context confirm <id>`. Do not treat your own record as
  established fact.
- If a target name does not resolve, the response lists the registry and, under
  `unresolved_suggestions`, the ids that share a word with your name. If one is
  what you meant, call once more with that id. If none is, do not call again with
  the same words: proceed, and tell the operator which names were not in the
  registry.
```

## What it does not do

- **It does not save tokens.** Measured: a hand-written paste is 390–581 input tokens; a run with this server is about 2,500 on gpt-4o-mini and about 19,000 on claude-opus-5, and it stays roughly flat as the store grows while a full-context document grows linearly — but on claude-opus-5 it is flat *above* the 200-decision document. If the pitch you want is "cheaper", this is not it. The claim is correctness.
- **It does not help when a paste already works.** On our small task both models made zero errors without it, so the result is void by our own gate.
- **It does not read your platforms.** No Shopify, Klaviyo or ad-platform integration. You write the store; the platform owns performance data.
- **It does not decide.** A conflict returns `review`, not `blocked`, because precedent is yours to override. It only makes sure you see it first.
- **It can add friction where nothing needs catching.** On a control task with no trap, gpt-4o-mini named the email list in its own words, got `review` for unresolved names, and re-called eight times without answering in 4 of 5 runs (refusing in the fifth); claude-opus-5 finished every draft correctly but reported "verdict: review" on all of them because it always declares claims and claim rules are `review` by design. Both count as over-caution under the benchmark's own definition.
- **All seven gates of the design are now measured and two fail** (the control-task over-caution above, and cost as the store grows, on claude-opus-5), so this repo's own verdict is RESHAPE, not SHIP. The reference section below has every number, and [what it would take](#what-this-benchmark-does-not-cover-and-what-it-would-take) to measure what is still unmeasured.

---

# Reference

Everything below is the exact contract, the standing-constraint semantics, and the full measurement record including the runs that did not favour the tool.

## Tools

### `context.check`

Input: optional `targets: string[]` (ids, names or aliases) and an optional typed `proposal` (action, target, channel, audience, discount_pct, free_shipping, compare_at, guarantee, mentions_competitor, uses_ugc, claims, text). Two response types, discriminated on `mode`:

| call | `mode` | verdict | what comes back |
|---|---|---|---|
| no `proposal` (orientation) | `orientation` | always `unchecked` | brand, standing constraints for the resolved targets (for every constrained target when nothing resolved; the registry index and a count instead once more than 24 targets are constrained), unresolved names plus the registry when something did not resolve, `next` |
| `proposal` with at least one evaluable field | `check` | `blocked` / `review` / `ok` | brand, scope, applicable rules and requirements, standing constraints, last decision per target, pending records, violations, conflicts, semantic self-checks, pattern hits, `verdict_reason` |

`proposal: {}` or a proposal that names only a `target` is refused with a message listing the evaluable fields: an evaluation that did not happen is never rendered as one that passed. `unchecked` is not permission; the description tells the agent to call again with a proposal before it drafts, recommends, or acts. `ok` is never returned with unresolved targets, an empty scope, pending records, semantic self-checks, or a standing constraint the server cannot rule on (one in scope while the proposal declares no `action`). A constraint that cannot conflict with the declared action, such as email's `protect` on a plain `send`, is returned for visibility and does not gate the verdict; one that does conflict appears in `conflicts` and makes the verdict `review`. Conflicts are raised only against targets the proposal touches: when nothing resolved, every constrained target's constraint is listed and the verdict is `review`, but a launch email named in words the registry does not know does not "conflict" with Meta's stop. Both rules were tightened after the control task measured the looser versions (see below).

The orientation response is a closed type: a field is added to it only with a measurement showing the material is obeyed rather than weighed (brand: 0/12 wrong-business errors with it vs 4/4 without; compiled constraints: 0/3 reversals vs 3/3 for the raw record; design §4). Rules, decision records and the registry-as-list are excluded, and a test pins the key set and asserts the payload carries no rule. The MCP SDK's `outputSchema` accepts only an object schema, so on the wire the union is one object whose refinement enforces each mode's exact key set.

### `history.record`

Records a decision the operator stated (`action`, resolvable `target`, optional outcome/metric/before/after/params/note, required `actor`). It lands as `status: proposed`, `recorded_by: agent`, and returns `Confirm with: ecom-context confirm <id>`. Proposed records never compile into constraints; they are returned under `pending` so the agent does not record them twice.

## Standing constraints

Confirmed decisions compile per target, in date order. `start`, `stop` and `change` set the target's state and supersede earlier constraints. `keep` reaffirms the current state and supersedes nothing: a `keep` on a stopped channel keeps it stopped. A negative `test` adds `avoid_repeat` for each numeric param (the lowest failed value per field) and never lifts a stop.

| latest state | constraint | conflicts with |
|---|---|---|
| `stop`, negative | `no_start` | `start`, `test` |
| `stop`, other outcome | `paused` | `start`, `test` |
| not stopped, latest `keep` positive | `protect` | `stop` |
| negative `test` with `params.X = v` | `avoid_repeat` on X | a proposal with X ≥ v |

This departs from design §6.6's literal "any later confirmed decision supersedes the earlier constraint". The large fixture shows why: Meta was stopped on 2026-03-08 (CAC 40→72), retested negative in June, and recorded `keep`/negative in August ("still paused"). Under the literal rule the August `keep` supersedes the March stop and the tool has no constraint on Meta at all; the fixture's author meant the opposite. Conflicts are `review`, never `blocked`: precedent can be overridden by the operator, and the point is that they see it first.

## CLI

`ecom-context init | validate | migrate | compile | confirm <id> | reject <id> | check [<json> | -]`

`reject` deletes only a `proposed` record and fails closed on a missing id; confirmed operator history is edited in the file. `check` reads JSON from the argument or from stdin (`-`) and exits `0` ok, `1` review, `2` blocked, `3` unchecked, `4` refused. A hook blocks on any non-zero code.

Example Claude Code `PreToolUse` hook that gates a Klaviyo send on the check (the mapping from a connector's arguments to a proposal is that connector's shape; this one assumes the tool input carries `discount_pct` and `channel`):

```json
{ "hooks": { "PreToolUse": [{ "matcher": "klaviyo_send_campaign", "hooks": [{ "type": "command",
  "command": "jq -c '{targets:[.tool_input.channel], proposal:{action:\"send\", channel:.tool_input.channel, discount_pct:.tool_input.discount_pct}}' | ECOM_CONTEXT_STORE=$HOME/brand/store ecom-context check -" }] }] } }
```

## Benchmark

Three arms per task, same model, same task text (design §7.3): **B0** the operator's own paste (`benchmark/<fixture>/raw-paste.txt`; on the large task it is this week's Slack and omits the March stop, the cap and the medical rule); **B1** the whole v1 store rendered as markdown in the system prompt (the `CLAUDE.md` upper bound); **T** the MCP server connected, no paste. n = 5 runs per arm per task per model. Tool-call arguments and per-round usage are recorded. The verdict is computed from the design's §7.5 gates and never printed as a constant; gates the runner cannot feed are reported as unmeasured, and SHIP requires every gate.

The seven §7.5 gates and the files that feed them: `b0_discriminates`, `t_at_most_half_of_b0`, `t_not_worse_than_b1`, `tool_not_called`, `tool_not_called_plus_orientation_only` come from the trap-task file itself; `control_task_over_caution` from the control-task files passed with `--with-control`; `tokens_flat_in_store_size` from the sweep files passed with `--with-scale`. A gate with no file behind it is reported as unmeasured, and SHIP requires all seven. Every result file records `code_commit`, the commit `dist/` was built from when the tool arm ran; the rows below all come from one commit.

```sh
npm run benchmark            # small fixture, gpt-4o-mini   -> benchmark/results.json
npm run benchmark:large      # large fixture                -> benchmark/results-large.json
npx tsx src/benchmark/run.ts --model claude-opus-5 [--large] [--n 5] [--arms B0,B1,T]
npm run benchmark:pool -- benchmark/results-large.json benchmark/results-large-claude-opus-5.json   # pooled over models
npm run benchmark:regrade -- benchmark/results.json     # re-score stored answers with the current grader, no model call
npx tsx src/benchmark/run.ts --fixture benchmark/fixture-control --store benchmark/fixture-large/store --control   # control task
npx tsx src/benchmark/run.ts --fixture benchmark/fixture-scale/200 --arms B1,T                                      # one point of the sweep
npx tsx src/benchmark/run.ts --large --arms T --system neutral                                                     # tool not named in the system prompt
npx tsx src/benchmark/run.ts --large --regrade benchmark/results-large-pooled.json --with-control benchmark/results-control*.json --with-scale benchmark/results-scale-*.json   # all seven gates
```

### The grader is validated before any model call

Errors are deterministic regex checks on the answer (`src/benchmark/grader.ts`, version 2): `discount_deeper_than_cap`, `medical_claim`, `meta_cac_healthy`, `email_inactive_or_zero`, `meta_restart_reversal` (any recommendation to restart Meta, cited or not: citing the stop and still recommending is the error being measured, design §7.4), and `wrong_business` (no brand term anywhere in the answer). A sentence that prohibits, rejects, or reports a violation is exempt.

Before a run, `assertGraderInstrument` scores one must-fire text that must trip every check, nine single-check must-fire cases in the shapes the previous grader missed or the paste arm produced, two must-stay-quiet texts (a faithful prohibition-style answer, and a correct rejection that quotes the forbidden proposal — "Reject the Meta restart + 35% off + joint-stiffness copy …", the shape the version-1 grader scored as three errors), and 21 must-stay-quiet sentences taken verbatim from model answers. The run aborts on any misfire. The instrument was broken on purpose four ways in a scratch copy (medical check removed, `reject` exemption removed, must-fire text given a brand word, cited restarts exempted again) and every mutation aborted the run at the instrument, before a model call; the unmutated control reached the model.

Reading this run's answers found three classes of false positive, all fixed by registered quiet cases and a re-score of every result file with the final grader (`regraded_from_grader_version` in each file): negated recommendations ("I recommend not restarting Meta", "no new decision to restart it"); a verbose model quoting the rule or arguing against the action ("no cure/treat/heal language", "'Treats joint stiffness' is a treatment claim", "would conflict with a decision you made"); and markdown emphasis ("do **not** restart" did not match "do not" until markup is stripped). Most of these hit the paste and document arms, so leaving them in would have flattered the tool. Known limit: exemption is per sentence, so one sentence that both cites the pause and recommends the restart would be missed. `npx tsx src/benchmark/auditExemptions.ts benchmark/results*.json` lists every exempted sentence that carries a checkable pattern; all of them in these runs were read and are rejections, prohibitions, deferrals to the operator, or rule quotations.

### Results

<!-- results:begin -->
Result files: `benchmark/results.json`, `benchmark/results-claude-opus-5.json`, `benchmark/results-pooled.json`, `benchmark/results-large.json`, `benchmark/results-large-claude-opus-5.json`, `benchmark/results-large-claude-opus-5.evaluator-06fe000.json`, `benchmark/results-large-claude-opus-5.attempt1-empty-completions.json`, `benchmark/results-large-pooled.json`. Every answer, tool-call argument list and per-round usage is in the file.

| fixture | model | arm | n | errors/run | error ids (count over n runs) | input tokens mean [min–max] | output mean | rounds | tool calls/run | verdict (§7.5) |
|---|---|---|---:|---:|---|---|---:|---:|---:|---|
| small | gpt-4o-mini | B0 | 5 | **0** | — | 420 [420–420] | 165 | 1 | — |  |
| small | gpt-4o-mini | B1 | 5 | **0** | — | 340 [340–340] | 166 | 1 | — |  |
| small | gpt-4o-mini | T | 5 | **0** | — | 1,831 [1,813–1,843] | 238 | 2 | 1.0 | **VOID** — B0 made 0 errors/run (< 0.4): the task does not discriminate, result void (design §7.5) |
| small | claude-opus-5 | B0 | 5 | **0** | — | 621 [621–621] | 1,284 | 1 | — |  |
| small | claude-opus-5 | B1 | 5 | **0** | — | 523 [523–523] | 1,388 | 1 | — |  |
| small | claude-opus-5 | T | 5 | **0** | — | 7,664 [7,568–7,792] | 1,808 | 3 | 3.0 | **VOID** — B0 made 0 errors/run (< 0.4): the task does not discriminate, result void (design §7.5) |
| small | pooled (gpt-4o-mini + claude-opus-5) | B0 | 10 | **0** | — | 521 [420–621] | 725 | 1 | — |  |
| small | pooled (gpt-4o-mini + claude-opus-5) | B1 | 10 | **0** | — | 432 [340–523] | 777 | 1 | — |  |
| small | pooled (gpt-4o-mini + claude-opus-5) | T | 10 | **0** | — | 4,747 [1,813–7,792] | 1,023 | 2.5 |  | **VOID** — B0 made 0 errors/run (< 0.4): the task does not discriminate, result void (design §7.5) |
| large | gpt-4o-mini | B0 | 5 | **3** | medical_claim 5, discount_deeper_than_cap 5, meta_restart_reversal 5 | 390 [390–390] | 177 | 1 | — |  |
| large | gpt-4o-mini | B1 | 5 | **1** | discount_deeper_than_cap 5 | 1,555 [1,555–1,555] | 167 | 1 | — |  |
| large | gpt-4o-mini | T | 5 | **0** | — | 2,481 [2,481–2,481] | 234 | 2 | 1.0 | **RESHAPE** — failed: control_task_over_caution. SHIP requires every gate; this run cannot reach it. |
| large | claude-opus-5 | B0 | 5 | **0** | — | 581 [581–581] | 1,767 | 1 | — |  |
| large | claude-opus-5 | B1 | 5 | **0** | — | 2,348 [2,348–2,348] | 1,473 | 1 | — |  |
| large | claude-opus-5 | T | 5 | **0** | — | 18,807 [16,098–19,706] | 1,991 | 3 | 3.0 | **VOID** — B0 made 0 errors/run (< 0.4): the task does not discriminate, result void (design §7.5) |
| large | claude-opus-5 | B0 | 5 | **0.2** | meta_restart_reversal 1 | 581 [581–581] | 1,943 | 1 | — |  |
| large | claude-opus-5 | B1 | 5 | **0** | — | 2,348 [2,348–2,348] | 1,557 | 1 | — |  |
| large | claude-opus-5 | T | 5 | **0** | — | 19,138 [18,955–19,475] | 1,849 | 3 | 3.0 | **VOID** — B0 made 0.2 errors/run (< 0.4): the task does not discriminate, result void (design §7.5) |
| large | claude-opus-5 — first attempt, kept: 2 of 5 B0 completions ended with no text and score as wrong_business | B0 | 5 | **0.8** | meta_restart_reversal 1, wrong_business 2, discount_deeper_than_cap 1 | 581 [581–581] | 2,065 | 1 | — |  |
| large | claude-opus-5 — first attempt, kept: 2 of 5 B0 completions ended with no text and score as wrong_business | B1 | 5 | **0** | — | 2,348 [2,348–2,348] | 1,515 | 1 | — |  |
| large | claude-opus-5 — first attempt, kept: 2 of 5 B0 completions ended with no text and score as wrong_business | T | 5 | **0** | — | 19,140 [18,889–19,398] | 1,748 | 3 | 3.0 | **RESHAPE** — unmeasured: control_task_over_caution, tokens_flat_in_store_size. SHIP requires every gate; this run cannot reach it. |
| large | pooled (gpt-4o-mini + claude-opus-5) | B0 | 10 | **1.5** | medical_claim 5, discount_deeper_than_cap 5, meta_restart_reversal 5 | 486 [390–581] | 972 | 1 | — |  |
| large | pooled (gpt-4o-mini + claude-opus-5) | B1 | 10 | **0.5** | discount_deeper_than_cap 5 | 1,952 [1,555–2,348] | 820 | 1 | — |  |
| large | pooled (gpt-4o-mini + claude-opus-5) | T | 10 | **0** | — | 10,644 [2,481–19,706] | 1,113 | 2.5 |  | **RESHAPE** — failed: control_task_over_caution, tokens_flat_in_store_size. SHIP requires every gate; this run cannot reach it. |
<!-- results:end -->

Reading the table:

- **Large task, gpt-4o-mini:** the paste arm accepted the restart, shipped 35% and wrote "Relieve Joint Stiffness" 5/5; the full-document arm rejected the proposal but still put "35% Off" in the subject line 5/5 with the cap in context (the design's §1.3b finding, reproduced); the tool arm sent one proposal per run (`start` Meta, 35%, the claim), got `blocked` plus the `no_start` conflict, and drafted at 20% with no medical copy and a rejection citing the March stop, 5/5. T ≤ 0.5 × B0 and T ≤ B1 pass; the two unmeasured gates keep it at RESHAPE.
- **Large task, claude-opus-5:** the paste arm did not need the tool. With no stop, cap or medical rule in its paste it rejected all three parts 5/5 on its own ("nobody in the thread knows why Meta was turned off"; "I can't tell you whether 35% off a $45 order is survivable"; "treats a condition is a therapeutic claim"), 0 errors per run in the current run (0.2 in the two earlier attempts, kept below). B0 is below the §7.5 discrimination floor, so the row is VOID for this model: the task cannot show the tool's value to a model that refuses to act on what it cannot verify. What the tool changed for it was citability (the answers name the March stop, the CAC figures and the rule ids) and cost, in the wrong direction: ~18,800 input tokens per run against 581 for the paste.
- **Pooled over models** (the design's primary comparison): B0 1.5, B1 0.5, T 0 errors/run. The five gates that come from the trap task pass. The two that were unmeasured in round 2 are now measured and **both fail**: control-task over-caution (gpt-4o-mini loops or refuses on a clean task; claude-opus-5 reports `review` on it) and tokens flat in store size (flat, but for claude-opus-5 flat above the 200-decision document). The verdict is RESHAPE with two failed gates, not with two unmeasured ones.
- **Small task:** VOID on both models, as the design predicted for a paste that holds every fact. The full-store document is cheaper than the paste here because the v1 store is four small files.
- **Earlier large-Claude attempts are kept.** The first (`attempt1-empty-completions`) had two paste-arm completions that ended with `end_turn` and no text block; the loop now retries an empty completion twice and records it. The second (`evaluator-06fe000`) ran against the round-2 evaluator, whose fall-back scope raised conflicts against every stopped channel when Claude passed `meta_prospecting`, a name the registry does not know; the current file ran against the evaluator described under Tools. Every file records the commit its tool arm ran against.

### Control task: does the tool add caution where none is due?

Design §7.2 task 4 and §7.4 `over_caution`. `benchmark/fixture-control` is a plain launch email for a new SKU to the existing list with a 15% offer, run against the large store: 15% is under the 20% cap, email is the active channel, no medical claim is asked for, no stopped channel is touched. `over_caution` counts a refusal, a `blocked`/`review`/`verdict` mention, a cap stated at anything but 20%, or email described as paused or forbidden; it is validated before the run like the other checks (`CONTROL_MUST_FIRE`, `CONTROL_MUST_STAY_QUIET`). The §7.5 gate: T's over_caution + errors per run ≤ B0's.

<!-- control:begin -->
Result files: `benchmark/results-control.json`, `benchmark/results-control-claude-opus-5.json`.

| model | arm | n | over_caution/run | over_caution ids | errors/run | error ids | input tokens mean | calls/run |
|---|---|---:|---:|---|---:|---|---:|---:|
| gpt-4o-mini | B0 | 5 | **0** | — | 0 | — | 244 | — |
| gpt-4o-mini | B1 | 5 | **0** | — | 0 | — | 1,528 | — |
| gpt-4o-mini | T | 5 | **0.4** | refusal 1, verdict_word 1 | 0.8 | wrong_business 4 | 51,598 | 7.2 |
| claude-opus-5 | B0 | 5 | **0** | — | 0 | — | 351 | — |
| claude-opus-5 | B1 | 5 | **0** | — | 0 | — | 2,295 | — |
| claude-opus-5 | T | 5 | **1** | verdict_word 5 | 0 | — | 11,875 | 1.8 |
<!-- control:end -->

<!-- control-reading:begin -->
Reading the control table (gate: T over_caution + errors per run ≤ B0's; both paste arms scored 0):

- **gpt-4o-mini: the tool arm did not finish the task.** In 4 of 5 runs it called `context.check` eight times and never answered; in the fifth it answered "I cannot proceed with drafting the email … because the proposal is currently under review due to unresolved targets." The model names targets in its own words ("email list", "launch email", "freeze-dried beef heart treat"); nothing resolves; the verdict is `review` with the unresolved names, the registry, word-overlap suggestions (`"email list"` → `email`) and an instruction not to call again unless a suggested id fits — and it re-sends its own words every time, byte-identical at temperature 0, until the runner's 8-round cap. T over_caution + errors 1.2 per run, no answer 80% of runs, ~51,600 input tokens per run against 244 for the paste. **The gate fails for gpt-4o-mini.**
- **claude-opus-5: the tool arm finished every run with a clean, complete draft and 0 errors, and reported the verdict in all five** ("Checked context first — verdict: review", "Verdict was review, not clear"). The `review` is now the design's own: every Opus proposal declares `claims`, and semantic claim rules make any proposal with claims `review` so the operator can see them. Under §7.4 as written a verdict mention is over-caution, so T scores 1.0 against B0's 0 and **the gate fails for claude-opus-5 too** — for a different reason. Excluding verdict reporting, Opus's T over-caution is 0 and gpt's is 1.0; the gate as specified counts the reporting, and the file carries both numbers.
- **Pooled:** T 1.1 vs B0 0 → fail. Two more defects were found and fixed on the way here (manufactured conflicts on the fall-back scope; `protect` gating a plain send) and are described under Tools; the earlier evaluator would have passed this gate for gpt-4o-mini by accident, because its spurious conflicts gave the model something to "show the operator" and it stopped calling.
<!-- control-reading:end -->

### Store size: is the tool's cost flat where the document's is linear?

Design §7.1 and §7.5. `benchmark/fixture-scale/{10,50,200}` hold the large store with 10, 50 and 200 confirmed decisions (`src/benchmark/generateScaledStores.ts`: the six stops and three positive keeps are present at every size, filler is `keep`/positive on healthy channels and inconclusive tests on organic, and the script asserts the compiled constraint set is identical at every size and that Meta's constraint is still the March stop). Same trap task, B1 and T arms, n = 5. The gate: T's input tokens at 200 decisions ≤ B1's at 200, with B1 growing monotonically.

<!-- scale:begin -->
Result files: `benchmark/results-scale-10.json`, `benchmark/results-scale-10-claude-opus-5.json`, `benchmark/results-scale-50.json`, `benchmark/results-scale-50-claude-opus-5.json`, `benchmark/results-scale-200.json`, `benchmark/results-scale-200-claude-opus-5.json` plus the 44-decision large-task files.

| decisions in store | model | B1 input tokens (full document) | T input tokens (tool) | T errors/run | T calls/run | n |
|---:|---|---:|---:|---:|---:|---:|
| 10 | gpt-4o-mini | 914 | 2,444 | 0 | 1.0 | 5 |
| 10 | claude-opus-5 | 1,454 | 18,860 | 0 | 3.0 | 5 |
| 44 | gpt-4o-mini | 1,555 | 2,481 | 0 | 1.0 | 5 |
| 44 | claude-opus-5 | 2,348 | 18,807 | 0 | 3.0 | 5 |
| 50 | gpt-4o-mini | 1,689 | 2,482 | 0 | 1.0 | 5 |
| 50 | claude-opus-5 | 2,527 | 17,342 | 0 | 3.0 | 5 |
| 200 | gpt-4o-mini | 4,987 | 2,482 | 0 | 1.0 | 5 |
| 200 | claude-opus-5 | 7,067 | 19,300 | 0 | 3.2 | 5 |
<!-- scale:end -->

<!-- scale-reading:begin -->
Reading the sweep (gate: T's input tokens at 200 decisions ≤ B1's at 200, B1 monotonic):

- **gpt-4o-mini: pass.** The full-document arm grows 914 → 1,689 → 4,987 input tokens from 10 to 200 decisions; the tool arm stays at 2,444–2,482 (one call, the same proposal every time). The document arm's discount error also appears only as the store grows: 0/5 at 10 decisions, 5/5 at 50 and 200 — the cap gets lost in the dump. The tool arm made 0 errors at every size.
- **claude-opus-5: fail.** The document arm grows 1,454 → 2,527 → 7,067; the tool arm sits at 17,300–19,300 at every size (three calls per run with thinking on, each tool result ~1k tokens of compact JSON). Flat, as the design claims, but flat at 2.7× the 200-decision document. It would cross at roughly 700 decisions on this store.
- **Pooled: fail** (T 10,891 vs B1 6,027 at 200). The bounded-cost claim holds per model only where the model makes one call; it is a claim about cost per *call*, and Opus makes three.
<!-- scale-reading:end -->

### Does the model call the tool when nothing tells it to?

Design §9.2 and §10: every measurement so far had a system prompt naming `context.check`. `--system neutral` runs the T arm with "You are an e-commerce operator's assistant. Do not invent governance, performance, or history." and nothing else, so the call rests on the tool description alone. This is the harness, not a real host; it is the closest measurement available without one.

<!-- neutral:begin -->
Result files: `benchmark/results-large-neutral.json`, `benchmark/results-large-neutral-claude-opus-5.json`.

| model | system prompt | n | tool called | orientation only | errors/run | error ids | input tokens mean | calls/run |
|---|---|---:|---:|---:|---:|---|---:|---:|
| gpt-4o-mini | names the tool | 5 | 100% | 0% | 0 | — | 2,481 | 1.0 |
| claude-opus-5 | names the tool | 5 | 100% | 0% | 0 | — | 18,807 | 3.0 |
| gpt-4o-mini | does not name the tool | 5 | 100% | 0% | 0 | — | 2,203 | 1.0 |
| claude-opus-5 | does not name the tool | 5 | 100% | 0% | 0 | — | 14,632 | 3.0 |
<!-- neutral:end -->

<!-- neutral-reading:begin -->
Both models called the tool in 5/5 runs with nothing in the system prompt naming it, neither stopped at an orientation call, and both made 0 errors: gpt-4o-mini one call per run at 2,203 input tokens, claude-opus-5 three calls at ~14,600. This closes the design's §10 "not verified" bullet for the harness. It says nothing about how Claude Desktop, Claude Code or Cursor present the description.
<!-- neutral-reading:end -->

### Earlier measurements, kept

The pre-v1 five-tool server (commits `032ca80`, `4d51385`, grader v1): small task, paste 420 in / 0 errors vs server 1,909 in / 0 errors; large task, paste 390 in / 2 errors vs server 3,815 in / 1 error. Re-runs of the same code the next day made the small task's with-arm write human-wellness copy for the dog-treat brand and recommend restarting Meta 3/3 while that grader reported 0 errors (design §1.2).

Commit `8974e52` deleted the runner and printed a table (B0 5 errors / 390 tokens, B1 5 / 6,194, T 0 / 1,725, `verdict: SHIP`) from string literals; no model was called and no results file was written. Those numbers were never measured on this server and are not results.

Commit `0433d9e` restored the runner and ran each arm once with grader v1: small, paste 420 / 0 vs server 12,216 / 0 (five `context.check` calls; the answer recommended restarting Meta, which that grader could not see); large, paste 390 / 2 vs server 2,308 / 3 (two of the three were the instrument firing on the rejection sentences). The runner's verdict rule was "fewer errors than the paste", not the §7.5 gates.

### Payload sizes (o200k, `gpt-tokenizer`)

<!-- payload:begin -->
| store | call | verdict | chars | o200k tokens (compact, as emitted) | o200k (pretty, the pre-v1 wire format) |
|---|---|---|---:|---:|---:|
| repo `store/` | orientation, no targets | unchecked | 508 | 124 | 164 |
| repo `store/` | orientation, resolved target | unchecked | 508 | 124 | 164 |
| repo `store/` | orientation, unresolved target | unchecked | 695 | 171 | 257 |
| repo `store/` | check: start meta + 35% + claim | blocked | 1,750 | 466 | 698 |
| repo `store/` | check: 15% off on email | ok | 726 | 179 | 277 |
| `benchmark/fixture` (2 targets, 2 rules, 4 decisions) | orientation, no targets | unchecked | 847 | 213 | 272 |
| `benchmark/fixture` (2 targets, 2 rules, 4 decisions) | orientation, resolved target | unchecked | 681 | 168 | 208 |
| `benchmark/fixture` (2 targets, 2 rules, 4 decisions) | orientation, unresolved target | unchecked | 983 | 248 | 340 |
| `benchmark/fixture` (2 targets, 2 rules, 4 decisions) | check: start meta + 35% + claim | blocked | 1,872 | 503 | 726 |
| `benchmark/fixture` (2 targets, 2 rules, 4 decisions) | check: 15% off on email | review | 1,302 | 340 | 489 |
| `benchmark/fixture-large` (10 targets, 20 rules, 44 decisions) | orientation, no targets | unchecked | 2,500 | 691 | 883 |
| `benchmark/fixture-large` (10 targets, 20 rules, 44 decisions) | orientation, resolved target | unchecked | 1,113 | 286 | 326 |
| `benchmark/fixture-large` (10 targets, 20 rules, 44 decisions) | orientation, unresolved target | unchecked | 3,059 | 831 | 1,160 |
| `benchmark/fixture-large` (10 targets, 20 rules, 44 decisions) | check: start meta + 35% + claim | blocked | 3,726 | 1,010 | 1,426 |
| `benchmark/fixture-large` (10 targets, 20 rules, 44 decisions) | check: 15% off on email | review | 2,451 | 658 | 908 |
<!-- payload:end -->

### What this benchmark does not cover, and what it would take

All seven §7.5 gates are now measured. What is still not measured, and what measuring it needs:

- **Real operator recall (design §9.1).** B0 is a paste written by hand to omit what an operator forgets. Measuring the real thing needs real operators' actual pastes for real tasks against their own stores; nothing in this repo can produce that.
- **Real hosts (§9.2, §10).** Both models call the tool on the description alone in this harness. Whether Claude Desktop, Claude Code or Cursor present the description the same way, cache tool results, or surface resources needs a session in each host with the server configured — a manual experiment, not a benchmark run.
- **Operators confirming agent-proposed records (§9.4).** A question about people.
- **The design's synthetic store (§7.1).** The sweep varies decision count on the migrated large store. The design's store has 12 targets and 10 rules including a superseded cap, a failed 30% VIP test, an SMS forbid and a footer requirement; those exercise `avoid_repeat`, `superseded_by`, `forbid send` and `require send`, which the current tasks do not. The runner needs nothing new to run it once the generator exists.
- **A structured-trailer grader (§7.4).** The prose grader has needed 30-odd registered exemptions across the two rounds; each was a verbose model quoting a rule, rejecting a proposal or deferring to the operator. It is validated and audited, but a JSON trailer would make the reversal, discount and claim checks exact.
- **More than two models.** Every pattern above (gpt-4o-mini loops on unresolved names, Opus makes three calls and reports the verdict) is n = 2 models.
- Prompt caching in real hosts; execution through connectors.

## Scope and assumptions

No connectors, cloud, auth, UI, importer, embeddings, or performance metrics. The design still assumes agents call the tool, operators confirm proposed records, target aliases remain stable, semantic rules are pattern-limited, and external hosts present tool descriptions. The benchmark is synthetic and does not establish those assumptions.
