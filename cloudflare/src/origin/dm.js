/**
 * @fileoverview Dynamic Media Origin Handler
 *
 * This module handles all interactions with Adobe Dynamic Media (AEM Assets) including:
 * - IMS token management and caching
 * - Search request proxying and authorization
 * - Collection access control (owner/editor/viewer roles)
 *
 * Key Features:
 * - Transparent proxy to Adobe AEM Cloud delivery endpoints
 * - Role-based access control for assets (brands, countries, customers)
 * - Collection-level ACL enforcement (CRUD operations)
 * - Automatic IMS token caching with expiry handling
 *
 * Analytics tracking (downloads, archives, searches) is handled by dm-analytics.js.
 *
 * @module origin/dm
 * @requires ../user
 * @requires jose
 * @requires ../util/helixutil
 */

import { decodeJwt } from 'jose';
import config from '../config.js';
import {
  CollectionCreatedByMeVisibility,
  CollectionListSegment,
} from '../../../scripts/collections/collection-search-constants.js';
import { ROLE, USER_TYPE } from '../user.js';
import { resolveCountryMatchValues } from '../constants/countries.js';
import { enforceAssetMetadataAuthorization } from './asset-access.js';
import {
  extractSearchContext,
  handleArchiveAnalytics,
  handleDownloadAnalytics,
  handleSearchAnalytics,
} from './dm-analytics.js';

// ==========================================
// IMS Authentication Constants
// ==========================================

/** Adobe IMS token endpoint URL for OAuth server-to-server authentication
 * @constant {string}
 */
const IMS_TOKEN_URL = 'https://ims-na1.adobelogin.com/ims/token/v4';

/** Buffer time before token expiry to refresh (5 minutes in seconds)
 * @constant {number}
 */
const IMS_TOKEN_EXPIRY_BUFFER = 5 * 60;

/** IMS OAuth scope for Adobe ID and OpenID
 * @constant {string}
 */
const IMS_SCOPE = 'AdobeID,openid';

// ==========================================
// Adobe API Constants
// ==========================================

/** API key for AEM Assets Content Hub collections endpoint
 * @constant {string}
 */
const ADOBE_API_KEY_COLLECTIONS = 'aem-assets-content-hub-1';

/** Prefix for Adobe AEM Cloud delivery hostname
 * @constant {string}
 */
const ADOBE_DELIVERY_HOST_PREFIX = 'delivery-';

/** Suffix for Adobe AEM Cloud delivery hostname
 * @constant {string}
 */
const ADOBE_DELIVERY_HOST_SUFFIX = '.adobeaemcloud.com';

/** Header name for enabling experimental Adobe APIs
 * @constant {string}
 */
const ADOBE_EXPERIMENTAL_HEADER = 'x-adobe-accept-experimental';

// ==========================================
// Path Constants
// ==========================================

/** API path prefix to be removed when proxying
 * @constant {string}
 */
const PATH_API_PREFIX = '/api';

/** Path for collections endpoint
 * @constant {string}
 */
const PATH_COLLECTIONS = '/adobe/assets/collections';

// ==========================================
// Collection ACL Constants
// ==========================================

/** ACL field name for collection owner
 * @constant {string}
 */
const ACL_OWNER = 'custom:assetCollectionOwner';

/** ACL field name for collection editors
 * @constant {string}
 */
const ACL_EDITOR = 'custom:assetCollectionEditor';

/** ACL field name for collection viewers
 * @constant {string}
 */
const ACL_VIEWER = 'custom:assetCollectionViewer';

/** ContentAI term paths for collection ACL in search queries */
const CONTENTAI_COLLECTION_SEARCH_ACL = {
  owner: `collectionMetadata.custom:metadata.custom:acl.${ACL_OWNER}`,
  editor: `collectionMetadata.custom:metadata.custom:acl.${ACL_EDITOR}`,
  viewer: `collectionMetadata.custom:metadata.custom:acl.${ACL_VIEWER}`,
};

/** ContentAI term path for collection access level in search queries */
const CONTENTAI_COLLECTION_ACCESS_LEVEL = 'collectionMetadata.accessLevel';

// ==========================================
// Collection Roles
// ==========================================

const COLLECTION_ROLE_OWNER = 'owner';
const COLLECTION_ROLE_EDITOR = 'editor';
const COLLECTION_ROLE_VIEWER = 'viewer';

// ==========================================
// Permission Types
// ==========================================

/** Read permission level
 * @constant {string}
 */
const PERMISSION_READ = 'read';

/** Write permission level
 * @constant {string}
 */
const PERMISSION_WRITE = 'write';

// ==========================================
// Template Placeholder
// ==========================================

/** Template string replaced with IMS system user ID in queries
 * @constant {string}
 */
const TEMPLATE_SYSTEM_USER_ID = '{{SYSTEM_USER_ID}}';

// ==========================================
// HTTP Headers
// ==========================================

/** HTTP Authorization header name
 * @constant {string}
 */
const HEADER_AUTHORIZATION = 'Authorization';

/** Adobe API key header name
 * @constant {string}
 */
const HEADER_API_KEY = 'x-api-key';

