# Spark — Complete System Architecture

> **Spark** is a digital asset management (DAM) portal (the **Assets Hub Spark** demo), built on Adobe Experience Manager Edge Delivery Services (AEM EDS) with a Cloudflare Worker gateway, backed by Adobe Dynamic Media (Content Hub).

---

## Table of Contents

1. [High-Level Architecture](#1-high-level-architecture)
2. [Technology Stack Summary](#2-technology-stack-summary)
3. [AEM Edge Delivery Services (EDS/Helix)](#3-aem-edge-delivery-services-edshelix)
4. [Cloudflare Worker — Edge Gateway](#4-cloudflare-worker--edge-gateway)
5. [Authentication](#5-authentication)
6. [Authorization](#6-authorization)
7. [Search & Asset Management](#7-search--asset-management)
8. [Reporting & Analytics](#8-reporting--analytics)
9. [Content Authoring & Management](#9-content-authoring--management)
10. [Deployment & CI/CD](#10-deployment--cicd)
11. [Local Development](#11-local-development)
12. [Data Storage & Bindings](#12-data-storage--bindings)
13. [Email & Notifications](#13-email--notifications)
14. [Key Design Patterns](#14-key-design-patterns)
15. [Building a Similar Portal — What You Need](#15-building-a-similar-portal--what-you-need)

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           USER'S BROWSER                                 │
│  ┌─────────────┐  ┌──────────────────┐  ┌─────────────────────────┐    │
│  │   EDS Pages  │  │  search-results  │  │  Report / My-* Blocks   │    │
│  │  (HTML/CSS)  │  │  (Vanilla JS SPA) │  │  (Vanilla JS)           │    │
│  └──────┬───────┘  └────────┬──────────┘  └───────────┬─────────────┘    │
└─────────┼────────────────────┼──────────────────────────┼────────────────┘
          │                    │                          │
          │ All requests to frescopamedia.com             │
          ▼                    ▼                          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    CLOUDFLARE WORKER (Edge Gateway)                       │
│                                                                          │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐  ┌────────────────────────┐  │
│  │  Auth    │  │  AuthZ    │  │  Routing   │  │  Analytics (write)      │  │
│  │  (Entra) │  │  (Config) │  │  (itty)    │  │  (Analytics Engine)     │  │
│  └────┬─────┘  └─────┬─────┘  └─────┬──────┘  └────────────────────────┘  │
│       │               │              │                                    │
│       ▼               ▼              ▼                                    │
│  ┌─────────────────────────────────────────────────────────────┐         │
│  │                    ORIGIN HANDLERS                            │         │
│  │  ┌───────┐  ┌──────────┐  ┌─────────┐                       │         │
│  │  │ Helix │  │ Dynamic   │  │  AEM     │                       │         │
│  │  │       │  │ Media     │  │ Publish  │                       │         │
│  │  └───┬───┘  └─────┬─────┘  └────┬────┘                       │         │
│  └──────┼─────────────┼─────────────┼───────────────────────────┘         │
└─────────┼─────────────┼─────────────┼────────────────────────────────────┘
          │             │             │
          ▼             ▼             ▼
┌──────────────┐ ┌────────────┐ ┌──────────┐
│  AEM EDS     │ │  Adobe DM  │ │  AEM CS  │
│  (Helix CDN) │ │  Content   │ │ Publish  │
│              │ │  Hub/AI    │ │          │
└──────────────┘ └────────────┘ └──────────┘
```

### Request Lifecycle (Complete Flow)

```
1. Browser → frescopamedia.com (DNS → Cloudflare)
2. Cloudflare Worker intercepts:
   a. TLS version check (reject TLS 1.0/1.1)
   b. CORS preflight handling
   c. Preview origin detection (preview.frescopamedia.com → .aem.page)
   d. Cookie parsing and decoding
   e. Auth router (login/logout/callback — unauthenticated)
   f. Public route matching (scripts, styles, blocks, icons)
   g. Authentication gate (validate Session JWT)
   h. Route-specific authorization
   i. Origin proxy (Helix, DM, Publish)
   j. Page-level access check (HTML meta exclude-roles)
   k. CORS headers applied
3. Response → Browser
```

---

## 2. Technology Stack Summary

| Layer | Technology | Purpose |
|-------|-----------|---------|
| CDN / Edge | Cloudflare Workers | Auth gateway, API proxy, analytics |
| Frontend Framework | AEM Edge Delivery Services (Helix) | Page rendering, block loading |
| UI Language | Vanilla JavaScript (ES modules) | All blocks, no framework |
| Content Authoring | DA (Document Authoring) | Authors write in Google Docs-like UI |
| Asset Search | Adobe ContentAI API | Full-text + faceted search |
| Asset Storage | Adobe Dynamic Media (Content Hub) | Asset metadata, renditions, downloads |
| Identity | Microsoft Entra ID (OIDC) | SSO for all users |
| Session | HS256 JWT in `Session` cookie | Stateless, 6h expiry |
| Config Store | EDS Spreadsheets (JSON) | Permissions, roles, brands, facets |
| KV Storage | Cloudflare KV | Saved searches, rights requests, notifications, tokens |
| SQL Database | Cloudflare D1 | User login tracking |
| Analytics | Cloudflare Analytics Engine | Downloads, searches, logins |
| Email | Office 365 SMTP (OAuth2) | Rights reminders, share notifications |
| CI/CD | GitHub Actions | Lint, test, deploy worker |
| Testing | Vitest (unit/DOM/integration/authz) | Multi-project test suites |

---

## 3. AEM Edge Delivery Services (EDS/Helix)

### What is EDS?

AEM Edge Delivery Services (formerly Project Helix) is Adobe's document-based web delivery platform. Content is authored in simple documents (Google Docs or Microsoft Word via DA), automatically transformed into optimized HTML, and served from a global CDN.

### Core Concepts

| Concept | Description |
|---------|-------------|
| **Blocks** | Reusable UI components (like React components but vanilla JS + CSS) |
| **Sections** | Page divisions separated by `---` in the authoring doc |
| **Default Content** | Regular HTML (headings, paragraphs, images) — no block needed |
| **Metadata** | Key-value pairs at bottom of doc → `<meta>` tags in HTML |
| **Spreadsheets** | Excel/Sheets → JSON APIs for configuration data |
| **Fragments** | Reusable content pieces embedded via `/fragments/...` paths |

### Load Pipeline (scripts.js)

```
┌─────────────────────────────────────────────────────────┐
│  EAGER (Critical Path / LCP)                             │
│  1. Fetch /api/user (authenticated user profile)         │
│  2. Check page access (redirect if unauthorized)         │
│  3. Show sudo banner (if impersonating)                  │
│  4. Decorate main content (sections, blocks, metadata)   │
│  5. Load + decorate first section (above the fold)       │
│  6. Load header block                                    │
└─────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  LAZY (Below the fold)                                   │
│  1. Load remaining sections                              │
│  2. Load footer block                                    │
│  3. Load lazy CSS                                        │
│  4. Initialize cart/download panels                      │
│  5. Initialize collection/share modals                   │
│  6. Initialize analytics (RUM/sampleRUM)                 │
└─────────────────────────────────────────────────────────┘
         │
         ▼ (3 second delay)
┌─────────────────────────────────────────────────────────┐
│  DELAYED                                                 │
│  1. Priority notifications check                         │
│  2. AEM user provisioning (template features)            │
└─────────────────────────────────────────────────────────┘
```

### Block Architecture (39 blocks)

#### Core Layout Blocks
| Block | Purpose |
|-------|---------|
| `header` | Navigation, locale, user profile, cart icon |
| `footer` | Site footer |
| `hero` | Hero banner (auto-built from h1 + picture) |
| `columns` | Multi-column layout |
| `tabs` | Tabbed content panels |
| `accordion` | Expandable/collapsible sections |
| `carousel` | Content slider |
| `cards` | Card grid |
| `fragment` | Embeds content from other pages |

#### Asset Management Blocks
| Block | Purpose |
|-------|---------|
| **`search-results`** | Primary search UI (~121 files) — facets, results, cart, details, downloads |
| `asset-details` | Standalone asset detail page |
| `content-stores` | Browsable curated asset libraries |
| `template-adapt` | Template customization editor (Chili iframe) |
| `search` | Simple search bar → redirects to search pages |
| `search-collection-results` | Search, create, manage, and share collections |
| `collection-details` | Single collection detail view |

#### User Workspace Blocks (`my-*`)
| Block | Purpose |
|-------|---------|
| `my-notifications` | In-app messages |
| `my-print-jobs` | Print job tracking |
| `my-rights-requests` | Rights clearance requests |
| `my-rights-reviews` | Rights review queue (reviewer) |
| `my-rights-review-details` | Individual review workflow |
| `my-saved-search` | Saved search management |
| `my-saved-templates` | Saved template management |

#### Reporting Blocks (`report-*`)
| Block | Purpose |
|-------|---------|
| `report-hub` | Central admin dashboard |
| `report-assets` | Asset usage analytics |
| `report-downloads` | Download activity report |
| `report-logins` | User login/activity report |
| `report-searches` | Search activity report |
| `report-saved-searches` | Saved search usage |
| `report-rights-requests` | Rights request analytics |

### Scripts Directory Structure

```
scripts/
├── aem.js                    # EDS core: block loading, RUM, utilities
├── scripts.js                # Project orchestration: loadPage, auth, roles
├── delayed.js                # Deferred init (notifications, provisioning)
├── analytics/                # Chart utilities for report blocks
├── collections/              # Collections API client
├── notifications/            # Messages client + priority modal
├── rights-management/        # Rights constants, reviewer config
├── saved-searches/           # Saved search client
├── share/                    # Share assets modal
├── utils/                    # Cart service, cart utilities
├── locales/                  # en.json, ja.json (i18n)
├── asset-transformers.js     # Metadata transformation layer
├── cart-state.js             # Cross-tab cart sync (BroadcastChannel)
├── download-cart-panels.js   # Global cart/download panel entry
├── aem-auth.js               # AEM SAML login for templates
├── locale-utils.js           # Locale paths, labels
└── toast/, modal-utils.js    # UI utilities
```

### Configuration (No fstab.yaml in repo)

| File | Purpose |
|------|---------|
| `head.html` | Loads aem.js, scripts.js, styles.css |
| `.hlxignore` | Excludes files from Helix deployment |
| Spreadsheets (in DA) | `configs`, `mime-types`, `restricted-brands` — fetched as JSON at runtime |

---

## 4. Cloudflare Worker — Edge Gateway

### Architecture Overview

The worker is an **itty-router v5** application that acts as the single entry point for all requests to `frescopamedia.com`. It terminates authentication, enforces authorization, proxies to multiple backends, and records analytics.

### File Structure

```
cloudflare/src/
├── index.js                  # Entry: router, routes, middleware
├── auth.js                   # OIDC login/callback/logout + session validation
├── user.js                   # User session creation, permissions, roles
├── origin/
│   ├── helix.js              # AEM EDS origin proxy
│   ├── dm.js                 # Dynamic Media (Content Hub) proxy + IMS auth
│   ├── dm-analytics.js       # Fire-and-forget DM event tracking
│   ├── publish.js            # AEM CS Publish proxy (Basic Auth + sudo)
│   ├── publish-routes.js     # Deny-by-default share router
│   ├── page-access.js        # HTML meta-based role filtering
│   └── asset-access.js       # Per-asset metadata authorization
├── api/
│   ├── analytics.js          # Report metrics + raw exports
│   ├── savedsearches.js      # Saved searches CRUD (KV)
│   ├── rightsrequests.js     # Rights workflow (KV)
│   ├── notifications.js      # Messages CRUD (KV)
│   ├── collections.js        # Collection share notifications
│   └── user-logins.js        # D1 user login export
├── util/
│   ├── helixutil.js          # Helix sheet fetching
│   ├── analytics-helper.js   # Analytics Engine write helper
│   ├── rights-request-util.js# Rights permission checks
│   ├── notifications-helpers.js
│   ├── constants.js          # Shared constants
│   └── itty.js               # CORS config
├── email/
│   ├── email-service.js      # Template-based email sending
│   └── oauth-token-manager.js# SMTP OAuth refresh
└── scheduled/
    ├── token-refresh.js      # Monthly SMTP token refresh
    └── rights-reminders.js   # Daily rights expiration check
```

### Route Map

| Priority | Path Pattern | Handler | Auth Required |
|----------|-------------|---------|---------------|
| 1 | `/auth/*` | authRouter | No |
| 2 | `/public/*`, `/scripts/*`, `/styles/*`, `/blocks/*`, `/icons/*`, `/fonts/*` | originHelix | No |
| 3 | `/public/download/original/*` | originPublishPassthrough | No |
| 4 | `/content/dam/*` (Basic Auth) | originPublishChili | No (Chili auth) |
| 5 | **Auth Gate** | withAuthentication | — |
| 6 | `GET /api/user` | apiUser | Yes |
| 7 | `/api/adobe/assets/*` | originDynamicMedia | Yes |
| 8 | `/api/savedsearches/*` | savedSearchesApi | Yes |
| 9 | `/api/rightsrequests/*` | rightsRequestsApi | Yes |
| 10 | `/api/messages/*` | notificationsApi | Yes |
| 11 | `/api/analytics/*` | analyticsApi | Yes |
| 12 | `/api/user-logins/csv` | exportUserLoginsCSV | Yes + admin-reports |
| 13 | `/content/share/*` | publishShareRouter | Yes |
| 14 | `/*` (catch-all) | originHelix + pageAccess | Yes |

### Origin Handlers

| Origin | Target | Auth Method | Purpose |
|--------|--------|-------------|---------|
| **Helix** | `main--assethub-spark--aem-showcase.aem.live` | Token header | EDS pages, CSS, JS |
| **Dynamic Media** | `delivery-p64403-e609778.adobeaemcloud.com` | IMS OAuth (cached in KV) | Asset search, metadata, downloads |
| **AEM Publish** | `author-p64403-e609778.adobeaemcloud.com` | Basic Auth + sling.sudo | Templates, print jobs, legacy share |

---

## 5. Authentication

### Flow: Microsoft Entra ID (OIDC)

```
┌──────────┐        ┌──────────────────┐        ┌────────────────────┐
│  Browser  │        │  Cloudflare       │        │  Microsoft Entra   │
│           │        │  Worker           │        │  (Azure AD)        │
└─────┬─────┘        └────────┬──────────┘        └─────────┬──────────┘
      │                       │                             │
      │  GET /auth/login      │                             │
      ├──────────────────────►│                             │
      │                       │                             │
      │  302 → MS authorize   │                             │
      │◄──────────────────────┤                             │
      │                       │                             │
      │  Redirect to MS login │                             │
      ├─────────────────────────────────────────────────────►│
      │                       │                             │
      │  User authenticates   │                             │
      │◄─────────────────────────────────────────────────────┤
      │                       │                             │
      │  POST /auth/callback  │  (id_token in form body)    │
      ├──────────────────────►│                             │
      │                       │                             │
      │                       │  Validate JWT (JWKS)        │
      │                       │  Create session             │
      │                       │  Track login event          │
      │                       │  Upsert D1 user record      │
      │                       │                             │
      │  Set-Cookie: Session  │                             │
      │  302 → /              │                             │
      │◄──────────────────────┤                             │
      │                       │                             │
```

### Session Cookie

| Property | Value |
|----------|-------|
| Name | `Session` |
| Algorithm | HS256 JWT |
| Secret | `COOKIE_SECRET` (Cloudflare Secrets) |
| Expiry | 6 hours |
| Payload | user email, name, userId, country, roles, permissions, brands, customers |
| Scope | `*.frescopamedia.com`, `Secure`, `HttpOnly`, `SameSite=None` |

### Supporting Cookies

| Cookie | Purpose |
|--------|---------|
| `State` | OIDC state + nonce (signed JWT, short-lived) |
| `LoginVisited` | Skip welcome page on return visits |
| `SUDO_*` | Impersonation overrides (admin only) |

### Dev Bypass

Setting `DISABLE_AUTHENTICATION=true` injects a fake admin user — used for local development.

---

## 6. Authorization

Authorization is **layered and config-driven** — permissions come from EDS spreadsheets, not hardcoded logic.

### Layer 1: Application Access (Permissions)

**Source:** `/config/access/application` spreadsheet (EDS JSON)

Permissions are matched by:
1. `*` (wildcard — all users)
2. Email domain (e.g. `@example.com`)
3. Specific email address

| Permission | Grants |
|------------|--------|
| `preview` | Access to non-production hosts |
| `admin-reports` | Analytics CSV exports |
| `manage-rights` | Rights reviewer workflows |
| `admin-rights` | Full rights admin |
| `sudo` | Impersonate other users |
| `admin-system` | System notifications |

### Layer 2: Roles and Entitlements

**Source:** `/config/access/companies` + `/config/access/users` spreadsheets

| Role | Source | Capabilities |
|------|--------|-------------|
| `admin` | Per-email grant | Full access, no filters |
| `employee` | Domain match | Standard access, no geo filter |
| `contingent-worker` | Domain match | Standard access, no geo filter |
| `agency` | Domain match | Standard access, no geo filter |
| `partner` | Domain match | Geo-restricted (country filter) |

### Layer 3: Brand Restrictions

**Source:** `/config/access/restricted-brands-index.json` + per-brand sheets

Brands can be restricted to specific email domains. Non-permitted users get `NOT` clauses injected into DM search queries.

### Layer 4: Dynamic Media Query Filters

Applied server-side in the Cloudflare worker before proxying to ContentAI:

```
Admin → No filters
Employee/Agency → Brand restrictions only
Partner → Brand restrictions + Country filter (custom:country)
No role → Block all results
```

### Layer 5: Per-Asset Metadata Check

Individual asset GETs are validated against the user's roles/country/brands in `asset-access.js`.

### Layer 6: Collection ACL

AEM metadata fields on collections:
- `custom:assetCollectionOwner` → full access
- `custom:assetCollectionEditor` → read/write
- `custom:assetCollectionViewer` → read-only

### Layer 7: Page-Level Access (HTML Meta)

After Helix returns HTML, the worker parses:
```html
<meta name="exclude-roles" content="agency, partner:us">
```
Excluded users get `302 → /404.html`.

### Layer 8: Section-Level Access (Frontend)

In `scripts.js`, sections with `data-roles` attribute are hidden client-side for non-matching roles.

### Authorization Flow Diagram

```
Request arrives (authenticated)
    │
    ├── Route-level check (admin-only for /config/access/*)
    │
    ├── API-level permission check (admin-reports for CSV exports)
    │
    ├── DM Search: inject auth clauses into query body
    │   ├── Brand restrictions (NOT clause)
    │   ├── Country filter (partners)
    │   └── Customer filter
    │
    ├── Asset GET: enforce metadata authorization
    │
    ├── Collection: check ACL fields
    │
    ├── Page HTML: check exclude-roles meta
    │
    └── Section: client-side role filtering
```

---

## 7. Search & Asset Management

### Search Engine: Adobe ContentAI

The search is **NOT** Algolia or Elasticsearch — it uses Adobe's ContentAI API (experimental), a semantic + structured search engine for AEM Assets.

### Search Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  search-results block (browser)                              │
│                                                               │
│  ┌──────────┐    ┌──────────────┐    ┌────────────────────┐  │
│  │  Facets   │    │  Results Grid │    │  Asset Details     │  │
│  │  Panel    │    │  (Cards)      │    │  Modal             │  │
│  └─────┬─────┘    └──────┬────────┘    └────────┬───────────┘  │
│        │                 │                      │              │
│        └─────────────────┼──────────────────────┘              │
│                          │                                     │
│                    ┌─────▼─────┐                               │
│                    │   State    │ (pub/sub store)              │
│                    │   Store    │                               │
│                    └─────┬─────┘                               │
│                          │                                     │
│                    ┌─────▼─────────────┐                       │
│                    │ dynamicmedia-     │                       │
│                    │ client.js         │                       │
│                    └─────┬─────────────┘                       │
└──────────────────────────┼────────────────────────────────────┘
                           │  fetch('/api/adobe/assets/contentai/search')
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  Cloudflare Worker                                            │
│                                                               │
│  1. Validate session                                          │
│  2. Build auth clauses (brands, country, customers)           │
│  3. Inject into search body                                   │
│  4. Proxy to Adobe ContentAI                                  │
│  5. Track search event (Analytics Engine)                     │
│                                                               │
└──────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  Adobe ContentAI Search API                                   │
│  (delivery-p64403-e609778.adobeaemcloud.com)                 │
└──────────────────────────────────────────────────────────────┘
```

### Search Request Pattern (3 parallel requests)

1. **Query request** — paginated results (cursor-based)
2. **Facets scope request** — facet counts scoped by other selections
3. **Facets include request** — exact counts for selected values

### State Management

No React, Redux, or Zustand. Custom lightweight pub/sub:

```javascript
// Central state in search-results.js
const state = { query, searchResults, dmImages, facets, cart, ... };
const listeners = new Set();

export function subscribe(listener) { listeners.add(listener); }
export function setState(updates) { Object.assign(state, updates); notify(); }
export function getState() { return state; }
```

**Persistence:**
- `localStorage` → Cart contents
- `sessionStorage` → Sort preferences, tags cache
- URL query params → Search filters, sort, assetId (deep links)
- `BroadcastChannel` → Cross-tab cart sync

### Cart & Download System

```
User selects assets → Cart (localStorage)
    │
    ├── Download (immediate) → /api/adobe/assets/{id}/as/{rendition}
    │
    └── Archive (bulk) → POST /api/adobe/assets/archives
        └── Poll for completion → Download ZIP
```

### URL-Based Routing (No SPA Router)

| URL Param | Purpose |
|-----------|---------|
| `query` | Search term |
| `facetFilters` | JSON-encoded facet selections |
| `numericFilters` | Date/size range filters |
| `rightsFilters` | Rights date, markets, media channels |
| `sortType` / `sortDirection` | Sort order |
| `assetId` | Deep link to asset detail |

Navigation uses `history.replaceState` (no page reload).

---

## 8. Reporting & Analytics

### Write Path (Event Collection)

Events are written via `ctx.waitUntil()` (fire-and-forget, never blocks response):

| Event Type | Trigger | Key Data |
|------------|---------|----------|
| `login` | Successful auth callback | userId, country, employeeType, roles |
| `search` | POST to ContentAI from search UI | searchTerm, searchType, resultCount |
| `download` | Asset download/archive | brand, campaign, resourceType, rendition |

**Privacy:** Uses `userId` (anonymized Entra User ID), not email.

### Analytics Engine Schema

| Field | Content |
|-------|---------|
| index1 | Event type (`login`, `search`, `download`) |
| blob1 | userId |
| blob2 | country |
| blob3 | employeeType |
| blob4 | company |
| blob5 | roles |
| blob6 | searchTerm / resourceType |
| blob7 | searchType / campaign |
| blob8 | brand |
| blob9–13 | downloadId, itemId, downloadType, rendition, publicationId |
| double1 | resultCount (searches) |

### Read Path (Report API)

```
Report blocks (browser)
    │
    │  GET /api/analytics/report-metrics?type=downloads&...
    ▼
Cloudflare Worker
    │
    │  SQL query → Cloudflare Analytics Engine SQL API
    ▼
Analytics Engine
    │
    │  Aggregated results
    ▼
Worker post-processing (role aliasing, geo→region, top-N)
    │
    ▼
JSON response → Chart rendering in report blocks
```

### D1 User Login Database

Every login upserts a record in `USER_LOGINS` (D1):
- Email, name, country, company, roles
- First login, last login timestamps
- Exportable as CSV for `admin-reports` users

### Report Blocks

Each `report-*` block:
1. Fetches `/api/analytics/report-metrics` with appropriate params
2. Processes data client-side (date ranges, aggregations)
3. Renders charts using shared `scripts/analytics/` utilities

---

## 9. Content Authoring & Management

### Document Authoring (DA)

Content lives at: `https://da.live/#/aem-showcase/assethub-spark`

Authors use DA (a Google Docs-like interface) to:
- Create pages (each doc = one web page)
- Add blocks using tables (first row = block name)
- Set page metadata (key-value pairs at end of doc)
- Manage navigation structure
- Create spreadsheets for configuration

### Content → HTML Pipeline

```
DA Document
    │
    │ (author saves/publishes)
    ▼
AEM Helix Pipeline
    │
    │ Transforms doc → semantic HTML
    │ Applies block markup conventions
    ▼
Helix CDN (aem.live / aem.page)
    │
    │ Served as static HTML + JSON
    ▼
Cloudflare Worker (proxy)
    │
    ▼
Browser (EDS scripts decorate blocks)
```

### Spreadsheet-Driven Configuration

| Spreadsheet | Purpose |
|-------------|---------|
| `configs` | General app configuration |
| `mime-types` | File type mappings |
| `restricted-brands` | Brand access control |
| `/config/access/application` | Permission grants |
| `/config/access/companies` | Domain → role/country mapping |
| `/config/access/users` | Per-user overrides |

### i18n / Localization

- URL prefix: `/en/`, `/ja/`
- Locale files: `scripts/locales/en.json`, `ja.json`
- DA placeholders for translated strings
- `locale-utils.js` handles path detection and label lookup

---

## 10. Deployment & CI/CD

### GitHub Actions Workflow

```yaml
# .github/workflows/main.yaml
Jobs:
  1. build         → npm ci && npm test && npm run lint (EDS)
  2. build-cloudflare → npm ci && npm test && npm run lint-ci (Worker)
  3. deploy-cloudflare → npm run deploy (after build-cloudflare passes)
```

### Deployment Targets

| Component | Deployment | Trigger |
|-----------|-----------|---------|
| EDS (Helix) | Automatic via AEM code sync | Push to `main` branch |
| Cloudflare Worker | `wrangler deploy` via CI | Push with cloudflare changes |
| Content | Author publish in DA | Manual publish |

### Worker Deployment

- CI (`release.yaml`/`build.yaml`) runs `wrangler deploy` directly; `deploy.sh` is for manual/local deploys only
- Creates GitHub Deployment with environment URL
- Routes: `frescopamedia.com/*` (production), `preview.frescopamedia.com/*` (Workers Custom Domain), `*.dev.frescopamedia.com/*` (branch previews)
- `workers_dev = false` — no `*.workers.dev` URLs in production

### Environments

| Environment | URL | Purpose |
|------------|-----|---------|
| Production | `frescopamedia.com` | Live users |
| Preview | `preview.frescopamedia.com` | Content preview (requires `preview` permission) |
| Helix Live | `main--assethub-spark--aem-showcase.aem.live` | Direct Helix access |
| Helix Preview | `main--assethub-spark--aem-showcase.aem.page` | Content staging |
| Local | `http://localhost:8787` | Developer machines |

---

## 11. Local Development

### Setup

```bash
npm install          # Installs root + cloudflare deps (postinstall)
npm run dev          # Runs local.sh → aem up + wrangler dev
```

### Local Stack

```
localhost:8787 (Cloudflare Worker - wrangler dev)
    │
    ├── /api/* → Real Adobe APIs (needs secrets)
    │
    └── /* → localhost:3000 (AEM CLI - aem up)
              │
              └── Serves local files (blocks, scripts, styles)
                  with content from DA/Helix
```

### Required Secrets (`cloudflare/.secrets`)

```
COOKIE_SECRET=...
DM_CLIENT_ID=...
DM_CLIENT_SECRET=...
```

### Authentication in Dev

- Set `DISABLE_AUTHENTICATION=true` in wrangler for no-auth dev
- Or copy a valid `Session` cookie from production browser

---

## 12. Data Storage & Bindings

### Cloudflare KV Namespaces

| Binding | Key Pattern | Data |
|---------|-------------|------|
| `AUTH_TOKENS` | `ims-token`, `smtp-refresh` | Cached OAuth tokens |
| `SAVED_SEARCHES` | `{email}:searches` | Per-user saved search JSON |
| `RIGHTS_REQUESTS` | `{requestId}` | Rights request records |
| `RIGHTS_REQUEST_REVIEWS` | `{reviewId}` | Reviewer assignments |
| `RIGHTS_REQUEST_REMINDERS` | `{reminderId}` | Expiration state |
| `MESSAGES` | `{email}:messages` | User notifications |

### Cloudflare D1

| Database | Table | Purpose |
|----------|-------|---------|
| `spark-user-logins` | `USER_LOGINS` | Login tracking for admin reports |

### Cloudflare Analytics Engine

| Dataset | Events |
|---------|--------|
| `spark_analyticstest` | login, search, download |

### Browser Storage (Client-Side)

| Storage | Data |
|---------|------|
| `localStorage` | Cart items, cart state |
| `sessionStorage` | Sort preferences, tags cache |
| URL params | Current search state |
| `BroadcastChannel` | Cross-tab cart synchronization |

---

## 13. Email & Notifications

### Email System

| Component | Technology |
|-----------|-----------|
| Provider | Office 365 SMTP |
| Auth | OAuth2 (refresh token in KV) |
| Templates | HTML templates in `email/` |
| Delivery | `ctx.waitUntil()` (non-blocking) |

### Email Triggers

| Event | Recipients |
|-------|-----------|
| Rights request submitted | Assigned reviewers |
| Rights request approved/denied | Requester |
| Collection shared | Share recipients |
| Rights expiration reminder | Request submitter |
| Usage expiration warning | Request submitter |

### In-App Notifications

- Stored in `MESSAGES` KV per-user
- Priority notifications shown as modal on page load
- Regular notifications in `my-notifications` block

### Scheduled Jobs (Cron)

| Schedule | Job |
|----------|-----|
| Monthly (1st) | SMTP OAuth token refresh |
| Daily (00:05 UTC) | Rights expiration + usage reminders |

---

## 14. Key Design Patterns

### 1. Edge-First Architecture
Everything routes through a single Cloudflare Worker. No direct backend access from browsers. Benefits: security, observability, single CORS origin.

### 2. Config-Driven Authorization
Permissions, roles, brands, and access rules live in EDS spreadsheets (JSON). Changes don't require code deploys — authors update spreadsheets in DA.

### 3. Defense in Depth
Seven layers of authorization from route-level to section-level. Each layer is independent and self-contained.

### 4. Fire-and-Forget Analytics
`waitUntil()` ensures analytics tracking never blocks user responses. Events are written to Analytics Engine and queried separately.

### 5. Token Caching
IMS tokens cached in KV with expiry buffers. Avoids token acquisition on every request.

### 6. Block-Based UI Composition
No monolithic SPA. Each feature is an EDS block that can be placed on any page via authoring. Blocks share state through global scripts.

### 7. Deny-By-Default
AEM Publish share routes explicitly allowlist paths. Unknown `.html` requests are blocked. Public routes are explicitly enumerated.

### 8. Spreadsheet as Database
User permissions, role mappings, brand restrictions — all stored in author-editable spreadsheets served as JSON. Simple to update, no migration needed.

### 9. Cross-Tab State Sync
Cart state synced across browser tabs via `BroadcastChannel` API. No server-side cart.

### 10. Progressive Enhancement
EDS loads in tiers (Eager → Lazy → Delayed). Critical auth and content first, then interactions, then background tasks.

---

## 15. Building a Similar Portal — What You Need

### Knowledge Requirements

| Area | What to Learn |
|------|---------------|
| **AEM Edge Delivery** | Block development, load pipeline, aem.js API, DA authoring, spreadsheets as JSON, content modeling |
| **Cloudflare Workers** | itty-router, KV, D1, Analytics Engine, Wrangler, Secrets, Cron triggers, `waitUntil` |
| **OIDC/OAuth2** | Microsoft Entra or similar IdP, JWT validation, session cookies, JWKS |
| **Adobe DM/Content Hub** | IMS authentication, ContentAI search API, asset metadata, renditions, archives |
| **Vanilla JavaScript** | ES modules, DOM manipulation, Custom Events, pub/sub pattern, no-framework SPA |
| **CSS Architecture** | BEM-like scoping, CSS custom properties, responsive design, font loading |

### Infrastructure You'd Need

| Component | Service | Alternative |
|-----------|---------|-------------|
| CDN/Edge Gateway | Cloudflare Workers | AWS CloudFront Functions, Vercel Edge |
| Page Delivery | AEM EDS (Helix) | Next.js, Astro, plain static hosting |
| Asset Storage | Adobe Dynamic Media | AWS S3 + CloudFront, Cloudinary |
| Search | Adobe ContentAI | Algolia, Elasticsearch, Meilisearch |
| Identity Provider | Microsoft Entra | Auth0, Okta, AWS Cognito |
| KV Store | Cloudflare KV | Redis, DynamoDB |
| SQL Database | Cloudflare D1 | PostgreSQL, PlanetScale |
| Analytics | CF Analytics Engine | Plausible, custom ClickHouse |
| Email | Office 365 SMTP | SendGrid, AWS SES |
| CI/CD | GitHub Actions | GitLab CI, CircleCI |
| Content Authoring | DA (Document Authoring) | CMS (Contentful, Sanity, Strapi) |

### Development Workflow

```
1. Author creates content in DA
2. Developer creates blocks (JS + CSS)
3. Blocks decorate authored HTML at runtime
4. Worker handles auth, proxies APIs
5. Push to main → CI tests → Worker deploys
6. Content publishes independently of code
```

### Key Files to Study First

| File | Why |
|------|-----|
| `scripts/scripts.js` | Understand the full load pipeline and role-based filtering |
| `cloudflare/src/index.js` | See complete routing and middleware chain |
| `cloudflare/src/auth.js` | OIDC implementation pattern |
| `cloudflare/src/user.js` | Permission/role resolution from config sheets |
| `cloudflare/src/origin/dm.js` | How DM proxy + auth filters work |
| `blocks/search-results/search-results.js` | State management and search orchestration |
| `blocks/search-results/clients/dynamicmedia-client.js` | ContentAI API integration |
| `blocks/header/header.js` | Navigation and profile integration |
| `scripts/cart-state.js` | Cross-tab state sync pattern |

### Estimated Complexity

| Component | Effort | Complexity |
|-----------|--------|-----------|
| EDS setup + basic blocks | 1-2 weeks | Low |
| Cloudflare Worker (routing + CORS) | 1 week | Medium |
| OIDC Authentication | 1-2 weeks | Medium-High |
| Authorization (config-driven) | 2-3 weeks | High |
| Search integration | 3-4 weeks | High |
| Cart + Downloads | 2 weeks | Medium |
| Reporting/Analytics | 2-3 weeks | Medium |
| User workspace (collections, saved searches) | 2-3 weeks | Medium |
| Admin features | 1-2 weeks | Medium |
| **Total (single developer)** | **~4-5 months** | — |

---

## Appendix: Environment Variables

### Cloudflare Worker (`wrangler.toml`)

| Variable | Purpose |
|----------|---------|
| `HELIX_ORIGIN` | AEM EDS origin URL |
| `AEM_ENV_ID` | AEM Cloud env (for DM and Publish hosts) |
| `DOMAIN_URL` | Production domain |
| `MICROSOFT_ENTRA_TENANT_ID` | Azure AD tenant |
| `MICROSOFT_ENTRA_CLIENT_ID` | OIDC client |
| `MICROSOFT_ENTRA_JWKS_URL` | Token validation |
| `SESSION_COOKIE_EXPIRATION` | Cookie TTL (6h) |
| `SMTP_HOST` / `SMTP_FROM` | Email config |
| `ANALYTICS_ACCOUNT_ID` | CF account for SQL API |
| `HELIX_PUSH_INVALIDATION` | Cache strategy toggle |

### Secrets (Cloudflare Secrets Store)

| Secret | Purpose |
|--------|---------|
| `COOKIE_SECRET` | JWT signing |
| `HELIX_ORIGIN_AUTHENTICATION` | EDS API token |
| `DM_CLIENT_ID` / `DM_CLIENT_SECRET` | Adobe IMS |
| `PUBLISH_API_USER` | AEM Publish Basic Auth |
| `MICROSOFT_ENTRA_CLIENT_SECRET` | OIDC client secret |
| `ANALYTICS_API_TOKEN` | CF Analytics SQL API |
| `SMTP_USERNAME` | Email OAuth |
