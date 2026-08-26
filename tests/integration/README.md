# Integration Tests

Smoke tests that hit real Spark endpoints (API + page loads) with your
session cookie. Tests are defined declaratively in `test-config.js` — no
per-feature test files needed.

## Quick Start

1. **Get your session cookie**
   - Open the site in your browser
   - DevTools → Application → Cookies
   - Copy the value of the `session` cookie for `frescopamedia.com`

2. **Export it**
   ```bash
   export TEST_SESSION_COOKIE="<paste cookie value>"
   ```

3. **Run tests**
   ```bash
   npm run test:integration            # Production (opens HTML report)
   npm run test:integration:local      # Local dev server
   npm run test:integration:preview    # Preview environment
   BRANCH=feat npm run test:integration:branch  # Branch deploy
   npm run test:integration:no-report  # Terminal only, no browser
   ```

   One-liner:
   ```bash
   TEST_SESSION_COOKIE="abc123" npm run test:integration
   ```

## What You Get

- **Terminal** — clean pass/fail summary with timing. Each test name includes the HTTP method and path (e.g. `GET /api/user`, `/en/search/assets`).
- **HTML report** — interactive report auto-opens in your browser after the
  run finishes (powered by `@vitest/ui`). The report lives at
  `tests/integration/report/index.html` and is gitignored.

## Feature Groups

Tests are organized by feature area in `test-config.js`:

| Group | API tests | Page tests | Description |
|-------|-----------|------------|-------------|
| `user` | `/api/user` | — | Current user profile |
| `search` | ContentAI search, collection search | `/en/search/assets` | Search endpoints and page |
| `reporting` | Report metrics, raw downloads, user logins CSV | 5 report pages | Analytics and admin reports |
| `collections` | — | `/en/search-collections`, `/en/collection-details` | Collection search and details |
| `rightsRequests` | List requests, reviews (assigned/unassigned), reviewers | My rights requests, my rights reviews | Rights request workflow |
| `rightsRequestReport` | Admin rights requests list | Rights request report page | Admin reporting |
| `savedSearches` | List/get saved searches | My saved searches page | Saved search management |
| `savedSearchReport` | Saved search report metrics | Saved search report page | Admin reporting |
| `notifications` | List notifications | My notifications page | User notifications |
| `contentStores` | — | All content stores page | Content store browsing |
| `localization` | — | Auto-generated `/ja/` variants | Japanese page variants (see below) |

## Localization Tests

The `localization` group is auto-generated at the bottom of `test-config.js`. It takes every `/en/` page from all other groups and creates a `/ja/` variant.

Pages under these paths are **excluded** from Japanese variants (EN_ONLY_PATHS):
- `/en/reports/` — reporting pages are English-only
- `/en/drafts/` — draft/content store pages are English-only

To add a path to the exclusion list, edit the `EN_ONLY_PATHS` array in `test-config.js`.

## Adding Tests

Edit `test-config.js` and add entries. The test runner picks them up
automatically — no new test files required.

```js
myFeature: {
  api: [
    {
      name: 'My endpoint works',
      method: 'GET',
      path: '/api/my-endpoint',
      expect: { status: 200, hasFields: ['data'] },
    },
  ],
  pages: [
    {
      name: 'My page loads',
      path: '/en/my-page',
      expect: { status: 200, contentType: 'text/html' },
    },
  ],
}
```

### Assertion options

| Key            | Type           | Description                                     |
|----------------|----------------|-------------------------------------------------|
| `status`       | `number\|number[]` | Expected HTTP status (or any-of list)        |
| `hasFields`    | `string[]`     | Dot-paths that must exist in JSON body           |
| `minLength`    | `{ field, min }` | Array field must have >= min items             |
| `nested`       | `{ path: type }` | Assert typeof for nested fields               |
| `contentType`  | `string`       | Response must contain this content-type          |
| `contains`     | `string[]`     | HTML body must contain each string               |

### Test options

| Key        | Type     | Description |
|------------|----------|-------------|
| `timeout`  | `number` | Per-test timeout in ms (overrides vitest default of 30s) |
| `skip`     | `string` | If set, test is skipped with this reason |
| `query`    | `object` | Query string params appended to the URL |
| `body`     | `object` | JSON request body (for POST) |
| `headers`  | `object` | Extra headers to send |

### Environment overrides

Use `expectByEnv` to set per-environment expectations:

```js
{
  expect: { status: 200 },
  expectByEnv: {
    local: { status: [200, 500] },   // local might not have all services
    production: { minLength: { field: 'hits', min: 100 } },
  },
}
```

## Environments

| `TEST_ENV` value | Target URL                                         |
|------------------|----------------------------------------------------|
| `production` (default) | `https://frescopamedia.com`      |
| `preview`        | `https://preview.frescopamedia.com`    |
| `local`          | `http://localhost:8787`                             |
| `branch:<name>`  | `https://<name>.dev.frescopamedia.com`     |

## Troubleshooting

**"TEST_SESSION_COOKIE is not set"**
→ Run `export TEST_SESSION_COOKIE="..."` in your terminal.

**401/403 errors**
→ Cookie expired — grab a fresh one from the browser.

**Admin report tests return 403**
→ Your user may lack the `admin-reports` permission. The tests accept
  403 as a valid response for report endpoints.

**Tests fail on local**
→ Make sure the dev server is running (`npm run dev`) and check that the
  feature is available locally.
