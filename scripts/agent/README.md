# Asset enrichment agent

A one-time authoring action, run per forked demo, that makes a customer's
assets **searchable and filterable** in the Assets Hub portal. It writes
AI-generated metadata (title, description, keywords, and — where inferable
— category, campaign, channel) onto the customer's AEM assets, stamps a
per-customer scope value plus `dam:status=approved`, and publishes them so
the portal's existing search + facets light up.

It is invoked by **Phase C** of the `customer-migration` skill
(`.claude/skills/customer-migration/SKILL.md`), but can also be run
directly. It introduces **no new secret** — it reuses the Content Hub
technical-account credentials collected during migration Phase B.7.

## What it does (controller flow)

The agent has **two runners**, chosen by how credentials resolve:

- **Classic-API runner (live/working path)** — used when a pre-issued
  `AUTHOR_SPARK_IMS_TOKEN` is present. Talks to the classic AEM Author
  Assets HTTP API (Sling), which authenticates a plain bearer token with no
  `x-api-key`. See the *Pre-issued token* section below.
- **Converged-API runner (fallback)** — used with the DM
  `client_credentials` flow against `/adobe/assets`; requires the client ID
  to be allowlisted for the environment.

Both share the same shape:

```
load config (customerKey -> /content/dam/<customerKey>, company scope)
  -> acquire author token (pre-issued bearer, or DM client_credentials)
  -> [bring-in, optional] with --source-url: scrape the site for images,
       ensure the customer folder exists, upload the images (classic only)
  -> enumerate the folder
       classic:   GET /api/assets/<folder>.json (HAL, recurses sub-folders)
       converged: match-all search + client-side repo:path prefix filter
  -> per asset (bounded concurrency):
       read metadata -> skip if already enriched (unless --force)
       generate metadata -> normalize to facet vocabulary
  -> WRITE
       classic:   Sling POST to <path>/jcr:content/metadata
       converged: bulk CSV import, or per-asset PATCH
  -> PUBLISH
       classic:   POST /bin/replicate.json (Activate) per asset
       converged: /adobe/assets/publish in batches of <=10, poll jobs
  -> REPORT (per-asset enriched/skipped/failed; exit non-zero on failure)
```

The metadata generator is pluggable. The default is **deterministic**
(derives fields from the filename) so the pipeline produces valid metadata
offline; wire a real vision/LLM generator in `generate.js` for production
quality.

## Usage

Run from the repo root with Node >= 18:

```bash
node scripts/agent/enrich-assets.js \
  --customer-key <customerKey> \
  [--dam-path /content/dam/<customerKey>] \
  [--bring-in --source-url <url>] \
  [--dry-run] [--force] [--no-publish] \
  [--write-mode bulk|patch] \
  [--publish-target AEM_PUBLISH|DYNAMIC_MEDIA] \
  [--concurrency <n>] \
  [--limit <n>] \
  [--secrets-file cloudflare/.secrets] \
  [--aem-env-id pNNN-eNNN] \
  [--report-file <path.json>]
```

**Always run `--dry-run` first** — it performs enumerate -> read ->
generate -> normalize and prints the intended CSV/patches **without**
writing or publishing anything.

### Flags

| Flag | Type | Default | Meaning |
|---|---|---|---|
| `--customer-key` | value | *(required)* | Customer slug; drives both `/content/dam/<key>` and the `company` scope value. |
| `--dam-path` | value | `/content/dam/<customerKey>` | Override the DAM folder. |
| `--bring-in` | bool | off | Lane B: bring **new** assets in from a source site before enriching (implied by `--source-url`). |
| `--source-url` | value | — | Source website to scrape images from for `--bring-in`. |
| `--dry-run` | bool | off | Preview only; no writes/publish. |
| `--force` | bool | off | Re-generate + re-write already-enriched assets. |
| `--no-publish` | bool | off | Stop before the publish step. |
| `--write-mode` | value | `bulk` | `bulk` (CSV import) or `patch` (per-asset JSON Patch). |
| `--publish-target` | value | `AEM_PUBLISH` | Publish target enum. |
| `--concurrency` | value | `4` | Parallel per-asset workers. |
| `--limit` | value | — | Cap the number of assets processed. |
| `--secrets-file` | value | `cloudflare/.secrets` | Where to read DM creds. |
| `--aem-env-id` | value | from `cloudflare/src/config.js` | AEM env id (`pNNN-eNNN`) → author host. |
| `--report-file` | value | — | Write the JSON report to this path. |
| `--fixture` | value | — | Offline preview from a fixture file (forces `--dry-run`). |

## Bring-in from a site (`--source-url`, classic path)

Passing `--source-url <url>` turns on the **bring-in** lane (E3): the agent
pulls the customer's own images off their website and lands them in the
customer folder, then the normal enrich → publish flow runs over them.

