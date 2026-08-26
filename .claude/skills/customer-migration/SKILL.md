---
name: customer-migration
description: Full customer migration for a forked Assets Hub Spark repo — rebrand the site's design/content via Catalyst, then get the backend (Cloudflare, Content Hub, local dev) running. Use when a customer forks this repo and asks to rebrand/restyle the site, or asks to get the portal/site running locally, or asks for a full migration/onboarding — any of these trigger the same one skill, run in order (rebrand first, backend second). Not for initial site migration into EDS (a different, prior step).
---

# Customer Migration

One skill, two phases: **Phase A — rebrand via Catalyst**, then **Phase B
— backend onboarding**. A full migration runs A then B, but either can be
skipped: the customer may only want the rebrand, only want the backend
running, or have the rebrand already done. Start every invocation with
the entry flow below, which resolves what's wanted and what's already
done before touching either phase.

## Invariants (apply throughout — never restated per step)

These hold in both phases. Steps below reference them rather than
repeating them:

- **I1 — Outcomes only, never internal terms.** Never expose this
  skill's name, its file, its phases, step names, `scopeChoice`, or its
  enum values to the customer — in prose **or** in any UI you render
  (question headers, option labels, chips). Describe outcomes in plain
  words: "give the site a fresh look," "update the content," "get it
  running locally." Avoid jargon the customer didn't use — including
  "rebrand," "scope," "phase," "tier," "onboarding" — and never "the
  skill says."
- **I2 — Never handle raw secrets in chat.** Never accept, echo, or read
  back a pasted token or secret value. Tell the customer where to put it
  themselves; read it only from the gitignored file at call time. If a
  secret appears in chat anyway, treat it as compromised — tell the
  customer to rotate it and don't use it. When you tell them to rotate,
  refer to it by name only ("that client secret") — **do not reproduce the
  pasted value** in your reply, not even to quote what to revoke.
- **I3 — Content is live on publish; code is live only on merge.**
  Document Authoring content takes effect immediately when published.
  Repo code (CSS tokens, SVG assets, JS) takes effect only once its
  branch is **merged** and Code Sync picks it up. An open PR means the
  code's effect is **not live**. Never call a rebrand "complete and live"
  while its PR is open.
- **I4 — Skipping optional work is a valid end state, not an unfinished
  one.** A customer who only wants a local run (no deploy), or only the
  rebrand (no backend), or only the backend (no rebrand), is *done* when
  that scope is done. Never hold a phase `in_progress` waiting on work
  the customer never asked for.

## Entry flow — run first, every invocation

Do this **before starting either phase and before any tool, environment, or
plugin availability check** (including the Phase A design-plugin gate below).
The very first thing the customer sees is the entry question — never a
readiness note, a blocker, or setup mechanics. Availability checks belong
*inside* the phase they gate, reached only after routing (step 3).

1. **Load state.** If `.internal/onboarding-state.json` exists, read it.
   Any phase it marks `done` is authoritative — never re-run it. Resume
   at the first non-`done` step of any phase still in progress, and don't
   re-ask questions already answered under `customer`. If the file
   doesn't exist, create it with the schema below.

2. **Ask what's wanted** (unless the request already makes it
   unambiguous — e.g. "just get it running" is backend-only). Ask in
   plain outcome language — **no internal terms** (I1): never the word
   "rebrand," "scope," "phase," "frontend," or "backend" in anything the
   customer sees, including a picker's header and option labels. In
   conversation, wording like:

   > "Want me to give the site a fresh look and update its content for
   > the new brand, or is that already done? Either way, I'll then get
   > it running for you."

   If you render this as a multiple-choice picker, use a plain header
   ("Getting started" / "What should I do") and outcome-worded options —
   e.g. "New look + get it running" / "New look only" / "Already updated
   — just get it running." Do **not** label options "Rebrand scope,"
   "Rebrand only," "Already rebranded," etc.

   Map the answer to `intent` and the rebrand phase's status:
   - new look + running / yes → `intent` = `full`, rebrand runs.
   - already done / skip that / just get it running → mark the rebrand
     phase `done` (`intent` = `backend-only`), skip Phase A.
   - new look only, nothing else → `intent` = `frontend-only`; mark
     backend `not-requested` after Phase A.

