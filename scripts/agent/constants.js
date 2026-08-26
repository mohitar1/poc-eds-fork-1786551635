/**
 * Grounded constants for the asset-enrichment agent.
 *
 * Hosts, limits, headers, IMS parameters — all taken from the AEM Assets Author API
 * schema (assets-api-schema/author) and the worker's own DM integration (cloudflare/
 * src/origin/dm.js). See plan.md §2.2 / §2.3 for provenance.
 */

// --- IMS (mirror cloudflare/src/origin/dm.js) ---
export const IMS_TOKEN_URL = 'https://ims-na1.adobelogin.com/ims/token/v4';
// The AEM Author Assets HTTP API requires the broader AEM-as-a-Cloud-Service technical-
// account scope set (not just AdobeID,openid, which only reaches the delivery/Content Hub
// tier). Verified empirically: adding adobeio_api + the read_organizations/roles/
// projectedProductContext scopes flips the author host past the "missing required scopes"
// 403 to the env-side "client ID not allowlisted" gate.
export const IMS_SCOPE = [
  'openid',
  'AdobeID',
  'read_organizations',
  'additional_info.projectedProductContext',
  'additional_info.roles',
  'adobeio_api',
].join(',');
export const IMS_TOKEN_EXPIRY_BUFFER_SECONDS = 5 * 60;

// --- Per-request headers ---
export const HEADER_AUTHORIZATION = 'Authorization';
export const HEADER_API_KEY = 'x-api-key';
export const HEADER_EXPERIMENTAL = 'x-adobe-accept-experimental';
export const HEADER_IF_MATCH = 'If-Match';
export const HEADER_IF_NONE_MATCH = 'If-None-Match';
export const HEADER_PREFER = 'Prefer';
export const EXPERIMENTAL_VALUE = '1';

// --- Author API host map, keyed by logical operation (plan §2.3) ---
//
// The customer's assets live in AEM Author (author-<aemEnvId>.adobeaemcloud.com), NOT the
// delivery/Content Hub tier the worker proxies. Every op targets the same author host; the
// per-op paths (/assets/search, /assets/{id}/metadata, ...) start with /assets, so the base
// carries the /adobe prefix. Build the map per environment with buildHosts(aemEnvId).
export function buildAuthorHost(aemEnvId) {
  if (!aemEnvId || !/^p\d+-e\d+$/.test(aemEnvId)) {
    throw new Error(`buildAuthorHost: invalid aemEnvId "${aemEnvId}" (expected pNNN-eNNN)`);
  }
  return `https://author-${aemEnvId}.adobeaemcloud.com`;
}

export function buildHosts(aemEnvId) {
  const base = `${buildAuthorHost(aemEnvId)}/adobe`;
  return {
    search: base,
    metadata: base,
    metadataImport: base,
    publish: base,
    jobs: base,
    upload: base,
    rendition: base,
    importFromUrl: base,
  };
}

// --- Limits (grounded in schema) ---
export const SEARCH_PAGE_LIMIT = 50;
export const SEARCH_TOTALCOUNT_CAP = 10000;
// Folder enumeration scans the tenant repo and filters by repo:path prefix client-side,
// because the author search's field-scoped startsWith operator does NOT prefix-match
// repo:path (verified live: it only returns the exact full path, and match-alls on
// repo:ancestors). This caps how many assets we page through before giving up.
export const SEARCH_SCAN_CAP = 20000;
export const PUBLISH_BATCH_MAX = 10;
export const CSV_MAX_BYTES = 10 * 1024 * 1024;
export const UPLOAD_ASSETS_MAX = 1000;
export const IMPORT_FILES_MAX = 300;

// --- Publish targets (schema PublishTarget enum) ---
export const PUBLISH_TARGET = {
  AEM_PUBLISH: 'AEM_PUBLISH',
  DYNAMIC_MEDIA: 'DYNAMIC_MEDIA',
};

// --- Generated-metadata field limits (plan §2.7) ---
export const TITLE_MAX = 80;
export const DESCRIPTION_MAX = 200;
export const KEYWORDS_MIN = 3;
export const KEYWORDS_MAX = 12;

// --- Metadata keys we write (plan §2.8 / §2.10) ---
export const FIELD = {
  TITLE: 'dc:title',
  DESCRIPTION: 'dc:description',
  SUBJECT: 'dc:subject',
  PRODUCT_CATEGORY: 'productCategory',
  CAMPAIGN: 'campaign',
  CHANNEL: 'channel',
  BRAND: 'brand',
  COMPANY: 'company',
  STATUS: 'dam:status',
};

export const STATUS_APPROVED = 'approved';

// The DAM content root. The Assets HTTP API mirrors this tree under /api/assets.
export const DAM_ROOT = '/content/dam';

// --- Bring-in (E3: scrape a site -> upload) limits ---
// Sensible demo-scale bounds so a scrape can't run away or pull a huge binary.
export const BRING_IN_MAX_IMAGES = 25;
export const BRING_IN_MAX_BYTES = 15 * 1024 * 1024;
// Skip images smaller than this — typically icons, flags, or tiny renditions.
export const BRING_IN_MIN_BYTES = 10 * 1024;
export const BRING_IN_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif'];
