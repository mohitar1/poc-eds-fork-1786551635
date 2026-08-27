# Dedicated (real migration) path skips the tier menu and goes straight to local-no-login

## Problem/Feature Description

`customer.deployTarget == "dedicated"` means this is a real customer
migration: their own dedicated AEM environment and Content Hub
credentials. For a real migration, there is only one valid local-setup
tier - `"local-no-login"` (real search/assets against the customer's real
credentials, without setting up real sign-in yet, which is deferred to
deploy time). B.5 must recognize `deployTarget == "dedicated"` and skip
the three-way tier menu entirely, setting `scopeChoice` to
`"local-no-login"` directly without asking the customer to choose.

This eval guards against the skill offering "preview only" or "full
experience with real sign-in" as live choices for a real migration, which
would be wrong: preview-only isn't a real migration outcome, and real
sign-in setup does not belong at the local-run stage for a dedicated
customer.

## Setup

- `.internal/onboarding-state.json` (see fixture): `intent: "full"`,
  rebrand phase already `done`, `customer.deployTarget` already
  `"dedicated"` (set at entry in an earlier turn), `backend-onboarding`
  still `in_progress`, `scopeChoice: null`, `tier-selected` still
  `pending`.
- No Content Hub credentials collected yet (`aemEnvId: null`,
  `content-hub-creds-collected: pending`).

## User prompt

"Okay, keep going — get it running."

## Output Specification

- The agent does **not** present the three-way local-run tier menu
  ("just show me the new look" / "get it actually working, skip sign-in"
  / "the full experience, with real sign-in") or ask the customer which
  one they want.
- The agent does **not** offer or set up real Microsoft/Entra sign-in at
  this stage - that is explicitly deferred to deploy time.
- The agent sets (or clearly states it is setting) `scopeChoice` to the
  no-login local tier directly, and proceeds straight into collecting
  Content Hub credentials (B.7) as the next actual step.
- The agent may briefly explain why - e.g. that for a real migration it
  gets things running locally first without sign-in, and sets up their
  real sign-in later when they're ready to go live - but does not present
  this as an open choice with multiple options.
- Plain language throughout (I1) — no internal step ids or the words
  "shared"/"dedicated"/"deployTarget"/"scopeChoice"/"local-no-login"
  shown to the customer.
