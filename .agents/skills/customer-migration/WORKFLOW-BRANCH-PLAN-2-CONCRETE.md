# Concrete implementation plan — B.5–B.11 branch on `deployTarget`

Companion to `WORKFLOW-BRANCH-PLAN-2.md` (the narrative rationale). This
file states the **exact before/after text** for every edit, so nothing is
implemented from vague description alone.

---

## Change 1 — B.5: branch before showing any tier menu

**File:** `SKILL.md`, section `## B.5: Local-run tier choice`

**Current opening** (paraphrased — see file for literal text): presents
the three-way menu (preview / local-no-login / local-login) to every
customer unconditionally.

**New opening, inserted before the menu:**

```
## B.5: Local-run tier choice (`tier-selected`, sets `scopeChoice`)

**First, branch on `customer.deployTarget`** (set at entry, step 2 —
never re-ask it here):

- **`"shared"` (demo)** — skip this step, and all of B.7–B.11, entirely.
  There is no local run for a demo: the shared environment is already
  deployed and running persistently. Once Phase A's rebrand is published
  and its PR merged (I3 — code needs a merge to take effect), the
  already-live shared deployment serves the new look on its own. Set
  `phases["backend-onboarding"].status` to `"done"`, mark every step from
  `tier-selected` through `boot-verified` as `"not-requested"` (I4 — this
  was never asked for, not left unfinished), and leave `scopeChoice`
  `null` (a comment in the state file schema explains why). Do not ask
  the customer anything else about running it — proceed straight to the
  Phase B completion report (below), or to Phase C if asset population
  was also requested.
- **`"dedicated"` (real portal)** — skip the three-way menu below. There
  is only one valid local-setup tier for a real migration:
  `"local-no-login"` (real search/assets against the customer's real,
  dedicated Content Hub credentials, deliberately without setting up
  real sign-in yet). Set `scopeChoice` to `"local-no-login"` directly —
  do not ask the customer to choose; proceed straight to the
  `"local-no-login"` branch below. Real sign-in (Entra) setup is
  deferred to the deploy stage (see `deploy.md`'s new pre-D.7 step) —
  it never appears as a local-run choice for a dedicated customer.

The three-way menu below is now unreachable in normal operation (every
customer's `deployTarget` is resolved before B.5 runs) — it is kept only
as reference material / a compatibility fallback if `deployTarget` is
somehow still `null` here (should not happen; see entry flow step 2).
```

**Then:** keep the existing menu text (`"There are three ways I can get
this running..."`) but retitle its intro to make clear it's the
compatibility-fallback path only, e.g. prefix it with *"(Fallback, if
`deployTarget` is somehow unresolved at this point:)"*.

**Also remove/adjust:** the existing "If `local-login`" subsection under
B.5 stays as reference text for the fallback path, but a dedicated
customer following the new branch above never reaches it during local
setup.

---

## Change 2 — B.9: remove the local-login (real Entra) branch as a *local* choice

**File:** `SKILL.md`, section `## B.9: Auth mode`

**Current:** has two branches — `"local-no-login"` (uncomment bypass) and
`"local-login"` (walk through real Entra registration).

**New:** since B.5 now never sets `scopeChoice` to `"local-login"` for a
normal dedicated flow (only the deprecated fallback path could), B.9's
real content is unchanged for `"local-no-login"`. Add a note at the top:

```
**Note:** under the corrected B.5 branch, a dedicated customer's
`scopeChoice` is always `"local-no-login"` at this point — the
`"local-login"` branch below only fires via the fallback path in B.5.
Real Entra/sign-in setup for a dedicated customer's actual deployment
happens once, at deploy time — see `deploy.md`'s new step before D.7 —
not here.
```

Leave the existing `"local-login"` branch's content in place (harmless
reference/fallback), but it is no longer the primary path.

---

## Change 3 — `deploy.md`: add real-Entra setup as a step before D.7

**File:** `deploy.md`

**Insert new step, between D.6 (CI token) and D.7 (deploy via merge):**

```
## D.6.5: Real sign-in setup (`real-auth-configured`) — dedicated only

**Only for `deployTarget == "dedicated"`.** Skipped for `"shared"` — a
demo never reaches this file's provisioning steps in the way that would
require it, and D.1's bypass gate (unconditional, already handled) is a
separate concern from setting up *real* sign-in.

Before this can go live, the customer needs real Microsoft Entra
sign-in wired up (the same content previously offered as B.9's
`"local-login"` option, now done once, here, instead of as a local
choice): walk them through their own Entra app registration (steps:
`deploy-plan.md` Entra section) and have them place the resulting
`MICROSOFT_ENTRA_TENANT_ID`/`CLIENT_ID` into `wrangler.toml`'s `vars`
(and `SPARK_MICROSOFT_ENTRA_CLIENT_SECRET` into the remote secrets store
per D.4, not `cloudflare/.secrets` — that file is local-dev-only).

Confirm both values are in place before proceeding to D.7. Mark
`real-auth-configured` `done`.
```