```bash
# Preview: scrape + download only (nothing is uploaded or written)
node scripts/agent/enrich-assets.js --customer-key acme \
  --source-url https://www.santander.com/en/home --limit 5 --dry-run

# Live: scrape -> ensure folder -> upload -> enumerate -> enrich -> publish
node scripts/agent/enrich-assets.js --customer-key acme \
  --source-url https://www.santander.com/en/home --limit 5
```

What happens on a live run:

1. **Scrape** (`scrape-site.js`) — fetch the page and extract image URLs from
   `<img src|data-src|srcset>`, `<source srcset>`, and `og:image`/`twitter:image`
   meta tags; resolve relative URLs; drop `data:`/empty.
2. **Download** — bounded by `--limit` (else `BRING_IN_MAX_IMAGES`) and a per-file
   byte cap (`BRING_IN_MAX_BYTES`); non-image and empty responses are skipped, and
   file names are sanitised/deduped with the extension taken from the `Content-Type`.
3. **Ensure folder** — the classic create-asset call does **not** auto-create
   missing parents, so `ensureFolderClassic` creates `/content/dam/<key>` first if
   it is absent.
4. **Upload** — `POST /api/assets/<folder>/<file>` with the raw bytes (per-file
   failures are captured, not fatal).
5. **Enumerate → enrich → publish** — the uploaded assets are discovered by the
   normal listing and flow through the standard pipeline uniformly.

`--dry-run` performs steps 1–2 (proving the scrape/download) but does **not**
upload, ensure the folder, or enrich — there is nothing in AEM yet to enumerate.

Bring-in currently runs on the **classic-API path only** (pre-issued
`AUTHOR_SPARK_IMS_TOKEN`). `--bring-in` on its own (no `--source-url`) warns and
is a no-op.

## Target host (AEM Author)

The customer's assets live in **AEM Author**, not the delivery/Content Hub
tier the worker proxies. Every call targets
`https://author-<aemEnvId>.adobeaemcloud.com/adobe/assets/...`. The
`aemEnvId` (`pNNN-eNNN`) resolves from `--aem-env-id` → `AEM_ENV_ID` env →
the worker's `cloudflare/src/config.js` (`AEM_ENV_ID`).

> **Environment prerequisite — client-ID allowlist.** The AEM Author
> Assets HTTP API only accepts a technical-account client ID that has been
> **allowlisted for the environment via the AEM Configuration Pipeline**
> (Cloud Manager config, api allowlist). Until then, every author call
> returns `403 "IMS Client ID not allowlisted"` even though the
> credentials and scopes are correct. The agent detects this and exits `3`
> with guidance.

## Credentials

No secret is passed on the command line or read from chat. Creds resolve
in this order:

1. `SPARK_DM_CLIENT_ID` / `SPARK_DM_CLIENT_SECRET` in the environment.
2. `SPARK_DM_CLIENT_ID` / `SPARK_DM_CLIENT_SECRET` in `cloudflare/.secrets`
   (collected in migration Phase B.7) — the default.
3. `SPARK_DM_CLIENT_ID` / `SPARK_DM_CLIENT_SECRET` in root `secret.env`.

The token is acquired via IMS `client_credentials` and used with
`Authorization: Bearer`, `x-api-key`, and `x-adobe-accept-experimental: 1`
headers on all author calls. The AEM Author Assets API requires the
broader AEM-as-a-Cloud-Service technical-account scope set (not just
`AdobeID,openid`, which only reaches the delivery tier):
`openid,AdobeID,read_organizations,additional_info.projectedProductContext,additional_info.roles,adobeio_api`.

### Pre-issued token (`AUTHOR_SPARK_IMS_TOKEN`) — the classic-API path

If `AUTHOR_SPARK_IMS_TOKEN` is set, it is used **verbatim** as the author
bearer token, **no `client_credentials` grant is performed**, and the agent
talks to AEM through the **classic Author Assets HTTP API** (Sling) rather
than the converged `/adobe/assets` facade. Resolution order: environment
-> `cloudflare/.secrets` -> root `secret.env`. A leading `Bearer ` is
stripped automatically.

**Why the classic API.** The converged `/adobe/assets/{id}/metadata`,
`/publish`, and `/metadata/import` endpoints route through the AEM I/O
gateway, which validates an `x-api-key` against a real registered key
belonging to the token's own client. A Content-Hub-issued demo token does
not carry such a key (metadata reads return
`403 {"error_code":"403003","message":"Api Key is invalid"}`, and
publish/import are not even routed → `404`). The **classic** author API,
by contrast, authenticates the same bearer token with **no `x-api-key`**
and supports the full lifecycle the demo needs. So when a pre-issued token
is present the agent uses these endpoints (host = the author root, no
`/adobe` prefix):

