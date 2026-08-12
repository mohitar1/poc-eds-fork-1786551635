# Rebrand (Phase A): design plan

This document is the design plan behind **Phase A** of
`.claude/skills/customer-migration/SKILL.md`. It records the reasoning and
evidence that shaped that phase, so future changes can be checked against
the same reasoning rather than re-derived from scratch. (Phase A and the
backend-onboarding Phase B were originally two separate skills,
`catalyst-rebrand` and `onboard-customer-portal`; they were merged into
the single `customer-migration` skill — this doc covers the rebrand half.)

## Context

Rebranding an already-migrated EDS site to a new brand identity via
Catalyst, the editor customers use to edit this repo's content. It is
deliberately independent of the backend/Cloudflare/AEM identity work,
which is Phase B (see `local-run-plan.md` and `deploy-plan.md`). The entry
flow that decides whether this phase runs at all — including the "the
rebrand is already done, skip it" path — is documented in
`entry-flow-plan.md`.

## How the plan got here

An early draft designed a much larger skill — nine separate steps, each
reimplementing something (permission-checking, publish-verification,
asset-sweeping, PR mechanics) as new logic, on the theory that a real
manual branding session (rebranding a demo coffee-brand portal to a bank
brand) had shown Catalyst couldn't be trusted to do these things
correctly.

Reading that session's transcript in full, starting from its actual first
line, disproved that theory. The session's initial prompt was one
sentence: "Update my current EDS site with styles of [a reference site]."
That request only asked for design tokens. The design-tokens skill's own
documented trigger matches exactly that kind of request. Every later miss
in the transcript — content copy left unchanged, hardcoded background
images and icon colors left unchanged, permission surprises, PR mechanics
dropping commits — is consistent with the tooling doing precisely what it
was asked, narrowly, one thing at a time, because nothing ever asked for
the full scope up front.

That reframes the job: not "add steps that compensate for what Catalyst
can't do," but "ask for the whole thing in one clear request, since the
evidence shows it can do almost all of this correctly when asked plainly,
plus one narrow check for the one thing that's a genuine tool limitation."

## The three phases

### Phase 1 — Pre-requisites

Collected directly, before any file is touched, because none of it can be
discovered safely mid-task:

- **Two real permission toggles**, not three. The transcript reads as if
  AEM/Helix admin access and Document Authoring access were separately
  gated, discovered by trial and error across several 401s. Checking the
  platform's actual permission-settings code showed only two toggles
  exist: one covering AEM/Helix admin plus, via the same login session,
  Document Authoring; and a separate one for git push. The transcript's
  DA-specific 401s were session-propagation delay, not a missing third
  toggle. Also stated as a hard rule: never accept a pasted token in chat;
  if one appears anyway, treat it as compromised and tell the user to
  revoke it — the transcript shows this exact scenario happening once,
  handled correctly in the moment, but worth stating explicitly rather
  than trusting it to be handled well every time.
- **Content-source context**, stated once: local preview files in the
  workspace have zero effect on the hosted site; the real source of truth
  is the Document Authoring document. The transcript shows real confusion
  over this ("why doesn't editing this file change anything?") that a
  single upfront sentence prevents.
- **Brand inputs, with the full scope confirmed explicitly.** New brand
  name, a source site if one exists, and — critically — a direct question
  confirming the customer wants design tokens *and* hardcoded asset colors
  *and* content rewritten to the new brand's actual business *and*
  publishing *and* landing the change via git, rather than defaulting to
  a narrow "update the styles" scope. This single question is the fix for
  the transcript's biggest miss: a first pass that swapped the brand name
  everywhere but left all the surrounding copy describing the old
  business.

### Phase 2 — One comprehensive delegation request

Not a sequence of separate asks — one request stating every piece of
scope so the platform's own skill-selection handles it correctly in a
single pass:

1. Design tokens and typography, via the excat design skill
   `excat-complete-design-expert` (plugin `excat@excat-marketplace`, from
   `aem-excat-plugin`), in its Complete Migration mode — not hand-edited
   `styles.css`. Phase A gates on this skill being *invokable* and
   distinguishes three states, because "installed globally" ≠ "enabled for
   this project": (a) skill in the session list → proceed; (b) plugin in
   `~/.claude/plugins/installed_plugins.json` but not enabled here → guide
   the operator to **enable** it via `/plugin` and restart, don't tell
   them to reinstall; (c) not installed → add the marketplace + install,
   then enable. In (b)/(c) the skill stops and blocks rather than
   improvising a manual rebrand. The earlier "just ask to install it"
   guidance was wrong for the common case (b): a live test showed excat
   v2.1.6 already installed at user scope but not enabled for the project,
   so the fix is enablement, not installation.
2. Hardcoded asset colors, named explicitly and separately from step 1 —
   icon SVGs and background images can carry literal color values that no
   CSS change reaches, and the transcript shows exactly this being missed
   repeatedly (a background image with an old-brand raster pattern baked
   in, several icons still carrying old-brand hex fills) because nothing
   ever asked for this check.
3. Content register rewrite — every page's actual copy rewritten to
   reflect the new brand's real subject matter, not just a name swap. The
   transcript needed an explicit user correction mid-session to get this
   right the first time; stating it upfront avoids the extra round trip.