/** User-Agent header name
 * @constant {string}
 */
const HEADER_USER_AGENT = 'user-agent';

/** X-Forwarded-Host header name
 * @constant {string}
 */
const HEADER_FORWARDED_HOST = 'x-forwarded-host';

/** Host header name
 * @constant {string}
 */
const HEADER_HOST = 'host';

/** Cookie header name
 * @constant {string}
 */
const HEADER_COOKIE = 'cookie';

/**
 * Create IMS token using OAuth server-to-server credentials
 *
 * Exchanges client credentials for an Adobe IMS access token using the OAuth 2.0
 * client credentials grant type. This token is used to authenticate requests to
 * Adobe Dynamic Media APIs.
 *
 * @param {Request} request - Incoming request (for User-Agent header)
 * @param {string} clientId - Adobe IMS client ID
 * @param {string} clientSecret - Adobe IMS client secret
 * @param {string} scope - OAuth scope (e.g., 'AdobeID,openid')
 * @returns {Promise<Object>} Token data with access_token and expires_in
 * @throws {Error} If token generation fails or response is invalid
 *
 * @example
 * const tokenData = await createIMSToken(request, clientId, clientSecret, 'AdobeID,openid');
 * console.log(tokenData.access_token);
 * console.log(tokenData.expires_in); // seconds until expiry
 */
async function createIMSToken(request, clientId, clientSecret, scope) {
  const response = await fetch(IMS_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': request.headers.get(HEADER_USER_AGENT),
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: scope,
    }),
  });

  if (response.ok) {
    const data = await response.json();
    if (data.access_token && data.expires_in) {
      return data;
    } else {
      throw new Error(`Failed to generate IMS token: ${JSON.stringify(data)}`);
    }
  } else {
    throw new Error(`Failed to generate IMS token: ${response.status} ${response.statusText} ${await response.text()}`);
  }
}

/**
 * Get cached IMS token or create a new one
 *
 * Retrieves a cached IMS token from KV store if available and not expired.
 * Otherwise, generates a new token and caches it. Tokens are refreshed 5 minutes
 * before expiry to prevent auth failures.
 *
 * @param {Request} request - Incoming request
 * @param {Object} env - Cloudflare environment bindings
 * @param {KVNamespace} env.AUTH_TOKENS - KV namespace for token storage
 * @param {string} env.DM_CLIENT_ID - Adobe IMS client ID (from secrets)
 * @param {string} env.DM_CLIENT_SECRET - Adobe IMS client secret (from secrets)
 * @returns {Promise<string|undefined>} IMS access token, or undefined on error
 *
 * @example
 * const token = await getIMSToken(request, env);
 * headers.set('Authorization', `Bearer ${token}`);
 */
async function getIMSToken(request, env) {
  try {
    const clientId = await env.DM_CLIENT_ID.get();
    const cachedTokenName = `dm-token-${clientId}`;

    // get cached token
    const { value: token, metadata } = await env.AUTH_TOKENS.getWithMetadata(cachedTokenName);
    console.warn(`Generated new IMS token for token=${token}`);
    // use token until 5 minutes before expiry
    if (token && metadata?.expiration > Math.floor(Date.now() / 1000) + IMS_TOKEN_EXPIRY_BUFFER) {
      return token;
    } else {
      const clientSecret = await env.DM_CLIENT_SECRET.get();

      const tokenData = await createIMSToken(request, clientId, clientSecret, IMS_SCOPE);
      console.warn(`Generated new IMS token for clientId=${clientId}, tokenData=${tokenData.access_token}`);
      // seconds since epoch
      const expiration = Math.floor(Date.now() / 1000) + tokenData.expires_in;

      // cache token in KV store
      await env.AUTH_TOKENS.put(cachedTokenName, tokenData.access_token, {
        expiration,
        metadata: {
          expiration,
        },
      });

      return tokenData.access_token;
    }
  } catch (error) {
    console.error(error);
    return;
  }
}

/**
 * Validate user access to a specific collection
 *
 * Fetches collection metadata from Adobe DM and checks ACL to determine if user
 * has required access level (owner/editor/viewer/public).
 *
 * Role hierarchy:
 * - Owner: Full access (read + write)
 * - Editor: Read + write access
 * - Viewer: Read-only access
 * - Public: Read-only access for any authenticated user
 *
 * @param {string} collectionId - Collection ID to check
 * @param {string} userEmail - User email (lowercase)
 * @param {string} requiredRole - Required permission level ('read' or 'write')
 * @param {string} imsToken - IMS access token for API auth
 * @param {string} dmOrigin - Dynamic Media origin URL
 * @returns {Promise<Object>} Access result object
 * @returns {boolean} returns.allowed - Whether access is granted
 * @returns {string} returns.role - User's role if allowed (owner/editor/viewer)
 * @returns {string} returns.reason - Denial reason if not allowed
 *
 * @example
 * const access = await validateCollectionAccess('col-123', 'user@example.com', 'read', token, origin);
 * if (access.allowed) {
 *   console.log(`Access granted as ${access.role}`);
 * }
 */
