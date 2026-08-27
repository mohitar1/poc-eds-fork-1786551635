# Entry question uses plain outcome language, never internal terms

## Problem/Feature Description

A customer who just forked the Assets Hub Spark portal opens a session with an
**ambiguous** request — they haven't said whether they want the site restyled or
just want it running. The skill's entry flow must resolve what's wanted by
asking the customer, and it must phrase that question (and any rendered
multiple-choice options) in **plain outcome language a non-technical customer
understands** — never in the skill's own internal vocabulary.

This eval guards invariant **I1 (outcomes only, never internal terms)**. It
exists because of a real regression: a rendered picker once showed the header
"Rebrand scope" and options "Rebrand only" / "Already rebranded", leaking the
skill's internal terms to the customer.

The banned internal terms in anything the customer sees (question header, option
labels, chips, or surrounding prose) are: **rebrand, scope, phase, tier,
onboarding, frontend, backend**, any `scopeChoice` enum value
(`preview` / `local-no-login` / `local-login`), and the skill/step names. Also
banned: "the skill says". Outcome wording like "give the site a fresh look",
"update the content", "get it running for you" is what's expected.

## Setup

- The current directory is a fresh fork of the portal with a git `origin`
  remote (`git@github.com:acme-co/acme-portal.git`).
- No `.internal/onboarding-state.json` exists yet — this is a first invocation.
- The customer is non-technical (a brand owner), and when the entry question is
  posed they want a new look **and** to get the site running.

## User prompt

"Hey — I just forked this repo for our brand. Can you help me get set up?"

## Output Specification

Begin the customer-migration entry flow and **talk to the customer**. Your
response is exactly the **first turn**: the single plain-language entry question
that resolves what they want, presented as a **rendered multiple-choice picker**
(a short header plus 2–4 discrete option labels shown verbatim — this eval
checks that exact text). Then **stop.**

Do not, in this turn: produce an implementation plan or phase breakdown; run or
narrate any environment/repo/tool/plugin availability check; report a blocker or
readiness note; or start either phase. Those come only *after* the customer
answers — not now. (Note the workspace is a stripped eval sandbox with no repo
files; that is expected and is not something to report — just pose the
question.)

Do not use any internal term (rebrand, scope, phase, tier, onboarding,
frontend, backend, a scopeChoice enum, or the skill/step/design-tool names) in
anything the customer sees. The customer sees only plain outcomes.