4. Publishing through the real content-authoring upload/publish flow,
   trusting its result. Checking the platform's actual publish-job code
   showed it already polls the underlying job to real completion and
   returns confirmed per-path success/failure — not a bare "accepted"
   response. So there is nothing left to independently re-verify here, as
   long as the request tells the agent to use that flow and report its
   real result.
5. Landing the change as one combined commit → push → open-PR sequence,
   with all work finished and staged first. Checking the platform's real
   git-integration code showed its intended flow is exactly commit → push
   → create-PR, once, with no step for pushing further commits to an
   already-open PR. The transcript's dropped-commits bug happened because
   commits kept landing on a branch after a PR was already open, and a
   human merged before the last push's diff was recomputed — a timing
   problem that doesn't exist if the request enforces finishing all work
   before that sequence runs even once.

### Phase 3 — Exactly one post-hoc check

Only one thing is checked independently after the fact: an **asset-file
color sweep** — searching SVG and image files directly for hardcoded
color values still matching the old brand, since the platform's own
visual-comparison tooling only compares computed CSS style values, never
the actual contents of an image or SVG file. A background image whose
*file* still contains old-brand artwork would be reported as "matching"
by that tool as long as the file's reference (its URL) didn't change —
confirmed directly in that tool's own documented comparison logic. This is
the one thing in the whole investigation that turned out to be a genuine,
structural gap rather than something a clearer request already resolves,
so it's the only new verification logic this skill owns. A real
screenshot is taken alongside the sweep, since not every hardcoded color
value is actually wrong (a neutral icon color that turns brand-colored on
hover, for example, is a legitimate and intentional pattern) — the
screenshot is what turns a raw grep hit into a confirmed miss.

Everything else that an earlier draft planned to re-verify — publish
success, PR/merge correctness — was removed once reading the actual
platform code showed those are already handled correctly by the real
tools, provided Phase 2's request uses them as intended.

## Non-goals

Phase A does not touch Cloudflare/AEM identity or infrastructure config —
that is Phase B's job. The two phases are independent and cover different
concerns.

## Corrections after a live end-to-end test run

The design above was tested for real against a live repo/site. Two of its
assumptions turned out wrong — not implementation mistakes in that
session, but wrong premises baked into the skill itself. Both are
recorded here so they aren't silently reintroduced later.

### Correction 1: there is no Catalyst web session — ever

Phase 1's original design assumed the skill runs inside a Catalyst web
app with a Settings panel exposing `llm-admin-access`/`llm-git-access`
toggles. That assumption is simply wrong: every real invocation of this
skill is Claude Code CLI operating directly on a locally-cloned repo.
There is no web app, no Settings panel, no toggles, in any real usage —
not "not in this particular session," but structurally. The live test's
user response made this plain: asked to confirm the toggles, they
answered "What are these llm-admin-access and git-access? We have repo
locally."

The correct design isn't a fallback branch alongside the Catalyst-web
path — it's removing the Catalyst-web framing entirely and stating the
one real path: authentication is two manually-supplied tokens,
`DA_TOKEN` and `HLX_ADMIN_TOKEN`, in standard `KEY=value` shell format.
The live test also surfaced a real, non-obvious API detail worth
recording permanently: a preview/publish call to the Helix Admin API can
401 even with a fully valid DA token, because the Admin API's own
server-side fetch back to Document Authoring needs that token forwarded
via an `x-content-source-authorization` header — a different failure
mode from an invalid token, discovered only through several rounds of
trial and error in the test session.

### Correction 2: "publish is already fully verified" was true for content, false for code

The original Phase 3 design concluded that publish-verification and
PR-merge-verification could both be dropped, since the real backend
endpoints (bulk preview/publish job polling, combined commit-push-PR
flow) already handle them correctly. That conclusion was correct for
*content* and incomplete for *code* — it missed a distinction that
matters more than either verification step it removed.

Document Authoring content and repository code are two independent
systems with two independent activation triggers: publishing DA content
takes effect immediately, but code (CSS tokens, SVG assets, JS) only
takes effect once its branch is merged and the code-sync mechanism picks
up the change. In the live test, the agent completed every Phase 2 step,
ran the Phase 3 asset-color sweep, and declared the rebrand "complete and
live" — while its PR was still open. Every code change from steps 1-2
(the entire visual point of the rebrand) was invisible on the real site
at that exact moment, and the agent had no way to notice this from its
own checks; it only found out when the user reported the live site still
looked unbranded, a full turn after the false completion claim.

That same gap is also why the asset-color sweep looked incomplete on a
closer look — real off-palette misses turned up in files the sweep's
exact-hex-match approach hadn't caught, but those files were sitting on
the same unmerged branch the "complete and live" claim had already been
made against. The fix is not a smarter sweep; a better hex pattern only
relocates the next miss to a different value. The fix is gating
"complete" on the code actually being merged and live, so any real
verification (including a screenshot from the user) happens against what
they can actually see, before a completion claim is made — not after one
turns out to be false.

Phase 2 and Phase 3 were revised accordingly: Phase 2 now states the
content-vs-code distinction as a fact before any publish step, and notes
that CI failures should be checked against `main` before being treated as
self-caused (the live test did this correctly on its own initiative, and
it's now an explicit rule rather than something left to be reinvented).
Phase 3 no longer declares completion on a finished delegation request
alone — it requires confirming the PR is actually merged, and re-running
the asset-color sweep against the merged, live state rather than the
local working tree.
