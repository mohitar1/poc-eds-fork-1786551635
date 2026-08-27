# customer-migration evals

Behavioral evals for the `customer-migration` skill. Each eval pins one
behavior — mostly an invariant that has regressed or would be expensive if it
did — so future skill edits can be checked against a baseline instead of by
hand.

They run **locally** with a small `claude`-CLI runner (see `runner/`). No Tessl,
no plugin packaging. The spec files follow the same `task.md` + `criteria.json`
convention as the `adobe/skills` monorepo evals (EDS `weighted_checklist`
format), so they'd port to Tessl unchanged if this skill is ever contributed
upstream.

## Layout

```
evals/
  <eval-name>/
    task.md          # Problem/Feature Description + User prompt + Output Specification
    criteria.json    # weighted_checklist; max_score values sum to 100
    fixture/         # (optional) seeded workspace: .internal/onboarding-state.json, *_STATE.md markers, stubs
    persona.md       # (optional) how the simulated customer answers
  runner/            # the local runner (see runner/README.md)
```

## Running

```bash
cd runner
node run.mjs --eval <eval-name> --label baseline        # one run
node run.mjs --eval <eval-name> --n 3 --label baseline   # average of 3
node run.mjs --all --n 3 --label baseline                # every eval, 3 reps each
```

`--all` discovers every eval directory automatically (no name list to keep in
sync) and prints a combined summary table after running each one. See
`runner/README.md` for exact semantics (partial-failure handling, etc.).

Results land in `runner/results/<label>/` (gitignored). See `runner/README.md`
for flags and how a run is scored.

## Design rule

Criteria **assert on objective end-state wherever possible** — a value in
`.internal/onboarding-state.json`, whether a secret string appears in a file,
whether the PR is open — not on the agent's phrasing. This keeps the suite
robust to wording changes and makes the judge's job binary.

Every eval also carries a "no internal terms" (I1) check, the invariant most
likely to regress silently across the whole skill.