**Add `real-auth-configured` to the state schema's `backend-onboarding`
deploy-only steps list** (see Change 4).

---

## Change 4 — State schema doc updates

**File:** `SKILL.md`, `## Shared state file` section, schema JSON block.

**Add one new step id** to `phases.backend-onboarding.steps`, inserted
between `ci-token-set` and `deployed-via-merge`:

```
"ci-token-set": "pending",
"real-auth-configured": "pending",
"deployed-via-merge": "pending"
```

**Add a documentation note** directly under the existing "run-tier
steps" / "deploy-only steps" split paragraph:

```
For `deployTarget == "shared"`, every run-tier step (`tier-selected`
through `boot-verified`) is set to `"not-requested"` at B.5, not left
`"pending"` — per I4, this was never applicable, not left unfinished.
`scopeChoice` stays `null` for `"shared"` (there is no local run to
choose a tier for). For `deployTarget == "dedicated"`, `scopeChoice` is
always set directly to `"local-no-login"` at B.5 — the customer is never
asked to choose, since it's the only valid tier for this path.
```

---

## Change 5 — Entry-flow question 2 wording (SKILL.md, step 2)

Replace the current fresh-request options (the "Give it Disney's look and
content, get it up and running..." block) with wording that matches the
now-locked branch behavior, **and is written once `deployTarget` is
already known** (question 2 is asked after question 1, so this is safe):

**If `deployTarget == "shared"` (demo):**

```
1. "Give it Disney's look and content, and once that's merged in it'll
   show up on the preview site we already keep running — with a few of
   Disney's own assets loaded in so you can see it with real content"
2. "Just give it Disney's look and content for now — I'll ask before
   merging it in or loading any assets"
3. Something else
```

**If `deployTarget == "dedicated"` (real portal):**

```
1. "Give it Disney's look and content, get it working end-to-end on my
   machine with Disney's real content so we can verify it, then walk
   you through the steps to actually put it live with Disney's own
   assets loaded in"
2. "Just give it Disney's look and content for now — I'll ask before
   starting on getting it working or setting it up to go live"
3. Something else
```

Map answers to `intent`/phase statuses exactly as the existing mapping
table below this question already does (`full` / `frontend-only` /
`backend-only` / `assets-only`) — unchanged by this plan.

---

## Change 6 — Evals to add/update

1. **`shared-path-skips-all-local-run`** (new) — fixture:
   `deployTarget: "shared"`, rebrand `done`, PR merged. Verify the agent
   never asks the B.5 tier question, never touches B.7/B.9/B.11, marks
   all run-tier steps `not-requested`, and reports Phase B `done`
   immediately.
2. **`dedicated-path-skips-tier-menu`** (new) — fixture:
   `deployTarget: "dedicated"`, rebrand `done`. Verify the agent never
   presents the three-way menu, sets `scopeChoice` to `"local-no-login"`
   directly, and proceeds straight into B.7's credential collection.
3. **`real-auth-only-at-deploy-time`** (new) — fixture: `dedicated`,
   backend `done` at `local-no-login`, customer now opting into deploy.
   Verify Entra/real-sign-in setup is requested only now (as the new
   D.6.5), never was asked during the earlier local-run steps.
4. Update `evals/README.md` coverage table with these three new rows.
5. Existing `b7-skips-new-creds-when-shared` and
   `deploy-shared-path-skips-provisioning` evals stay valid as-is — no
   changes needed there.

---

## Execution order (matches SQL todos `plan-2-*`)

1. `plan-2-b5-branch` — Change 1
2. `plan-2-b7-b11-shared-skip` — folded into Change 1's shared branch
   (no separate B.7/B.9/B.11 edits needed beyond the note in Change 2 and
   the deploy.md insert in Change 3)
3. `plan-2-b9-entra-to-deploy` — Changes 2 + 3
4. `plan-2-entry-question-2-wording` — Change 5
5. `plan-2-state-schema-update` — Change 4
6. `plan-2-sync-all-copies` — copy `SKILL.md`/`deploy.md` to
   `poc-eds-fork-1786551635`'s three skill locations
7. `plan-2-evals-update` — Change 6