async function validateCollectionAccess(collectionId, userEmail, requiredRole, imsToken, dmOrigin) {
  // Fetch collection metadata
  const metadataUrl = `${dmOrigin}/adobe/assets/collections/${collectionId}`;
  const response = await fetch(metadataUrl, {
    headers: {
      [HEADER_AUTHORIZATION]: `Bearer ${imsToken}`,
      [HEADER_API_KEY]: ADOBE_API_KEY_COLLECTIONS,
    },
  });

  if (!response.ok) {
    return {
      allowed: false,
      reason: `Failed to fetch collection metadata: ${metadataUrl} => ${response.status} ${response.statusText}`,
    };
  }

  const collection = await response.json();
  const metadata = collection?.collectionMetadata || {};
  const acl = metadata?.['custom:metadata']?.['custom:acl'] || null;
  const accessLevel = String(metadata.accessLevel || 'private').toLowerCase();

  // Owner: full access (read + write)
  const ownerValue = acl?.[ACL_OWNER];
  if (ownerValue && String(ownerValue).toLowerCase() === userEmail) {
    return { allowed: true, role: COLLECTION_ROLE_OWNER };
  }

  // Editor: write access
  const editors = acl?.[ACL_EDITOR];
  if (Array.isArray(editors) && editors.some((e) => e.toLowerCase() === userEmail)) {
    return { allowed: true, role: COLLECTION_ROLE_EDITOR };
  }

  if (requiredRole === PERMISSION_WRITE) {
    return { allowed: false, reason: 'no write permission' };
  }

  // Viewer: read-only
  const viewers = acl?.[ACL_VIEWER];
  if (Array.isArray(viewers) && viewers.some((e) => e.toLowerCase() === userEmail)) {
    return { allowed: true, role: COLLECTION_ROLE_VIEWER };
  }

  // Public collections are readable by any authenticated user.
  if (accessLevel === 'public') {
    return { allowed: true, role: COLLECTION_ROLE_VIEWER };
  }

  if (!acl) {
    return { allowed: false, reason: 'no ACL' };
  }

  return { allowed: false, reason: 'not in ACL' };
}

/**
 * Check collection authorization and return error response if denied
 * @param {string} collectionId - Collection ID
 * @param {Object} request - Request with user info
 * @param {string} imsToken - IMS auth token
 * @param {string} origin - Origin URL
 * @param {string} resourceDescription - Description for logging (e.g., "collection", "collection items")
 * @returns {Response|null} Returns Response with 403 if denied, null if allowed
 */
async function checkCollectionAuthorization(
  collectionId,
  request,
  imsToken,
  origin,
  resourceDescription = 'collection',
) {
  const requiredRole = request.method === 'GET' ? PERMISSION_READ : PERMISSION_WRITE;

  const access = await validateCollectionAccess(
    collectionId,
    request.user.email?.toLowerCase(),
    requiredRole,
    imsToken,
    origin,
  );

  if (!access.allowed) {
    console.warn(
      `[${request.user.email}] denied ${request.method} on ${resourceDescription} ${collectionId}: ${access.reason}`,
    );
    return new Response('Forbidden', { status: 403 });
  }

  console.warn(
    `[${request.user.email}] allowed ${request.method} on ${resourceDescription} ${collectionId} as ${access.role}`,
  );
  return null; // null means authorized
}

// ==========================================
// ContentAI Search Authorization
// ==========================================

/**
 * Add authorization query clauses to ContentAI search query
 * @param {Object} search - ContentAI search object
 * @param {Array} authClauses - Array of query clause objects to add
 */
/**
 * Chunk parts into nested 'and' blocks to comply with ContentHub backend limit (max 5 items per 'and')
 * @param {Array} parts - Array of query parts
 * @param {number} maxSize - Maximum items per 'and' block (default 5, imposed by ContentHub backend)
 * @returns {Object|null} Nested 'and' structure or null if empty
 */
function chunkIntoAnd(parts, maxSize = 5) {
  if (parts.length === 0) return null;
  if (parts.length <= maxSize) return { and: parts };

  // Split into chunks of maxSize, last chunk may have fewer
  const chunks = [];
  for (let i = 0; i < parts.length; i += maxSize) {
    chunks.push(parts.slice(i, i + maxSize));
  }

  // If we have multiple chunks, recursively nest them
  if (chunks.length <= maxSize) {
    // Each chunk becomes { and: [...] }, then wrap all chunks in outer { and: [...] }
    const wrappedChunks = chunks.map((chunk) => ({ and: chunk }));
    return { and: wrappedChunks };
  }

  // More than maxSize chunks - need deeper nesting (recursive)
  const wrappedChunks = chunks.map((chunk) => ({ and: chunk }));
  return chunkIntoAnd(wrappedChunks, maxSize);
}

/**
 * Chunk parts into nested 'or' blocks to comply with ContentHub backend limit (max 5 items per 'or')
 * @param {Array} parts - Array of query parts
 * @param {number} maxSize - Maximum items per 'or' block (default 5, imposed by ContentHub backend)
 * @returns {Object|null} Nested 'or' structure or null if empty
 */
