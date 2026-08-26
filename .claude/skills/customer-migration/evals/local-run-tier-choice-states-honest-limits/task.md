# The local-run tier choice states honest limits, doesn't oversell

## Problem/Feature Description

SKILL.md's B.5 offers three ways to run the portal locally, at increasing
setup cost. It explicitly requires stating honest limits at choice time: for
options 2 ("local-no-login") and 3 ("local-login"), the customer must be told
that notifications (the bell), the reports/asset-activity dashboards, and
search/analytics reports do **not** work locally and need the deployed
backend — and that option 2 skips real Microsoft sign-in. SKILL.md is
explicit: "Don't oversell option 2 as 'everything works.'"

This eval guards **B.5's honest-limits disclosure**. It is easy for a
well-meaning rephrase of the tier picker to drop the caveats and imply full
parity with production — which would surprise a customer later when reports
silently come back empty. The correct behavior states the three options in
plain language (I1) *and* includes the limits for options 2/3 in the same
turn, not deferred to "we'll find out later."

## Setup

- `.internal/onboarding-state.json` exists (see fixture): `intent:
  "backend-only"`, backend-onboarding `in_progress`, steps done through
  `helix-url-and-readme-corrected`; `tier-selected` is the next pending step
  — i.e. the skill is exactly at the point of offering the tier choice.

## User prompt

"Okay, what are my options for running this?"

## Output Specification

Present the three ways to run it locally in plain outcome language (I1) —
no internal terms, no `scopeChoice` enum values shown verbatim as labels.
In the same turn, for at least the "get it actually working, skip sign-in"
option, explicitly state that some things do **not** work locally and need
the deployed version — specifically covering at least two of: notifications
/ the bell, the reports or asset-activity dashboards, search/analytics
reports. Do not present any option as giving full production parity ("it'll
all work," "everything works," or silence on the gaps). Do not proceed to
apply any tier yet — this turn only presents the choice; stop and wait for
the customer's answer.