| Step | Endpoint |
|---|---|
| Enumerate | `GET /api/assets/<folder>.json?offset&limit` (HAL listing, recurses sub-folders) |
| Read metadata | `GET /content/dam/<path>/jcr:content/metadata.json` |
| Write metadata | `POST /content/dam/<path>/jcr:content/metadata` (Sling POST servlet; multi-value via `<prop>@TypeHint=String[]`) |
| Publish | `POST /bin/replicate.json` (`cmd=Activate`) |

This path needs **only** a valid author bearer token — no `x-api-key`, no
allowlisting, no `AUTHOR_SPARK_IMS_API_KEY`. `AGENT_DEBUG=1` prints each
request as a copy-pasteable curl with the bearer redacted to `$TOKEN`, and
per-asset failures (with status + exact response body) are printed to the
CLI as well as the `--report-file`.

When a pre-issued token is used, `SPARK_DM_CLIENT_ID`/`SECRET` are not
consulted at all. The agent falls back to the DM `client_credentials` flow
against the converged API **only** when `AUTHOR_SPARK_IMS_TOKEN` is unset
(that path additionally requires the client ID to be allowlisted for the
environment).

## Offline preview (`--fixture`)

Preview the full generate -> normalize -> CSV pipeline with no
credentials and no network. Provide a JSON array of assets:

```json
[
  {
    "assetId": "urn:aaid:aem:demo-1",
    "repoPath": "/content/dam/acme/hero-spring-campaign.jpg",
    "repoName": "hero-spring-campaign.jpg",
    "dcFormat": "image/jpeg",
    "assetMetadata": {}
  }
]
```

```bash
node scripts/agent/enrich-assets.js --customer-key acme --fixture assets.json
```

`--fixture` forces `--dry-run`; it never performs live writes.

## Report

The run records a per-asset outcome (`enriched`, `skipped`, `published`,
`failed`) and a summary. With `--report-file` it also writes a
machine-readable JSON summary:

```json
{
  "startedAt": "...",
  "finishedAt": "...",
  "counts": { "enriched": 12, "skipped": 3 },
  "assets": [ { "assetId": "...", "outcome": "enriched" } ]
}
```

The process exits non-zero if any asset hard-failed, so the caller can
gate on success.

## Idempotency

An asset is treated as already enriched when its `company` scope value
equals the customer key **and** it has a non-empty `dc:title`. Such assets
are skipped unless `--force` is passed, so re-runs are safe.

## Module map

| Module | Responsibility |
|---|---|
| `enrich-assets.js` | Controller + CLI entrypoint. |
| `config.js` | Arg parsing, `customerKey` -> paths, credential resolution. |
| `constants.js` | Hosts, headers, limits, field keys. |
| `ims-auth.js` | IMS token grant + cached refresh. |
| `author-client.js` | Author API client (host map, auth, 401/429/5xx retry). |
| `enumerate.js` | Folder discovery: match-all `search` scan (cursor pagination) filtered client-side by `repo:path` prefix, because the author search's field-scoped `startsWith` does not prefix-match `repo:path` in this lexical space. Bounded by `SEARCH_SCAN_CAP`. |
| `metadata.js` | Read metadata (+ETag); already-enriched test. |
| `rendition.js` | Fetch a small rendition (fallback to original). |
| `generate.js` | Metadata generation (deterministic default; pluggable vision). |
| `normalize.js` | Clean keywords, map to facet vocabulary, validate shape. |
| `csv.js` | Bulk metadata CSV (RFC-4180) + batching. |
| `json-patch.js` | Per-asset RFC-6902 patch body. |
| `write-bulk.js` | Multipart metadata import + job poll. |
| `write-patch.js` | Per-asset PATCH with ETag retry. |
| `publish.js` | Publish in batches of <=10 + poll. |
| `bring-in.js` | Upload / import-from-URL (converged Lane B). |
| `scrape-site.js` | Bring-in: extract image URLs from a page + bounded download. |
| `classic-client.js` | Classic Author (Sling) bearer-only HTTP client (`getJson`/`postForm`/`postBinary`/`postJson`). |
| `classic-assets.js` | Classic enumerate/read/write/publish + bring-in `ensureFolderClassic`/`uploadImagesClassic`/`deleteAssetClassic`. |
| `enrich-classic.js` | Classic-API enrichment controller (hosts the bring-in stage). |
| `concurrency.js` | Bounded-concurrency `map` helper. |
| `report.js` | Per-asset report, counts, exit code. |
| `fixture-client.js` | Offline client for `--fixture`. |

## Tests

```bash
# from the repo root
npx vitest run --project unit-tests scripts/agent
```

## Worker scope companion (Phase C)

Making the portal show **only** this customer's assets is a one-line local
config edit, applied by the worker at runtime:

```js
// cloudflare/src/config.js
DEMO_COMPANY: '<customerKey>', // null = unchanged upstream behaviour
```

`dm.js` injects `term: { 'assetMetadata.company': [DEMO_COMPANY] }` into
search authorization when set. It takes effect on the next `npm run dev`
restart — **no deployment required** for the local demo.
