# Spark Cloudflare Worker

A Cloudflare Worker that acts as outermost CDN for the Spark project with some additional features. It provides authentication, authorization, edge caching, and request routing to the various AEM backends (Helix/EDS, Dynamic Media OpenAPI and more).

- [Worker in Cloudflare Dashboard](https://dash.cloudflare.com/d3259185ae56522248254092489d6755/workers/services/view/spark/production/metrics)

- Live: https://frescopamedia.com
- Preview: https://preview.frescopamedia.com
- Branch: <https://{branch}.dev.frescopamedia.com>

## URL Paths

Here are the various URL paths handled by the worker:

| Path                   | Authenticated | Description | Origin | Proxied Path |
|------------------------|---------------|-------------|--------|--------------|
| `/auth/*`              | 🟡 | 🔑  Authentication flows | - | - |
| `/api/user`            | ✅ | 👤  User session API (based on session cookie) | - | - |
| `/api/savedsearches/*` | ✅ | 🔎  Saved searches API (stored in Cloudflare KV) | - | - |
| `/api/adobe/assets/*`  | ✅ | 🖼️  Adobe Dynamic Media OpenAPI | `delivery-*.adobeaemcloud.com` | Everything after `/api` |
| `/api/adobe/assets/search-collections`  | ✅ | 🖼️  Adobe Dynamic Media OpenAPI.<br><br>Search index `*_collections` | `delivery-*.adobeaemcloud.com` | `/adobe/assets/search` |
| `/content/share`<br>`/content/experience-fragments`<br>`/content/dam`<br>`/home/users`<br>`/etc.clientlibs`<br>`/libs`       | ✅ | ↪️ AEM CS Publish (for Chili templates functionality only) | `publish-*.adobeaemcloud.com` | as is |
| `/public/*`<br>`/scripts/*`<br>`/styles/*`<br>&nbsp;[more](src/index.js#L44) | ❌ | 🌎  Public content & code from Adobe Helix. | `*.aem.live` / `*.aem.page` | as is |
| `/*`                   | ✅ | 📑  Adobe Helix content | `*.aem.live` / `*.aem.page` | `/*` |


## Setup

- Node.js and npm installed
- Run `npm install` to install the dependencies
- (Only for manual deployments or log tailing) Access to deploy workers on the `Franklin (Dev)` account, id: `d3259185ae56522248254092489d6755`
  - The `wrangler` cli used by the various command below will automatically open a browser window to log into Cloudflare.

### Change Cloudflare account

If you need to deploy to a different Cloudflare account:

- Requires a Cloudflare account with Workers enabled (free tier is sufficient)
- Change the `account_id` in the `wrangler.toml` file to the new account id
- Set `CLOUDFLARE_API_TOKEN` for Github Actions to a Cloudflare api token (ideally account api token) that can deploy workers on the account
- Ensure preview aliases are enabled on the worker (to support branch deployments)
- As necessary, update this README.md with the new worker URLs and configuration values


## Develop

### Local Email Testing

For testing email functionality locally without OAuth2 configuration:

📧 **See:** [LOCAL_EMAIL_TESTING.md](./LOCAL_EMAIL_TESTING.md) for complete setup instructions using FakeSMTP.

### Local server

It is recommended to run the [full local development stack](../README.md#local-development) using `npm run dev` in the **root folder of the git repository**.

The default wrangler port is 8787, but when that port is taken (e.g. another instance is already running), the script automatically picks the next free port starting at 9001. The resolved port is printed at startup. See [Running multiple instances](../README.md#running-multiple-instances) for details.

If you _only_ want to run the cloudflare worker locally:

1. Make sure you have `.secrets` file with required [secret store secrets](#secret-store). See [example here](../README.md#local-development).
2. Run `npm run dev`

To overwrite configurations locally, change them in `wrangler.toml` or create an `.env` file to overwrite (do not commit).
For defining secrets they must go into a `.secrets` file.

### Tests

```bash
npm test
```

### Linting

This cloudflare folder uses [Biome](https://biomejs.dev/) for linting and formatting.

```bash
npm run lint
```

To automatically fix linting errors and format files, run:

```bash
npm run lint:fix
```

## Deploying

### CI branch

On each branch/PR push, the Github Actions CI will automatically deploy a dedicated branch worker with its own custom-domain route:

| URL | Helix origin |
|-----|--------------|
| `https://{branch}.dev.frescopamedia.com` | `https://{branch}--assethub-spark--aem-showcase.aem.page` |

### CI main

On each `main` branch push, the Github Actions CI deploys that worker version to production:

| URL | Helix origin |
|-----|--------------|
| https://frescopamedia.com | https://main--assethub-spark--aem-showcase.aem.live |
| https://preview.frescopamedia.com | https://main--assethub-spark--aem-showcase.aem.page |

### Manual deploy

To deploy local work manually, you can run

```bash
npm run deploy

# implemented in
./scripts/deploy.sh
```

This will deploy the worker to the preview URL using the `user` id (git email address without the domain) and `branch` name:

```bash
https://{user}-{branch}-spark-eds.workers.dev
```

This will use the same `branch` for the Helix origin: `{branch}--assethub-spark--aem-showcase.aem.live`

Options:

- `npm run deploy -- "my change"`: add custom message for the worker version in Cloudflare
- `npm run deploy -- --tail`: tail logs after deployment (Note: seems to not work well for specific worker versions)

## Logs

### Local logs

When running `npm run dev`, logs are shown in the console.

* Set the `CLOUDFLARE_LOG_LEVEL` environment variable to control the log level.
* Set the `CLOUDFLARE_REQUEST_LOGS` environment variable to `1` to show request logs.

### Production logs

Go to [spark worker logs](https://dash.cloudflare.com/d3259185ae56522248254092489d6755/workers/services/view/spark/production/observability/logs) in the Cloudflare dashboard to see the production worker logs (`spark-eds.workers.dev`).

You can also tail the logs locally using the `npm run tail` command.

Note that you can **not see logs for versions or preview aliases** (PR/branch or preview URLs) directly. See below for a workaround.

### Branch logs

This is a workaround to view logs in Cloudflare for PR branches, before they are actually deployed and used in production.

1. Create PR, wait for branch deployment
2. Notify the team that they should not merge PRs while you are testing the logs
3. Go to [deployments](https://dash.cloudflare.com/d3259185ae56522248254092489d6755/workers/services/view/spark/production/deployments) for the spark worker in Cloudflare
4. Manually create a [gradual deployment](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/gradual-deployments/?utm_source=chatgpt.com) with 0%/100% traffic split
   1. Click the "Deploy" button
   2. Enable the Split deployment toggle
   3. Keep the current active deployment (aka `main`)
   4. Click "Add version"
   5. Select the branch version you want to test and see logs for
   6. Click "Add"
   7. Set the current version at top to `100%`, and the new version to `0%`
   8. Click "Deploy"
   9. This will make sure all normal traffic still goes to the `main` version. But it now allows you to specifically call the other version and get logs for that.
5. Copy the version number of the branch version => `<version>`
6. Make test requests but with an [extra header](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/gradual-deployments/#version-overrides) `Cloudflare-Workers-Version-Overrides: <version>`
   - This targets your specific version
   - Set manually when using curl or postman
   - When using a browser, you need a setting or extension that allows to set/override custom headers for all requests, such as [ModHeader](https://chromewebstore.google.com/detail/modheader-modify-http-hea/idgpnmonknjnojddfkpgkljpfnnfcklj?hl=en) for Chrome.
7. Go to [spark worker logs](https://dash.cloudflare.com/d3259185ae56522248254092489d6755/workers/services/view/spark/production/observability/logs) and filter by `$workers.scriptVersion.id = <version>`
   - Alternatively run `npx wrangler tail --version-id <version>` to tail locally
8. Do your testing
   - Every time you push changes to your branch, you will have to re-create the gradual deployment to the new worker version deployed by the CI
9. When done make sure to remove the gradual deployment
   - If PR changes are good, simply merge the PR. The auto-deployment on `main` will overwrite the gradual deployment to a single version deployment.
   - Otherwise manually change the deployment in the Cloudflare dashboard back to just the previous `main` version.
10. Notify the team you are done, so they know they can merge PRs again.


## Cloudflare Resources across Environments

Understanding how different Cloudflare resources behave across deployment environments is critical for development and testing.

### Resource Behavior Matrix

| Service | Production (main) | Branch/Preview | Local (wrangler dev) |
|---------|------------------|----------------|---------------------|
| **KV Stores** | Production KV | Production KV | Local KV |
| **Analytics Engine (Writes)** | Production Index | Production Index | ❌ Cannot Write |
| **Analytics Engine (Reads)** | Production Index | Production Index | Production Index |
| **D1 Database** | ✅ Production DB | ❌ No Database | Local DB |

### Key Differences Explained

#### KV Stores
- **Production & Branch**: Both use the **same production KV namespaces**
  - ⚠️ **No isolation**: Changes in branch preview affect production KV data
  - Example: Saving a search in `https://mybranch.dev.frescopamedia.com` writes to production KV
- **Local**: Uses separate local KV (`.wrangler/state/v3/kv/`) - isolated from production
  - Safe for testing without affecting production data

#### Analytics Engine
- **Writes**:
  - Production ✅ Writes to production index
  - Branch ✅ Writes to production index (events appear in production analytics!)
  - Local ❌ Cannot write (no local Analytics Engine emulation)
- **Reads** (SQL API):
  - Production ✅ Reads from production index
  - Branch ✅ Reads from production index (reports show production data)
  - Local ✅ Reads from production index (reports show production data)

#### D1 Database
- **Production**: ✅ Uses production D1 database (`spark-user-logins`)
  - `scripts/deploy.sh` includes D1 binding for production deployments
- **Branch/Preview**: ❌ **No D1 binding available** (Cloudflare limitation)
  - D1 bindings are deployment-scoped, not namespace-scoped like KV
  - This is by design to prevent preview code from running migrations or writes against production database
  - `scripts/deploy.sh` automatically strips D1 binding for branch deployments
- **Local**: Uses local SQLite file (`.wrangler/state/v3/d1/`) - isolated from production
  - Perfect for testing database operations without affecting production

### Why D1 Doesn't Work in Branch Preview (but KV Does)

**KV Stores:**
- Schema-less (key-value pairs)
- Eventually consistent
- Multiple worker versions can safely share the same namespace
- Branch preview writing to production KV = acceptable (by design)

**D1 Databases:**
- Schema-dependent (SQL tables with defined structure)
- Strongly consistent (ACID transactions)
- Preview branches might have different schema versions than production
- If preview used production D1, it could:
  - Run migrations that break production schema
  - Write test data to production database
  - Execute incompatible queries
- **Solution**: Cloudflare blocks D1 bindings in preview deployments for safety

### Practical Impact

**Testing in Branch Preview:**
- ✅ Authentication works
- ✅ Saved searches work (writes to prod KV ⚠️)
- ✅ Rights requests work (writes to prod KV ⚠️)
- ✅ Analytics events tracked (writes to prod index ⚠️)
- ✅ Reports show data (reads prod analytics)
- ❌ User login CSV export disabled (no D1)

**Testing Locally:**
- ✅ Authentication works
- ✅ Saved searches work (local KV)
- ✅ Rights requests work (local KV)
- ❌ Analytics events cannot be written
- ✅ Reports show production data (reads prod analytics)
- ✅ User login CSV export works (local D1)

**Recommendation for Safe Testing:**
- Use **local development** for features involving D1 or when you don't want to affect production KV/analytics
- Use **branch preview** for testing frontend changes, authentication flows, and production data integration

## Configuration

Most configuration is done via environment variables in the `wrangler.toml` file:

| Variable | Default in code | Description |
|----------|---------|-------------|
| `name` | - | Cloudflare worker name |
| `account_id` | - | Cloudflare account ID |
| `HELIX_ORIGIN` | - | AEM EDS origin server such as `https://*.aem.live` |
| `AEM_ENV_ID` | - | AEM Program + Environment ID string such as `pXXXX-eYYYY` |
| `HELIX_PUSH_INVALIDATION` | not set (invalidation enabled) | If set to `disabled`, disable push invalidation to the AEN EDS origin server. |
| `MICROSOFT_ENTRA_TENANT_ID` | - | Directory (tenant) ID from the app registration in [Microsoft Entra admin center](http://entra.microsoft.com). |
| `MICROSOFT_ENTRA_CLIENT_ID` | - | Application (client) ID from the app registration in [Microsoft Entra admin center](http://entra.microsoft.com). |
| `MICROSOFT_ENTRA_JWKS_URL` | `https://login.microsoftonline.com/common/discovery/keys` | The Microsoft Entra ID public keys URL. Get this from `https://login.microsoftonline.com/{MICROSOFT_ENTRA_TENANT_ID}/.well-known/openid-configuration` and json field `jwks_uri` |
| `SESSION_COOKIE_EXPIRATION` | `6h` | The expiration time for the session cookie. Example: `1h` for 1 hour, or `10m` for 10 minutes. [Format documentation](https://github.com/panva/jose/blob/main/docs/jwt/sign/classes/SignJWT.md#setexpirationtime) |
| `DISABLE_AUTHENTICATION` | not set (enabled) | If set to `true`, disable authentication entirely. WARNING: be careful with this! |

## Secrets

### Secret Store

To ease rotation of secrets, without having to re-deploy the worker, we use [Secret Store](https://developers.cloudflare.com/secrets-store/) instead of worker secrets ([explanation of the differences](https://github.com/cloudflare/workers-sdk/issues/10585#issuecomment-3271987962)).

To configure these secrets locally (for use with `npm run dev`), create a `.secrets` file in this folder and add the secret store secrets there.

Secret Store ID: `1e5b0170484843c69f8b9bb71c055468`

* As options are limited in the Secret Store beta, we are using the _default secret store_ in the Franklin (Dev) account.
* And use a common prefix `SPARK_` for individual secrets, to avoid conflicts with other workers.
* Ideally this should be a dedicated secret store just for `spark`. In which case we would not need the prefix.

| Name in Secret Store | Variable Name in Code | Description | Rotation |
|----------------------|-----------------------|-------------|----------|
| `SPARK_COOKIE_SECRET` | `COOKIE_SECRET` | Secret used to sign the session cookie. Must be a cryptographically secure random string of characters, base64 encoded, 32 bytes or more. | TODO: weekly? need to implement 2 secrets for rotation.<br><br>Manually rotate by generating new secretvalue using `openssl rand -base64 32` and updating secret store. Note: will currently immediately end all existing sessions. |
| `SPARK_DM_CLIENT_ID` | `DM_CLIENT_ID` | Client ID for the DM IMS technical account used to access `DM_ORIGIN`. From [Adobe developer console](http://developer.adobe.com/console) project with access to the right delivery environment and DM API access. | Only changed if the DM IMS technical account is changed, e.g. new developer console project. |
| `SPARK_DM_CLIENT_SECRET` | `DM_CLIENT_SECRET` | Client secret for the DM IMS technical account used to access `DM_ORIGIN`. From [Adobe developer console](http://developer.adobe.com/console) project with access to the right delivery environment and DM API access. | Manually rotate in [Adobe developer console](http://developer.adobe.com/console) and then update in secret store. |
| `SPARK_HELIX_ORIGIN_AUTHENTICATION` | `HELIX_ORIGIN_AUTHENTICATION` | AEM EDS authentication token. | TODO: possible using Helix admin APIs? |
| `SPARK_PUBLISH_API_USER` | `PUBLISH_API_USER` | AEM CS user in the format of `<user>:<password>`. Used for proxying requests to AEM publish environment for certain features not re-implemented in the new portal yet. Must be available on the publish environment. Must have impersonation rights for all portal users on publish. Current user id: `spark-contenthub`. | Manually rotate in AEM CS and then update in secret store. |
| `SPARK_SMTP_USERNAME` | `SMTP_USERNAME` | Email address for SMTP authentication (e.g., `noreply@example.com`). This is the Microsoft 365 mailbox that sends emails. | Only if the sending mailbox changes. |
| `SPARK_MICROSOFT_ENTRA_CLIENT_SECRET` | `MICROSOFT_ENTRA_CLIENT_SECRET` | Client secret for the Microsoft Entra app registration. Used for both user login and SMTP OAuth2 authentication. | **Max 24 months.** Rotate in Microsoft Entra Admin Center before expiration. See [SMTP OAuth2 Configuration](#smtp-oauth2-configuration). |


### CI secrets

These secrets need to be configured in the CI (Github Actions) and are used for deployment and secret rotation workflows.

| Variable | Description |
|----------|-------------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token used to deploy workers and rotate secrets via [Github Actions](../.github/workflows/). |


## Cloudflare Resource Configuration

### KV Namespaces

This worker uses the following [Cloudflare KV](https://developers.cloudflare.com/kv/) namespaces:

| Namespace Name | Binding | Contents |
|----------------|---------|-------------|
| `spark-auth-tokens` | `env.AUTH_TOKENS` | Authentication tokens for various origins |
| `spark-saved-searches` | `env.SAVED_SEARCHES` | Saved searches from users |
| `spark-rights-requests` | `env.RIGHTS_REQUESTS` | Rights requests |
| `spark-rights-request-reviews` | `env.RIGHTS_REQUEST_REVIEWS` | Review results of rights requests |
| `spark-messages` | `env.MESSAGES` | Notifications for users |

### D1 Database

This worker uses [Cloudflare D1](https://developers.cloudflare.com/d1/) for relational data storage:

| Database Name | Binding | Contents | Schema |
|---------------|---------|----------|--------|
| `spark-user-logins` | `env.USER_LOGINS` | User login data for reporting | [user_logins.sql](./schema/user_logins.sql) |

**Note:** D1 is only available in production deployments. Branch/preview deployments automatically exclude D1 bindings. See [Cloudflare Resources across Environments](#cloudflare-resources-across-environments) for details.

### Analytics Engine

This worker uses [Cloudflare Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/) for event tracking:

| Dataset Name | Binding | Purpose |
|--------------|---------|---------|
| `spark_analyticstest` | `env.KO_ANALYTICS_ENGINE_TEST` | User activity tracking (search, download, login events) |

**Note:** Analytics Engine writes work in all environments (writes to production index). SQL API reads are available in production and branch deployments but not in local development.

## Permission Configuration

Permissions for access the application and controlling access to assets is configured via AEM EDS sheets authored in [Document Authoring](https://docs.da.live/authors/guides/editing-sheets).

The following sheets are used:

| Sheet | Description |
|-------|-------------|
| `/config/access/application` | Application permissions. |
| `/config/access/companies` | Company content permissions (by email domain) |
| `/config/access/users` | User content permissions (by email address) |

### Application Permissions

Authored at `/config/access/application`.

General notes:
* Users or companies/domains MUST be listed here to be allowed to access the application. To give access to all users that the IDP allows for this application, add a row with `*` for the email address.
* Permissions from domain, email and `*` are all considered if they match for a given user.

| Column | Values| Description |
|--------|-------|-------------|
| `email` |  | Email address (to address a user) or domain (to address a company) or `*` for any user allowed by the IDP. |
| | `example.com` | Domain to address a company. Matches all users with an email address ending in `@example.com`. |
| | `user@example.com` | Email address to address an individual user. |
| | `*` | Any user allowed by the IDP. |
| `permissions` | | Comma separated list of permissions |
| | `preview`  | User has access to preview environments (eg. https://preview.frescopamedia.com), including branch deployments for development. |
| | `sudo` | User can use the impersonation/user simulation feature. |
| | `admin-reports` | User has access to system reports |
| | `admin-rights` | User has access to rights reviews (can assign to self or other reviewers) |
| | `manage-rights` | User has access to rights reviews (can assign to self) |
| | `admin-system` | User receives system notifications (OAuth token refresh status, client secret expiration alerts) |



### Content Permissions

General notes:
* Both company and user permissions will apply for a given user if they match their email address or domain.
* If a user has no country configured in either companies or users sheets, the country field from the IDP will be used.

#### Company permissions

Authored at `/config/access/companies`.

This has sheets for each role: `customer`, `partner`, `agency`, `employee` and `contingent-worker`.

##### `customer` sheet

| Column | Values | Description |
|--------|--------|-------------|
| `domain` | `customer.com` | Domain of the customer company. Matches all users with an email address ending in `@customer.com`. |
| `name` | `customerX` | Exact value used in the `custom:intendedCustomers` asset metadata field. |

##### `partner` sheet

| Column | Values | Description |
|--------|--------|-------------|
| `domain` | `partner.com` | Domain of the partner company. Matches all users with an email address ending in `@partner.com`. |
| `countries` | `us, ca, es` | Comma separated list of partner countries the company has access to. 2 letter ISO code. Examples: `us`, `ca`, `es`. |

##### `agency` sheet

| Column | Values | Description |
|--------|--------|-------------|
| `domain` | `agency.com` | Domain of the agency company. Matches all users with an email address ending in `@agency.com`. |

##### `employee` sheet

| Column | Values | Description |
|--------|--------|-------------|
| `domain` | `company.com` | Email domain. Matches all users with an email address ending in `@company.com`. |
| `employeeType` | `10` | Employee type field from users's Microsoft directory profile. Employee is typically `10`. If empty, this field will be ignored.  |

##### `contingent-worker` sheet

| Column | Values | Description |
|--------|--------|-------------|
| `domain` | `company.com` | Email domain. Matches all users with an email address ending in `@company.com`. |
| `employeeType` | `11` | Employee type field from users's Microsoft directory profile. Contingent worker is typically `11`. If empty, this field will be ignored.  |

#### User permissions

Authored at `/config/access/users`.

| Column | Values| Description |
|--------|-------|-------------|
| `email` | `user@example.com` | Email address of the user. |
| `roles` | | Comma separated list of roles. Optional. Can be empty if it is set via the `companies` sheet already. |
| | `employee`  | Employee |
| | `contingent-worker`  | Contingent worker |
| | `agency`  | Agency |
| | `partner`  | Partner |
| | `admin`  | Can always see all content. ⚠️ Only for admin users. |
| `countries` | `us`, `ca`, `es` | Comma separated list of partner countries the user has access to. 2 letter ISO code. Optional. |
| `customers` | `customer1, customer2` | Comma separated list of customers the user has access to. Must use the exact value used in the `custom:intendedCustomers` asset metadata field. |


## SMTP OAuth2 Configuration

The worker sends emails (e.g., rights request notifications) using SMTP with OAuth2 (XOAUTH2) authentication via Microsoft 365.

> 💡 **For local development/testing:** See [LOCAL_EMAIL_TESTING.md](./LOCAL_EMAIL_TESTING.md) to use FakeSMTP instead of OAuth2.

### Overview

- Uses the same Microsoft Entra app registration as user login (`MICROSOFT_ENTRA_CLIENT_ID` / `MICROSOFT_ENTRA_TENANT_ID`)
- Requires `SMTP.Send` and `offline_access` delegated permissions with admin consent
- Authentication uses OAuth2 refresh tokens stored in `AUTH_TOKENS` KV

### Token Lifecycle

| Token Type | Validity | Storage |
|------------|----------|---------|
| Access Token | ~60-90 minutes | In-memory (per request) |
| Refresh Token | 90 days of inactivity | `AUTH_TOKENS` KV (`smtp_oauth_refresh_token`) |

The refresh token is automatically rotated on each use. A monthly cron job (`0 0 1 * *`) refreshes the token to prevent 90-day inactivity expiration. Users with the `admin-system` permission receive a notification on each successful refresh (or an alert if the client secret has expired).

### Initial Setup

#### Customer Setup Checklist

Before Adobe can complete the technical setup, the customer must configure the Microsoft Entra app:

- [ ] Add **SMTP.Send** permission (delegated) to the existing Spark app registration
- [ ] Grant admin consent for SMTP.Send permission
- [ ] Ensure **offline_access** permission is present (should already exist for login)
- [ ] Add redirect URI: `http://localhost:3939/callback` (for initial token generation)
- [ ] Create a client secret (max 24 months expiration) and share securely with Adobe

#### Technical Setup Steps

1. **Entra App Permissions**: Ensure the existing app registration has:
   - `SMTP.Send` (delegated) - admin consented
   - `offline_access` (delegated) - admin consented
   - Redirect URI: `http://localhost:3939/callback`

2. **Create Client Secret** (if not exists):
   - Go to Microsoft Entra Admin Center > App registrations > Spark App
   - Navigate to "Certificates & secrets" > "New client secret"
   - Set max expiration (24 months)
   - Copy the secret value

3. **Store Client Secret**:
   ```bash
   # Add to Cloudflare Secret Store
   npx wrangler secrets-store secret create 1e5b0170484843c69f8b9bb71c055468 \
     --scopes workers \
     --name SPARK_MICROSOFT_ENTRA_CLIENT_SECRET
   ```

4. **Generate Initial Refresh Token**:
   ```bash
   cd cloudflare/scripts
   ./email-oauth-setup.sh
   ```
   Sign in as the mailbox user (e.g., `noreply@example.com`) when prompted.

### Rotating the Client Secret

The client secret expires after max 24 months. To rotate:

1. Create a new client secret in Microsoft Entra Admin Center
2. Update `SPARK_MICROSOFT_ENTRA_CLIENT_SECRET` in Cloudflare Secret Store
3. The existing refresh token in `AUTH_TOKENS` KV remains valid

### Troubleshooting

| Error | Cause | Solution |
|-------|-------|----------|
| `invalid_client` / `AADSTS7000215` | Client secret expired or invalid | Rotate the client secret (see above) |
| `invalid_grant` | Refresh token expired (90 days inactive) | Re-run `email-oauth-setup.sh` to generate a new token |
| `SMTP OAuth not configured` | Missing client secret or refresh token | Check Secret Store and AUTH_TOKENS KV |

### Code Structure

Email-related code is located in `src/email/`:

```
src/email/
├── email.js              # Main email utility
├── email-templates.js    # Email templates
├── oauth-token-manager.js # OAuth2 token management
├── smtp-client.js        # SMTP client with XOAUTH2
└── __tests__/            # Unit tests
```
