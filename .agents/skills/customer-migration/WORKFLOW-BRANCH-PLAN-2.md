# Demo vs. Dedicated — Phase B/entry-question correction plan (round 2)

This is a follow-up correction to `DEMO-VS-DEDICATED-PLAN.md`. That
earlier plan correctly introduced `customer.deployTarget` and branched
B.7 (credentials) and the deploy stage (D.2–D.5) on it. What it missed:
**B.5 through B.11 (the entire local-run tier choice and boot
verification) also need to branch on `deployTarget` — they currently run
identically regardless of demo vs. dedicated, which is wrong.**

## Corrected understanding of the two journeys

**Demo (`deployTarget: "shared"`)**
- The shared AEM/Cloudflare environment is **already deployed and
  running, persistently** — it is not spun up per-demo, and never torn
  down between demos.
- A demo therefore needs: **rebrand (Phase A) → merge the PR** (per I3,
  code needs a merge to take effect) — and that's it. The already-live
  shared deployment picks up the change once merged.
- **No local run at all.** B.5's tier menu, B.7's local credential setup,
  B.9's auth-mode application, B.11's boot verification — none of these
  apply. They should be skipped entirely, not just have their content
  altered.
- Phase C (assets) still runs, but against the shared environment's
  existing demo asset set / a small representative set — not a new
  provisioned environment.

**Real migration (`deployTarget: "dedicated"`)**
- The whole point is the customer ends up with their own live portal.
  Deploy is not "opt-in on top" for this path — it is the expected,
  central destination, not a skippable extra.
- Sequence: **rebrand (Phase A) → local setup, fixed to `local-no-login`
  (Phase B.7–B.11, no menu) → deploy, which requires setting up real
  authentication (Entra/login) as a prerequisite before merge-to-deploy.**
- **B.5's three-way tier menu (preview / local-no-login / local-login)
  must not be asked for dedicated.** It always proceeds directly to
  `local-no-login`: real search/assets against the customer's real,
  dedicated Content Hub credentials, but explicitly skipping Entra/login
  setup at this stage.
- **B.9's real-Entra-login branch is not a local tier choice for
  dedicated at all.** Real auth setup is deferred to the deploy stage —
  done once, right before going live (i.e., as a new prerequisite step in
  `deploy.md`, before D.7's merge-to-deploy) — never offered as a local
  "which tier" menu option.

## What stays the same

- Phase A (rebrand) is identical either way — untouched by this plan.
- B.1–B.4 (node check, fork identity, code-sync check, Helix URL/README
  correction) are cheap, always-safe steps that apply regardless of path
  — untouched.
- B.7's credential-collection branch on `deployTarget` (already
  implemented in round 1) stays as-is: shared reuses existing creds,
  dedicated collects new ones. This plan doesn't change B.7's credential
  logic — it changes *whether B.7 (and B.9, B.11) run at all* for shared.
- The deploy stage's D.1 (bypass gate, unconditional) and D.7 (merge,
  unconditional) stay as-is. D.2–D.5 stay skipped-for-shared as already
  implemented.

## Concrete changes to make

1. **B.5 rewritten**: branch on `deployTarget` before presenting any
   menu.
   - `"shared"` → skip B.5 (and all of B.7–B.11) entirely. After Phase A
     completes (published + merged), Phase B's status goes straight to
     `done` (per I4 — nothing else was requested/needed). No tier
     question asked, ever, for a demo.
   - `"dedicated"` → skip the three-way menu. Go straight to the
     `"local-no-login"` tier's logic (already documented under B.5's "If
     `local-no-login`" subsection) — no question asked, since there's
     only one valid tier for a real migration's local-setup step.
2. **B.9 changed**: remove the `local-login` (real Entra) branch as a
   *local* option. Real Entra/login setup moves into `deploy.md` as a new
   step before D.7 (merge-to-deploy) — framed as "before this goes live,
   let's set up real sign-in" — for dedicated only. Shared never reaches
   this since it never reaches deploy.md's provisioning steps in the same
   way (though D.1's bypass gate still applies unconditionally, per round
   1 — that's about disabling any fake local bypass, distinct from real
   Entra setup, and is unaffected by this change).
3. **State schema / step docs updated**: `phases.backend-onboarding`
   documentation should note that for `shared`, all local-run steps
   (`tier-selected` through `boot-verified`) are marked `not-requested`,
   not silently left `pending` — consistent with I4 (skipped work is a
   valid end state, not unfinished). `scopeChoice` is never set for
   shared (stays `null`, with a comment explaining why); for dedicated
   it's always `"local-no-login"` once this phase starts (never
   `"preview"` or `"local-login"`, since the menu never offers those to
   a dedicated customer).
4. **Entry-flow question 2 wording updated** to match: options must
   describe what concretely happens under whichever `deployTarget` was
   already answered, without vague "get it running"/"fully working"
   language, and without falsely promising deploy happens instantly on a
   menu click for dedicated (deploy requires the customer to actually
   supply new infrastructure/credentials across further turns).
5. **Sync**: after SKILL.md/deploy.md edits are verified, copy to all
   three skill locations in `poc-eds-fork-1786551635`
   (`.claude/skills`, `.agents/skills`, `skills`) and keep
   `assethub-spark`'s copy as source of truth.
6. **Evals**: add/update coverage for (a) shared path skips B.5–B.11
   entirely, not just B.7; (b) dedicated path never shows B.5's 3-way
   menu, goes straight to `local-no-login`; (c) real-Entra setup is only
   ever requested at deploy time for dedicated, never during local run.

## Todo tracking

See session SQL `todos` table, ids `plan-2-*`, for the ordered breakdown
and dependency graph mirrored from this document.
