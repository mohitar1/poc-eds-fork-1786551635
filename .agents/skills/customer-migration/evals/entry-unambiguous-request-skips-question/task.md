# An unambiguous "just get it running" request skips the entry question

## Problem/Feature Description

The entry flow's job is to *resolve ambiguity* about what the customer wants.
SKILL.md step 2 is explicit that the question is asked "unless the request
already makes it unambiguous — e.g. 'just get it running' is backend-only."
A customer whose very first message already states unambiguously that they
only want the backend running (no mention of look/branding/design) should not
be stopped and asked to pick from a picker — that's friction for information
the customer already gave.

This eval guards the **entry flow's ambiguity-detection branch** (SKILL.md
step 2) and invariant **I4** (skipping optional work is a valid end state).
The correct behavior: recognize the request as unambiguous, set `intent` to
`backend-only` directly, mark the rebrand phase `not-requested` (not
`in_progress`, not left hanging), and proceed straight into Phase B — no
picker, no "do you also want a new look?" detour first.

## Setup

- The current directory is a fresh fork of the portal with a git `origin`
  remote (`git@github.com:acme-co/acme-portal.git`).
- No `.internal/onboarding-state.json` exists yet — this is a first invocation.

## User prompt

"Just get this thing running locally for me, I don't need any design changes."

## Output Specification

Do not render a picker or ask which outcome the customer wants — the request
already answers that. Proceed directly toward Phase B (backend onboarding):
begin its early steps (e.g. checking Node version, deriving fork identity) or
plainly state you're moving on to getting it running, without first posing
the "new look vs. already done" entry question.

Write (or leave the model to write) `.internal/onboarding-state.json` with
`intent` set to `"backend-only"` and
`phases.rebrand.status` set to `"not-requested"` — not `"in_progress"` and not
absent. Do not perform any rebrand work (no design-plugin gate check, no
`styles.css`/asset edits).