3. **Route** to the first genuinely-pending phase — rebrand before
   backend when both are pending. Entering Phase B directly is safe: its
   early steps (B.1–B.4) re-derive everything they need from the repo at
   run time, independent of whether Phase A ran.

## Shared state file

Both phases read and write the same `.internal/onboarding-state.json`
(gitignored via the existing `.internal` entry — do not add a new ignore
rule). It is the resumability mechanism (see entry flow, step 1) and the
record of what the customer asked for.

`intent` records the customer's answer to the entry question
(`full` / `frontend-only` / `backend-only`); it's revisitable — a
customer who chose `backend-only` can ask for the rebrand later. A
phase's `status` may be `in_progress`, `done`, or `not-requested`
(the customer explicitly didn't want it — a valid end state, distinct
from an unfinished `in_progress`).

Schema:

```json
{
  "schemaVersion": 1,
  "intent": null,
  "customer": {
    "name": null,
    "githubOrg": null,
    "githubRepo": null,
    "aemEnvId": null,
    "authBypassActive": null
  },
  "phases": {
    "rebrand": {
      "status": "in_progress",
      "lastUpdated": null,
      "steps": {
        "brand-inputs-collected": "pending",
        "permissions-checked": "pending",
        "design-tokens-applied": "pending",
        "asset-colors-swept": "pending",
        "content-register-rewritten": "pending",
        "published": "pending",
        "landed-via-pr": "pending",
        "asset-color-sweep-verified": "pending"
      }
    },
    "backend-onboarding": {
      "status": "in_progress",
      "lastUpdated": null,
      "scopeChoice": null,
      "steps": {
        "node-version-check": "pending",
        "fork-identity-resolved": "pending",
        "code-sync-verified": "pending",
        "helix-url-and-readme-corrected": "pending",
        "tier-selected": "pending",
        "content-hub-creds-collected": "pending",
        "auth-mode-applied": "pending",
        "boot-verified": "pending",
        "deploy-bypass-gated": "pending",
        "intake-file-generated": "pending",
        "repo-identity-rename-applied": "pending",
        "remote-secrets-pushed": "pending",
        "remote-d1-migrated": "pending",
        "ci-token-set": "pending",
        "deployed-via-merge": "pending"
      }
    }
  }
}
```

Step values are one of `pending`, `done`, or `blocked` (blocked = waiting
on something external — the customer fetching credentials, provisioning
Cloudflare resources, or installing Code Sync). Update `lastUpdated` and
the relevant step every time you complete or block on a step.

The `backend-onboarding` steps split along two axes:

- **Run-tier steps** (`node-version-check` through `boot-verified`) —
  getting the portal running locally at the customer's chosen tier.
- **Deploy-only steps** (`deploy-bypass-gated` through
  `deployed-via-merge`) — only relevant if the customer wants to deploy.

Per I4, a customer who only runs locally leaves every deploy-only step
`pending` and the phase is still `done`. Set
`phases["backend-onboarding"].status` to `"done"` once the run-tier steps
for the chosen tier are done (a `"preview"` tier needs fewer than a
`"local-login"` tier — see B.5).

`backend-onboarding.scopeChoice`
(`null` / `"preview"` / `"local-no-login"` / `"local-login"`) is
revisitable mutable state, not a completion marker — a customer can pick
`"preview"` now and ask for more later. It lives alongside `status`, not
inside `steps`. See B.5 for its use. Internal only (I1).

## Companion file: customer-config intake (Phase B only)

`.internal/customer-config.json` (also gitignored, same convention) holds
non-secret Cloudflare identity/resource values the customer must look up
themselves. Generated in the deploy stage (`deploy.md`, step D.2), and
only when the customer actually wants to deploy — not needed to run
locally. Not used by Phase A.

---

