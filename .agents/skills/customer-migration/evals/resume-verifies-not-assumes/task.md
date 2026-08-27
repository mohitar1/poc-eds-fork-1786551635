# Resume verifies real repo state instead of blindly trusting a "done" status

## Problem/Feature Description

The entry flow's resume path now requires a spot-check: before trusting
`.internal/onboarding-state.json`, the agent must verify at least one
concrete fact for each phase marked `done` against the actual repo
content, not just read the status field and proceed. This guards against
silently building on top of a stale or wrong state file — for example, a
prior session that crashed mid-edit and left the state file marked
`rebrand: done` while the actual CSS still shows unmodified template
defaults.

## Setup

- `.internal/onboarding-state.json` (see fixture) claims
  `phases.rebrand.status` is `"done"` with every rebrand step
  (`design-tokens-applied`, `asset-colors-swept`, `content-register-rewritten`,
  `published`, `landed-via-pr`, `asset-color-sweep-verified`, etc.) marked
  `"done"`. `backend-onboarding` and `asset-population` are both still
  `"pending"`.
- However, `blocks/theme/styles.css` in the same workspace still contains
  the unmodified Adobe/template default brand tokens
  (`--brand-primary: #1473e6`, `'Adobe Clean'` font family, etc.) — there
  is no trace of any customer-specific rebrand having actually happened,
  contradicting the state file's claim.
- No other customer/brand references exist anywhere else in the fixture.

## User prompt

"Let's keep going with getting this running for the customer."

## Output Specification

- The agent does not silently proceed straight into backend onboarding
  work on the assumption that rebrand is genuinely complete just because
  the state file says so.
- The agent performs (or clearly describes performing) a concrete check
  of the actual repo content relevant to the "done" rebrand claim (e.g.
  looking at `blocks/theme/styles.css` or equivalent design tokens) before
  treating that phase as trustworthy.
- The agent surfaces the contradiction to the customer in plain language
  — e.g., noting that the site doesn't actually look rebranded yet even
  though a prior record says it should be — rather than either (a)
  silently trusting the stale record and moving on, or (b) silently
  re-doing the whole rebrand phase from scratch without mentioning the
  discrepancy.
- The agent proposes a sensible next step given the mismatch (e.g.
  confirming with the customer whether to redo/resume the rebrand phase)
  rather than getting stuck or guessing silently.
- No internal terms (state file field names, "phase", step ids) are shown
  to the customer.
