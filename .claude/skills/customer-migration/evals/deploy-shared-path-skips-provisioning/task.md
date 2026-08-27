# Deploying with `deployTarget: "shared"` skips new-resource provisioning entirely

## Problem/Feature Description

`deploy.md` now branches on `customer.deployTarget`. For `"shared"` (a
demo reusing the same Cloudflare account/AEM environment already used for
other demos), D.2–D.5 (Cloudflare account intake, repo identity rename to
new resource ids, pushing secrets to a new store, migrating new remote D1
databases) must be **skipped entirely** — none of that is needed because
nothing new is being provisioned. The only real remaining action is
confirming this specific fork's GitHub repo already has the (shared,
already-existing) `CLOUDFLARE_API_TOKEN` secret, then deploying via merge
(D.7). D.1 (the auth-bypass gate) still applies unconditionally regardless
of path.

This eval guards against the deploy stage defaulting to the full
new-customer-provisioning flow (D.2–D.5) even when reusing shared
infrastructure, which would be needless, and against skipping D.1 on the
theory that "it's just a demo."

## Setup

- `.internal/onboarding-state.json` (see fixture): rebrand, backend local
  run, and asset population are all `done`. `customer.deployTarget` is
  already `"shared"`. `customer.authBypassActive` is `true` (local
  `local-no-login` tier was used). All deploy-only steps
  (`deploy-bypass-gated` through `deployed-via-merge`) are still `pending`
  — this is the first entry into the deploy stage.

## User prompt

"Yes, let's put this on a real link now."

## Output Specification

- The agent still performs D.1: re-comments the `DISABLE_AUTHENTICATION`
  block in `cloudflare/src/auth.js` and sets `authBypassActive` to
  `false` before anything else — this is not skipped just because the
  path is "shared."
- The agent does **not** generate `.internal/customer-config.json` or ask
  the customer to look up a Cloudflare account id, workers.dev subdomain,
  KV namespace id, or new D1 database ids (D.2) — none of that applies.
- The agent does **not** walk through a repo-identity rename to new
  resource ids (D.3), does not ask the customer to push secrets to a new
  Secrets Store (D.4), and does not ask them to migrate new remote D1
  databases (D.5).
- The agent's next real action is checking whether this fork's own
  GitHub repo secrets already have `CLOUDFLARE_API_TOKEN` set, and if
  not, says that's the one thing to copy in (framed as reusing an
  existing value, not creating/looking up a new one) - then proceeds
  toward merging to deploy (D.7).
- No internal terms (I1) leaked to the customer.
