---
name: customer-migration
description: Full customer migration for a forked Assets Hub Spark repo — rebrand the site's design/content via Catalyst, get the backend (Cloudflare, Content Hub, local dev) running, then populate the site with the customer's own assets and make them searchable/filterable. Use when a customer forks this repo and asks to rebrand/restyle the site, or asks to get the portal/site running locally, or asks to populate/bring in the customer's assets, fill the portal with their content, tag their assets, or make the assets searchable, or asks for a full migration/onboarding — any of these trigger the same one skill, run in order (rebrand first, backend second, assets third). Not for initial site migration into EDS (a different, prior step).
---

# Customer Migration

One skill, three phases: **Phase A — rebrand via Catalyst**, then **Phase B
— backend onboarding**, then **Phase C — asset population** (bring in the
customer's own assets and make them searchable). A full migration runs
A then B then C, but any can be skipped: the customer may only want the
rebrand, only want the backend running, only want their assets populated,
or have earlier phases already done. Start every invocation with
the entry flow below, which resolves what's wanted and what's already
done before touching any phase.

## Invariants (apply throughout — never restated per step)

These hold in all three phases. Steps below reference them rather than
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

Do this **before asking the customer anything or doing any rebrand work**.
The very first thing the customer sees is the entry question — never a
readiness note or setup mechanics. But the moment routing (step 3) resolves
to a rebrand (`intent` is `full` or `frontend-only`), the excat tool
pre-requisite (below) runs immediately, before A.1 and before anything else
in Phase A — it is a pre-requisite *of entering Phase A at all*, not a
mid-phase surprise.

1. **Load state.** If `.internal/onboarding-state.json` exists, read it.
   Before trusting a phase marked `done`, spot-check **one concrete fact**
   against the actual repo, not just the file — e.g. rebrand `done` →
   does `styles.css` actually contain the new brand's tokens; backend
   `done` → does `cloudflare/.secrets` actually exist. A state file can be
   stale or inherited from an unrelated branch/customer (this happened in
   a real prior session: a fork's state file still showed a previous,
   different customer's rebrand as `done`). If the spot-check disagrees
   with the file, say so plainly and treat that phase as needing
   confirmation, not as authoritative. Otherwise, resume at the first
   non-`done` step of any phase still in progress, and don't re-ask
   questions already answered under `customer`. If the file doesn't
   exist, create it with the schema below.

2. **Ask two things in the same turn, in this order.**

   **First, and always explicitly** — this decides which backend
   everything downstream uses, so it leads:

   > "Is this going to become [customer]'s own real portal — the one
   > they'll actually run and manage going forward, with their own
   > content environment set up specifically for them — or is this so
   > we can show them a demo of what a rebrand would look like, using
   > the environment we already use for these previews?"

   The concrete, technical difference this question is resolving —
   state it plainly if the customer asks "what's the difference" or
   seems unsure, but don't over-explain unprompted:
   - **"Real portal"** → a brand-new, dedicated AEM content environment
     (a new AEM Program+Environment, new Content Hub credentials) is
     provisioned specifically for this customer. Nothing is shared with
     any other customer or demo. This is what an actual customer
     migration requires — their assets, their content, their environment.
   - **"Demo"** → this fork reuses the same AEM content environment
     already used for other demo previews. Nothing new is provisioned;
     it's for showing what the rebrand looks like, not for the customer's
     real content going forward.

   Map straight to `customer.deployTarget`: "real portal" → `"dedicated"`,
   "demo" → `"shared"`. Never frame this as a speed/effort tradeoff
   ("faster" vs "takes longer") — that biases the answer toward whichever
   sounds easier instead of reflecting what they actually need.

   Never skip this on a keyword match, even an apparently unambiguous
   one — the word "migrate" alone is not reliable (a real prior session
   had a customer ask to "migrate this portal" while actually meaning a
   demo). If the answer is still vague after asking ("whatever's
   easiest," "just get it going"), don't guess silently: state a default
   out loud and let them correct it — *"I'll treat this as a demo for
   now — say the word if it's actually their real portal"* — then
   proceed with `deployTarget = "shared"` as a stated, correctable
   assumption, not a silent guess.

   **Second** (unless the request already makes it unambiguous — e.g.
   "just get it running" is backend-only). Ask in plain outcome language
   — **no internal terms** (I1): never the word "rebrand," "scope,"
   "phase," "frontend," or "backend" in anything the customer sees,
   including a picker's header and option labels. In conversation,
   wording like:

   > "Want me to give the site a fresh look and update its content for
   > the new brand, or is that already done? Either way, I'll then get
   > it running for you — and fill it with your own assets so they're
   > easy to find by searching and filtering on what's in each one."

   If you render this as a multiple-choice picker, use a plain header
   ("Getting started" / "What should I do") and only offer choices that
   make sense given what you already know from the state file — don't
   blindly present "already done" options on a genuinely first-ever
   request, since a customer asking for the first time has no "already
   done" state to report; that's nonsensical to ask them. Each option
   states a concrete, checkable end result — something the customer
   could verify by looking at it, never a vague state like "fully
   working," and never phrased as an apology/disclaimer ("I won't set up
   ... yet").

   **On a fresh request** (no prior state, or `rebrand.status` is not yet
   `done`), offer only:

   - "Give it Disney's look and content, get it up and running so you
     can open it and click through it, and load in Disney's own assets
     so they're searchable" (full)
   - "Just give it Disney's look and content for now — I'll get it
     running and load Disney's assets in a later step" (frontend-only)
   - "Something else" (free text)

   **The "get it up and running" phrase means something different
   depending on `deployTarget`** — say the right one, don't reuse the
   same words for both:

   - **`"shared"` (demo)**: "get it up and running" = merge the rebrand
     into the existing shared preview environment, which is already
     deployed and live — nothing to set up, no local step at all. Once
     merged, it's simply visible there.
   - **`"dedicated"` (real portal)**: "get it up and running" = get it
     working on your own machine first so you (or the customer) can
     verify it before it goes live, then walk through setting up their
     real environment so it can actually go live. Do **not** say or imply
     it'll be "live"/"deployed" immediately — going live is a distinct,
     later step (real sign-in setup + merge, `deploy.md` D.6.5/D.7) that
     the customer explicitly decides to do when ready, not an automatic
     consequence of this choice.

   **On a resumed request** where the state file already shows
   `rebrand.status: done` (verified via the spot-check in entry step 1,
   not just trusted blindly), instead offer:

   - "Get it up and running so you can open it and click through it,
     then load in Disney's own assets so they're searchable" (backend-only)
   - "Just get it up and running so you can open it and click through
     it — I'll load Disney's assets in a later step" (backend-only,
     defer assets)
   - "Just load in Disney's own assets so they're searchable — it's
     already up and running" (assets-only)
   - "Something else" (free text)

   The same `deployTarget`-dependent meaning of "get it up and running"
   above applies here too.

   Do **not** label options "Rebrand scope," "Rebrand only," "Already
   rebranded," "boot locally," "get it running" alone with no outcome
   attached, or any other internal step/phase name — every option must
   state what the customer will concretely be able to do or see
   afterward, with no follow-up question needed to decode it, and never
   read like a disclaimer about what won't happen.

   Map the answer to `intent` and the phase statuses:
   - new look + running / yes → `intent` = `full`, rebrand runs; Phase A
     → B → C all run.
   - already done / skip that / just get it running → mark the rebrand
     phase `done` (`intent` = `backend-only`), skip Phase A; B → C run.
   - new look only, nothing else → `intent` = `frontend-only`; mark
     backend and asset-population `not-requested` after Phase A.
   - just populate/bring in the assets, make them searchable, fill the
     portal with their content (rebrand + backend already done) →
     `intent` = `assets-only`; route straight to Phase C. Its early
     steps (C.1–C.2) re-derive the customer key and credentials from the
     repo/state at run time, so entering C directly is safe (same pattern
     as Phase B's B.1–B.4). If C finds no Content Hub creds or `aemEnvId`,
     it drops into B.7 to collect them first, then continues.

3. **Route** to the first genuinely-pending phase — rebrand before
   backend before asset-population when more than one is pending.
   Entering Phase B or Phase C directly is safe: their early steps
   (B.1–B.4 / C.1–C.2) re-derive everything they need from the repo at
   run time, independent of whether earlier phases ran.

## Shared state file

All three phases read and write the same `.internal/onboarding-state.json`
(gitignored via the existing `.internal` entry — do not add a new ignore
rule). It is the resumability mechanism (see entry flow, step 1) and the
record of what the customer asked for.

`intent` records the customer's answer to the entry question
(`full` / `frontend-only` / `backend-only` / `assets-only`); it's
revisitable — a customer who chose `backend-only` can ask for the rebrand
or asset population later. A
phase's `status` may be `in_progress`, `done`, or `not-requested`
(the customer explicitly didn't want it — a valid end state, distinct
from an unfinished `in_progress`).

`customer.deployTarget` (`null` / `"shared"` / `"dedicated"`) records the
entry flow's other question — whether this is a demo (reuses the same
shared AEM environment and Cloudflare account already used for other
demos) or the customer's own real, separate portal (its own AEM
environment and Cloudflare account, fully provisioned). Set once at
entry (see entry flow step 2), read by B.7 (which credentials to
collect), Phase C (which environment assets land in), and the deploy
stage (which of the two paths applies) — never re-derived or re-asked
downstream. Revisitable the same way `intent` is: if the customer
corrects it later, update it and re-evaluate any step that already ran
under the old value.

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
    "authBypassActive": null,
    "deployTarget": null
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
        "real-auth-configured": "pending",
        "deployed-via-merge": "pending"
      }
    },
    "asset-population": {
      "status": "in_progress",
      "lastUpdated": null,
      "lane": null,
      "customerKey": null,
      "assetSourceUrl": null,
      "steps": {
        "customer-key-resolved": "pending",
        "author-access-verified": "pending",
        "assets-resolved": "pending",
        "metadata-generated": "pending",
        "metadata-written": "pending",
        "assets-published": "pending",
        "scope-config-written": "pending",
        "scope-applied-locally": "pending",
        "search-scope-verified": "pending",
        "scope-deployed": "not-requested"
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

For `deployTarget == "shared"` (demo): B.5 skips straight to marking
every run-tier step (`tier-selected` through `boot-verified`)
`"not-requested"` and the phase `"done"` — there is no local run to do,
so these are not left `pending`/unfinished, they were never applicable.
`scopeChoice` stays `null` in this case (see below). Deploy-only steps
stay `pending`/`not-requested` too unless the customer separately asks
to deploy the demo (rare).

For `deployTarget == "dedicated"` (real migration): B.5 sets
`scopeChoice` to `"local-no-login"` directly, without asking — it's the
only valid tier for a real migration, so this is not a customer choice
to record as "revisitable" in the usual sense. `real-auth-configured`
(new, set by `deploy.md` D.6.5) is dedicated-only and always `pending`
until deploy time — for `"shared"` it stays `pending` too but is simply
never reached, since deploy for a demo doesn't need real auth.

`backend-onboarding.scopeChoice`
(`null` / `"preview"` / `"local-no-login"` / `"local-login"`) is
revisitable mutable state, not a completion marker — a customer can pick
`"preview"` now and ask for more later. It lives alongside `status`, not
inside `steps`. See B.5 for its use. Internal only (I1). It stays `null`
for a `"shared"` customer, since a demo never picks a local-run tier at
all.

The `asset-population` steps also split along two axes:

- **Local steps** (`customer-key-resolved` through
  `search-scope-verified`) — bringing in / labelling the customer's
  assets and scoping the *local* portal to them. These are the whole
  outcome for a local demo (no deploy needed — see Phase C).
- **Deploy-only step** (`scope-deployed`) — only relevant if the customer
  wants the scoped demo on a hosted URL; it defaults to `not-requested`
  (I4) and only becomes active via Phase B's opt-in deploy stage.

`asset-population.lane` (`null` / `"enrich-existing"` / `"bring-in"`)
records which discovery path ran; `customerKey` is the slug of
`customer.name`; `assetSourceUrl` is set only for the bring-in (website)
path. All three live alongside `status`, not inside `steps`. Internal
only (I1). Set `phases["asset-population"].status` to `"done"` once the
local steps for the chosen lane are done.

## Companion file: customer-config intake (Phase B only)

`.internal/customer-config.json` (also gitignored, same convention) holds
non-secret Cloudflare identity/resource values the customer must look up
themselves. Generated in the deploy stage (`deploy.md`, step D.2), and
only when the customer actually wants to deploy — not needed to run
locally. Not used by Phase A.

---

# Phase A — Rebrand via Catalyst

**Precondition — this tool check is a pre-requisite of Phase A, run
immediately by the entry flow the instant routing resolves to a rebrand
(`intent` = `full` or `frontend-only`) — never deep inside A.1, and never
discovered only after A.2 tries to invoke the skill and fails.** If
`intent` is still `null`, the entry question hasn't been answered yet — do
that first (entry flow step 2), then come straight here before anything
else in Phase A.

Rebrand the site's design/content to a new brand identity. The design/CSS
migration is done by the **Catalyst (excat) design skill**, not by hand —
design tokens, asset colors, content register rewrite, and publish all
work independently of whether the fork's backend is set up yet. Do not
defer this phase waiting on Phase B — it doesn't need it.

**Required tool.** This phase drives the excat design skill
**`excat-complete-design-expert`**, shipped from the `excat-marketplace`
(source: the Adobe Experience Catalyst `aem-excat-plugin` repo's
`excat-marketplace` directory) as the `excat` plugin. Don't assume it's
missing and don't assume it's present — determine actual state with the
live CLI, never with a cached/static config file, since that can be stale
relative to a session that already fixed it, or relative to a *different*
CLI's config entirely (Claude Code and Copilot CLI each keep their own,
separate plugin registrations — a plugin enabled in one is invisible to
the other).

The plugin/marketplace mechanics below are **operator-facing** setup,
addressed to whoever runs this session — not customer-facing prose. I1
still forbids naming `excat`/the plugin in anything an end customer reads
(the entry question, run-tier choices, completion reports). Never let this
tooling handoff bleed into a customer-facing message.

**Detect which CLI is running this session** (its command name — `claude`
or `copilot` — determines which commands below to use; do not run both
commands for state that's foreign to the CLI in use, since it will report
a false "not found").

1. **Skill invokable now** — `excat-complete-design-expert` already
   appears in this session's available-skills list (check with
   `copilot skill list` or `claude plugin list` per the active CLI,
   looking for it enabled/loaded). → Proceed; A.2 invokes it in Complete
   Migration mode.

