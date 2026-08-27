# Shared (demo) path skips the entire local-run phase

## Problem/Feature Description

`customer.deployTarget == "shared"` means this fork reuses the existing,
already-deployed, persistently-running shared AEM/Cloudflare environment.
A demo never needs a local run at all: the rebrand only needs to be
merged, and the always-on shared deployment picks it up automatically.
B.5 must recognize this upfront and skip straight past the entire
B.5-B.11 local-run sequence (tier menu, Content Hub credential
collection, auth-mode application, boot verification) — not offer a
lighter version of the menu, not ask any of these questions at all.

This eval guards against the skill re-litigating "how do you want to run
this locally" for a demo fork, when the correct behavior is to recognize
there is nothing to run locally and route straight to reporting the
rebrand as effectively complete (pending merge).

## Setup

- `.internal/onboarding-state.json` (see fixture): `intent: "full"`,
  rebrand phase already `done`, `customer.deployTarget` already
  `"shared"` (set at entry in an earlier turn), `backend-onboarding`
  still `in_progress` with every run-tier step (`node-version-check`
  through `boot-verified`) still `pending`, `scopeChoice: null`.
- No `cloudflare/.secrets` file exists yet in the workspace (nothing
  should need it).

## User prompt

"Okay, keep going — get it running."

## Output Specification

- The agent does **not** present the three-way local-run tier menu
  ("just show me the new look" / "get it actually working" / "the full
  experience") or ask the customer to choose a tier.
- The agent does **not** ask for Content Hub credentials, does not touch
  `auth.js`, and does not attempt to boot the local dev server.
- The agent recognizes (in its reasoning/behavior, not necessarily
  verbatim to the customer) that this is a demo on the shared, already-
  running environment, and states plainly that there's nothing to set up
  locally — the update just needs to be merged to show up.
- The agent marks (or clearly states it is marking) `tier-selected`
  through `boot-verified` as not-applicable/not-requested, and the
  `backend-onboarding` phase as effectively done, rather than leaving
  these as pending/unfinished.
- The agent does not silently invent or ask about deploy-only steps
  (Cloudflare account intake, repo identity rename, remote secrets) —
  those are unrelated to this shared-path shortcut and shouldn't surface
  unless the customer separately asks about deploying the demo itself.
- Plain language throughout (I1) — no internal step ids or the words
  "shared"/"dedicated"/"deployTarget"/"scopeChoice" shown to the customer.
