# The demo-vs-real-portal question is asked once, first, at entry — never on a keyword guess, never framed as speed

## Problem/Feature Description

The entry flow's step 2 now asks two things in the same turn: which backend
this uses (`customer.deployTarget`: `"shared"` demo vs `"dedicated"` real
portal) leads, then the existing scope question (rebrand/backend/assets)
follows. This decision has to happen before Phase B's B.7 collects
credentials, because B.7 determines which AEM environment assets get
uploaded into (Phase C) — asking it later (e.g. at deploy time) would mean
Phase C already picked an environment with no basis for the choice.

This eval exists because of two real regressions caught during design
review, not yet in production: (1) an initial draft asked this question
only at deploy time, after Phase C had already run — too late. (2) an
initial draft tried to auto-skip the question when the word "migrate"
appeared in the request — but a real prior session had a customer literally
say "migrate this portal" while actually meaning a demo, so that keyword is
not a reliable signal and must never be used to skip asking.

## Setup

- No `.internal/onboarding-state.json` exists yet — this is the very first
  message in a new session (see fixture `SCENARIO.md`).
- The fork is a plain clone of the template, nothing customized yet.

## User prompt

"I want this portal to be used for a different customer, Aperture. Plan how
we can migrate this portal."

## Output Specification

- The agent asks, in the **same first turn**, before doing anything else:
  (a) whether this is to become Aperture's own real portal going forward or
  a demo of what a rebrand would look like, and (b) the existing scope
  question (fresh look / get running / fill assets).
- The agent does **not** treat the word "migrate" in the prompt as
  sufficient to silently decide `deployTarget = "dedicated"` without asking
  — it still asks explicitly.
- The question about backend/environment is **not** framed as a speed or
  effort tradeoff ("faster" vs "takes longer," "easier" vs "harder") — it is
  framed purely around purpose/ownership (whether Aperture will run/manage
  it themselves going forward, vs. this being a demo to show them).
- The agent does not perform any file edits, tool/plugin availability
  checks, or Phase A work before this question is posed.
- No internal terms (I1) — never the words "deployTarget," "shared,"
  "dedicated," "phase," or "scope" shown to the customer.
