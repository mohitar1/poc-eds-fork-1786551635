# Customer Migration — deploy stage (deploy-only, opt-in)

Companion to `SKILL.md`. Open and follow this **only** when a customer
has explicitly opted into deploying, *after* a local tier is already
running (SKILL.md Phase B). A local-only customer never enters this file;
its steps stay `pending` in the state file, which is a valid end state
(SKILL.md invariant I4). References to `I1`–`I4` and step ids (B.x) are to
`SKILL.md`.

**Who runs what (governs every step here).** The agent *prepares* — exact
commands, edited config, a ready PR — but the **customer performs** any
step that (a) handles a real secret value (I2), (b) runs under their own
Cloudflare/GitHub session, or (c) mutates their production environment.
Per step: make it a single unambiguous command (or one-click merge),
verify the pre-state, confirm the result after the customer reports back.
The agent never performs the privileged action itself, and never pushes
or merges to the customer's `main`.

## D.1: Bypass gate (`deploy-bypass-gated`)

Do this **first**, before anything else in this stage, **regardless of
which path below applies** — a fabricated admin user is a real risk the
moment anything is public, demo or not; this step is never skipped
either way. If `customer.authBypassActive` is `true`, the repo is
**not** deploy-ready: re-comment the `DISABLE_AUTHENTICATION` block in
`cloudflare/src/auth.js` (lines ~161-172) — the exact inverse of the edit
B.9 made — set `customer.authBypassActive` to `false`, and tell the
customer real login is now required, which is why the Entra registration
(D.6 / the note below) matters. Refuse to proceed with deploy while the
bypass is active. Mark step `done` once re-commented.

## Which path applies (`customer.deployTarget`)

Read `customer.deployTarget` — set once at `SKILL.md`'s entry flow step
2, never re-asked here. It decides everything from this point on:

- **`"shared"` (demo)** — reusing the same Cloudflare account/AEM
  environment already used for other demos. Skip **D.2–D.5** entirely —
  no new Cloudflare account, no new KV/D1/secrets store, nothing to
  provision. Go straight to **D.6's lightweight form** below, then D.7.
- **`"dedicated"` (real portal)** — the customer's own separate,
  isolated environment. Continue through **D.2–D.8** exactly as written
  below, unchanged.
- **If `deployTarget` is still `null`** (a state file from before this
  distinction existed) — fall back to asking the question once, here,
  using the same wording as `SKILL.md` entry flow step 2, then proceed
  on the answer as above. This is a compatibility path only; new runs
  should never reach this branch.

## D.2: Intake file generation (`intake-file-generated`)

**Only for `deployTarget == "dedicated"`.** Skip this and D.3–D.5
entirely for `"shared"` — see above.


Several values need the customer to run a command or look something up
in their own Cloudflare account first — not answerable one-at-a-time in
chat, and needed only for deploy (local dev uses simulated bindings, so
these are irrelevant to running locally). Generate
`.internal/customer-config.json` pre-populated with these fields, each
`null` until filled in:

```json
{
  "cloudflareAccountId": null,
  "workersDevSubdomain": null,
  "workerName": null,
  "productionDomain": null,
  "kvNamespaceId": null,
  "d1DatabaseIds": {
    "userLogins": null,
    "auditEvents": null,
    "searchEvents": null
  },
  "secretsStoreId": null
}
```

Give the customer the per-field lookup instructions from the intake-file
table in `docs/onboarding/deploy-plan.md` — the
**customer runs** the `wrangler` commands under their own account (CLI
where unambiguous, dashboard only where no CLI getter exists). Three
carry a gotcha worth stating inline:

- `workersDevSubdomain` — dashboard only; account-level. If never set,
  they must set it now.
- `d1DatabaseIds` — `wrangler d1 create <name>` **once per binding**
  (three names) → three *distinct* ids.
- `productionDomain` — optional; may stay on `*.workers.dev` for now.

Have them fill it in at their own pace. Mark step `blocked` until they
confirm, then re-read, confirm every field is non-null (except
`productionDomain` if intentionally skipped), mark `done`.

## D.3: Repo identity rename (`repo-identity-rename-applied`)

Repoint every remaining file that identifies the upstream template's
*Cloudflare account* rather than this customer's own — everything here
depends on the intake file (D.2). One bulk, previewed,
single-confirmation pass (not file-by-file): every change is a mechanical
substitution of already-known values.

