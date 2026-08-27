# Resuming a partial session doesn't re-ask answered questions or redo done steps

## Problem/Feature Description

Onboarding spans many turns and often multiple sessions. The entry flow's step
1 says: "If `.internal/onboarding-state.json` exists, read it. Any phase it
marks `done` is authoritative — never re-run it. Resume at the first
non-`done` step of any phase still in progress, and don't re-ask questions
already answered under `customer`." A customer returning to a fresh session
after partial progress should be resumed at exactly the right point, not
walked back through steps that already happened.

This eval guards the **entry flow's resume logic** (step 1). It exists
because state-file-driven resumability is easy to silently break — an edit to
the entry flow or Phase B ordering could start re-asking for the tier choice,
the Content Hub credentials, or the fork's org/repo, all of which are already
answered and recorded.

## Setup

- `.internal/onboarding-state.json` exists (see fixture): `intent:
  "backend-only"`, rebrand `not-requested` (customer never wanted it),
  backend-onboarding `in_progress` with `scopeChoice: "local-no-login"`.
  Steps done through `content-hub-creds-collected`; `auth-mode-applied`
  onward are `pending`. `customer.githubOrg`/`githubRepo`/`aemEnvId` are
  already populated.
- `cloudflare/.secrets` already exists in the workspace with all three
  required lines filled in (see `SESSION_NOTE.md` — stands in for the
  customer having done this in the earlier session).
- This is a **new session** — you have no memory of any prior conversation
  with this customer; everything you need to resume is in the state file and
  the workspace itself.

## User prompt

"Hey, I'm back — where were we?"

## Output Specification

Read the state file and resume at the next pending step
(`auth-mode-applied`), not from the beginning. Specifically:

- Do NOT ask again what the customer wants (no repeat of the entry
  question) — `intent` is already `backend-only` and the rebrand phase is
  already `not-requested`; don't revisit or question that.
- Do NOT ask again for the fork's GitHub org/repo — already in
  `customer.githubOrg`/`githubRepo`.
- Do NOT ask again for the Content Hub client id/secret or re-prompt to
  create `cloudflare/.secrets` — `content-hub-creds-collected` is already
  `done` and the file already exists with values in place.
- Do NOT ask again which local-run tier they want — `scopeChoice` is already
  `"local-no-login"` and `tier-selected` is `done`.
- DO proceed with the next actual pending step: applying the auth-bypass
  edit for `local-no-login` (uncommenting the `DISABLE_AUTHENTICATION` block
  in `cloudflare/src/auth.js`) and/or moving toward boot verification.
- Keep language plain (I1) — no internal step names or file paths shown to
  the customer.