function chunkIntoOr(parts, maxSize = 5) {
  if (parts.length === 0) return null;
  if (parts.length <= maxSize) return { or: parts };

  const chunks = [];
  for (let i = 0; i < parts.length; i += maxSize) {
    chunks.push(parts.slice(i, i + maxSize));
  }

  if (chunks.length <= maxSize) {
    const wrappedChunks = chunks.map((chunk) => ({ or: chunk }));
    return { or: wrappedChunks };
  }

  const wrappedChunks = chunks.map((chunk) => ({ or: chunk }));
  return chunkIntoOr(wrappedChunks, maxSize);
}

function forceContentAISearchFilter(search, authClauses) {
  // skip if no auth clauses
  if (!authClauses || authClauses.length === 0) {
    return;
  }

  // ContentAI search structure: { query: [{ and: [...clauses...] }], ... }
  // Each clause in the array should be EXPLICITLY AND'ed together
  if (!search.query) {
    search.query = [];
  }

  if (!Array.isArray(search.query)) {
    // Wrap existing query in array if needed
    search.query = [search.query];
  }

  // Filter out empty clauses (empty objects or objects with empty arrays)
  const validClauses = authClauses.filter((clause) => {
    if (!clause || typeof clause !== 'object') return false;
    const keys = Object.keys(clause);
    if (keys.length === 0) return false;
    // Check if all values are empty arrays
    return keys.some((key) => {
      const value = clause[key];
      return !Array.isArray(value) || value.length > 0;
    });
  });

  // Skip if no valid clauses after filtering
  if (validClauses.length === 0) {
    return;
  }

  // Find or create the 'and' clause in the query
  let andClause = search.query.find((clause) => clause.and);
  if (!andClause) {
    // No existing 'and' clause - wrap all existing clauses in one
    const existingClauses = [...search.query];
    andClause = { and: existingClauses };
    search.query = [andClause];
  }

  // Add authorization clauses wrapped in nested 'and' using chunkIntoAnd
  // This is required because ContentAI has a quirk where term filters
  // at the same level as an empty match clause are ignored.
  // Wrapping in nested 'and' ensures filters are always applied.
  // Using chunkIntoAnd ensures we don't exceed ContentHub backend limit of 5 items per 'and' block.
  const authBlock = chunkIntoAnd(validClauses);
  if (authBlock) {
    andClause.and.push(authBlock);
  }
}

/**
 * Build ContentAI authorization clauses for asset search and metadata access.
 *
 * Asset visibility is controlled by metadata fields tagged on Content Hub assets:
 *   - `custom:userType`  — who can see the asset: 'internal', 'external', or 'all'
 *   - `allowedCountries`   — which countries can see the asset: ISO-3166-1 alpha-2 codes,
 *                          full lowercase country names (e.g. 'usa', 'india'), or the
 *                          special sentinel 'global' (visible to all countries)
 *   - `internalStatus`     — external users only see 'approved' assets, or assets where the
 *                          field is absent entirely (checked explicitly via an exists clause,
 *                          not relied on as undocumented `term` behavior); internal users see
 *                          all values (e.g. 'preview', 'fpo')
 *
 * User attributes that drive filtering (resolved at login, stored in session):
 *   - `user.userType`   — 'internal' or 'external', derived from email domain + sheet overrides
 *   - `user.country`    — ISO-3166-1 alpha-2 country code from Entra ID `ctry` claim
 *   - `user.countries`  — optional additional country codes from /config/access/users sheet
 *                         (used to grant multi-country access to specific users/domains)
 *
 * Returns:
 *   - `[]`           → admin bypass: no search constraints applied
 *   - `[denyAll]`    → user has no resolvable attributes: deny everything (safe default)
 *   - `[...clauses]` → AND-ed constraints injected into the ContentAI search query
 *
 * @param {Request} request - Cloudflare request with `request.user` populated by auth middleware
 * @param {Object} _env - Cloudflare environment bindings (unused, reserved for future sheet lookups)
 * @param {Object} [options]
 * @param {boolean} [options.useRealPermissions=false] - Evaluate as the real, pre-simulation
 *   identity (`request.user.su`) in its entirety — roles, country, userType, everything —
 *   instead of whatever is currently simulated. No effect when not simulating.
 * @returns {Promise<Object[]>} ContentAI query clause array
 */