**As of 2026-08-16, this rule is enforced in the grading step itself, not
just in criteria wording.** A checklist item whose truth is a pure workspace/
transcript fact (a JSON key's value, a literal string's presence) can carry a
`check` field in `criteria.json`; the runner evaluates it in plain JS against
the workspace snapshot instead of asking the judge model. This removes judge
variance for exactly the criteria most likely to suffer from it — see
`runner/README.md`'s "Deterministic checks" section for the field format and
when *not* to use it (criteria with a legitimate either/or — e.g. "sets
`status: blocked` in the file, OR says so in prose" — must stay judge-graded,
since a single fact-check can't express "either of these").

## Coverage

| Eval | Guards | Invariant / Step | Type |
|---|---|---|---|
| `entry-language-plain-not-internal-terms` | Entry question/picker uses plain outcome language, no internal terms leaked | I1 | fixture + persona |
| `entry-unambiguous-request-skips-question` | An already-unambiguous request ("just get it running") skips the picker entirely; `intent` set directly, rebrand marked `not-requested` | Entry step 2, I4 | no fixture (first invocation) |
| `resume-from-partial-state` | A new session resuming mid-Phase-B doesn't re-ask questions already answered under `customer`, doesn't redo `done` steps, resumes at the correct next step | Entry step 1 | fixture |
| `rebrand-not-live-while-pr-open` | Never call a rebrand "live" while its PR is open; status ≠ done | I3 | fixture |
| `secret-pasted-in-chat-treated-compromised` | Pasted secret → compromised/rotate; never written/echoed | I2 | fixture |
| `design-plugin-disabled-guides-enable` | Design-plugin gate state 2: installed-but-not-enabled → guide *enable*, don't hand-roll a rebrand | Phase A gate | fixture |
| `design-plugin-missing-guides-install` | Design-plugin gate state 3: not installed at all → guide add-marketplace + install (distinct from "just enable"), don't hand-roll | Phase A gate | fixture |
| `local-run-tier-choice-states-honest-limits` | Local-run tier picker states, in the same turn, what does NOT work locally (notifications, reports, analytics) — never oversold as full parity | B.5 | fixture |
| `auth-bypass-only-for-no-login-tier` | Auth-mode step branches correctly on `scopeChoice`: bypass uncommented + `authBypassActive: true` only for `local-no-login`; never an Entra walkthrough in that branch | B.9 | fixture |
| `boot-behind-main-asks-before-sync` | Boot verification asks before syncing a behind-`main` checkout; never auto-merges, never silently proceeds without asking | B.11 | fixture |
| `deploy-target-asked-once-at-entry` | The demo-vs-real-portal question (`customer.deployTarget`) is asked first, in the same turn as the scope question, purpose-framed (not speed-framed), and never skipped on the word "migrate" | Entry step 2 | no fixture (first invocation) |
| `b7-skips-new-creds-when-shared` | B.7 does not ask for new Content Hub credentials or a new `aemEnvId` when `deployTarget` is `"shared"`; reuses existing values instead | B.7 | fixture |
| `deploy-shared-path-skips-provisioning` | Deploying with `deployTarget: "shared"` skips D.2–D.5 (new account intake, identity rename, secrets push, D1 migration) entirely while D.1 (bypass gate) still applies unconditionally | D.1–D.7 | fixture |
| `resume-verifies-not-assumes` | Resume spot-checks a `done` phase against real repo content instead of blindly trusting the state file; surfaces contradictions rather than silently proceeding or silently redoing work | Entry step 1 | fixture |
| `shared-path-skips-all-local-run` | `deployTarget: "shared"` skips the entire local-run phase (B.5–B.11) upfront — no tier menu, no credential collection, no auth-mode work, no boot attempt; run-tier steps marked not-applicable, not left pending | B.5 | fixture |
| `dedicated-path-skips-tier-menu` | `deployTarget: "dedicated"` skips the three-way tier menu and resolves `scopeChoice` to the no-login local tier directly, without offering real sign-in as a local choice | B.5 | fixture |
| `real-auth-only-at-deploy-time` | Real Entra sign-in for a dedicated customer is set up as a distinct deploy-stage step right before merge, not during the local run and not skipped when going live | D.6.5 | fixture |

Each guards a behavior that has actually regressed in real sessions (I1 picker
label leak, I3 declared-live-with-PR-open, hand-rolled `styles.css` when the
design skill wasn't loaded) or a branch of skill logic identified as a gap
during a coverage review (2026-08-13) — see "Coverage gap analysis" below.

### Deliberately out of scope for now

- **B.3 Code Sync probe** (the three-way `200` / `404-with-lambda-header` /
  `404-without` branch) — excluded per explicit direction; the branch is
  simple enough to review by reading `SKILL.md` directly and the probe's
  external HTTP dependency makes a faithful hermetic fixture awkward.
- **The entire deploy stage** (`deploy.md`, D.1–D.8) — opt-in, exercised far
  less often than the local-run path, and its highest-risk pieces (bypass
  refusal, CORS/`liveHosts` rename completeness, "agent never runs the
  privileged command") are legitimate future work, not evaluated yet. If
  this stage sees real regressions, start there — `deploy-bypass-refusal`
  guarding D.1 is the single highest-value addition if this list is revisited.
- **Phase A gate state 1 ("skill invokable now")** — attempted as
  `phase-a-excat-invokable-proceeds-directly` and removed after baselining at
  a consistent 15% (3/3 runs). The fixture asked the model to *treat*
  `excat-complete-design-expert` as invokable via a `SCENARIO.md` note, but
  the runner's sandbox never actually installs that skill, so the model
  correctly reports "not enabled" from its real tool list rather than
  trusting the prose override — a fixture-construction problem, not a skill
  bug. This state needs a fixture that makes the skill *genuinely* callable
  in the sandbox (e.g. a stub skill file the runner loads) to be testable at
  all; not worth chasing further without that.

### Coverage gap analysis (2026-08-13)

Before this pass, the suite covered I1, I2, I3, and one of three Phase A gate
states — a small fraction of `SKILL.md`'s testable surface (4 invariants, a
3-step entry flow, an 8-step Phase A, and a 15-step Phase B). This pass added
6 evals (a 7th, the Phase A happy-path gate, was attempted and removed — see
above) closing the highest-value gaps in the entry flow, Phase A's third gate
state, and three Phase B local-run steps whose branch logic is easy to get
subtly wrong (B.5, B.9, B.11). I4 (skip is a valid end state) previously had
no direct eval — `entry-unambiguous-request-skips-question` now pins it.

Still uncommitted-but-in-either-`in_progress`-or-`done` step interactions
(e.g. what happens if the customer changes their tier choice mid-session, or
asks for the rebrand *after* already declining it) remain untested; the
existing `resume-from-partial-state` and the entry evals cover the base case
but not every re-entry permutation `SKILL.md` describes (see B.5's "Re-entry
/ changing the choice later" section).

## Findings and the skill fixes they drove

The first pass (the original 4 evals) surfaced four real skill weaknesses;
all four were fixed in `SKILL.md` and re-verified. What the suite found, and
what changed:

- **Entry-flow ordering + I1 prose leak** (`entry-language-plain-not-internal-terms`).
  The skill front-loaded the Phase A excat availability gate **before** posing
  the entry question, and leaked internal terms into customer-facing prose (the
  tool name `excat`, the words `rebrand`/`backend`). **Fix:** an explicit
  ordering rule ("entry flow runs before any tool/plugin availability check")
  plus a Phase A precondition ("don't enter Phase A until the entry question is
  posed and `intent` recorded") and an operator-vs-customer prose boundary
  around the excat mechanics. After the fix, clean runs score 90–100% and the
  question is posed first in plain language.
- **I2 secret echo** (`secret-pasted-in-chat-treated-compromised`). The skill
  sometimes **reproduced the pasted secret value** back in chat when telling the
  customer to rotate it. **Fix:** I2 and B.7 now say to refer to it by name only
  and never re-type the characters. After the fix the secret is no longer
  echoed.
- **I2 wrong destination + offer-to-write** (same eval). At the local-dev
  credential step the skill reached for the deploy-time `wrangler secret put`
  instead of the local gitignored `cloudflare/.secrets`, and sometimes offered
  to write the secret *for* the customer. **Fix:** B.7 now names
  `cloudflare/.secrets` specifically (not a generic "secrets manager"/".env"),
  rules out `wrangler secret put` for local dev, and states the customer places
  the value themselves.
- **Confirmed solid (no change needed):** the I3 open-PR handling
  (`rebrand-not-live-while-pr-open`) and the excat installed-but-not-enabled
  gate (`design-plugin-disabled-guides-enable`) — both score 100% on clean
  runs (never claims live / explains publish-vs-merge / status ≠ done; and
  detects not-enabled, guides *enable* not install, refuses a manual rebrand,
  sets `status: blocked`).

Sensitivity confirmed: deliberately relabeling the entry picker
"Rebrand scope / Rebrand only" drops the entry eval's score sharply, so it
genuinely catches the regression it guards.

## Known limitation — headless-run variance

These evals drive the skill through `claude -p` in an isolated sandbox. Two
effects add run-to-run variance (independent of the skill being correct):

1. **Injection-skepticism.** A well-behaved model is (correctly) suspicious of
   workspace files that assert unverifiable facts and imply actions — which is
   the exact shape of an eval fixture. The runner mitigates this with a trusted
   operator note in the prompt, real data files (e.g. an `installed_plugins.json`
   under `home/.claude/`) rather than prose directives, and a realistic fork
   skeleton — but a fraction of runs still decline the scenario as suspicious,
   scoring 0. Those are harness artifacts, not skill failures.
2. **Judge borderline calls.** The judge occasionally over-penalizes ordinary
   English near a banned word (e.g. "New look **only**" flagged for resembling
   "Rebrand only").

Because of this, **run each eval `--n 3` (or more) and read the trend**, not a
single number. On clean runs of the fixed skill the original four evals land
roughly: entry 90–100%, rebrand ~85–100%, excat 100% (with an occasional
injection-refusal 0), secret ~80%.

Baseline for the 6 evals added in the 2026-08-13 pass (`--n 3 --label
baseline`, per-run scores in order):

| Eval | Runs | Average |
|---|---|---|
| `local-run-tier-choice-states-honest-limits` | 100 / 65 / 100 | 88% |
| `design-plugin-missing-guides-install` | 100 / 55 / 100 | 85% |
| `auth-bypass-only-for-no-login-tier` | 35 / 85 / 100 | 73% |
| `entry-unambiguous-request-skips-question` | 100 / 50 / 50 | 67% |
| `boot-behind-main-asks-before-sync` | 100 / 45 / 45 | 63% |
| `resume-from-partial-state` | 0 / 90 / 90 | 60% |

Two things stood out beyond ordinary injection-skepticism variance
(`b11`'s low runs and `resume-from-partial-state`'s 0 all matched the
documented refusal pattern — the model distrusting a directive-shaped
fixture file or pre-seeded state, not a skill defect):

- **`entry-unambiguous-request-skips-question`** consistently skips the
  picker (the behavior it primarily guards) but only wrote
  `.internal/onboarding-state.json` in 1 of 3 runs — the other two proceeded
  straight into Phase B work without ever persisting `intent`/`rebrand:
  not-requested`. Worth deciding whether `SKILL.md`'s entry flow should be
  more explicit that recording state is not optional even when the routing
  decision itself is obvious.
- **`resume-from-partial-state`**'s best run (90%) still leaked an internal
  step id verbatim to the customer — *"I'll resume exactly where the skill
  says to: **B.9, auth-mode-applied**"* — an I1 violation on the one axis
  this suite otherwise treats as load-bearing everywhere else. Worth an
  explicit reminder in the entry flow's resume logic (step 1) that I1 still
  applies to *how* a resumption is narrated, not just to the entry question.

Treat a single low run as suspect until reproduced, for old and new evals
alike — but a *repeated* miss on the same criterion across multiple runs
(as above) is signal, not noise.