# Phase A — Rebrand via Catalyst

**Precondition — do not enter Phase A (including the excat check below)
until the entry flow has run:** you must have already posed the entry
question and recorded `intent` in the state file. If `intent` is still
`null`, you are not in Phase A yet — go back and do the entry flow's step 2
(pose the plain-language entry question) first, and stop there until the
customer answers. The excat availability check is the *first thing inside*
Phase A, not the first thing the customer sees.

Rebrand the site's design/content to a new brand identity. The design/CSS
migration is done by the **Catalyst (excat) design skill**, not by hand —
design tokens, asset colors, content register rewrite, and publish all
work independently of whether the fork's backend is set up yet. Do not
defer this phase waiting on Phase B — it doesn't need it.

**Required tool — check on entering Phase A, before A.1** (i.e. only after
the entry flow has run and routed here — never as the first thing the
customer sees; see the entry flow's ordering rule). This phase drives the
excat design skill **`excat-complete-design-expert`** (plugin `excat`, from
the `excat-marketplace` shipped by the Adobe Experience Catalyst
`aem-excat-plugin`). Don't assume it's missing and don't assume it's
present — actually determine which of three states you're in, because
"installed globally" and "enabled for this project" are different things:

The plugin/enable mechanics below (skill names, `/plugin`, marketplace) are
**operator-facing** setup, addressed to whoever runs this session — not
customer-facing prose. That's the one place naming `excat`/the plugin is
fine; I1 still forbids it in anything an end customer reads (e.g. the entry
question, run-tier choices, completion reports). Never let this tooling
handoff bleed into a customer-facing message.

1. **Skill invokable now** — `excat-complete-design-expert` appears in
   this session's available-skills list. → Proceed; A.2 invokes it in
   Complete Migration mode.

2. **Plugin installed but not enabled for this project** — it's in
   `~/.claude/plugins/installed_plugins.json` (look for
   `excat@excat-marketplace`) but the skill isn't in the session list.
   This is the common case. → **Guide the operator to enable it**, don't
   tell them to install: have them run `/plugin` (Manage plugins →
   `excat-marketplace` → `excat` → Enable) for this project, or add
   `excat@excat-marketplace` to `enabledPlugins` for this project, then
   restart the session so the skill loads. To check install state you may
   read `installed_plugins.json` and `known_marketplaces.json`.

3. **Not installed at all** — no `excat@excat-marketplace` entry. → Have
   the operator add the marketplace and install: `/plugin marketplace add
   <path-or-repo of aem-excat-plugin/excat-marketplace>` then
   `/plugin install excat@excat-marketplace`, then enable per state 2.

In states 2 and 3, **stop and do not hand-roll the rebrand** — editing
`styles.css` / sweeping hex manually is not a substitute for this skill
and silently misses the content rewrite and asset-color sweep. Mark the
rebrand phase `blocked`, tell the operator exactly which state they're in
and the one action to fix it, and pause Phase A until the skill loads.

This phase is more than tokens: the content-register rewrite and the
hardcoded-asset-color sweep (A.3) are this phase's own job, wrapped around
the excat skill in one larger request (A.2).

## A.1: Pre-requisites

Do these before touching any file. Ask the customer directly — these
cannot be discovered mid-task without risking a stalled rebrand.

### A.1.a: Permissions checklist (`permissions-checked`)

Tell the customer to confirm both of these are enabled in Settings → LLM
Permissions before starting:

- **Admin access** — covers Helix admin preview/publish AND, via the same
  Adobe IMS session, Document Authoring read/write. If DA still returns a
  401 right after enabling this, that's expected IMS-session propagation
  lag or an Adobe sign-in prompt — not a missing separate toggle.
- **Git access** — required for committing/pushing/opening a PR.

The never-paste-secrets rule (I2) covers the IMS session here and the
`DA_TOKEN`/`HLX_ADMIN_TOKEN` below equally.

### A.1.d: DA / Helix Admin tokens (`token.env`)

Any Document Authoring or Helix Admin API call this phase makes (preview,
publish, status) authenticates with two customer-supplied tokens — not
the IMS session above. Before the first such call:

- Ask the customer to create a gitignored `token.env` at the repo root
  with exactly two lines, `KEY=value` format, no quotes:
  `DA_TOKEN=...` and `HLX_ADMIN_TOKEN=...` (I2 — customer fills the
  values; read at call time, never from chat).
- Confirm `token.env` is gitignored. If `.gitignore` has no `token.env`
  entry, add one — don't rely on another pattern covering it.

Known quirk: a Helix Admin API (`admin.hlx.page`) preview/publish can
`401` even with a valid `DA_TOKEN` — forward the token via an
`x-content-source-authorization` header rather than assuming it's wrong
(why: `rebrand-plan.md`).

### A.1.b: Content-source context

Tell the customer once, before any content work: local
`content/**/*.plain.html` files are for local dev-server preview only and
have zero effect on the hosted `.aem.page`/`.aem.live` site — the real
source of truth is the Document Authoring document (which is why "publish"
is a real, separate step later). Per I3, DA content goes live on publish
but code goes live only on merge — keep the two straight throughout.

### A.1.c: Brand inputs — confirm full scope (`brand-inputs-collected`)

Ask for:

- New brand name. Write it into `customer.name` in the state file.
- Source site to extract the look from, if there is one.
- **Explicit confirmation the customer wants the full scope**: design
  tokens AND hardcoded asset colors (icons, background graphics) AND
  content register (rewritten copy, not just a name swap) AND publish
  AND landing the change via git/PR. Do not proceed on a vague one-line
  request like "update the styles" — that under-specifies scope and
  produces a design-tokens-only result, leaving the rest undone silently.

## A.2: The delegation request

Once A.1 is confirmed, issue one comprehensive request covering all of
the following. Do not split this into separate turns/requests — the goal
is stating the full scope up front so the excat design skill and your own
judgment handle it correctly in one pass, rather than piecemeal.

1. **Design tokens and typography** (`design-tokens-applied`) — invoke
   **`excat-complete-design-expert`** in **Complete Migration** mode (site
   design system + all blocks, site scope), naming the source site if one
   was given. Do not substitute manual `styles.css` edits for this.
2. **Hardcoded asset colors** (`asset-colors-swept`) — explicitly in
   scope, separate from step 1: check SVG icon files and background
   image assets for hardcoded fill colors and embedded raster art that
   don't match the new palette. CSS custom properties do not affect
   these — a background SVG with an embedded raster pattern, or an icon
   SVG with a literal `fill="#hex"`, needs its own file edited, not just
   `styles.css`.
3. **Content register rewrite** (`content-register-rewritten`) — for
   every content page, rewrite the actual copy to match the new brand's
   real subject matter and business, not just substitute the old brand
   name for the new one. Show a before/after diff for review before
   publishing.
4. **Publish** (`published`) — use the real Document Authoring
   upload/preview/publish flow. This polls the underlying job to real
   completion and returns confirmed per-path success/failure — trust and
   report that result, don't treat the initial upload response alone as
   proof anything published.
5. **Land the change as one combined commit → push → PR**
   (`landed-via-pr`) — finish *all* of the above (tokens, assets,
   content) first, stage everything, and only then commit, push, and
   open the pull request as a single sequence. Do not open a PR and then
   continue pushing follow-up commits to that branch afterward — if more
   work is needed after a PR is open, finish it on the branch *before*
   opening the PR. Per I3, merging (not opening) is the finish line for
   the code.
   - If CI checks block the merge, check whether the same checks already
     fail on `main` before assuming you broke something — only fix
     checks that fail on your branch but pass on `main`.

## A.3: Verification

After the delegation request completes, run the check below before
declaring the rebrand done.

Completion is gated on the PR being **merged**, not opened (I3). If the
PR is still open, report it as "code changes ready for review, not yet
live" — a valid stopping point, but not `done`. Once merged, run the
asset-color sweep below against the **merged, live** site — not the local
working tree or open branch.

### Asset-file color sweep (`asset-color-sweep-verified`)

Grep SVG and image assets for hardcoded hex/color values still matching
the *old* brand — visual-comparison tooling misses these (why:
`rebrand-plan.md` Phase 3). Check icon SVGs for `fill="#..."` and
`background-image` assets for embedded raster art / hardcoded panel
colors. Not every hardcoded fill is wrong (a neutral icon that turns
brand-colored on hover is legitimate) — screenshot the pages to confirm a
flagged file actually reads off-brand.

Report any real misses found, fix them, and re-check before considering
Phase A complete. Set `phases["rebrand"].status` to `"done"`.

## Phase A completion report

Summarize plainly: what's rebranded and confirmed live (post-merge); the
new brand name and any before/after content highlights; any known
follow-up (e.g. a placeholder logo mark pending the customer's real
licensed asset). Then, unless the entry flow already established the
customer wants the backend too, ask whether to continue into getting the
site running locally now or stop here. Per I4, stopping is a valid end
state — mark backend `not-requested` and the rebrand phase `done`.

---

# Phase B — Backend onboarding

Get the customer's forked copy of Assets Hub Spark booting locally, with
a correctly reported auth state and real search working against their
own Adobe Content Hub environment — and make sure every file in the repo
that currently identifies the *upstream template* (its GitHub org/repo,
Cloudflare worker/account/resource ids, domain) instead identifies the
*customer's own fork*. Never creates cloud resources itself, never
deploys, and never stores or transmits real secret values (I2) — edits
local, gitignored files, writes non-secret resource identifiers the
customer supplies, and tells the customer where to put actual secrets.

Branding/content is Phase A, not repeated here. This phase runs
independently of whether Phase A ran (the entry flow already resolved
that); branding remains available later if skipped.

**Never hardcode this template's own identity.** Nothing in this phase's
own logic should assume the literal strings `assethub-spark`,
`aem-showcase`, `spark-eds`, `spark.aem.media`, or any other value found
in the inventory below. Always *derive* the current ("old") values by
reading the fork's own files at run time, and *derive* the new values
from what the customer supplies.

## B.1: Node version check (`node-version-check`)

Read `.nvmrc` at the repo root for the required Node major version. Run
`node --version` and compare. If it doesn't match, stop and tell the
customer to switch (e.g. `nvm use`) before continuing — do not proceed on
a mismatched version, since `npm install` will emit engine warnings and
dependencies (wrangler, vite, etc.) may misbehave silently.

Once matched: if `cloudflare/node_modules` is missing, run `npm install`
at the repo root (recurses into `cloudflare/` via `postinstall`). Mark
step `done`.

## B.2: Fork identity resolution (`fork-identity-resolved`)

Do not ask the customer for their GitHub org/repo — derive it:

```
git remote get-url origin
```

Parse `{org}/{repo}` from the URL. Write these into `customer.githubOrg`
/ `customer.githubRepo` in the state file (skip re-deriving if Phase A
already populated these). Mark step `done`.

If there is no `origin` remote, ask the customer directly instead, then
proceed the same way.

## B.3: AEM Code Sync verification (`code-sync-verified`)

Probe `https://main--{repo}--{org}.aem.page/en/` (a content path, **not**
the bare `/`, which 404s even when Code Sync works — see `local-run-plan.md`
for why). `curl -sI` for headers is enough. Judge by the response:

- **200** → installed and working. Mark `done`.
- **404 with an `x-error: Lambda:` header** → installed, just nothing
  published at this path yet. Don't tell them to install anything;
  content publishes separately (Phase A or their own DA). Mark `done`.
- **404 without that header** (or "site not found") → genuinely not
  installed. The customer must install the AEM Code Sync GitHub App on
  their fork themselves (the agent can't install a GitHub App on their
  org) — point them to aem.live docs (look up the URL). Mark `blocked`
  and stop; a fork without Code Sync silently serves the template's demo
  content via the `aem up` fallback proxy.

## B.4: Helix URL and README correction (`helix-url-and-readme-corrected`)

Always runs, whatever the customer wants next — no Cloudflare account,
credentials, or intake file needed. A pure text substitution from B.2/B.3
values; it matters even for a preview-only customer, so their `aem up`
and README point at their own fork.

Using the org/repo from B.2:

- Repoint `AEM_PAGES_URL` in `local.sh` (the line with its `:-` default)
  to `https://main--{repo}--{org}.aem.page`.
- Repoint `HELIX_ORIGIN` in **both** `[env.production.vars]` and
  `[env.branch.vars]` of `cloudflare/wrangler.toml` to
  `https://main--{repo}--{org}.aem.live`.
- Correct `README.md`'s Live/Preview URLs and its `AEM_PAGES_URL` example
  row to the same values.

Do not touch `local.sh`'s placeholder `git remote add origin` line — it
only runs inside a guard for repos with no `origin` at all, which is not
this customer's situation (they have a real fork with a real remote).

Show the customer the before/after for these few lines, apply it, and
mark step `done`.

## B.5: Local-run tier choice (`tier-selected`, sets `scopeChoice`)

There are three genuinely different ways to run this locally, at very
different setup cost. Offer all three in plain outcome language (I1). Use
wording like:

> "There are three ways I can get this running for you:
>
> **1. Just show me the new look** — I'll start it up so you can click
> through your updated pages right away. Nothing needed from you.
> Search and sign-in won't work yet — it's a visual preview.
>
> **2. Get it actually working, skip sign-in for now** — real search,
> real assets and thumbnails, browsing your own content, running on your
> machine without making you set up a login. I'll need two values from
> your Adobe Content Hub for this. (Reports and notifications still need
> the deployed version — those won't work locally.)
>
> **3. The full experience, with real sign-in** — same as option 2, plus
> your real Microsoft sign-in so it behaves exactly like production. This
> needs a bit of setup on Microsoft's side from you or your IT team.
>
> Most people start with 1 or 2. Which sounds right?"

Map the answer and record it in
`phases["backend-onboarding"].scopeChoice`: option 1 → `"preview"`,
option 2 → `"local-no-login"`, option 3 → `"local-login"`. Mark
`tier-selected` `done`.

**Honest limits for options 2 and 3 — state at choice time (call this
"the local limits" where referenced later).** These genuinely work:
search, asset thumbnails and previews, the collections list, and the
header/user widget (shows a "Local Dev" user). These do **not** work
locally and need the deployed backend: notifications (the bell), the
reports/asset-activity dashboards, and search/analytics reports — they
error or come back empty; opening a collection you don't own can be
denied. Don't oversell option 2 as "everything works."

### If `"preview"`

Running `npx aem up` alone serves the site's raw EDS pages directly and
does not start the Cloudflare Worker at all — `local.sh` runs the AEM dev
server and the worker as two independent processes, and everything in
`cloudflare/src/auth.js`/`index.js` (session cookies, Entra login,
`DISABLE_AUTHENTICATION`) lives only inside the worker. So preview needs
no secrets, no Content Hub credentials, no Entra app, and no deploy steps.
Start it, let them click around, and stop here. Per I4, if `"preview"` is
all they want the phase is `done`; if they signalled they want more, leave
it `in_progress`.

### If `"local-no-login"`

Proceed through the local-run steps: B.7 (Content Hub creds) → B.9
(apply the auth bypass) → B.11 (boot & verify). **Skip the entire deploy
stage** — none of the Cloudflare-account intake, identity rename, or
remote push is needed to run locally. Placeholder resource ids in
`wrangler.toml` are fine for local dev (miniflare simulates the
bindings).

### If `"local-login"`

Proceed: B.7 (Content Hub creds) → B.9 (real Entra, bypass left off) →
B.11 (boot & verify). Same skip of the deploy stage.

### Re-entry / changing the choice later

If the customer previously chose a lighter option and now wants more
(same session or a future one): read `scopeChoice`, proceed directly to
the next needed step for the new tier, saying only the outcome (I1) —
*"Good — since you're already running locally, next I'll wire up real
search, which needs two values from your Content Hub."* Update
`scopeChoice`. A later request to actually deploy moves into the deploy
stage (below), which is otherwise never entered.

# Phase B — local run (B.7-B.11)

These steps get the portal running locally at the tier B.5 selected.
They are reached for `"local-no-login"` and `"local-login"` (and are
what a later upgrade from `"preview"` runs). None of them needs a
Cloudflare account, the intake file, or the identity rename — those are
deploy-only (the separate stage further below).

## B.7: Content Hub credential collection (`content-hub-creds-collected`)

As mentioned at the tier choice, real search needs two values from the
customer's Content Hub — collect them now. Ask for:

- **`AEM_ENV_ID`** — their AEM Program + Environment ID, `pXXXX-eYYYY`.
- **Content Hub OAuth Server-to-Server credentials** — client ID and
  secret, from an Adobe Developer Console project with access to that
  delivery environment's Dynamic Media / Content Hub API.

Per I2, don't take secret values in chat:

1. Tell them to create `cloudflare/.secrets` (gitignored) from the
   template documented in `cloudflare/README.md` / root `README.md`.
2. Tell them exactly which two lines to add: `SPARK_DM_CLIENT_ID="..."`
   and `SPARK_DM_CLIENT_SECRET="..."`.
3. Confirm they've done it — don't read the file's contents to "verify."

**If the customer pastes a secret into chat anyway (I2):** tell them that
value is now compromised and to rotate/regenerate it in the Adobe Developer
Console, then put the *new* value into the gitignored **`cloudflare/.secrets`**
file themselves (the same file and line — `SPARK_DM_CLIENT_SECRET="..."` — as
the normal flow; name that file specifically, not a generic "secrets manager"
or ".env"). When you say this, **do not repeat the pasted value back** — refer
to it as "that client secret", never re-type the characters (re-typing it to
say "revoke this" still exposes it in the transcript). Do not use the pasted
value for anything. And do **not** offer to write the secret into `.secrets`
*for* them — the customer always places secret values themselves; you only
tell them the file and line. Offering to "drop it in for you" defeats I2.

For local dev these go in the **`cloudflare/.secrets` file** — do **not**
reach for `wrangler secret put` / a remote secrets store here. That's a
deploy-time mechanism (the deploy stage's D-steps), needs the customer's
Cloudflare account, and does nothing for `wrangler dev`, which reads
`.secrets` locally.

The `cloudflare/.secrets` file must **exist** or `wrangler dev` won't
even boot (its `predev` hook hard-fails on a missing file) — so this
step is mandatory for both `"local-no-login"` and `"local-login"`, not
optional.

Also check whether `cloudflare/.secrets` has a `SPARK_COOKIE_SECRET`
line — required by `cloudflare/src/auth.js`'s `REQUIRED_ENV_VARS`
regardless of auth-bypass state. If missing, generate one locally with
`openssl rand -base64 32` and have the customer add it themselves.

Write only the non-secret `aemEnvId` into `customer.aemEnvId`. Mark step
`done` once the customer confirms all three lines are in place.

## B.9: Auth mode — apply the customer's tier choice (`auth-mode-applied`)

This step **acts** on the tier choice (bypass mechanism + why it's safe
locally: `local-run-plan.md`).

**If `scopeChoice` is `"local-no-login"`:** uncomment the
`DISABLE_AUTHENTICATION` block in `cloudflare/src/auth.js` (~161-172,
those lines only). Tell the customer this makes everyone a local-only
fake admin — fine locally, must be re-commented before deploy (D.1
enforces it). Restate the local limits from B.5. Set
`customer.authBypassActive` to `true`.

**If `scopeChoice` is `"local-login"`:** leave `auth.js` untouched. Walk
the customer through their own Entra app registration (steps:
`deploy-plan.md` Entra section) and have them place the resulting
`MICROSOFT_ENTRA_TENANT_ID`/`CLIENT_ID` into `wrangler.toml`'s `vars`
(and `SPARK_MICROSOFT_ENTRA_CLIENT_SECRET` into `cloudflare/.secrets` for
SMTP). Set `customer.authBypassActive` to `false`.

Then set the local run environment for `npm run dev`, regardless of
branch:

- `AEM_PAGES_URL` = `https://main--{repo}--{org}.aem.page` (from B.2/B.3).
- `AEM_ENV_ID` = the value from B.7.
- `DISABLE_AUTHENTICATION` = `true` (this only takes effect for
  `"local-no-login"`, where the block is now uncommented; harmless
  otherwise).

Note `wrangler.toml`'s `HELIX_ORIGIN` isn't consulted by `local.sh` for
local dev (the local worker always targets the local `aem up` server) —
it matters only for CI/deploy, handled in B.4 and the deploy rename. Mark
step `done`.

## B.11: Boot verification (`boot-verified`)

**Before booting — offer to sync with `main` (ask, never auto).** The
local `aem up` server serves the site's content from the fork's published
`main` state (per I3, and the origin B.4 repointed), so the customer
booting "to see their site" should be on the latest code first. Fetch and
check whether the current branch is behind `origin/main`
(`git fetch origin` then compare, e.g. `git rev-list --count HEAD..origin/main`):

- If behind → tell the customer plainly ("your checkout is N commits
  behind the latest — want me to update it so the preview reflects the
  newest changes?") and, only if they agree, `git pull`/merge `origin/main`.
  **Never auto-merge**: it can conflict or pull in changes they didn't
  ask for — the customer decides, consistent with the agent-prepares /
  customer-decides posture. If they decline, proceed on the current
  checkout and note the preview may be stale.
- If up to date (or a merge would conflict) → say so and continue; don't
  force it.

Then run `npm run dev` with the environment from B.9. Wait for both the
AEM dev server and the Cloudflare worker dev server to report ready (watch
for the script's own "Ready on http://localhost:{port}" line). Open the
**worker** port in the browser (not the aem-up port) — that's the one
that serves `/api/*`.

Once up, verify, in order:

1. **The server is serving this repo's own local files**, not a stale or
   unrelated cached directory — confirm a distinctive string from a
   local file actually appears in the served output.
2. Auth behavior matches the chosen tier: `"local-no-login"` should let
   you reach the app as the fake dev user with no login prompt;
   `"local-login"` should redirect to Microsoft sign-in.
3. A real search request returns results sourced from the customer's own
   Content Hub environment, and at least one asset thumbnail renders.

If search fails, check in order: wrong/missing
`SPARK_DM_CLIENT_ID`/`SECRET`, wrong `AEM_ENV_ID`, or the Content Hub
technical account lacking access to that delivery environment.

Mark step `done` once verified. Per I4, if the customer only wanted a
local run, set `phases["backend-onboarding"].status` to `"done"`. Offer
the deploy stage below only if they want it; never force it.

---

# Phase B — deploy stage (deploy-only, opt-in)

**Only for a customer who wants to deploy**, offered *after* a tier is
running locally, never as a prerequisite. Per I4, a local-only customer
leaves every deploy step `pending` — a valid end state — and never enters
this stage.

When the customer opts into deploying, follow **`deploy.md`** (companion
file in this skill directory): steps D.1–D.8 — bypass gate, Cloudflare
intake file, repo identity rename, remote secrets, remote D1 migration,
CI token, deploy via merge, and later-updates. Throughout, the agent only
*prepares*; the **customer performs** every step that handles a real
secret, runs under their own Cloudflare/GitHub session, or mutates
production — the agent never deploys, pushes, or merges their `main`
itself. Return here for the completion report when done.

## Phase B completion report

Summarize plainly: the tier that's running and verified; for a deploy,
every identity value renamed and where, and that the auth bypass is
re-commented; the true auth state; the known PDF-preview gap
(`adobe-pdf-viewer.js`); any intake fields left blank; the update paths
from D.8; and the state/intake file locations.
