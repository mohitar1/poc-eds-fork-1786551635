# Agentic Asset Metadata Enrichment for Per-Customer Demos — DETAILED PLAN

Three parts: **(1) Use case / Outcome / Flow → (2) Design → (3) Implementation**.
Every endpoint, header, status code, error path, limit, and edge case below is
grounded in the real repo (`assethub-spark`) and the AEM Assets Author API schema
(`master_quickstart/assets-api-schema/author`). No code written yet.

Legend: **[V#]** = must-verify-before-relying; **[EDGE]** = edge case with defined
handling; **[GROUNDED]** = confirmed in code/schema.

===============================================================================
# PART 1 — USE CASE / OUTCOME / FLOW
===============================================================================

## 1.1 Use case
When the Assets Hub portal is forked for a new prospect (e.g. Santander), the demo
must be coherent: rebranded UI **plus that customer's own assets**, and those assets
must be **searchable and filterable** in the portal. Today a fork gets a rebranded UI
but generic/unlabelled assets, so search + facets return nothing meaningful. We want
an **agent** that, given a customer, **intelligently writes real metadata onto that
customer's assets** so the portal's existing search + facets light up.

Transcript anchors:
- **Alex:** *"separate folders in AEM … get the metadata updated automatically, then
  query by that in the index … all queries have this customer equals something."*
- **Philipp (cherry):** pull sample assets from the prospect's website.
- **Mohit:** *"we have tokens, we can make the call."*

## 1.2 Outcome (success criteria, testable)
For a fork keyed to `customerKey` (e.g. `santander`):
1. Every asset in `/content/dam/<customerKey>` carries AI-generated per-asset
   `dc:title`, `dc:description`, `dc:subject`, and (where inferable) `productCategory`,
   `campaign`, `channel`, plus `company = customerKey` (scope) and `dam:status = approved`.
2. Portal search box returns those assets when queried by words in their generated
   title/description.
3. Portal facets (Campaign, Category, Channel, Keywords; Brand if inferable) show
   buckets and filter correctly by the generated values.
4. With the worker scope set, the portal shows **only** `company = customerKey` assets.
5. Re-running the agent changes nothing for already-enriched assets (idempotent).

## 1.3 Two experiments (separate)
- **E2 (PRIMARY)** — Enrich existing assets + scoped search. Updates metadata of
  assets **already in** the folder. This is Alex's ask.
- **E3 (CHERRY, separate)** — Ingest from the customer website. Brings **new** assets
  in from URLs, then reuses E2's enrichment + scope. Optional, later.

## 1.4 End-to-end flow (the controller)
```
[1] load config: customerKey -> damFolderPath=/content/dam/<customerKey>, company=customerKey (scope)
[2] acquire author token (reuse DM client_credentials)                     [Design 2.2]
[3] enumerate folder via searchAssets(startsWith repo:path)                [Design 2.4]
        |
        +-- hits > 0 ?
        |        yes -> assetSet = hits                    (Lane A: ENRICH-EXISTING)
        |        no  -> 0 hits = folder empty OR missing (same outcome: nothing to enrich)
        |                 if E3/upload requested: BRING-IN -> upload auto-creates folder,
        |                                          assetSet = new ids (Lane B)          [3a]
        |                 else: STOP "nothing to enrich" (actionable)
        v
[4] for each asset in assetSet (bounded concurrency):
        [4a] GET metadata (+ETag)                                          [Design 2.5]
        [4b] already-enriched? (company==customerKey AND dc:title present)
                 yes & !--force -> SKIP (report skipped)                   [EDGE-IDEMP]
        [4c] fetch small rendition (fallback to original)                  [Design 2.6]
        [4d] GENERATE metadata via vision/LLM -> normalize to facet vocab  [Design 2.7]
        [4e] stage row (bulk) OR PATCH now (per-asset)                     [Impl E2.3]
[5] WRITE: bulk metadata/import (preferred) OR per-asset PATCH             [Impl E2.3]
[6] PUBLISH in batches of <=10 -> poll jobs                                [Impl E2.3]
[7] REPORT: enriched / skipped / failed (per-asset), exit code            [Impl 3.6]
```
- **Why step 3 (enumerate) exists:** it's Lane A's *discovery* — the only way to learn
  which pre-placed assets to enrich (need each `assetId` for rendition + PATCH +
  publish). Lane B skips it (upload/import already return the ids). Detail in 2.4.
- Default lane = **ENRICH-EXISTING**. **BRING-IN** (E3/upload) only when 0 hits and
  explicitly requested; upload auto-creates the folder and feeds the SAME enrich step.

## 1.5 Trigger / invocation (how the skill is called)
This ships as **Phase C of the existing `customer-migration` skill**. Full mechanics in
**§3.9**; the essentials:

**The existing skill today = one skill, two phases** (run after a customer forks the
repo; grounded in `.claude/skills/customer-migration/SKILL.md`):
- **Phase A — Rebrand (via the Catalyst `excat` design skill).** Give the fork the
  customer's look + content: design tokens & typography, a hardcoded-asset-color sweep
  (SVG/background art), a content-register rewrite (real copy, not a name swap), publish
  via Document Authoring, and land it as a PR. Captures the **brand name** into
  `customer.name` (step A.1.c). Code is live only on merge (I3).
- **Phase B — Backend onboarding.** Get the fork actually running: Node/`npm install`,
  derive fork identity from `git remote`, verify AEM Code Sync, repoint Helix/README
  URLs, choose a **run tier** (preview / local-no-login / local-login), and — in
  **step B.7** — collect **Content Hub creds** (`SPARK_DM_CLIENT_ID/SECRET` into
  gitignored `cloudflare/.secrets`) + **`aemEnvId`**, apply auth mode, boot-verify real
  search. Optional opt-in deploy stage (`deploy.md`).
- Either phase can be skipped; a shared state file `.internal/onboarding-state.json`
  tracks intent + per-step status; invariants **I1** (outcomes-only language),
  **I2** (never handle raw secrets), **I3** (content live on publish, code live on
  merge), **I4** (skipping optional work is a valid end state) apply throughout.

**Phase C (this work) = "populate the customer's assets and make them searchable."** It
slots after B, and crucially **reuses A's `customer.name` and B.7's DM creds/`aemEnvId`
— so it asks for nothing new** (§3.9 reuse map).

**How the skill gets invoked (grounded in the repo's skill system).** Skills are
auto-selected by their `description` frontmatter (AGENTS.md: discover via
`./.agents/discover-skills`, then "use each skill based on its name and description").
`customer-migration`'s current description triggers on *"rebrand… get the portal running
locally… full migration/onboarding."* To make asset population reachable we **extend
that one `description` string** (§3.9) with asset-outcome language + verbs
("populate/bring in the customer's assets," "make the assets searchable," "fill the
portal with their content," "migrate/onboard"). No new skill is created — Phase C lives
inside the same SKILL.md, so the existing entry flow, state file, and I1/I2 invariants
apply unchanged.

**What the operator says → what runs:**
- Full onboarding — *"Onboard/Migrate/Set up the demo for Santander"* → entry flow runs
  A→B→**C**.
- Assets only (rebrand/backend already done) — *"Populate Santander's assets and make
  them searchable"* / *"Fill the portal with Santander's assets and tag them."* → routes
  straight to Phase C (its early steps re-derive what they need, like Phase B does).
- Cherry (E3) opted in by naming a source — *"…pull sample assets from santander.com…"*
  → BRING-IN lane; else ENRICH-EXISTING.

**Everything Phase C needs is already captured by A/B — nothing re-asked (§3.9 table):**
- **customerKey** ← `customer.name` (set in A.1.c), slugified (e.g. Santander→`santander`).
  Drives BOTH `/content/dam/<customerKey>` and the `company` scope value.
- **author credentials** ← the SAME `SPARK_DM_CLIENT_ID`/`SPARK_DM_CLIENT_SECRET` that
  Phase **B.7** already collected into gitignored `cloudflare/.secrets` (worker binding
  `DM_CLIENT_ID`/`DM_CLIENT_SECRET`). These are the author-capable DM creds (D-B). Read at
  call time, never from chat (I2).
- **aemEnvId** ← `customer.aemEnvId` (set in B.7).
- **source URL** ← only for the E3 cherry; optional.

**Customer-facing wording stays outcomes-only (I1)** — never "enrich," "metadata,"
"scope," "facet," "company field," "Phase C": e.g. *"I'll bring in <customer>'s assets
and make them easy to find — searching and filtering by what's in each image."*

===============================================================================
# PART 2 — DESIGN
===============================================================================

## 2.1 Locked decisions
- **D-A Path [RESOLVED]:** folder = convention **`/content/dam/<customerKey>`**,
  derived from `customerKey` (single source of truth). Scope value = `company` =
  `customerKey`, enforced as a **server-side authz term** (not a user-facing facet). For **enrich-existing** the folder is expected to be populated
  (0 hits ⇒ nothing to enrich, 2.4 [EDGE-FOLDER]); for **bring-in** the folder need not
  pre-exist — `initiateUpload` auto-creates missing `/content/dam/*` folders [GROUNDED].
  The agent never has to create an *empty* folder (nothing to enrich in one).
- **D-B Token [RESOLVED]:** reuse existing DM technical account — creds live as
  `SPARK_DM_CLIENT_ID`/`SPARK_DM_CLIENT_SECRET` in gitignored `cloudflare/.secrets`
  (mapped to worker binding `DM_CLIENT_ID`/`DM_CLIENT_SECRET`), collected in Phase B.7;
  confirmed author-capable. IMS `client_credentials` is scoped by **product profile, not
  host**, so the same token the worker uses for delivery also calls author hosts.
- **D-C Controller [RESOLVED]:** single controller (1.4); enrich-existing default,
  bring-in only when empty; idempotent re-runs. E2 primary, E3 cherry.

## 2.2 Author token (exact mechanics) [GROUNDED: dm.js createIMSToken/getIMSToken]
- **Grant:** `POST` to IMS token URL, `application/x-www-form-urlencoded`, body
  `grant_type=client_credentials`, `client_id=<DM_CLIENT_ID>`,
  `client_secret=<DM_CLIENT_SECRET>`, `scope=AdobeID,openid`.
- **Response:** `{ access_token, expires_in }`. Cache; refresh 5 min before expiry
  (mirror worker's `IMS_TOKEN_EXPIRY_BUFFER`).
- **Per-request headers on ALL author calls:**
  `Authorization: Bearer <token>`, `x-api-key: <DM_CLIENT_ID>`,
  `x-adobe-accept-experimental: 1`. **[V3]** whether `x-gw-ims-org-id: <IMS org>` is
  additionally required on author writes — confirm with one probe.
- The agent script reads the same secrets the worker uses; **no new secret**.

## 2.3 Host map (per operation) [GROUNDED from schema `servers:` blocks]
`AEM_ENV_ID = p203220-e2129061` (config.js). Exact prod hosts:
| Operation | Method + path | Prod host |
|---|---|---|
| Search / enumerate | `POST /assets/search` | `aem-converged-search-api.adobe.io/adobe/assets` |
| Get metadata (+ETag) | `GET /assets/{id}/metadata` | `aem-assets-management-api.adobe.io/adobe/assets` |
| Patch metadata | `PATCH /assets/{id}/metadata` | `aem-assets-management-api.adobe.io/adobe/assets` |
| Bulk metadata import | `POST /assets/metadata/import` | author host `/adobe/assets` (`/adobe/assets` routing) |
| Publish | `POST /assets/publish` | author host `/adobe/assets` |
| Job status | `GET /assets/jobs/{jobId}/status` | author host `/adobe/assets` |
| Initiate upload | `POST /assets` | `asset-management-service-api-prod-va6.adobe.io/adobe/assets` |
| Complete upload | `POST /assets/{id}/completeUpload` | `asset-management-service-api-prod-va6.adobe.io/adobe/assets` |
| Import from URL | `POST /assets/import/fromUrl` | `zy5vuvqzn1.execute-api.us-east-1.amazonaws.com/aem-assets/import-service-api/v1` |
| Import job status/result | `GET /assets/import/jobs/{id}/status|result` | same import-service host |
| Rendition/original | `GET /assets/{id}/renditions/{r}/as/{seo}` / `/original/as/{seo}` | author host `/adobe/assets` |
- **[V3]** Some paths also expose an env-relative `author-<AEM_ENV_ID>.adobeaemcloud.com`
  route; confirm which base the DM token+profile actually reaches. Resolve host per
  operation at startup with a single reachability probe (2.10).

## 2.4 Discovery & lifecycle — WHICH assets [GROUNDED]
Bounded by the customer folder; never "which assets?" guesswork.

**Why enumerate at all? (Lane A only.)** Enumeration exists solely to *discover assets
the agent did NOT place* — i.e. Alex's scenario where assets are already sitting in the
per-customer folder (from a migration or manual load). To enrich an asset the agent
must know it exists, because it needs the asset's **`assetId`** to (a) fetch a rendition
as vision-model input, (b) `GET`/`PATCH` its metadata (with `ETag`), and (c) add it to
the publish list. There is **no folder-listing op** in the author API other than search,
so `searchAssets(startsWith repo:path)` is the only metadata-based way to list a folder.
**Enumeration is skipped entirely for Lane B (bring-in/upload):** `initiateUpload` /
`importFromUrl` return every created `assetId`, so the agent already holds the list.

**Lane A — existing assets (E2 core).** `POST /assets/search`:
```json
{ "query": [ { "match": {
      "text": "/content/dam/santander",
      "mode": "FULLTEXT", "operator": "startsWith",
      "fields": ["repositoryMetadata.repo:path"] } } ],
  "limit": 50 }
```
- Query grammar [GROUNDED]: leaves are only `match|term|range|exists` (no wildcard);
  the ONLY path-capable operator is `match … operator:startsWith`
  (`MatchOperator = startsWith|matches`, `FullTextMatchQuery`).
- Each hit = `assetId` + `repositoryMetadata.repo:path` + `repo:name`.
- **Pagination [GROUNDED]:** response `cursor`; loop sending `cursor` back until
  absent. Page ≤50; `search_metadata.totalCount` capped at 10000
  (relation `eq|gte`) — [EDGE-PAGES] if `gte` at 10000, warn that the folder exceeds
  the addressable window and process in path-prefixed sub-batches.
- **[V-D1]** confirm `startsWith` on `repositoryMetadata.repo:path` is index-backed.
  If a 400 "unindexed" is returned, retry with `?allowUnindexedSearch=true`
  [GROUNDED param]; if still unavailable, fall back to the repository/Asset-Selector
  directory listing (opaque, Asset-Selector-only) or keep folders small.

**Lane B — new assets (E3/upload).** Agent creates them and already holds ids:
- **B1 upload [GROUNDED]:** `POST /assets` body
  `{ assets:[{ fileName, path:"/content/dam/santander", fileSize }] }` (max 1000) →
  response `data.assets[]` each `{ assetId, path, uploadURIs[], uploadToken,
  minPartSize, maxPartSize }` → PUT bytes to `uploadURIs` (chunk within part-size
  bounds) → `POST /assets/{assetId}/completeUpload` with `CompleteUploadAsset`
  (`uploadToken`). Processing then begins.
- **B2 import [GROUNDED]:** `POST /assets/import/fromUrl` → `getImportJobResult`
  returns per-item `{ fileName, assetId, status: imported|failed|processing, error? }`.

**[EDGE-FOLDER] folder missing or empty — resolved by lane [GROUNDED].**
There is **no folder GET/create op** in the author API (only asset `move` references a
parent). Crucially, **you don't need one**, and the "empty vs missing" ambiguity does
**not** affect behavior:
- **Bring-in / upload lane:** the folder need **not** pre-exist. `initiateUpload`
  auto-creates it — schema: *"If the path does not exist, missing folders will be
  created automatically … only paths under `/content/dam` are supported"* [GROUNDED,
  InitiateUploadAsset.yaml]. So uploading to `/content/dam/<customerKey>` **creates**
  the folder. `importFromUrl.folder` accepts *"the ID or path for the folder"*
  [GROUNDED, ImportTargetFolder.yaml]; if a path is rejected there, fall back to the
  upload lane (which always auto-creates). → **folder-missing is a non-issue for
  bring-in.**
- **Enrich-existing lane:** if the folder is missing OR empty, `searchAssets` returns
  **0 hits** either way — operationally identical: *nothing to enrich.* The agent does
  NOT need to distinguish the two, and never needs to create an empty folder (an empty
  folder has nothing to enrich). On 0 hits:
  - if bring-in was requested → switch to Lane B (upload auto-creates the folder, then
    enrich the new ids);
  - else → STOP with: *"No assets found under /content/dam/<customerKey> — nothing to
    enrich. Populate the folder (or run with bring-in) and retry."*
  This is correct conservative behavior, not a silent success. **[V6]** = confirm the
  folder is populated for the enrich demo (or rely on bring-in).

## 2.5 Idempotency & metadata read [GROUNDED: GET/PATCH /assets/{id}/metadata]
- `GET /assets/{id}/metadata` → `{ assetId, repositoryMetadata, assetMetadata }` +
  **`ETag`** header. Supports `If-None-Match` (304).
- **already-enriched test [EDGE-IDEMP]:** treat asset as enriched iff
  `assetMetadata.company === customerKey` AND `assetMetadata.dc:title` is non-empty.
  Skip unless `--force`. (Optionally also stamp a private marker like
  `assetMetadata.autotag:agentVersion` to make re-tag decisions version-aware; only
  if that key is writable/allowed — else rely on company+title.)
- Capture the returned `ETag` per asset for the per-asset PATCH path (2.9).

## 2.6 Rendition read (model input) [GROUNDED: renditions endpoints]
- Prefer a SMALL rendition: `GET /assets/{id}/renditions/{renditionName}/as/{seo}`.
- **[EDGE-RENDITION]** rendition set varies per asset/processing; if the chosen
  rendition 404s, fall back to `GET /assets/{id}/original/as/{seo}`, and if the
  original is huge, downscale client-side before sending to the model. Skip
  non-image mime types (from `repositoryMetadata.dc:format`) or handle per type.

## 2.7 Generation contract (the AI value-add)
- **Input:** the small rendition bytes + a few grounding hints (`repo:name`,
  existing `xcm:machineKeywords` if present, `dc:format`).
- **Output (strict JSON schema the script validates):**
  `{ title:string(<=80), description:string(<=200),
     keywords:string[](3..12), productCategory:enum|null,
     campaign:string|null, channel:enum|null }`.
- **Normalization:** map `productCategory`/`channel` to the existing facet vocabulary
  (from the live excFacets buckets, 2.8) via a controlled list; if no confident
  match → leave null (do NOT invent 1-off buckets). Keywords lowercased, de-duped.
- **Guardrails:** reject/repair outputs that aren't valid JSON or exceed lengths;
  never write empty strings (omit the field instead). `company` and `dam:status` are
  set by the script, NOT the model.

## 2.8 Searchability & filterability contract [GROUNDED: dynamicmedia-client.js + LIVE excFacets]
- **Free-text search hits EXACTLY 4 fields** (`buildMatchQuery`):
  `assetMetadata.dc:title`, `assetMetadata.autogen:title`,
  `assetMetadata.dc:description`, `assetMetadata.autogen:description` →
  generated **title→`dc:title`**, **description→`dc:description`**.
- **Live excFacets (use as-is; no new facets, no content edits):**
  | facet key | label | field path | agent fills? |
  |---|---|---|---|
  | `brand` | Brand | `assetMetadata.brand` | OPTIONAL (actual brand, if inferable) |
  | `campaign` | Campaign | `assetMetadata.campaign` | YES (if inferable) |
  | `productCategory` | Category | `assetMetadata.productCategory` | YES |
  | `channel` | Channel | `assetMetadata.channel` | YES (if inferable) |
  | `dc:subject` | Keywords | `assetMetadata.dc:subject` | YES (keyword array) |
  | `allowedCountries` | Country | `assetMetadata.allowedCountries` | NO (authz-governed) |
  | `internalStatus` | Internal Status | `assetMetadata.internalStatus` | NO (authz-governed) |
  | `dc:format` | Format | `repositoryMetadata.dc:format` | NO (system-derived) |
- **`company` is the SCOPE field, NOT a facet.** The agent writes
  `assetMetadata.company = customerKey` on every asset, but `company` is not an
  excFacet row, so it renders no chip — it's an **invisible server-side authz term**
  the worker injects (2.12), which is exactly Alex's "hard-code customer=X in the
  query." The user-facing searchable/filterable fields are the excFacet rows above.
- A selected facet → `term:{ '<path>':[values] }`. Because these are already excFacets
  rows and facetable-indexed, values become filters the moment they're written +
  published — **no facet registration**. **[V2]** sanity-check buckets return.

## 2.9 Write mechanics [GROUNDED]
**Bulk (preferred): `POST /assets/metadata/import`** — `multipart/form-data`, part
name **`file`**, UTF-8 CSV (RFC-4180):
- Header row: first col(s) must be `assetId` and/or `assetPath` (case-sensitive);
  neither present → **422**. Other columns are `prop[type]`. Empty cell = no change.
- Types: `string`, `string[]` (`"[""a"",""b""]"`), etc. Multi-value must be quoted
  with doubled quotes.
- Limits: file ≤ **10 MB** (else **413**); unsupported headers → **422** (detail
  "CSV file contains unsupported metadata headers.").
- Async: send `Prefer: respond-async, wait=<n>` [GROUNDED Prefer]; on **202** →
  `Location` → poll `GET /assets/metadata/import/jobs/{jobId}/status` →
  `.../result[/successes|warnings|errors]`. [EDGE-IMPORT-SPLIT] if >10 MB or many
  assets, split into multiple CSV jobs.

**Per-asset alt: `PATCH /assets/{id}/metadata`** [GROUNDED]:
- `Content-Type: application/json-patch+json` (RFC-6902), **`If-Match: <etag>`**
  required. Body e.g.
  `[{"op":"add","path":"/dc:title","value":"…"},{"op":"add","path":"/company","value":"santander"},{"op":"add","path":"/dam:status","value":"approved"}]`.
- **repositoryMetadata is read-only** — including it → **400** [GROUNDED].
- **ETag errors [EDGE-ETAG]:** **428** = If-Match missing; **412** = stale ETag
  (asset changed) → re-`GET` metadata, re-apply patch on fresh ETag, retry (bounded);
  **409** = conflict → same recovery.

## 2.10 Approval + publish [GROUNDED]
- **Approval:** stamp `assetMetadata.dam:status = "approved"` in the same write.
  **[V7-note]** exact key/casing per env: schema also models `dam:assetStatus`
  ({approved,rejected}); we standardize on **`dam:status=approved`** per decision, and
  the startup probe (2.11) confirms it's accepted (400/422 would flag a wrong key).
- **Publish:** `POST /assets/publish` body
  `{ assets:[urn…(≤10)], target:"AEM_PUBLISH"|"DYNAMIC_MEDIA" }` [GROUNDED enum].
  **Max 10/request** (>10 → 400). **200** = done sync; **202** → `Location` → poll
  `GET /assets/jobs/{jobId}/status` (`state: PROCESSING|…`) until terminal, then read
  per-asset success/failure. **[V1]** which target the portal's ContentAI/Content Hub
  index actually reads (`AEM_PUBLISH` vs `DYNAMIC_MEDIA`) — decides `target` and even
  whether publish is required at all.

## 2.11 Cross-cutting: auth/retry/limits/observability
- **401** on any author call → refresh IMS token once, retry.
- **429 / 5xx** → exponential backoff with jitter, bounded retries; respect
  `Retry-After` when present [GROUNDED: Retry-After header on some results].
- **Concurrency:** cap parallel per-asset work (e.g. 4–8) to avoid rate limits; the
  vision-model calls are the slow leg.
- **Startup probes (fail fast):** (a) token grant; (b) one `GET .../metadata` on any
  hit to confirm host+headers (**V3**); (c) a no-op/echo to confirm `dam:status` key
  acceptance; (d) `searchAssets` startsWith returns ≥0 without 400 (**V-D1**).
- **Dry-run mode:** run steps 3–4 (enumerate, read, generate, normalize) and emit the
  intended CSV/patches WITHOUT writing/publishing — for review before the live run.
- **Reporting:** per-asset outcome table (enriched|skipped|failed + reason); non-zero
  exit if any hard failures; machine-readable JSON summary artifact.

## 2.12 Scope mechanism (the "same value" guarantee)
- Write: agent sets `assetMetadata.company = customerKey` on every asset.
- Read: worker injects `term:{ 'assetMetadata.company':[customerKey] }` into search
  authz (Impl E2.4), mirroring existing country/internalStatus clauses.
- Same `customerKey` both sides → portal shows only that customer's assets.
- **Where `customerKey` comes from = the MIGRATION, not the session.** This is the
  customer the fork is being set up for (e.g. Santander), learned/established during
  onboarding and captured as `customer.name` in the migration state file
  (`.internal/onboarding-state.json`), slugified to `customerKey` (§1.5). It is a
  **per-fork constant baked into config at migration time**, exactly Alex's
  "hard-coded customer=X in the query."
- **NOT the session `idToken.Company`.** The worker's existing session field
  `user.company` (`user.js:207` = `idToken.Company`) is the **logged-in viewer's** org
  — e.g. an Adobe SE demoing Santander logs in with `Company = Adobe`, which would
  match **zero** Santander assets. So scoping must use the migration-time customer
  value, never the viewer's token. (We reuse the metadata *key name* `company`; the
  *value* is the customer, set by migration.)
- **Single scope source:** `config.DEMO_COMPANY = '<customerKey>'`, written into
  `cloudflare/src/config.js` by the migration (Phase C) when the fork is set up.
  Deterministic and independent of who logs in.

## 2.13 Where things run
- Enrich/read/write/ingest = **agent-side Node script** (one-time authoring action per
  fork), reusing DM creds. The **ONLY worker code change = E2.4**.

## 2.14 Does this require deployment? — NO (for the local demo) [GROUNDED]
The demo runs **locally** (Phase B tiers are all local-run; the Cloudflare deploy stage
is explicitly opt-in, I4). Nothing here needs a Cloudflare deployment:
- **Asset metadata writes + publish** call **AEM author/delivery APIs directly** — wholly
  independent of Cloudflare. Assets become searchable in the portal's DM/ContentAI index
  no matter where the portal front end runs. (This is the entire E2 outcome.)
- **The E2.4 scope change** edits `cloudflare/src/config.js` (`DEMO_COMPANY`), imported by
  `dm.js` at runtime. Phase B runs the worker via `wrangler dev`/miniflare (`npm run dev`),
  which simulates bindings — so the change is live on **local restart**. No merge, no CI,
  no `wrangler deploy`. (Same basis Phase B uses to say placeholder `wrangler.toml` ids
  are fine locally.)
- **Deployment is required ONLY IF** the customer wants the scoped demo on a **hosted**
  `.aem.live` URL — then it's Phase B's opt-in deploy stage (`deploy.md`): re-comment auth
  bypass, remote secrets, merge, remote deploy. Live on merge (I3). Not the default.
- Net: the core value (searchable/filterable customer assets) needs **only** AEM API calls
  + a local config edit + a `npm run dev` restart.

===============================================================================
# PART 3 — IMPLEMENTATION PLAN
===============================================================================

## 3.0 Deliverables
- `scripts/agent/enrich-assets.mjs` (or similar) — the controller + all lanes.
- Small modules: `ims-auth`, `author-client` (host map + retry), `enumerate`,
  `metadata-read`, `generate` (model), `normalize`, `write-bulk`, `write-patch`,
  `publish`, `report`.
- Worker change: E2.4 scope clause + unit tests.
- No new secrets; reads existing `SPARK_DM_CLIENT_ID`/`SPARK_DM_CLIENT_SECRET` from
  `cloudflare/.secrets` (binding `DM_CLIENT_ID`/`DM_CLIENT_SECRET`) at call time.

## E2 — Enrich existing assets + scoped search (PRIMARY)

### E2.1 Enumerate + read
- `searchAssets` startsWith loop with cursor pagination (2.4); collect
  `{assetId, repo:path}[]`.
- Per asset `GET .../metadata` (+ETag) (2.5); apply [EDGE-IDEMP] skip logic.
- Handle [EDGE-PAGES], [EDGE-FOLDER], [V-D1] as specified.

### E2.2 Generate (model)
- Fetch small rendition (2.6, [EDGE-RENDITION]); call vision model; validate + repair
  to the strict JSON schema; normalize to facet vocabulary (2.7); drop empty fields.

### E2.3 Write + publish
- Default **bulk**: build one CSV (2.9) with columns
  `assetPath,dc:title[string],dc:description[string],dc:subject[string[]],productCategory[string],campaign[string],channel[string],company[string],dam:status[string]`
  (optional extra `brand[string]` column when brand is inferable);
  POST multipart `file`; `Prefer: respond-async`; poll job; read successes/errors.
  Split on 10 MB / large sets [EDGE-IMPORT-SPLIT].
- **Per-asset fallback**: `PATCH` with `If-Match` (2.9), ETag-retry [EDGE-ETAG].
- **Publish** ≤10/batch (2.10); poll jobs; record per-asset publish results. Target
  per **[V1]**.

### E2.4 Worker scope (ONLY worker change) [GROUNDED code targets]
- **File:** `cloudflare/src/origin/dm.js`, function `buildAssetAuthClauses(request, env)`
  (~L559). After the country/internalStatus clauses, add:
  ```js
  // config.DEMO_COMPANY is the migration-time customer key (per fork), NOT the
  // viewer's session company — see 2.12.
  if (config.DEMO_COMPANY) {
    clauses.push({ term: { 'assetMetadata.company': [config.DEMO_COMPANY] } });
  }
  ```
  (admins still bypass via the early `return []`.)
- **Config:** add `DEMO_COMPANY: '<customerKey>'` (or `null`) to `cloudflare/src/config.js`.
  This is written by the migration (Phase C) when the fork is set up; it is the customer
  the fork is for, NOT `request.user.company`/`idToken.Company` (the viewer's org).
- **Mirror:** `cloudflare/src/origin/asset-access.js` `checkAssetMetadataAuthorization`
  already understands `term` clauses (it validates `internalStatus`), so a company
  `term` is enforced consistently; add a focused test.
- **Tests:** in `cloudflare/src/origin/__tests__/dm.test.js` `describe('buildAssetAuthClauses')`
  (~L786), following the existing `internalStatusClause` pattern:
  - adds `{ term: { 'assetMetadata.company': ['santander'] } }` when `DEMO_COMPANY` set;
  - omits it when `DEMO_COMPANY` null;
  - scope value comes from `config.DEMO_COMPANY`, NOT from `request.user.company` (assert
    a viewer whose session `company` differs still gets the configured customer's term);
  - admin still returns `[]` (bypass);
  - coexists with country + internalStatus clauses;
  - `forceContentAISearchFilter` injects the company term (extend ~L694 block);
  - `checkAssetMetadataAuthorization` violates when `assetMetadata.company` != customerKey.
- **Run:** `npm test` (vitest) — all green.

**E2 done when** the 5 outcome criteria (1.2) hold on a real folder.

## E3 — Ingest from customer website (CHERRY, Lane B2)
1. `scrape-webpage` skill on the prospect URL → local images + source URLs + metadata.
2. Target `/content/dam/<customerKey>` — need NOT pre-exist; upload auto-creates it, and
   `importFromUrl.folder` accepts an ID or path [GROUNDED]. ([EDGE-FOLDER], [V6].)
3. `POST /assets/import/fromUrl` (optionally `assetMetadata.company=<customerKey>` at
   import); poll status; `getImportJobResult` → `{assetId,status}` per item.
   Prod host: `zy5vuvqzn1.execute-api.us-east-1.amazonaws.com/aem-assets/import-service-api/v1`.
   [EDGE-HOTLINK] if a source URL is protected → stage on a public URL (Cloudflare R2)
   and import that, or use Lane B1 upload with the scraped bytes.
4. Feed returned `assetId`s into E2.1(read)→E2.2→E2.3.

## 3.5 Sequencing (de-risk first)
1. **Startup probes / spikes (V3, V-D1, V1, dam:status key):** token grant; one
   `GET metadata`; `searchAssets` startsWith on a real folder (pagination); a single
   `PATCH dc:title+company+dam:status` on ONE asset; `publish` it; confirm it appears
   in the portal search and filters by Category/Keywords. This one spike closes V1, V2,
   V3, V-D1, and the dam:status key at once.
2. **E2.4** worker scope + tests (independent, cheap).
3. **E2 full script** (enumerate→read→generate→bulk write→publish→report) with
   **dry-run** first, then live on the folder.
4. **E3 cherry** after V4/V5/V6.
5. **Ship as Phase C** of `customer-migration` — full mechanics in **§3.9** (extend the
   skill `description`; add the `asset-population` phase to the state schema; entry-flow
   routing; reuse B.7 creds + A.1.c `customer.name`; write `config.DEMO_COMPANY`).

## 3.6 Reporting & safety
- Dry-run mode (2.11) mandatory before first live run per customer.
- Per-asset JSON report + human summary; non-zero exit on hard failures.
- Idempotent re-run safe (2.5). `--force` to re-generate.

## 3.7 Verify matrix (blocking vs non-blocking)
| id | question | how to verify | blocks |
|---|---|---|---|
| V-D1 | is `startsWith` on `repo:path` index-backed? | run enumerate; watch for 400 unindexed; try `allowUnindexedSearch=true` | E2.1 |
| V1 | which publish target does the portal index read? | publish one asset to AEM_PUBLISH; if not visible, try DYNAMIC_MEDIA | E2.3 |
| V2 | do the facets return buckets once populated? | enrich one asset; check Category/Keywords facets in portal | E2 done |
| V3 | author host + headers (x-gw-ims-org-id?) | probe `GET metadata` with worker header set | all writes |
| dam:status | is `dam:status=approved` the accepted key? | PATCH it on one asset; 400/422 flags wrong key | E2.3 |
| V4 | import-service reachability/org context | probe importFromUrl (dev) | E3 |
| V5 | are prospect image URLs fetchable by AEM? | test import a couple URLs | E3 |
| V6 | folder populated for enrich demo? | enumerate returns hits; else use bring-in (upload auto-creates folder) | E2.1/E3 |

## 3.8 Missed-path checklist (explicit edge cases, all handled above)
- [EDGE-FOLDER] 0 hits = folder empty or missing (same outcome): STOP "nothing to
  enrich" or switch to bring-in. Upload auto-creates the folder; agent never creates an
  empty one. No disambiguation needed.
- [EDGE-PAGES] >10000 assets (totalCount `gte`) → sub-batch by sub-path.
- [EDGE-IDEMP] re-run → skip already-enriched unless `--force`.
- [EDGE-RENDITION] rendition 404 / non-image → fallback to original / skip by type.
- [EDGE-ETAG] 428/412/409 on PATCH → re-GET ETag, retry bounded.
- [EDGE-IMPORT-SPLIT] CSV >10 MB or large set → split jobs.
- [EDGE-HOTLINK] protected source URLs (E3) → stage public / upload bytes.
- 401 → token refresh+retry; 429/5xx → backoff (respect Retry-After).
- Model output invalid/oversized/hallucinated bucket → repair/normalize/drop field;
  company & dam:status never model-controlled.
- repositoryMetadata in PATCH → 400 (never include).
- publish >10 → 400 (always batch ≤10).

## 3.9 Stitching into `customer-migration` as Phase C (concrete)
The asset work is **not a standalone skill** — it becomes **Phase C** inside the existing
`.claude/skills/customer-migration/SKILL.md`, reusing its entry flow, state file, and
invariants. Six concrete edits:

**(1) Make it invocable — extend the skill `description` frontmatter** (the ONE field
that governs auto-selection). Add asset-outcome triggers so utterances like "populate/
bring in the customer's assets," "make the assets searchable," "fill the portal with
their content" route here — alongside the existing rebrand/backend/onboarding triggers.
Because it's the same skill file, `./.agents/discover-skills` and the session skill list
pick it up with no new registration.

**(2) Entry flow — add Phase C to routing + the entry question.** In the entry flow
(SKILL.md "Entry flow — run first"):
- `intent` gains coverage for assets. Simplest: keep the 3 existing values and treat
  Phase C as part of `full` (A→B→C); add a standalone route when the operator asks only
  for assets (analogous to `backend-only`). Map: "make my assets searchable / fill the
  portal" → run Phase C only; "onboard <customer>" → A→B→C.
- Extend the plain-language entry question with an assets outcome, e.g. add
  *"…and fill it with your own assets so they're searchable"* — still I1 (no "enrich/
  metadata/scope").
- Route to the first pending phase; entering Phase C directly is safe because C.1–C.2
  re-derive customerKey + creds from the repo/state at run time (same pattern as B.1–B.4).

**(3) State schema — add an `asset-population` phase block** to
`.internal/onboarding-state.json` (mirrors the existing phase shape):
```json
"asset-population": {
  "status": "in_progress",           // in_progress | done | not-requested (I4)
  "lastUpdated": null,
  "lane": null,                       // "enrich-existing" | "bring-in"
  "customerKey": null,                // slug of customer.name
  "assetSourceUrl": null,             // E3 cherry only
  "steps": {
    "customer-key-resolved": "pending",
    "author-access-verified": "pending",   // token+host probe (V3, dam:status, V-D1)
    "assets-resolved": "pending",           // enumerate (Lane A) OR bring-in (Lane B)
    "metadata-generated": "pending",        // AI generate + normalize
    "metadata-written": "pending",          // bulk import / PATCH
    "assets-published": "pending",          // publish + poll
    "scope-config-written": "pending",      // DEMO_COMPANY in config.js (local edit)
    "scope-applied-locally": "pending",     // restart npm run dev; miniflare picks it up (NO deploy)
    "search-scope-verified": "pending",     // portal shows only customer assets, facets light up
    "scope-deployed": "not-requested"       // OPT-IN only: hosted deploy via Phase B deploy stage (I4)
  }
}
```
Step values `pending|done|blocked`, `lastUpdated` per step — same convention as A/B.

**(4) Ordering & preconditions — Phase C runs after B.7.** It needs a working backend
context, so it's offered after the run-tier steps, and it hard-requires **B.7**
(Content Hub creds + `aemEnvId`). If a Phase-C-only invocation finds no
`cloudflare/.secrets` DM creds or no `customer.aemEnvId`, it drops into B.7 to collect
them first (don't re-implement collection). Everything else is reused (table below).

**(5) Reuse map — what Phase C takes vs newly needs:**
| Phase C needs | Source | New ask? |
|---|---|---|
| `customerKey` (folder + scope value) | `customer.name` (A.1.c), slugified | No |
| author token creds | `SPARK_DM_CLIENT_ID/SECRET` in `cloudflare/.secrets` (B.7) → binding `DM_CLIENT_ID/SECRET` (D-B) | No |
| `aemEnvId` | `customer.aemEnvId` (B.7) | No |
| DAM folder `/content/dam/<customerKey>` | convention (D-A); bring-in auto-creates | No |
| source website URL | operator, only for E3 cherry | Only for cherry |
| `DEMO_COMPANY` scope value | = `customerKey` (this phase writes it) | No |

**(6) Delegation — skill orchestrates, script executes.** The Phase C SKILL steps are
thin: resolve customerKey, ensure creds, then **invoke the enrich controller**
(`scripts/agent/enrich-assets.mjs`, §1.4/§3.0) passing `--customer-key`, the folder, and
the creds-file path; the script does all author API calls (enumerate→generate→write→
publish) and returns the per-asset report the step records.
- **Deployment is NOT required for the demo (see §2.14).** The metadata writes + publish
  hit AEM APIs directly (nothing to do with Cloudflare). The **E2.4 scope change** is a
  local edit to `config.js` (`DEMO_COMPANY`) that `dm.js` imports at runtime; it takes
  effect on the next `npm run dev` restart (miniflare simulates bindings — same basis on
  which Phase B says "placeholder resource ids in `wrangler.toml` are fine for local
  dev"). No merge, no CI, no `wrangler deploy`.
- **Only if** the customer later wants the scoped demo on a **hosted** `.aem.live` URL do
  the code changes follow Phase B's **opt-in deploy stage** (`deploy.md`) — merge + remote
  deploy — at which point I3 (code live only on merge) applies. Until then `scope-deployed`
  stays `not-requested` (I4). Phase C never surfaces internal terms (I1) or secrets (I2).

**Phase C completion report (outcomes-only):** which assets are now in the portal and
searchable; that filtering by image content works; that the (local) demo shows only this
customer's assets; any per-asset failures. Deployment is not part of this — the demo runs
locally; mention a hosted deploy only if the customer explicitly asked for one (then it's
the opt-in Phase B deploy stage, live on merge).

===============================================================================
# PART 4 — IMPLEMENTATION STATUS & WORKAROUNDS (as-built)
===============================================================================

This section records what is **actually implemented and working live** vs the
original design above, and — importantly — the **workarounds** we had to take
because the environment did not behave as the OpenAPI schema/plan assumed.

## 4.1 What is implemented and working (live-verified)

Everything runs against AEM Author env `p203220-e2129061`
(`https://author-p203220-e2129061.adobeaemcloud.com`), customer `acme`,
folder `/content/dam/acme`.

- **E2 — Enrich existing assets (PRIMARY): WORKING.**
  - Enumerate the customer folder, read per-asset metadata, idempotency-skip,
    generate metadata, normalize to the facet vocabulary, write, publish.
  - Live-verified: enrich + publish of the real `acme` asset; re-run is
    idempotent (already-enriched assets are skipped).
- **E3 — Bring-in from customer website (CHERRY): WORKING.**
  - `--source-url <url>` → scrape page for image URLs → bounded download →
    ensure folder exists → upload bytes → enumerate → enrich → publish.
  - Live-verified two ways: into the existing `acme` folder, and into a
    brand-new folder (auto-created). Probe assets/folders cleaned up after.
- **Worker search scoping (E2.4): WORKING** via `DEMO_COMPANY` in
  `cloudflare/src/config.js` (local-only, no deploy).
- **Tests + lint:** 165 agent unit tests pass; `eslint scripts/agent/` clean.
  All offline (injected `fetchFn` / fake clients), no creds or network needed.

## 4.2 Workarounds taken (and WHY) — the important part

### W1 — Pre-issued `AUTHOR_SPARK_IMS_TOKEN` instead of minting our own token
- **Plan assumed** (§2.2): acquire an author token ourselves via the DM
  `client_credentials` IMS grant and call the API with it.
- **Reality:** that DM technical-account client ID is **not allowlisted** for
  this AEM env, so author calls fail with `403 "IMS Client ID not allowlisted"`.
  Allowlisting requires the AEM Configuration Pipeline (Cloud Manager) — outside
  our control for the demo.
- **Workaround:** accept a **pre-issued bearer token** (`AUTHOR_SPARK_IMS_TOKEN`
  in `cloudflare/.secrets`, a Content-Hub session token,
  `client_id=aem-assets-content-hub-1`). When present, the agent uses it directly
  and skips the IMS grant. The DM `client_credentials` path remains as a fallback
  for when a properly allowlisted client is available.

### W2 — Classic Sling / Assets HTTP API instead of the converged OpenAPI (`/adobe/assets`)
- **Plan assumed** (§2.3): use the modern converged Assets API facade
  (`/adobe/assets/{id}/metadata`, `/adobe/assets/publish`,
  `/adobe/assets/metadata/import`) per the OpenAPI schema.
- **Reality with the demo token:** the converged facade is gated by an
  `x-api-key` the Content-Hub token does not carry:
  - `GET/PATCH /adobe/assets/{id}/metadata` → `403003 "Api Key is invalid"`.
  - `/adobe/assets/publish` and `/adobe/assets/metadata/import` → **not routed**
    on this host (`404`).
  - (Search happens to ignore the key, but reads/writes/publish do not.)
- **Workaround:** talk to the **classic AEM Author API** at the host root, which
  authenticates the **same bearer token with NO `x-api-key`** and supports the
  full lifecycle we need:
  - enumerate: `GET /api/assets/<relpath>.json?offset&limit` (HAL) → 200
  - read:      `GET /content/dam/<path>/jcr:content/metadata.json` → 200
  - write:     `POST /content/dam/<path>/jcr:content/metadata` (Sling POST) → 200
  - publish:   `POST /bin/replicate.json` cmd=Activate → 200
  - upload:    `POST /api/assets/<folder>/<file>` (raw bytes) → 201
  - folder:    `POST /api/assets/<folder>` (JSON descriptor) → 201
  - delete:    `DELETE /api/assets/<path>` → 200
  This is implemented as a **parallel runner** (`classic-client.js`,
  `classic-assets.js`, `enrich-classic.js`), selected automatically when the
  pre-issued token is present. The converged runner (`author-client.js`,
  `write-bulk.js`, `write-patch.js`, `publish.js`, `bring-in.js`) is kept intact
  for when a proper allowlisted client credential is provided.

### W3 — Explicit folder-create before upload (no auto-create on the classic path)
- **Plan/assumption:** the converged `initiateUpload` auto-creates missing parent
  folders, so bring-in need not create the customer folder.
- **Reality:** the **classic** create-asset call (`POST /api/assets/<folder>/<file>`)
  returns **500** if the parent folder does not exist.
- **Workaround:** `ensureFolderClassic` probes the folder listing and, if absent,
  creates it via `POST /api/assets/<folder>` with a JSON folder descriptor
  (verified 201) **before** uploading. This makes bring-in work for a genuinely
  new customer whose DAM folder does not yet exist.

### W4 — Deterministic (filename-based) metadata generator, not a vision model
- **Plan** (§2.7): pluggable generator; production should use a vision/LLM model.
- **Reality/scope:** no vision model is wired in this environment.
- **Workaround:** the default generator derives valid, plausible metadata from
  the filename so the pipeline is fully exercisable offline and the facets light
  up. `generate.js` is the single injection point to swap in a real model later.
  (Consequence: enrichment on freshly-uploaded bring-in assets is filename-quality
  until a vision generator is attached.)

### W5 — Regex-based scraper (no DOM parser dependency)
- **Reality/scope:** avoid adding a heavyweight HTML/DOM dependency to the repo.
- **Workaround:** `scrape-site.js` extracts image URLs with targeted regexes over
  `<img src|data-src|srcset>`, `<source srcset>`, and `og:image`/`twitter:image`
  meta tags; resolves relative URLs; validates by `Content-Type` at download.
  Download is bounded by `BRING_IN_MAX_IMAGES` / `--limit` and per-file
  `BRING_IN_MAX_BYTES`.

### W6 — Bring-in is classic-path only
- Bring-in (E3) is wired **only** into the classic controller (the working token
  path). It is not implemented on the converged runner. `--bring-in` without
  `--source-url` warns and no-ops.

## 4.3 Environment assumptions baked in (revisit if the token/env changes)
- The working token is a **Content-Hub session token** placed manually in
  `cloudflare/.secrets` as `AUTHOR_SPARK_IMS_TOKEN` (strip any leading `Bearer `).
  It can expire — the classic client refreshes once on 401 via the token provider,
  but a dead pre-issued token must be replaced by hand.
- Customer assets live in **AEM Author**, not the delivery/Content-Hub tier the
  worker proxies.
- If/when a **properly allowlisted** technical-account client ID becomes
  available, the converged runner (and §2.2/§2.3 as originally designed) can be
  used instead, and W1/W2/W3 fall away.

## 4.4 Status: still uncommitted
All of `scripts/agent/` is on branch `agentic-asset-enrichment`, **untracked /
uncommitted**. Commit when satisfied.

## Todos
Tracked in SQL `todos` (decisions locked; controller, D1 spike, E2.1–E2.4, B1 upload,
E3, phase-c-skill).

Blocked todos are the original **converged-API spikes** superseded by the
classic-path workaround (W2):
- `d1-discovery-spike` — converged `searchAssets startsWith repo:path` discovery
  (replaced by classic `GET /api/assets/<folder>.json`).
- `e2-spike` — converged enrich-one-asset spike (replaced by the classic runner,
  which is live-verified end-to-end).
