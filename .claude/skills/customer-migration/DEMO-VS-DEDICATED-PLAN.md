# customer-migration — demo vs. dedicated-portal fix plan

Root-cause analysis and implementation plan from the URBN migration session
review (2026-08-26/27). Source material: `poc-eds-fork-1786551635`'s
`2026-08-26-195806-*.txt` transcript and `.migration/urbn-session-log.md`.

## Root causes found

1. **Content-source discovery was guesswork.** No `fstab.yaml` in the fork,
   so the agent wrongly concluded "nothing to rewrite," then used a stale
   README URL (`assethub-spark--aem-showcase`, the upstream template's own
   identity) instead of deriving the fork's real DA/Helix addresses. Cost
   two user round-trips before content rewrite even started.
2. **Asset-color sweep was manual grep + eyeballing, not exhaustive.** Real
   misses shipped and had to be hand-caught mid-session: a leftover
   `.icon-santander-mark` CSS class, `#4A4A4A` hover colors in multiple
   files, and a stray stylelint auto-fix side effect on `--accent-tertiary`
   that rode along in the same diff undetected until manually reviewed.
3. **Deploy (Phase D) was never reached.** It's opt-in and only mentioned
   if the customer explicitly asks — the session ran out of budget mid
   rebrand (PR opened, not merged), and a later, separate session skipped
   most of Phase B and never touched Phase D. The GitHub Action never got
   its Cloudflare token because nothing in the flow ever surfaced that step.
4. **The skill has exactly one backend model** (each fork = a new isolated
   customer environment with its own Cloudflare account/AEM env), but real
   usage has two genuinely different cases:
   - A **demo** — showing a rebrand + the customer's assets, reusing the
     *same shared* AEM environment and Cloudflare account already used for
     other demos (this is what `DEMO_COMPANY` scoping already assumes).
   - A **real migration** — the customer's own isolated AEM environment and
     Cloudflare account, fully provisioned (`deploy.md` D.1–D.8 as written).
   Nothing in the skill asks which one this is, so Phase B/C/D behave as if
   every fork needs full new-account provisioning, even for a demo.

## The fix — one question, asked first, purpose-only

Asked at the very start of the entry flow, before the existing scope
question, in plain words with **no time/effort framing** (never "faster" /
"takes longer" — that biases the answer toward whichever sounds easier
instead of reflecting what's actually needed):

> "Is this going to become [customer]'s own real portal — the one they'll
> actually run and manage going forward — or is this so we can show them a
> demo of what a rebrand would look like?"

- Always asked explicitly. **Never skipped on keyword match** — "migrate"
  is not a reliable signal (the real URBN prompt said "migrate this
  portal" but the actual intent was a demo).
- If the answer is still vague, state a default out loud rather than
  guessing silently: *"I'll treat this as a demo for now — say the word if
  it's actually their real portal,"* then proceed with `deployTarget =
  "shared"` as a stated, correctable assumption.
- Recorded once as `customer.deployTarget`: `"dedicated"` (real portal) or
  `"shared"` (demo). Read everywhere downstream, never re-asked.
- The practical consequence (they'll need to provide their own hosting
  account) is only mentioned *after* they answer "real portal" — never
  baked into the question itself.

## What happens after each answer, phase by phase

### Phase A — Rebrand (identical either way)
Design tokens, exhaustive two-pass asset-color sweep, content rewrite,
publish, PR → merge — none of this depends on the answer.

### Phase B — Backend onboarding
- B.1–B.6 (node check, fork identity, code sync check, README/Helix URL
  fix, local-run tier choice): identical either way.
- **B.7 (Content Hub credentials)** — where the branches diverge:
  - `shared` (demo) → skip asking for new credentials; reuse what's
    already in `cloudflare/.secrets` / `customer.aemEnvId`.
  - `dedicated` (real portal) → proceed exactly as documented today: ask
    for the customer's own real credentials and `aemEnvId`.
- B.9/B.11 (auth mode, boot verification): identical either way.

### Phase C — Asset population
No new logic needed — it already uploads into whatever `aemEnvId` B.7
resolved.
- `shared` → assets land in the shared environment, scoped by
  `DEMO_COMPANY = customerKey` so only this customer's assets show.
- `dedicated` → assets land in the customer's own dedicated environment.
- Completion report (both branches): **always** proactively asks about a
  real public link now — never silent, never forced (I4 preserved).

### Phase D — Deploy (only entered if they accept the Phase C offer)
Reads `customer.deployTarget` — never asks again.
- **D.1 (bypass gate) applies unchanged in both branches** — a fake
  open-admin login is a real risk the moment anything is public, demo or
  not, never skipped either way.
- `shared` → skip D.2–D.5 entirely (no new Cloudflare account/KV/D1/secrets
  store — same account already provisioned for other demos). Confirm
  Phase C's scoping, check/copy the existing shared `CLOUDFLARE_API_TOKEN`
  into this fork's own GitHub repo secrets if missing, then D.7 (merge).
- `dedicated` → proceed through D.1–D.8 exactly as documented today (new
  Cloudflare account, new KV/D1, customer's own real secrets, own domain).

## Implementation todos (ordered, see session SQL `todos`/`todo_deps`)

1. `impl-1-schema` — add `customer.deployTarget` to the state schema.
2. `impl-2-entry-question` — leading, purpose-only question at entry.
3. `impl-3-b7-branch` — B.7 skips/asks credentials based on the branch.
4. `impl-4-content-source` — deterministic DA/Helix URL derivation
   (`git remote` → DA/Helix URLs, real probe before concluding "no content").
5. `impl-5-color-sweep` — exhaustive checklist (hex map, selector-name
   scan, full diff-vs-pre-edit), run twice: post-edit and post-merge-live.
6. `impl-6-deploy-reads-not-asks` — deploy branches on the stored answer,
   D.1 always applies.
7. `impl-7-proactive-offer` — Phase C completion report always offers
   going live, never only if asked.
8. `impl-8-resume-guard` — spot-check `done` phases against real repo
   state before trusting a resumed state file.
9. `impl-9-evals` — eval coverage for all of the above, following the
   existing `evals/` `task.md` + `criteria.json` + `fixture` convention.
