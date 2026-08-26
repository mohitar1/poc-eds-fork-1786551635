# Backend local-run (Phase B, B.1–B.11): design plan

This document is the design plan behind the **local-run** half of Phase B
in `.claude/skills/customer-migration/SKILL.md` (steps B.1–B.11 — getting
a fork booting locally with real search and a correctly reported auth
state). It records the code-verified findings that shaped those steps.

The **deploy** half of Phase B (D.1–D.8, `deploy.md`) is documented
separately in `deploy-plan.md`; the **rebrand** phase in
`rebrand-plan.md`; and the entry flow that routes between phases
in `entry-flow-plan.md`. (Phase B was originally a standalone
`onboard-customer-portal` skill, since merged into `customer-migration`.)

## Context — two scope findings that shaped local-run

An early draft treated `wrangler.toml`/`local.sh` as almost entirely
out-of-scope for a local-only flow. Checking a real fork and its
onboarding transcript showed the opposite, and produced the two facts the
local-run steps are built around:

1. **`HELIX_ORIGIN` stays pointed at the upstream template after forking**
   — in both `wrangler.toml` and `local.sh` — silently serving the old
   template's content instead of the fork's own. A real, live bug, not
   theoretical. This is why B.4 (Helix URL / README correction) always
   runs, even for a preview-only customer, and why B.3 verifies Code Sync
   against the fork's own `/en/` path rather than assuming.

2. **The `DISABLE_AUTHENTICATION` bypass is commented-out code.** See the
   auth-bypass section below — this is the single most important local-run
   finding, and both this doc's B.9 and `deploy-plan.md`'s D.1 depend on
   it.

Branding/DA content/visual work is out of Phase B's scope entirely — that
is Phase A's job (`rebrand-plan.md`).

## Code Sync verification (B.3) — the `/en/` probe

Probe a path that actually has content, **not** the bare root. The
template's real content lives under `/en/`, and a bare `/` almost always
404s even when Code Sync is perfectly installed (nothing is published at
`/index`). Reading a `/` 404 as "not installed" is a false negative that
misfires for nearly every fork.

