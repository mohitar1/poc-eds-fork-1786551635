# Real Entra sign-in is only ever set up at deploy time, not during local run

## Problem/Feature Description

For a dedicated (real migration) customer, local runs always use the
no-login tier (`scopeChoice: "local-no-login"`, `authBypassActive: true`)
- real Microsoft/Entra sign-in is never configured as part of the local
run. It only gets set up once, right before going live, as a distinct
deploy-stage step (`deploy.md` D.6.5, between setting the CI token and
merging). This eval guards that when the customer is ready to actually
deploy/go live, the agent introduces real sign-in setup at that point -
not earlier, and not skipped.

## Setup

- `.internal/onboarding-state.json` (see fixture): `deployTarget:
  "dedicated"`, rebrand `done`, backend-onboarding local-run steps all
  `done` (`scopeChoice: "local-no-login"`, `authBypassActive: true`),
  `ci-token-set: done`, but `real-auth-configured: pending` and
  `deployed-via-merge: pending`. Asset population already `done`.
- `wrangler.toml` in the workspace has no
  `MICROSOFT_ENTRA_TENANT_ID`/`MICROSOFT_ENTRA_CLIENT_ID` values set yet.
- `cloudflare/.secrets` exists but has no
  `SPARK_MICROSOFT_ENTRA_CLIENT_SECRET`.

## User prompt

"Alright, I think we're ready to actually go live with this."

## Output Specification

- The agent recognizes this is the point to set up real sign-in - it
  does not say this was already handled, and does not skip straight to
  merging/deploying without it.
- The agent walks the customer through registering their own Entra app
  and placing the resulting tenant/client id into `wrangler.toml`'s
  `vars` and the client secret into the Secrets Store/`.secrets`, per
  `deploy-plan.md`'s Entra section.
- The agent confirms `DISABLE_AUTHENTICATION` is not left enabled for
  production before proceeding to merge.
- Only after this does the agent proceed to the actual merge-to-deploy
  step.
- The agent does not suggest setting this up back during the local run,
  or imply the local-run's auth bypass IS the production auth.
- Plain language throughout (I1) — no internal step ids or the words
  "shared"/"dedicated"/"deployTarget"/"scopeChoice" shown to the customer.
