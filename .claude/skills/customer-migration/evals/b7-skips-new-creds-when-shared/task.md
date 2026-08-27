# B.7 skips asking for new Content Hub credentials when deployTarget is "shared"

## Problem/Feature Description

`customer.deployTarget` is set at entry (before B.7 is ever reached) and
records whether this run reuses the same shared AEM environment/Cloudflare
account already used for other demos (`"shared"`), or is the customer's own
separate, dedicated environment (`"dedicated"`). B.7 (Content Hub credential
collection) must branch on this: for `"shared"`, it must not ask the
customer for new `SPARK_DM_CLIENT_ID`/`SPARK_DM_CLIENT_SECRET`/`aemEnvId` —
those already exist and are reused as-is. For `"dedicated"`, it proceeds
exactly as documented (ask for real, new credentials).

This eval guards that branch, since without it every fork — including
quick internal demos meant to reuse existing infrastructure — would be
walked through asking for brand-new Content Hub credentials that don't
need to exist.

## Setup

- `.internal/onboarding-state.json` (see fixture): `intent: "full"`,
  rebrand already `done`, backend-onboarding `in_progress` at
  `scopeChoice: "local-no-login"`, `content-hub-creds-collected` still
  `pending`. Critically, `customer.deployTarget` is already `"shared"`
  (set at entry in an earlier turn).
- `cloudflare/.secrets` already exists in the workspace with
  `SPARK_DM_CLIENT_ID`, `SPARK_DM_CLIENT_SECRET`, and
  `SPARK_COOKIE_SECRET` already filled in (standing in for the shared
  environment's existing, working credentials).
- `customer.aemEnvId` is already populated (`p1111-e2222`).

## User prompt

"Okay, keep going — get it running."

## Output Specification

- The agent does **not** ask the customer to provide a new Content Hub
  client id/secret, and does **not** ask them to create or edit
  `cloudflare/.secrets` — it recognizes `deployTarget == "shared"` and
  treats the existing values as reused/confirmed instead.
- The agent does not ask for a new `aemEnvId` either — the existing one is
  reused.
- The agent may perform a quick confirmation/probe that the existing
  values still work, but this is not a new credential *request* to the
  customer.
- The agent marks (or clearly states it is marking)
  `content-hub-creds-collected` as done on this basis, and moves on to the
  next actual pending step (auth mode / boot verification) rather than
  stalling on credential collection.
- Plain language throughout (I1) — no internal step ids or the words
  "shared"/"dedicated"/"deployTarget" shown to the customer.