async function buildAssetAuthClauses(request, _env, { useRealPermissions = false } = {}) {
  // Callers that need to discover what's generally available (e.g. populating the
  // country picker used to change simulation) evaluate as the real, pre-simulation
  // identity rather than whichever attributes are currently simulated. Restoring the
  // whole identity (not just individual fields) keeps this correct as new simulated
  // attributes are added, and keeps every check below unchanged/unaware of simulation.
  const user = (useRealPermissions && request.user.su)
    ? { ...request.user, ...request.user.su }
    : request.user;

  const clauses = [];

  // --- Customer scope filter (always applied) ---
  // config.DEMO_COMPANY is always set (default: 'frescopa'). Every asset search is
  // restricted to assets tagged assetMetadata.company === DEMO_COMPANY. The agent
  // auto-patches this to the prospect's key after enrichment. Injected BEFORE the admin
  // bypass so even admins only see the configured customer's assets.
  if (config.DEMO_COMPANY) {
    clauses.push({ term: { 'assetMetadata.company': [config.DEMO_COMPANY] } });
  }

  // Admins bypass all per-user asset filters — they see everything in Content Hub
  // (except the demo customer scope above, which always applies when configured).
  if (user.roles?.includes(ROLE.ADMIN)) {
    console.warn(`[${user.email}] admin bypass: no per-user asset auth clauses applied`);
    return clauses;
  }

  // --- Country filter ---
  // Collect all country codes the user is authorised for:
  //   1. The user's own country from the Entra ID JWT claim (ctry).
  //   2. Any additional countries granted via the /config/access/users sheet.
  //   3. The 'global' sentinel always included so globally-tagged assets are never blocked.
  // Assets may be tagged with either the ISO code or the full lowercase country name, so
  // each resolved code is expanded to include its mapped name (see constants/countries.js).
  const authorisedCountries = [];
  const addCountry = (c) => {
    resolveCountryMatchValues(c).forEach((value) => {
      if (value && !authorisedCountries.includes(value)) authorisedCountries.push(value);
    });
  };
  if (user.country) addCountry(user.country);
  if (Array.isArray(user.countries)) {
    user.countries.forEach(addCountry);
  }
  if (!authorisedCountries.includes('global')) authorisedCountries.push('global');

  // If only 'global' is present (no country from JWT or sheet), skip the filter —
  // no point injecting a clause that only allows 'global' tagged assets.
  if (authorisedCountries.length === 1 && authorisedCountries[0] === 'global') {
    console.warn(`[${user.email}] no country resolved — skipping country filter`);
  } else {
    console.warn(`[${user.email}] asset auth clauses: countries=[${authorisedCountries.join(',')}]`);
    clauses.push({ term: { 'assetMetadata.allowedCountries': authorisedCountries } });
  }

  // --- Internal status filter ---
  // External users only see assets tagged internalStatus=approved, or where the
  // field is absent entirely. Don't rely on term's undocumented behavior for
  // missing fields — explicit exists-check avoids depending on backend semantics
  // that aren't confirmed by the ContentAI/Content Hub API schema.
  if (user.userType !== USER_TYPE.INTERNAL) {
    clauses.push({
      or: [
        { term: { 'assetMetadata.internalStatus': ['approved'] } },
        { not: [{ exists: { field: 'assetMetadata.internalStatus' } }] },
      ],
    });
  }

  return clauses;
}

/**
 * ContentAI Search: search authorization for assets
 * Mimics searchAuthorization logic but generates ContentAI query clauses
 *
 * A request body may set `useRealPermissions: true` (stripped before forwarding
 * upstream) to build the filter from the real, pre-simulation identity rather than
 * the currently-simulated one — used by the simulation country picker so it always
 * offers every country the real user could see, not just the simulated subset.
 * @param {Object} request - Request object with user info
 * @param {Object} env - Environment object
 * @param {Object} search - ContentAI search object to modify
 */
async function searchContentAIAuthorization(request, env, search) {
  const useRealPermissions = search.useRealPermissions === true;
  if (search.useRealPermissions !== undefined) delete search.useRealPermissions;

  // ContentAI search request. Enforce filters that ensure only authorized assets are returned
  const authClauses = await buildAssetAuthClauses(request, env, { useRealPermissions });

  // Empty array means admin - no constraints needed (already logged in buildAssetAuthClauses)
  if (authClauses.length === 0) {
    return;
  }

  console.warn(`[${request.user.email}] authz filter: ContentAI clauses (${authClauses.length} constraints)`);

  forceContentAISearchFilter(search, authClauses);
}

/**
 * Coerce `relationship` to {@link CollectionListSegment}.
 * Omitted or unrecognized values become {@link CollectionListSegment.PUBLIC}.
 * @param {string|undefined} rel
 * @returns {typeof CollectionListSegment[keyof typeof CollectionListSegment]}
 */
function normalizeCollectionsSearchRelationship(rel) {
  if (rel === CollectionListSegment.ALL) return CollectionListSegment.ALL;
  if (rel === CollectionListSegment.CREATED_BY_ME) return CollectionListSegment.CREATED_BY_ME;
  if (rel === CollectionListSegment.SHARED_WITH_ME) return CollectionListSegment.SHARED_WITH_ME;
  if (rel === CollectionListSegment.PUBLIC_VIEW) return CollectionListSegment.PUBLIC_VIEW;
  if (rel === CollectionListSegment.PUBLIC) return CollectionListSegment.PUBLIC;
  return CollectionListSegment.PUBLIC;
}

/**
 * ContentAI Search: search authorization for collections
 * @param {Object} request - Request object with user info
 * @param {Object} search - ContentAI search object to modify
 * @param {{
 *   relationship?: 'createdByMe' | 'sharedWithMe' | 'public',
 *   visibility?: 'all' | 'private' | 'public',
 * }} [options]
 * - relationship: createdByMe = owner ACL + optional accessLevel; sharedWithMe = viewer ACL only;
 *   public = accessLevel public only; omitted → legacy owner/editor/viewer filter.
 *   visibility: only for `createdByMe` (`all` | `private` | `public`); ignored otherwise → `all`.
 */