**Gather the substitution map** (old → new), reading old values live
from the files:

- Cloudflare worker name / account id: read `wrangler.toml`'s `name` /
  `account_id` → new values from the intake file.
- Production domain / workers.dev subdomain: read the current
  route/domain literals → new values from the intake file.
- KV namespace id, three D1 database ids, Secrets Store id: read current
  ids in `wrangler.toml` → new values from the intake file. The three D1
  bindings must end up with three *distinct* ids (per D.2 — the template
  currently shares one across all three).
- `AEM_ENV_ID`: read the current value in `wrangler.toml` → new value
  from `customer.aemEnvId`.

Mirror var changes into **both** `[env.production.vars]` and
`[env.branch.vars]` — the toml warns to keep them in sync.

**Files to update:** the complete inventory lives in
`docs/onboarding/deploy-plan.md` §B (functional/CI) and §C (docs) —
re-derive by searching rather than trusting the list verbatim. `README.md` and `local.sh`'s `AEM_PAGES_URL` are **not** here
(B.4 handled them). Three items from that inventory need explicit care:

- **Security-relevant, don't miss:** `cloudflare/src/index.js` CORS
  `allowedOrigins` and `cloudflare/src/user.js` `liveHosts` — if the
  fork's real production host isn't listed, requests are treated as
  preview and locked behind the `preview` permission.
- **Do not touch** `cloudflare/src/origin/__tests__/dm-analytics-search-type.test.js`
  — its domain-looking strings are arbitrary referer-parse test input.
- `blocks/search-results/components/adobe-pdf-viewer.js` has a separate
  placeholder (`REPLACE_WITH_SPARK_PDF_EMBED_CLIENT_ID`) needing the
  customer's own Adobe PDF Embed client id — note as a completion-report
  follow-up, not a blocker.

**Process:** build the full (file, line, old, new) list, show one diff,
one confirmation, apply all. After renaming both `package.json`s,
regenerate lockfiles via `npm install` — don't hand-edit them. Mark
step `done`.

## D.4: Push secrets to the remote Secrets Store (`remote-secrets-pushed`)

**Only for `deployTarget == "dedicated"`.** For `"shared"`, the deployed
worker already has these secrets set (they're the same account other
demos already deploy through) — skip straight to D.6.

Critical distinction: the `cloudflare/.secrets` file (from B.7) populates
only the **local** simulated store — it never reaches the deployed
worker, and nothing pushes it automatically. The deployed worker's
secrets are set by a **manual, per-secret** command the **customer runs**
under their own `wrangler` session — agent supplies the `<name>`, customer
enters the value (I2).

For each secret the deploy needs, against the Secrets Store id now in
`wrangler.toml`:

```
npx wrangler secrets-store secret create <store-id> --scopes workers --name <SPARK_NAME>
```

Secrets to push: `SPARK_COOKIE_SECRET`, `SPARK_HELIX_ORIGIN_AUTHENTICATION`,
`SPARK_DM_CLIENT_ID`, `SPARK_DM_CLIENT_SECRET`, and — since deploy means
real login is active — `SPARK_MICROSOFT_ENTRA_CLIENT_SECRET` (needed for
`/auth/*` and SMTP). Note `--scopes workers` and **no** `--local` (that
would target the local store again). Mark step `done` once the customer
confirms all are set.

## D.5: Migrate the remote D1 databases (`remote-d1-migrated`)

**Only for `deployTarget == "dedicated"`.** For `"shared"`, the remote
databases already have their schema applied (same shared account) —
skip straight to D.6.

Local D1 setup uses `--local`; the real production databases need the
schema applied explicitly, and there is no migrations framework wired
up. The **customer runs**, once per database, under their own session:

```
npx wrangler d1 execute <db-name> --remote --file cloudflare/schema/<file>.sql
```

for `user_logins.sql`, `audit_events.sql`, `search_events.sql` against
the three databases. Only production has D1 (branch/preview deploys have
none), so this targets the production databases. Mark step `done` once
the customer confirms.

## D.6: Set the CI deploy token (`ci-token-set`)

Deploy runs in GitHub Actions and needs exactly one repo secret,
`CLOUDFLARE_API_TOKEN`, on **this fork's own repo** — GitHub Actions
secrets are per-repo, so even a fork sharing a Cloudflare account needs
its own copy of the value.