2. **Marketplace not registered for this CLI.** Check with
   `copilot plugin marketplace list` / `claude plugin marketplace list`.
   If `excat-marketplace` is absent, this CLI has simply never been told
   about it — it may well be fully set up in the *other* CLI already,
   which does not carry over. → Ask the operator once, in one sentence,
   for permission to register it and install (state the marketplace path
   you'll use — the local `aem-excat-plugin/excat-marketplace` directory,
   or its git remote if the local path isn't present on this machine).
   On yes, if you have shell access to run commands yourself, run them;
   if you don't (or the run fails/needs interactive confirmation), print
   the **exact commands for the operator's actual CLI** — never a
   generic "run /plugin install" — as two literal, copy-pasteable lines:
   - Copilot CLI:
     `copilot plugin marketplace add <path-or-repo-of-excat-marketplace>`
     `copilot plugin install excat@excat-marketplace`
   - Claude Code:
     `claude plugin marketplace add <path-or-repo-of-excat-marketplace>`
     `claude plugin install excat@excat-marketplace`
   (then continue to state 3 for Claude Code to confirm/enable for this
   project — Copilot CLI has no separate step).
   Either way — whether you ran it or the operator did — re-check
   afterward (`copilot skill list` / `claude plugin list`) that the skill
   now actually loaded; an install can still require a restart, in which
   case say so plainly and wait; don't assume it's live yet.

3. **Installed but not enabled for this project** (Claude Code only —
   Copilot CLI has no separate per-project enable step once installed).
   `claude plugin list` shows `excat@excat-marketplace` installed but not
   enabled for this project/scope. → Ask the operator once for
   permission. If you have shell access, run
   `claude plugin enable excat@excat-marketplace --project` (or the
   matching scope flag) yourself; otherwise give them that exact command
   to run. Either way, re-verify with `claude plugin list` afterward. If
   a restart is required for the skill to load, say so and wait.

In all cases, **never hand-roll the rebrand instead of fixing the tool** —
editing `styles.css` / sweeping hex manually is not a substitute for this
skill and silently misses the content rewrite and asset-color sweep. If
the operator declines permission to install/enable, mark the rebrand phase
`blocked`, tell them exactly which state they're in and the one command
needed, and pause Phase A until it's resolved — don't guess or proceed
without the skill.

This phase is more than tokens: the content-register rewrite and the
hardcoded-asset-color sweep (A.3) are this phase's own job, wrapped around
the excat skill in one larger request (A.2).

## A.1: Pre-requisites

Do these before touching any file. Ask the customer directly — these
cannot be discovered mid-task without risking a stalled rebrand.

### A.1.a: Content-authoring access (`permissions-checked`, `token.env`)

The only access setup needed for this phase is a gitignored `token.env`
file at the repo root with exactly two lines, `KEY=value` format, no
quotes:

- **`DA_TOKEN`** — lets this session read/write Document Authoring
  content for the rebrand's content-register rewrite and publish.
- **`HLX_ADMIN_TOKEN`** — lets this session call Helix Admin (preview,
  publish, status).

Ask the customer to create this file and fill in both values themselves
(I2 — never accept either token typed into chat; read them from the file
at call time only). Confirm `token.env` is gitignored — if `.gitignore`
has no `token.env` entry, add one, don't rely on another pattern covering
it.

Never tell the customer to look for a "Settings → LLM Permissions" screen
or any in-product admin-access toggle — no such setting exists for this
flow. There is no web app or Settings panel in any real invocation of
this skill; it always runs as a CLI operating directly on a locally
cloned repo. These two tokens are the entire access requirement.

**How the customer actually gets each value** (give them these exact
steps if they ask "how do I get one" — don't just name the env var and
leave them to figure it out):

- **`DA_TOKEN`** (Document Authoring / Adobe IMS access token):
  1. Sign in at `https://da.live` with the Adobe account that has access
     to this project's DA content.
  2. Open browser DevTools → Application/Storage → Local Storage →
     `https://da.live`, and copy the value of the IMS access token
     stored there (commonly under a key containing `accessToken` /
     `access_token`) — this is what the DA admin API accepts as the
     bearer token.
  3. This token is short-lived (session-based) — if calls start
     returning `401`, it likely expired; have them re-open da.live,
     re-authenticate, and grab a fresh value.
  (If a technical/OAuth Server-to-Server integration is set up in Adobe
  Developer Console for automation instead of a human login, the IMS
  `access_token` from that flow can be used instead — but for a single
  rebrand session, the da.live browser-session token above is the
  simpler path most customers can do themselves.)

- **`HLX_ADMIN_TOKEN`** (Helix/EDS Admin API key — NOT the same as a
  `.aem.page`/`.aem.live` site-access token):
  1. Determine `{org}` and `{site}` from the project's Helix URL, shaped
     `https://main--{site}--{org}.aem.page`: `{org}` is the last
     hostname segment, `{site}` is the middle segment (e.g. for
     `https://main--myportal--acme.aem.page`, `org=acme`,
     `site=myportal`). These usually match the GitHub org/repo.
  2. Sign in at `https://admin.hlx.page/login/{org}/{site}/main` with an
     Adobe account that has admin/config_admin rights on that org/site.
  3. In DevTools → Application → Cookies for `admin.hlx.page`, copy the
     `auth_token` cookie value — a temporary admin session token.
  4. Use that session token to mint a real, reusable API key:
     ```
     curl -s -X POST \
       -H "x-auth-token: <auth_token from step 3>" \
       -H "Content-Type: application/json" \
       -d '{ "description": "customer-migration rebrand", "roles": ["admin"] }' \
       https://admin.hlx.page/config/{org}/sites/{site}/apiKeys.json
     ```
     The `value` field in the response is the real API key — that's
     `HLX_ADMIN_TOKEN`. It's shown once; have them save it into
     `token.env` immediately.

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

**Derive the DA source and Helix URLs, never guess or trust stale docs.**
`README.md` can be wrong (it may still show the upstream template's own
org/repo rather than this fork's) and there may be no `fstab.yaml` in the
repo — neither of those is grounds to conclude "there's no content to
rewrite." Instead:

1. Get the fork's real org/repo the same way B.2 does:
   `git remote get-url origin`, parsed as `{org}/{repo}`.
2. Build the DA source directly: `https://da.live/#/{org}/{repo}`.
3. Build the Helix preview/live URLs the same way B.4 does:
   `https://{branch}--{repo}--{org}.aem.page` /
   `https://main--{repo}--{org}.aem.live`.
4. Actually probe the DA source (e.g. `GET
   https://admin.da.live/list/{org}/{repo}`) before concluding there's no
   content register. Only treat it as "nothing to rewrite" on a genuine
   empty/404 result from this probe — never on the absence of a config
   file or on not immediately finding brand copy in the repo's own files.

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

Run this as a **fixed checklist, not an ad hoc grep** — a manual
grep-and-eyeball pass has, in practice, missed real misses (a leftover
old-brand CSS class selector, and a linter auto-fix silently riding along
in the same diff). Every item below is mandatory, and the whole checklist
runs **twice**: once right after A.2 step 1–2's edits, and again after
merge, against the live site — not just once, and not just against the
local working tree.

1. **Build the old→new hex map** from A.2 step 1's token diff — every
   color value that changed, old and new side by side.
2. **Grep every value in that map**, case-insensitive, across every
   `*.svg`, `*.css`, and `*.scss` file in the repo — report *every* hit,
   not a sample. Check icon SVGs for `fill="#..."` /
   `background-image` assets for embedded raster art / hardcoded panel
   colors, per the map, not just visually.
3. **Grep the old brand's name itself** across CSS/SCSS selector names
   (class/id selectors specifically, not prose) — this is what catches a
   miss like a renamed icon file whose CSS class (e.g.
   `.icon-<oldbrand>-mark`) still carries the old name.
4. **Diff every file touched in A.2** against its pre-A.2 version and
   flag any changed line **not** explained by the intended token/color/
   name swap — this is what catches an unrelated linter auto-fix (e.g. a
   hex-length shorthand) silently riding along in the same commit.

Not every hardcoded fill is wrong (a neutral icon that turns
brand-colored on hover is legitimate) — screenshot the pages to confirm a
flagged file actually reads off-brand before "fixing" it.

Report any real misses found, fix them, and re-run the full checklist
(both passes) clean before considering Phase A complete. Set
`phases["rebrand"].status` to `"done"`.

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
  `null` (see the schema note in "Shared state file" for why). Do not
  ask the customer anything else about running it — proceed straight to
  the Phase B completion report, or to Phase C if asset population was
  also requested.
- **`"dedicated"` (real portal)** — skip the three-way menu below
  entirely. There is only one valid local-setup tier for a real
  migration: `"local-no-login"` (real search/assets against the
  customer's real, dedicated Content Hub credentials, deliberately
  without setting up real sign-in yet). Set `scopeChoice` to
  `"local-no-login"` directly — do not ask the customer to choose;
  proceed straight to the `"local-no-login"` branch below. Real sign-in
  (Entra) setup is deferred to the deploy stage (see `deploy.md`'s D.6.5)
  — it never appears as a local-run choice for a dedicated customer.

The three-way menu below is now unreachable in normal operation — every
customer's `deployTarget` is resolved before B.5 runs (entry flow step
2). It's kept only as a **compatibility fallback**, if `deployTarget` is
somehow still `null` here (should not happen in a normal session):

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

**Fallback-path option only** — never reachable for a normal dedicated
customer under the branch above, since that branch always resolves to
`"local-no-login"` directly. Proceed: B.7 (Content Hub creds) → B.9 (real
Entra, bypass left off) → B.11 (boot & verify). Same skip of the deploy
stage.

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

**First, branch on `customer.deployTarget`** (set at entry, step 2 — never
re-ask it here):

- **`"shared"` (demo)** — skip the rest of this step's collection
  entirely. Confirm the values already present in `cloudflare/.secrets`
  and `customer.aemEnvId` (the same shared environment other demo forks
  already use) still work — a quick probe (C.2's read check is enough,
  called early) rather than a fresh ask. Mark step `done` once confirmed.
- **`"dedicated"` (real portal)** — proceed with the rest of this step
  exactly as below: real, new credentials for this customer's own
  environment.

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

**Note:** under the normal branch resolved in B.5, `scopeChoice` is
always `"local-no-login"` for a dedicated customer — the `"local-login"`
case below is a fallback-menu-only path (see B.5) and shouldn't occur in
practice. Real Microsoft/Entra sign-in for a dedicated customer is set up
later, at deploy time (`deploy.md` D.6.5), not here.

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

---

# Phase C — Asset population (make the customer's assets searchable)

The final phase makes the demo coherent: after the site looks like the
customer (A) and is running (B), fill it with the customer's **own
assets** and make them **findable** — searchable by what's written about
each asset and filterable by facets like Category, Campaign, Channel and
Keywords — and scope the portal so it shows **only** this customer's
assets. Two lanes:

- **Enrich-existing (default)** — the customer's assets are already sitting
  in their AEM folder (from an earlier migration or manual load); this lane
  labels them so they surface in search and facets.
- **Bring-in (opt-in cherry)** — the customer named a source website; this
  lane pulls sample images from it into the folder first, then labels them
  the same way.

Customer-facing wording stays outcomes-only (I1) — never "enrich,"
"metadata," "scope," "facet," "company field," or "Phase C." Speak of
"bringing in <customer>'s assets and making them easy to find — searching
and filtering by what's in each image."

## Preconditions — runs after B.7

Phase C needs a working backend context, so it is offered after the
run-tier steps and **hard-requires B.7** (Content Hub creds in
`cloudflare/.secrets` + `customer.aemEnvId`). If a Phase-C-only invocation
finds no DM creds or no `aemEnvId`, drop into **B.7** to collect them
first (don't re-implement collection), then return here. Everything else
Phase C needs is reused from A/B — it asks for **nothing new**:

| Phase C needs | Source | New ask? |
|---|---|---|
| `customerKey` (folder + scope value) | `customer.name` (A.1.c), slugified | No |
| author token creds | `SPARK_DM_CLIENT_ID/SECRET` in `cloudflare/.secrets` (B.7) → binding `DM_CLIENT_ID/SECRET` | No |
| `aemEnvId` | `customer.aemEnvId` (B.7) | No |
| DAM folder `/content/dam/<customerKey>` | convention; bring-in auto-creates it | No |
| source website URL | operator, **only** for the bring-in cherry | Only for cherry |
| scope value (`DEMO_COMPANY`) | = `customerKey` (this phase writes it) | No |

## C.1: Resolve the customer key (`customer-key-resolved`)

Read `customer.name` from state (set in A.1.c) and slugify it (e.g.
Santander → `santander`). This single key drives **both** the folder
`/content/dam/<customerKey>` and the `company` scope value — they are the
same value by construction. Record it in
`asset-population.customerKey`. If `customer.name` is absent (a
Phase-C-only invocation with no prior state), ask the customer which
brand these assets are for — in plain words — and set both `customer.name`
and the key.

## C.2: Verify author access (`author-access-verified`)

Confirm the DM creds from B.7 actually reach the author APIs before doing
per-asset work: acquire a token and make one read probe. Never read the
secret values in chat (I2) — the agent script reads them from the
gitignored file at call time. If the probe fails, the likely cause is the
same short list as B.11 search failures (wrong/missing
`SPARK_DM_CLIENT_ID/SECRET`, wrong `aemEnvId`, or the technical account
lacking access). This step also closes the startup checks the script
performs (host/header + approval-key acceptance + folder search).

## C.3: Resolve the asset set (`assets-resolved`)

- **Enrich-existing lane:** the script enumerates
  `/content/dam/<customerKey>`. If it finds assets, that's the set
  (`lane = "enrich-existing"`). If it finds **none**, the folder is empty
  or absent — operationally identical: *nothing to enrich.* Tell the
  customer plainly and offer to bring assets in from their website
  instead; don't silently succeed.
- **Bring-in lane (cherry):** when the customer named a source website,
  set `assetSourceUrl`, `lane = "bring-in"`, and the script pulls sample
  images from it into the folder (auto-creating the folder), then treats
  the new assets as the set. This lane may delegate the scrape to the
  `scrape-webpage` skill for the source page.

## C.4–C.6: Label, save and publish

The script does the heavy lifting per asset (bounded concurrency,
idempotent — re-runs skip already-labelled assets unless forced):

- **`metadata-generated`** — for each asset it looks at a small preview of
  the image and produces a title, description, keywords and — where it can
  tell — a category, campaign and channel, normalised to the facets the
  portal already shows. It also stamps the customer scope value and marks
  each asset approved so it's demo-ready.
- **`metadata-written`** — saves those onto the assets (bulk where
  possible, per-asset otherwise), retrying safely on conflicts.
- **`assets-published`** — publishes the assets in batches so they appear
  in the portal's search index.

Run the script in **dry-run first** for review, then live. It returns a
per-asset report (labelled / skipped / failed) that these steps record.

## C.7: Scope the portal to this customer (`scope-config-written`,
`scope-applied-locally`)

So the demo shows **only** this customer's assets, set the scope value
once in local config: `config.DEMO_COMPANY = '<customerKey>'` in
`cloudflare/src/config.js` (default `null` = unchanged upstream
behaviour). The worker reads it at runtime and injects a
`company = <customerKey>` filter into every search — exactly "hard-code
customer = X in the query." This is a **local edit**: it takes effect on
the next `npm run dev` restart (miniflare simulates the binding — the same
basis on which Phase B treats placeholder `wrangler.toml` ids as fine for
local dev). Restart to apply.

**No deployment is required for the demo.** The label-and-publish work
calls AEM APIs directly (nothing to do with Cloudflare), and the scope
change is a local config edit applied by a local restart — no merge, no
CI, no `wrangler deploy`. `scope-deployed` stays `not-requested` (I4)
unless the customer explicitly wants the scoped demo on a **hosted**
`.aem.live` URL — then it follows Phase B's opt-in deploy stage
(`deploy.md`), live on merge (I3).

## C.8: Verify (`search-scope-verified`)

In the running portal confirm the outcome: searching words from an
asset's generated title/description returns it; the Category / Keywords /
Campaign / Channel facets show buckets and filter correctly; and only this
customer's assets appear. Mark the phase `done` once verified (I4: the
local outcome is a complete end state; a hosted deploy is optional extra).

## Delegation — the script does the API work

The steps above are thin orchestration; the author API calls live in the
agent controller **`scripts/agent/enrich-assets.js`** (run from the repo
root with Node ≥ 18). The skill invokes it, passing the resolved key and
letting it read creds from the gitignored file at call time:

```
node scripts/agent/enrich-assets.js \
  --customer-key <customerKey> \
  [--dam-path /content/dam/<customerKey>] \
  [--bring-in --source-url <url>] \
  [--dry-run] [--force] [--no-publish] \
  [--secrets-file cloudflare/.secrets]
```

- Default lane is enrich-existing; `--bring-in --source-url <url>` selects
  the cherry lane. `--dry-run` performs enumerate→read→generate→normalize
  and emits the intended writes **without** writing or publishing — always
  do this first. `--force` re-labels already-labelled assets;
  `--no-publish` stops before publish. Creds resolve from env →
  `cloudflare/.secrets` (B.7) → root `secret.env`; **no new secret**.
- See `scripts/agent/README.md` for the full flag list, the offline
  `--fixture` mode, and the report format.

## Phase C completion report (outcomes-only)

Summarize plainly: which of the customer's assets are now in the portal
and searchable; that filtering by what's in each image works (name the
facets that lit up); that the local demo shows only this customer's
assets; and any per-asset items that couldn't be brought in or labelled.

**Always ask, plainly, whether they want this at a real address they can
share now** — never only if the customer happens to ask first. Something
like: "Want me to put this on a real link you can send people, instead of
just running here?" If yes, this routes into the deploy stage
(`deploy.md`), which reads the already-recorded `customer.deployTarget`
and proceeds on the matching path without asking again. If they say no,
that's a valid, complete end state (I4) — don't push further. Never
surface internal terms (I1) or secret values (I2).