function collectionsSearchContentAIAuthorization(request, search, options = {}) {
  const user = request.user;
  const userEmailLower = user?.email?.toLowerCase();

  if (!userEmailLower) {
    forceContentAISearchFilter(search, [
      {
        term: { [CONTENTAI_COLLECTION_SEARCH_ACL.owner]: ['___does_not_exist___'] },
      },
    ]);
    return;
  }

  const emailVariants = [userEmailLower, userEmailLower.toUpperCase()];
  const searchOwnerClause = {
    term: { [CONTENTAI_COLLECTION_SEARCH_ACL.owner]: emailVariants },
  };
  const searchEditorClause = {
    term: { [CONTENTAI_COLLECTION_SEARCH_ACL.editor]: emailVariants },
  };
  const searchViewerClause = {
    term: { [CONTENTAI_COLLECTION_SEARCH_ACL.viewer]: emailVariants },
  };

  // Backward-compatible mode when no relationship is specified.
  if (options.relationship === undefined) {
    const aclFilter = chunkIntoOr([searchOwnerClause, searchEditorClause, searchViewerClause]);
    forceContentAISearchFilter(search, [aclFilter]);
    console.warn(`[${userEmailLower}] collections search filter applied (legacy ACL)`);
    return;
  }

  const relationship = normalizeCollectionsSearchRelationship(options.relationship);
  let visibility = CollectionCreatedByMeVisibility.ALL;
  if (relationship === CollectionListSegment.CREATED_BY_ME) {
    visibility =
      options.visibility === CollectionCreatedByMeVisibility.PRIVATE ||
      options.visibility === CollectionCreatedByMeVisibility.READ_ONLY ||
      options.visibility === CollectionCreatedByMeVisibility.PUBLIC ||
      options.visibility === CollectionCreatedByMeVisibility.ALL
        ? options.visibility
        : CollectionCreatedByMeVisibility.ALL;
  }

  const accessPrivate = {
    term: { [CONTENTAI_COLLECTION_ACCESS_LEVEL]: [CollectionCreatedByMeVisibility.PRIVATE] },
  };
  const accessReadOnly = {
    term: { [CONTENTAI_COLLECTION_ACCESS_LEVEL]: [CollectionCreatedByMeVisibility.READ_ONLY] },
  };
  const accessPublic = {
    term: { [CONTENTAI_COLLECTION_ACCESS_LEVEL]: [CollectionCreatedByMeVisibility.PUBLIC] },
  };
  const accessAnyPublic = {
    term: {
      [CONTENTAI_COLLECTION_ACCESS_LEVEL]: [
        CollectionCreatedByMeVisibility.PUBLIC,
        CollectionCreatedByMeVisibility.READ_ONLY,
      ],
    },
  };

  /** @type {Object[]} */
  let authClauses;

  if (relationship === CollectionListSegment.ALL) {
    authClauses = [{ or: [searchOwnerClause, accessAnyPublic, searchViewerClause] }];
  } else if (relationship === CollectionListSegment.CREATED_BY_ME) {
    authClauses = [searchOwnerClause];
    if (visibility === CollectionCreatedByMeVisibility.PRIVATE) {
      authClauses.push(accessPrivate);
    } else if (visibility === CollectionCreatedByMeVisibility.READ_ONLY) {
      authClauses.push(accessReadOnly);
    } else if (visibility === CollectionCreatedByMeVisibility.PUBLIC) {
      authClauses.push(accessPublic);
    }
  } else if (relationship === CollectionListSegment.SHARED_WITH_ME) {
    authClauses = [searchViewerClause];
  } else if (relationship === CollectionListSegment.PUBLIC_VIEW) {
    authClauses = [accessReadOnly];
  } else {
    authClauses = [accessPublic];
  }

  forceContentAISearchFilter(search, authClauses);
  console.warn(
    `[${userEmailLower}] collections search filter applied (ContentAI)` +
      `${relationship !== CollectionListSegment.PUBLIC ? ` [relationship=${relationship}]` : ''}` +
      `${relationship === CollectionListSegment.CREATED_BY_ME && visibility !== CollectionCreatedByMeVisibility.ALL ? ` [visibility=${visibility}]` : ''}`,
  );
}