- **`deployTarget == "dedicated"`** — the **customer adds**
  `CLOUDFLARE_API_TOKEN` to their fork's GitHub repo secrets (Settings →
  Secrets and variables → Actions → New repository secret), scoped to
  deploy Workers on their own account. The agent can't and shouldn't set
  this. Mark step `done` once confirmed.
- **`deployTarget == "shared"`** — this is not a new value to create:
  the same Cloudflare account already deploys other demo forks, so the
  token already exists somewhere. Check whether this specific fork's
  repo secrets already have `CLOUDFLARE_API_TOKEN` set; if not, the
  **operator** (whoever has access to the shared account/another demo
  fork already using it) copies that existing value in — nothing new is
  looked up or created in Cloudflare itself. Still I2: the agent never
  handles the actual value, only confirms the secret name exists. Mark
  step `done` once confirmed present.

## D.6.5: Real sign-in setup (`real-auth-configured`) — dedicated only

**Applies only when `deployTarget == "dedicated"`.** Skip entirely for
`"shared"` — a demo never sets up real sign-in; it stays on the shared
environment's existing auth as-is.

This is where real Microsoft/Entra sign-in gets configured for a
dedicated customer — not during local setup (B.5/B.9 always keep local
runs on `"local-no-login"`, i.e. the bypass, for a real migration). Doing
it here, right before going live, means the customer only sets up Entra
once, for the environment that will actually be used and shown to their
own end users.

Walk the customer through registering their own Entra app (steps:
`deploy-plan.md` Entra section) and have them place the resulting
`MICROSOFT_ENTRA_TENANT_ID` / `MICROSOFT_ENTRA_CLIENT_ID` into
`wrangler.toml`'s `vars`, and `SPARK_MICROSOFT_ENTRA_CLIENT_SECRET` into
the Secrets Store (D.4) so production actually authenticates against it.
Confirm `DISABLE_AUTHENTICATION` is **not** set for the production
environment in `wrangler.toml` (D.1 already gates this, but re-check
here since this is the last step before merge). Mark step `done`.

## D.7: Deploy via merge (`deployed-via-merge`)

Applies to both paths, unchanged. Deploy is CI-driven, not a script: `.github/workflows/release.yaml` runs
`wrangler deploy --env production` on push to `main`, and `build.yaml`
auto-deploys a per-PR branch worker on pull requests. So **deploying =
merging to `main`**.

Do **not** use `npm run deploy` / `cloudflare/scripts/deploy.sh` — it's
stale (no `--env`, hardcoded upstream identity) and diverges from the CI
path. Tell the customer this explicitly if they reach for it.

The agent prepares and verifies the PR (all deploy steps above done,
bypass re-commented, CI token set) and confirms it's ready; the
**customer merges** — the agent never pushes or merges to their `main`.
Once merged, watch the Actions run and confirm the deploy succeeded.
Mark step `done`, and set `phases["backend-onboarding"].status` to
`"done"`.

## D.8: Updating values later

Tell the customer how to change a value after the initial setup — the
path differs by what kind of value it is:

- **A non-secret var** (e.g. `AEM_ENV_ID`, a domain/route,
  `MICROSOFT_ENTRA_CLIENT_ID`, session expiry): edit it in
  `wrangler.toml` — in **both** `[env.production.vars]` and
  `[env.branch.vars]`, which the toml itself warns to keep in sync — then
  **re-deploy by merging to `main`**.
- **A secret** (`SPARK_DM_CLIENT_SECRET`, `SPARK_COOKIE_SECRET`,
  `SPARK_MICROSOFT_ENTRA_CLIENT_SECRET`, etc.): update it **directly in
  the Secret Store, no redeploy needed** — re-run the D.4 command
  (`wrangler secrets-store secret create/update <store-id> --scopes workers --name <SPARK_NAME>`).
  Editing local `cloudflare/.secrets` does **not** touch the deployed
  store — separate copies that can silently drift.
- **A D1 schema change**: re-run the D.5 remote `wrangler d1 execute
  --remote` against the affected database — there's no migrations
  framework to do this automatically.

This step is informational; mark `done` once conveyed. Then return to
`SKILL.md`'s Phase B completion report.