The discriminator is the response header: a 404 carrying
`x-error: Lambda: ...` means the content-bus Lambda is running, i.e. Code
Sync **is** installed (content just isn't published at that path yet). A
404 without it (or a "site not found") means Code Sync is genuinely not
installed — a required one-time GitHub-App install the customer must do
themselves; the agent cannot install a GitHub App on their org. Don't
proceed past a genuine "not installed" state: that fork would silently
serve the upstream template's demo content via the `aem up` fallback
proxy.

## Auth-bypass — mechanism and the skill's evolution (B.9 / referenced by D.1)

`cloudflare/src/auth.js`'s `DISABLE_AUTHENTICATION` block inside
`withAuthentication` (lines ~161-172) is commented out by default. Two
code-verified facts about it:

- It is a **self-contained local seam**: `withAuthentication` only
  validates a locally-signed session cookie and never contacts Microsoft
  (the Entra calls live only in `/auth/login` and `/auth/callback`).
  Uncommenting the block makes `withAuthentication` set a fabricated dev
  user (`dev@localhost`, `admin`/`employee` roles) and return, so every
  downstream route works with **no Entra config at all**. Re-commenting
  restores real login.
- The env-var check `REQUIRED_ENV_VARS`
  (`MICROSOFT_ENTRA_TENANT_ID`, `MICROSOFT_ENTRA_CLIENT_ID`,
  `COOKIE_SECRET`) in the `authRouter`'s `before` middleware 503s on any
  `/auth/*` request if those are missing — **independent of**
  `DISABLE_AUTHENTICATION`. So local dev can run indefinitely on the
  bypass, but `/auth/*` still needs those vars set; the template's own
  placeholder Entra values in `wrangler.toml` satisfy the check for local
  dev.

**Evolution note (correctness-critical):** an earlier design had the
skill only *statically check and warn* about the bypass state, never
editing `auth.js`. The current skill instead **acts** on the tier choice
(B.9): for `"local-no-login"` it uncomments the block; for `"local-login"`
it leaves it commented and walks the customer through a real Entra
registration. Either way it records `customer.authBypassActive`. The
deploy stage's D.1 re-comments the block before any deploy — a fabricated
admin must never ship (see `deploy-plan.md`).

## Local-run tier choice (B.5) — three genuinely different setups

There are three ways to run locally, at very different setup cost, and
the honest limits differ. This reasoning is why B.5 offers a three-way
outcome choice (`scopeChoice`: `"preview"` / `"local-no-login"` /
`"local-login"`) rather than a single "run it" path:

- **preview** — `npx aem up` alone serves raw EDS pages and does not
  start the Cloudflare Worker at all (`local.sh` runs the two as
  independent processes; everything auth-related lives only in the
  worker). No secrets, no Content Hub creds, no Entra app needed.
- **local-no-login** — the auth bypass on; real search, thumbnails,
  collections list, and the header work. Notifications, reports, and
  analytics dashboards do **not** — they need the deployed backend. State
  these limits at choice time; don't oversell it.
- **local-login** — bypass off, real Microsoft sign-in, closest to
  production; needs the customer's own Entra registration.

## Content Hub credentials (B.7) — why `.secrets` is mandatory

Real search needs `AEM_ENV_ID` plus Content Hub OAuth S2S client id/secret.
The secrets go into `cloudflare/.secrets` (gitignored), never read back by
the agent (invariant I2). Code-verified: the file must **exist** or
`wrangler dev` won't boot — its `predev` hook hard-fails on a missing
file — so this step is mandatory for both login tiers, not optional. Also
check for `SPARK_COOKIE_SECRET` (required by `REQUIRED_ENV_VARS`
regardless of bypass state); generate one with `openssl rand -base64 32`
if missing and have the customer add it. Only the non-secret `aemEnvId`
is recorded in the state file.

## Boot verification (B.11) — the stale-directory failure mode

**Sync-with-main before boot (ask, never auto).** The local `aem up`
server serves the fork's published `main` content (per I3 and the B.4
origin), so a customer booting "to see their site" should be on the
latest code first. B.11 fetches and checks whether the branch is behind
`origin/main`; if so it *offers* to pull/merge and lets the customer
decide — it never auto-merges, since that can conflict or pull unwanted
changes, matching the agent-prepares/customer-decides posture used
everywhere git is mutated. (Considered and rejected: committing the
`.internal` state file for cross-machine resume — it holds customer
identity, `.internal` is gitignored on purpose, and same-machine resume
already works from the on-disk file.)

Run `npm run dev`, open the **worker** port (it serves `/api/*`, not the
aem-up port). Then verify, in order:

1. The server is serving **this repo's own local files**, not a stale or
   cached directory — a real failure mode seen in practice; confirm a
   distinctive local string appears in the served output.
2. Auth behavior matches the chosen tier (no-login reaches the app as the
   fake dev user; login redirects to Microsoft).
3. A real search returns the customer's own Content Hub results and at
   least one thumbnail renders. If search fails, check in order:
   wrong/missing `SPARK_DM_CLIENT_ID`/`SECRET`, wrong `AEM_ENV_ID`, or
   the Content Hub technical account lacking access to that environment.

## Completion / handoff

A running local tier with no deploy is a complete, valid end state
(invariant I4) — mark `phases["backend-onboarding"].status` `"done"`
once the run-tier steps for the chosen tier pass. Offer the deploy stage
(`deploy-plan.md`) only if the customer wants it; never force it.

## Verification

- Confirm B.3 judges Code Sync from the `/en/` probe and its
  `x-error: Lambda` header, never a bare `/` 404.
- Confirm the skill reports/handles `DISABLE_AUTHENTICATION` per the
  current "acts on tier choice" design, not the old warn-only design.
- Confirm B.11 checks the server serves this repo's own files (not a
  stale directory) before declaring boot verified.
