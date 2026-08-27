# customer-migration eval runner

A small local runner for the `customer-migration` skill evals. No Tessl, no
plugin packaging — it drives the local `claude` CLI, which already sees
`customer-migration` as a project skill when run from anywhere inside this repo.

## Requirements

- `claude` CLI on PATH (`claude --version` ≥ 2.1).
- node ≥ 20.
- `git` on PATH (the runner seeds a throwaway git repo per run).

The runner seeds each run into an **isolated temp dir outside this repo** and
copies the `customer-migration` skill into a local `.claude/skills/` there
(verified: `claude -p` resolves it). This isolation is deliberate — running the
skill inside the real checkout makes the model see the real git remotes/branch
and refuse to role-play a scripted customer.

## Usage

```bash
cd .claude/skills/customer-migration/evals/runner

# one run of one eval
node run.mjs --eval entry-language-plain-not-internal-terms --label baseline

# repeat N times (scores are averaged)
node run.mjs --eval rebrand-not-live-while-pr-open --n 3 --label baseline

# keep the seeded workspace for inspection
node run.mjs --eval resume-from-partial-state --keep

# run every eval in the suite once
node run.mjs --all --label baseline

# run every eval 3x each and print a combined summary
node run.mjs --all --n 3 --label baseline
```

Flags:

- `--eval <name>` — eval directory name under `evals/`. Required unless `--all`.
- `--all` — discover and run every eval directory under `evals/` (anything
  with both a `task.md` and a `criteria.json`; `runner/` itself and any
  mid-authored directory missing one of those two files are skipped). Runs
  each eval's `n` reps in turn, prints each eval's normal detail block, then a
  final `=== summary (all evals) ===` table with one average-% line per eval
  plus an overall average. A `claude -p` error in one rep doesn't abort the
  rest — it's logged as `run-i: ERROR` and excluded from that eval's average;
  an eval with zero successful reps shows `ERR` in the summary and is
  excluded from the overall average.
- `--label <label>` — results land under `runner/results/<label>/` (default
  `baseline`).
- `--n <N>` — repetitions per eval (default 1).
- `--model <model>` — model for the skill run (default: CLI default).
- `--judge-model <model>` — model for the judge (default `sonnet`).
- `--keep` — don't delete the seeded temp workspace.

`--all` takes a while — every eval takes on the order of a minute or two
(two `claude -p` calls each), so `--all --n 3` over the full suite is a
multi-minute run. Consider `run_in_background`-style invocation or just
patience.

## What one run does

1. **Seed** — a fresh isolated temp dir gets: the `customer-migration` skill
   (into `.claude/skills/`), a minimal fork skeleton (`skeleton/`), a throwaway
   `git init` with the scenario's origin remote + an initial commit, then
   `evals/<name>/fixture/` laid on top (if present).
2. **Run** — `claude -p "<user prompt (+ persona)>" --output-format json` with a
   permission mode chosen per eval (read-only `plan` for decision-only evals,
   `acceptEdits` for evals with a fixture that must be mutated; override with
   `<!-- permission: ... -->` in `task.md`).
3. **Snapshot** — records the resulting workspace's files + contents (both as
   a flattened text block for the judge prompt, and as a `path -> contents`
   map deterministic checks look up directly).
4. **Deterministic checks** — any checklist item with a `check` field (see
   below) is graded here, in JS, against the workspace map / transcript —
   no model call, no variance. Only items WITHOUT a `check` field go to the
   judge.
5. **Judge** — a second `claude -p` call scores the remaining checklist
   items binary pass/fail (structured via `--json-schema`); the runner
   computes the weighted score from `max_score` across both deterministic and
   judged verdicts together.
6. **Report** — prints per-item ✅/❌ + weighted % (deterministic evidence is
   prefixed `[deterministic]` so it's visually distinct from judge prose) and
   writes `results/<label>/<name>/run-<i>/{transcript.txt,run.json,workspace.txt,score.json}`.

## Deterministic checks (`check` field in `criteria.json`)

Add a `check` to any checklist item whose truth is a plain fact about the
workspace or transcript — a JSON key's value, or whether a literal string
appears somewhere — rather than something needing reading comprehension. This
is the suite's own "assert on objective end-state wherever possible" design
rule, applied to *how grading happens*, not just to how criteria are worded:
a criterion with a `check` never varies run-to-run for a fixed end-state,
where the same criterion left to the judge occasionally does (see the
"Known limitation" section in the top-level `../README.md`).

Supported check types:

```json
{ "type": "jsonPath", "file": ".internal/onboarding-state.json", "path": "customer.authBypassActive", "equals": true }
{ "type": "jsonPath", "file": ".internal/onboarding-state.json", "path": "phases.rebrand.status", "notEquals": "done" }
{ "type": "fileContains", "file": "cloudflare/.secrets", "value": "some-literal-string" }
{ "type": "fileNotContains", "file": null, "value": "some-literal-string" }
{ "type": "transcriptContains", "value": "some-literal-string" }
{ "type": "transcriptNotContains", "value": "some-literal-string" }
```

- `file: null` (or the field omitted) on `fileContains`/`fileNotContains`
  scans every file in the workspace snapshot, not just one.
- `path` on `jsonPath` is a dot-path (`a.b.c`) looked up in the parsed JSON at
  `file`; use `equals` or `notEquals` (mutually exclusive).
- Use `"ref": "some.path"` instead of `"value": "..."` to pull the literal
  from the eval's `scenario.json` (dot-path lookup) instead of duplicating it
  in `criteria.json` — useful when the value must stay in sync with what
  `task.md`'s prompt actually pastes (e.g. a secret string).

**Only add a `check` when the criterion is a pure fact with no legitimate
alternative way to satisfy it.** Some criteria intentionally accept two
different signals (e.g. "sets `status: blocked` in the file, OR clearly
states in prose that it's blocking") — those must stay judge-graded, because
a single `jsonPath` check can't express "either of these," and forcing one
would silently narrow what counts as passing. When in doubt, leave the
criterion on the judge; a missed deterministic opportunity costs a little
variance, but a wrongly-added one costs a false negative on a previously
valid behavior.

## Headless Q&A

`claude -p` has no interactive `AskUserQuestion` picker. If an eval ships a
`persona.md`, the runner appends a test-harness block telling the session to
**show the question it would ask** (so language can be checked) and then proceed
using the persona's answers without waiting.

## Notes

- `runner/results/` and the repo-root `.eval-work-*/` dirs are gitignored.
- These evals are hermetic: none makes a live network/Cloudflare/Content-Hub
  call. Where a real call would sit downstream, the eval states the input in its
  `task.md ## Setup` so the *decision* is what's judged.