/**
 * Main handler for Adobe Dynamic Media origin requests
 *
 * This is the primary entry point for all Adobe Dynamic Media requests. It:
 * 1. Transforms incoming URLs to Adobe delivery endpoints
 * 2. Authenticates requests with cached IMS tokens
 * 3. Applies role-based authorization filters for searches
 * 4. Enforces collection-level ACL for CRUD operations
 * 5. Tracks download and search analytics (fire-and-forget)
 *
 * URL transformation:
 * - Incoming: <host>/api/adobe/assets/...
 * - Outgoing: delivery-pXX-eYY.adobeaemcloud.com/adobe/assets/...
 *
 * @param {Request} request - Incoming HTTP request
 * @param {Object} request.user - Authenticated user object (added by auth middleware)
 * @param {Object} env - Cloudflare environment bindings
 * @param {KVNamespace} env.AUTH_TOKENS - KV store for IMS token caching
 * @param {AnalyticsEngine} env.SPARK_ANALYTICS_ENGINE - Analytics Engine binding
 * @param {ExecutionContext} ctx - Cloudflare execution context (for waitUntil)
 * @returns {Promise<Response>} Proxied response from Adobe Dynamic Media
 *
 * @example
 * // Called by worker's fetch handler
 * const response = await originDynamicMedia(request, env, ctx);
 *
 * @see {@link https://developers.cloudflare.com/workers/runtime-apis/fetch-event/}
 */
