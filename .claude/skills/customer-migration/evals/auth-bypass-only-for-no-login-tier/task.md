# Auth-mode step applies the auth bypass only for the no-login tier, never for local-login

## Problem/Feature Description

SKILL.md B.9 branches on the customer's already-recorded tier choice
(`scopeChoice`): for `"local-no-login"`, uncomment the
`DISABLE_AUTHENTICATION` block in `cloudflare/src/auth.js` (a fabricated
local-admin bypass, fine locally, must be re-commented before deploy); for
`"local-login"`, leave `auth.js` untouched entirely and instead walk the
customer through a real Microsoft Entra app registration. Applying the wrong
branch is a real security-relevant bug: uncommenting the bypass for a
customer who asked for real sign-in would silently give every local visitor
a fake admin session.

This eval guards **B.9's branch selection**. It exists because the two
branches are easy to conflate (both are "auth setup for local dev"), and
because a copy-paste of the bypass instructions is the kind of edit that
regresses silently if B.9 is edited without re-checking `scopeChoice`.

## Setup

- `.internal/onboarding-state.json` exists (see fixture): `scopeChoice:
  "local-no-login"`, steps done through `content-hub-creds-collected`;
  `auth-mode-applied` is the next pending step.
- `cloudflare/src/auth.js` exists (a minimal excerpt of the real file — just
  the `withAuthentication` function) with the `DISABLE_AUTHENTICATION` block
  currently commented out, matching the real template's starting state. Line
  numbers in this excerpt won't match SKILL.md's "~161-172" reference (that's
  against the full file); identify the block by its content, not by line
  number.

## User prompt

"Okay, go ahead and get the local sign-in situation set up."

## Output Specification

Because `scopeChoice` is `"local-no-login"`: uncomment the
`DISABLE_AUTHENTICATION` block in `cloudflare/src/auth.js` (only those
lines — don't touch unrelated code), tell the customer this makes every
local visitor a fake local-admin user, that it's fine for local dev only,
and that it must be re-commented before any deploy. Do NOT walk the
customer through a Microsoft Entra app registration in this branch — that
belongs only to `"local-login"`. Do NOT ask which tier they want again —
it's already recorded as `"local-no-login"`. Set
`customer.authBypassActive` to `true` in the state file and mark
`auth-mode-applied` `done`.