export async function originDynamicMedia(request, env, ctx) {
  // incoming url:
  //   <host>/api/adobe/assets/...
  // origin url:
  //   delivery-pXX-eYY.adobeaemcloud.com/adobe/assets/...

  const aemEnvId = config.AEM_ENV_ID;
  if (!aemEnvId.match(/^p(.*)-e(.*)$/)) {
    return new Response('Invalid AEM_ENV_ID', { status: 500 });
  }

  const url = new URL(request.url);
  url.protocol = 'https';
  url.host = `${ADOBE_DELIVERY_HOST_PREFIX}${aemEnvId}${ADOBE_DELIVERY_HOST_SUFFIX}`;
  url.port = '';

  // remove /api from path
  url.pathname = url.pathname.replace(PATH_API_PREFIX, '');

  const headers = new Headers(request.headers);
  // Convert body to string immediately so we can log it later
  let body = request.body ? await request.text() : null;

  // set DM authorization
  const imsToken = await getIMSToken(request, env);

  if (!imsToken) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (url.pathname.startsWith(PATH_COLLECTIONS)) {
    headers.set(HEADER_API_KEY, ADOBE_API_KEY_COLLECTIONS);
  } else {
    headers.set(HEADER_API_KEY, await env.DM_CLIENT_ID.get());
  }
  headers.set(HEADER_AUTHORIZATION, `Bearer ${imsToken}`);
  headers.delete(HEADER_COOKIE);

  // Handle Tags API (GET, no body) - rewrite path only
  if (url.pathname === '/adobe/assets/contentai/tags') {
    url.pathname = '/adobe/experimental/tags-expires-20261130/tags';
  }

  // Handle search requests (POST with body)
  // Match collection asset search: /adobe/assets/contentai/collections/{collectionId}/search
  const collectionAssetMatch = url.pathname.match(/^\/adobe\/assets\/contentai\/collections\/([^/]+)\/search$/);

  if (url.pathname === '/adobe/assets/contentai/search') {
    // Search assets
    headers.set('x-ch-request', 'search');
    headers.set('x-polaris-search-provider', '3');

    const imsUserId = decodeJwt(imsToken).user_id;
    body = body.replaceAll(TEMPLATE_SYSTEM_USER_ID, imsUserId);

    const search = JSON.parse(body);
    extractSearchContext(request, search);
    await searchContentAIAuthorization(request, env, search);
    url.pathname = '/adobe/assets/search';
    body = JSON.stringify(search);
  } else if (url.pathname === '/adobe/assets/contentai/collections/search') {
    // Search collections
    headers.set('x-ch-request', 'search');
    headers.set('x-polaris-search-provider', '3');

    const imsUserId = decodeJwt(imsToken).user_id;
    body = body.replaceAll(TEMPLATE_SYSTEM_USER_ID, imsUserId);

    const search = JSON.parse(body);
    extractSearchContext(request, search);
    const relationship = search.relationship;
    const normalizedRelationship = normalizeCollectionsSearchRelationship(relationship);
    const visibility =
      normalizedRelationship === CollectionListSegment.CREATED_BY_ME &&
      (search.visibility === CollectionCreatedByMeVisibility.PRIVATE ||
        search.visibility === CollectionCreatedByMeVisibility.READ_ONLY ||
        search.visibility === CollectionCreatedByMeVisibility.PUBLIC ||
        search.visibility === CollectionCreatedByMeVisibility.ALL)
        ? search.visibility
        : CollectionCreatedByMeVisibility.ALL;
    if (search.relationship !== undefined) delete search.relationship;
    if (search.visibility !== undefined) delete search.visibility;
    if (search.writeOnly !== undefined) delete search.writeOnly;
    collectionsSearchContentAIAuthorization(request, search, {
      relationship,
      visibility,
    });
    url.pathname = '/adobe/experimental/collectionsearch-expires-20260915/assets/collections/search';
    body = JSON.stringify(search);
  } else if (collectionAssetMatch) {
    // Search assets in a collection
    headers.set('x-ch-request', 'search');
    headers.set('x-polaris-search-provider', '3');

    const imsUserId = decodeJwt(imsToken).user_id;
    body = body.replaceAll(TEMPLATE_SYSTEM_USER_ID, imsUserId);

    const search = JSON.parse(body);
    extractSearchContext(request, search);
    const collectionId = collectionAssetMatch[1];
    await searchContentAIAuthorization(request, env, search);
    url.pathname = `/adobe/experimental/collectionsearch-expires-20260915/assets/collections/${collectionId}/search`;
    body = JSON.stringify(search);
  }

  handleArchiveAnalytics(url, request, headers, env, ctx);

  // access to experimental APIs
  headers.set(ADOBE_EXPERIMENTAL_HEADER, '1');

  // general proxying best practices
  headers.set(HEADER_USER_AGENT, headers.get(HEADER_USER_AGENT));
  headers.set(HEADER_FORWARDED_HOST, headers.get(HEADER_HOST));

  // Authorization check for individual collection operations
  // e.g. GET => get collection metadata, POST => update collection metadata, DELETE => delete collection
  // This applied for BOTH Algolia search and ContentAI search
  // Exclude /adobe/assets/collections/search (search endpoint, not a collectionId)
  if (url.pathname.match(/^\/adobe\/assets\/collections\/(?!search$)[^/]+$/)) {
    const collectionId = url.pathname.split('/').pop();
    const authResponse = await checkCollectionAuthorization(collectionId, request, imsToken, url.origin, 'collection');
    if (authResponse) return authResponse;
  }

  // Authorization check for collection items endpoint
  // e.g. GET => get collection items, POST => update collection items
  // This applied for BOTH Algolia search and ContentAI search
  if (url.pathname.match(/^\/adobe\/assets\/collections\/[^/]+\/items$/)) {
    const collectionId = url.pathname.split('/')[4];
    const authResponse = await checkCollectionAuthorization(
      collectionId,
      request,
      imsToken,
      url.origin,
      'collection items',
    );
    if (authResponse) return authResponse;
  }

  // The browser's Referer can be enormous (search URLs with many facet filters
  // easily reach 3KB+) and push total headers past the upstream's 8KB limit → 400.
  headers.delete('referer');

  // The incoming request's Content-Length reflects the original browser-sent body.
  // Search (and other) handlers above may have re-serialized `body` after injecting
  // auth clauses, changing its byte length — a stale Content-Length here causes the
  // upstream to read a truncated/misframed body ("Expecting value" JSON parse errors).
  // Let fetch() (via undici) compute the correct Content-Length from the actual body.
  headers.delete('content-length');

  const response = await fetch(url, {
    method: request.method,
    headers: headers,
    body: body,
  });

  // ACCESS CHECK for asset metadata requests
  // Pattern: GET /adobe/assets/urn:aaid:aem:{uuid}/metadata
  const assetMetadataMatch = url.pathname.match(/^\/adobe\/assets\/.*\/metadata$/i);
  if (request.method === 'GET' && assetMetadataMatch && response.ok) {
    if (!request.user) {
      return new Response('Forbidden', { status: 403 });
    }
    const authClauses = await buildAssetAuthClauses(request, env);
    const authResponse = await enforceAssetMetadataAuthorization(authClauses, response, request.user.email);
    if (authResponse.status === 403) {
      return authResponse;
    }
  }

  handleDownloadAnalytics(url, request, response, env, ctx);
  handleSearchAnalytics(url, request, response, env, ctx);

  // Paths that must never be served from Cloudflare's edge cache.
  // These are mutable or short-lived endpoints where a stale cached response
  // would break functionality (e.g. archive status polling returning PROCESSING
  // forever because the first 200 was cached with cacheEverything:true on custom
  // zone domains — workers.dev bypasses edge cache automatically, custom zones do not).
  const noCachePaths = [
    /^\/adobe\/assets\/archives(\/|$)/, // archive creation + status polling
    /^\/adobe\/assets\/[^/]+\/token$/, // download tokens (short-lived, user-specific)
  ];
  const bypassEdgeCache = noCachePaths.some((pattern) => pattern.test(url.pathname));

  // For mutable/polling endpoints, ensure the browser and Cloudflare edge
  // cannot serve stale data. Only override Cache-Control if Dynamic Media has
  // not set one — if they add their own directive in future, respect it.
  if (bypassEdgeCache && !response.headers.get('Cache-Control')) {
    const nocacheResponse = new Response(response.body, response);
    nocacheResponse.headers.set('Cache-Control', 'no-store');
    return nocacheResponse;
  }

  return response;
}

// Re-export from asset-access.js for convenience
export {
  ancestorsToTaxonomyPath,
  checkAssetMetadataAuthorization,
  enforceAssetMetadataAuthorization,
  extractTaxonomyPaths,
} from './asset-access.js';
// Export authorization functions for testing
export {
  // Asset metadata authorization
  buildAssetAuthClauses,
  COLLECTION_ROLE_EDITOR,
  // Collection roles
  COLLECTION_ROLE_OWNER,
  COLLECTION_ROLE_VIEWER,
  // Query chunking utilities
  chunkIntoAnd,
  chunkIntoOr,
  collectionsSearchContentAIAuthorization,
  forceContentAISearchFilter,
  searchContentAIAuthorization,
  // IMS token (shared with coa.js — same DM S2S technical account, same x-api-key)
  getIMSToken,
};
