/* eslint-disable import/prefer-default-export */
/**
 * Dynamic Media Client for Adobe AEM Assets
 * Handles search (ContentAI), downloads, renditions, and archives
 */

import { mimeTypeToExtension } from '../utils/mime-type-converter.js';
import makeRequest from './api-client.js';
import { normalizeAssetId, isBareUuid } from '../../../scripts/asset-id-utils.js';
import {
  getDateFacets,
  getMetadataPath,
} from '../constants/facets.js';
import { buildOrderBy, SORT_TYPE, SORT_DIRECTION } from '../utils/sort-utils.js';
import { getExternalParams } from '../utils/config.js';
import { dispatchAssetAction } from '../../../scripts/audit/asset-audit.js';
import { ASSET_AUDIT_ACTIONS } from '../../../scripts/audit/asset-audit-constants.js';

// Note: The following limit is imposed by Polaris as of Mar 12, 2026
// Size for each facet bucket must be less than or equal to 1000
// Total bucket size across all facets must not exceed 10000
const FACET_BUCKET_SIZE = 100;
/** Polaris max bucket size per facet (Show All modal uses this for expanded facet request). */
export const MAX_FACET_BUCKET_SIZE = 1000;

/**
 * Per-facet bucket size used in ContentAI search (matches CATEGORY facet `size`).
 * @param {string} facetKey
 * @returns {number}
 */
export function getEffectiveFacetBucketSize(facetKey) {
  const facetConfig = (getExternalParams().excFacets || {})[facetKey];
  const configSize = facetConfig?.facetBucketSize || FACET_BUCKET_SIZE;
  return Math.min(configSize, MAX_FACET_BUCKET_SIZE);
}

export const ORIGINAL_RENDITION = 'original';

export const ARCHIVE_STATUS = {
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
};

/**
 * Dynamic Media Client class
 * Handles search (ContentAI API), downloads, renditions, and archives
 */
export class DynamicMediaClient {
  /**
   * Generic request method using fetch API
   * @private
   * @param {Object} config - Request configuration
   * @returns {Promise<*>} Response data
   */
  // eslint-disable-next-line class-methods-use-this
  makeRequest(config) {
    return makeRequest(config);
  }

  // ============================================================
  // ContentAI Search Methods
  // ============================================================

  /**
   * Convert Facet key to ContentAI field path
   * @private
   * @param {string} facetKey - Facet key (e.g., 'custom-brand')
   * @returns {string} ContentAI field path (e.g., 'assetMetadata.custom-brand')
   */
  // eslint-disable-next-line class-methods-use-this
  getContentAIFieldPath(facetKey) {
    return getMetadataPath(facetKey);
  }

  /**
   * Extract base facet key from Facet filter
   * @private
   * @param {string} filter - Facet filter
   *   (e.g., 'custom-subBrand:brand/example-brand/example-variant')
   * @returns {{ key: string, value: string }} Base key and value
   */
  /**
   * Parse Numeric filters into ContentAI range format
   * @private
   * @param {string[]} numericFilters - Numeric filters
   * @returns {Object} Field to range mapping
   */
  parseNumericFilters(numericFilters) {
    const ranges = {};

    numericFilters.forEach((filter) => {
      // Parse filters like "repo-createDate >= 1756710000" or "repo:modifyDate >= 1756710000"
      const match = filter.match(/^([a-zA-Z0-9:-]+)\s*(>=|<=|>|<)\s*(\d+)$/);
      if (match) {
        const [, field, operator, value] = match;
        const contentAIField = this.getContentAIFieldPath(field);
        const epochValue = parseInt(value, 10);
        const isoDate = new Date(epochValue * 1000).toISOString();

        if (!ranges[contentAIField]) {
          ranges[contentAIField] = {};
        }

        switch (operator) {
          case '>=':
            ranges[contentAIField].gte = isoDate;
            break;
          case '<=':
            ranges[contentAIField].lte = isoDate;
            break;
          case '>':
            ranges[contentAIField].gt = isoDate;
            break;
          case '<':
            ranges[contentAIField].lt = isoDate;
            break;
          default:
            break;
        }
      }
    });

    return ranges;
  }

  /**
   * Tokenize an Algolia filter string
   * @private
   * @param {string} input - Filter string
   * @returns {string[]} Array of tokens
   */
  // eslint-disable-next-line class-methods-use-this
  tokenizeFilter(input) {
    const tokens = [];
    let i = 0;
    const len = input.length;

    while (i < len) {
      // Skip whitespace
      while (i < len && /\s/.test(input[i])) i += 1;
      if (i >= len) break;

      // Check for parentheses
      if (input[i] === '(' || input[i] === ')') {
        tokens.push(input[i]);
        i += 1;
        // Check for operators (AND, OR, NOT)
      } else if (input.substring(i, i + 4).toUpperCase() === 'AND '
                 || input.substring(i, i + 4).toUpperCase() === 'AND)') {
        tokens.push('AND');
        i += 3;
      } else if (input.substring(i, i + 3).toUpperCase() === 'OR '
                 || input.substring(i, i + 3).toUpperCase() === 'OR)') {
        tokens.push('OR');
        i += 2;
      } else if (input.substring(i, i + 4).toUpperCase() === 'NOT '
                 || input.substring(i, i + 4).toUpperCase() === 'NOT(') {
        tokens.push('NOT');
        i += 3;
      } else {
        // Read a term (field:value or quoted string)
        let term = '';
        // Handle quoted values
        if (input[i] === "'" || input[i] === '"') {
          const quote = input[i];
          i += 1;
          while (i < len && input[i] !== quote) {
            term += input[i];
            i += 1;
          }
          i += 1; // skip closing quote
        } else {
          // Read until whitespace, parenthesis, or end
          while (i < len && !/\s/.test(input[i]) && input[i] !== '(' && input[i] !== ')') {
            term += input[i];
            i += 1;
          }
        }
        if (term) tokens.push(term);
      }
    }
    return tokens;
  }

  /**
   * Parse tokens into ContentAI query (recursive descent parser)
   * Grammar:
   *   expr     -> orExpr
   *   orExpr   -> andExpr ('OR' andExpr)*
   *   andExpr  -> notExpr ('AND' notExpr)*
   *   notExpr  -> 'NOT' notExpr | primary
   *   primary  -> '(' expr ')' | term
   * @private
   * @param {string[]} tokens - Tokenized filter
   * @param {Object} ctx - Parse context { pos: number }
   * @returns {Object|null} ContentAI query object
   */
  parseFilterExpr(tokens, ctx) {
    return this.parseOrExpr(tokens, ctx);
  }

  /**
   * Parse OR expression
   * @private
   */
  parseOrExpr(tokens, ctx) {
    const parts = [];
    const first = this.parseAndExpr(tokens, ctx);
    if (!first) return null;
    parts.push(first);

    while (ctx.pos < tokens.length && tokens[ctx.pos]?.toUpperCase() === 'OR') {
      ctx.pos += 1; // consume 'OR'
      const next = this.parseAndExpr(tokens, ctx);
      if (next) parts.push(next);
    }

    if (parts.length === 1) return parts[0];
    return this.chunkIntoOr(parts);
  }

  /**
   * Parse AND expression
   * @private
   */
  parseAndExpr(tokens, ctx) {
    const parts = [];
    const first = this.parseNotExpr(tokens, ctx);
    if (!first) return null;
    parts.push(first);

    while (ctx.pos < tokens.length && tokens[ctx.pos]?.toUpperCase() === 'AND') {
      ctx.pos += 1; // consume 'AND'
      const next = this.parseNotExpr(tokens, ctx);
      if (next) parts.push(next);
    }

    if (parts.length === 1) return parts[0];
    return { and: parts };
  }

  /**
   * Parse NOT expression
   * @private
   */
  parseNotExpr(tokens, ctx) {
    if (tokens[ctx.pos]?.toUpperCase() === 'NOT') {
      ctx.pos += 1; // consume 'NOT'
      const expr = this.parseNotExpr(tokens, ctx);
      if (!expr) return null;
      return { not: [expr] };
    }
    return this.parsePrimary(tokens, ctx);
  }

  /**
   * Parse primary (parenthesized expression or term)
   * @private
   */
  parsePrimary(tokens, ctx) {
    if (tokens[ctx.pos] === '(') {
      ctx.pos += 1; // consume '('
      const expr = this.parseFilterExpr(tokens, ctx);
      if (tokens[ctx.pos] === ')') {
        ctx.pos += 1; // consume ')'
      }
      return expr;
    }
    return this.parseTerm(tokens, ctx);
  }

  /**
   * Parse a single term (field:value)
   * Field may contain colons (e.g., contentType), so split at LAST colon
   * Field may use hyphens (e.g., custom-contentType) or colons (contentType)
   * Normalize to hyphen format for lookup, then getContentAIFieldPath handles conversion
   * @private
   */
  parseTerm(tokens, ctx) {
    const token = tokens[ctx.pos];
    if (!token || token === ')' || ['AND', 'OR', 'NOT'].includes(token.toUpperCase())) {
      return null;
    }

    ctx.pos += 1;

    // Parse 'field:value' format - split at LAST colon since field may contain colons
    // e.g., 'contentType:marketing' -> field='contentType', value='marketing'
    // e.g., 'custom-contentType:marketing' -> field='custom-contentType', value='marketing'
    const colonIndex = token.lastIndexOf(':');
    if (colonIndex === -1) return null;

    const rawField = token.substring(0, colonIndex);
    let value = token.substring(colonIndex + 1);

    // Remove surrounding quotes from value if present
    if ((value.startsWith("'") && value.endsWith("'"))
        || (value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1);
    }

    if (!rawField || !value) return null;

    // Normalize field to hyphen format for lookup (contentType -> custom-contentType)
    // The mapping keys use hyphens, getContentAIFieldPath will convert back to colons
    const field = rawField.replace(/:/g, '-');
    const contentAIField = this.getContentAIFieldPath(field);

    return {
      term: {
        [contentAIField]: [value],
      },
    };
  }

  /**
   * Parse a preset filter string into ContentAI query
   * Handles Algolia filter syntax: AND, OR, NOT, parentheses, field:value
   * Examples:
   *   'custom-contentType:marketing OR custom-contentType:customers'
   *   '(custom-brand:Example-Brand AND custom-market:US) OR custom-brand:Sprite'
   *   'NOT custom-contentType:internal'
   * @private
   * @param {string} filter - Algolia filter string
   * @returns {Object|null} ContentAI query object or null if invalid
   */
  parsePresetFilter(filter) {
    if (!filter || typeof filter !== 'string') return null;

    const tokens = this.tokenizeFilter(filter.trim());
    if (tokens.length === 0) return null;

    const ctx = { pos: 0 };
    return this.parseFilterExpr(tokens, ctx);
  }

  /**
   * Chunk an array of parts into nested 'and' blocks to comply with ContentHub backend limit
   * @private
   * @param {Array} parts - Array of query parts
   * @param {number} maxSize - Max items per 'and' block (default 5, ContentHub backend limit)
   * @returns {Object} Nested 'and' structure
   */
  // eslint-disable-next-line class-methods-use-this
  chunkIntoAnd(parts, maxSize = 5) {
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
    return this.chunkIntoAnd(wrappedChunks, maxSize);
  }

  /**
   * Chunk an array of parts into nested 'or' blocks to comply with ContentHub backend limit
   * @private
   * @param {Array} parts - Array of query parts
   * @param {number} maxSize - Max items per 'or' block (default 5, ContentHub backend limit)
   * @returns {Object} Nested 'or' structure
   */
  // eslint-disable-next-line class-methods-use-this
  chunkIntoOr(parts, maxSize = 5) {
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
    return this.chunkIntoOr(wrappedChunks, maxSize);
  }

  /**
   * Build a single match query for a text term
   * @private
   * @param {string} text - Search text
   * @returns {Object} ContentAI match query object
   */
  // eslint-disable-next-line class-methods-use-this
  buildMatchQuery(text, searchMode) {
    // Live user-selected mode (search-bar mode selector, passed in via options) takes
    // precedence over the static block-authored config, which stays as the fallback default.
    const { searchMode: configSearchMode } = getExternalParams();
    const mode = (searchMode || configSearchMode || 'FULLTEXT').toUpperCase();
    return {
      match: {
        text,
        ...(mode !== 'FULLTEXT' && { mode }),
        // `fields` is only defined on FullTextMatchQuery in the API's discriminator-mapped
        // schema (HybridMatchQuery declares no extra properties) — sending it for HYBRID
        // causes a strict-deserialization failure ("Error while deserializing And query")
        // on the backend. Only include it for FULLTEXT.
        // TPTODO: remove once number/date fields are no longer searchable
        ...(mode === 'FULLTEXT' && {
          fields: [
            'assetMetadata.dc:title',
            'assetMetadata.autogen:title',
            'assetMetadata.dc:description',
            'assetMetadata.autogen:description',
          ],
        }),
        // "fields" is optional. Per ASSETS-64808: If omitted, the backend will search
        // across all searchable fields configured in the CH UI for that customer.
      },
    };
  }

  /**
   * Build a text search query with limited OR support.
   * Splits on OR when every operand is either a #-prefixed string
   * or a numeric value (any combination, any count), with or without quotes.
   *
   * @private
   * @param {string} text - Raw search text
   * @returns {Object} ContentAI query object (match or { or: [...] })
   */
  buildTextSearchQuery(text, searchMode) {
    if (!text) return this.buildMatchQuery('', searchMode);

    // The #tag/numeric OR-splitting shortcut below is a keyword-search convenience;
    // it doesn't apply to semantic/natural-language queries, which should pass through
    // to buildMatchQuery untouched so the full sentence reaches the match clause intact.
    const { searchMode: configSearchMode } = getExternalParams();
    const mode = (searchMode || configSearchMode || 'FULLTEXT').toUpperCase();
    if (mode !== 'FULLTEXT') return this.buildMatchQuery(text, searchMode);

    // Split by OR (case-insensitive) surrounded by whitespace
    const parts = text.split(/\s+OR\s+/i);
    if (parts.length < 2) return this.buildMatchQuery(text, searchMode);

    const stripQuotes = (s) => {
      const t = s.trim();
      if ((t.startsWith('"') && t.endsWith('"'))
          || (t.startsWith("'") && t.endsWith("'"))) {
        return t.slice(1, -1);
      }
      return t;
    };

    const isOrEligible = (s) => (s.startsWith('#') && s.length > 1) || /^\d+$/.test(s);

    const operands = parts.map((p) => stripQuotes(p));

    if (operands.every((o) => isOrEligible(o))) {
      return this.chunkIntoOr(operands.map((o) => this.buildMatchQuery(o, searchMode)));
    }

    return this.buildMatchQuery(text, searchMode);
  }

  /**
   * Build query array from search text and filters
   * @private
   * @param {string} query - Search text
   * @param {Object} options - Search options
   * @returns {Array} ContentAI query array
   */
  buildQueryArray(query, options) {
    const {
      numericFilters = [], filters = [], facetFilters = [], searchMode,
    } = options;

    // Check if query is an assetId (URN format or bare UUID)
    const trimmedQuery = query?.trim() || '';
    const isAssetIdQuery = trimmedQuery.startsWith('urn:aaid:aem:') || isBareUuid(trimmedQuery);

    // Build search query (match or term)
    let searchQuery;
    if (isAssetIdQuery) {
      // Always use full URN format for the API query
      searchQuery = {
        term: {
          assetId: [normalizeAssetId(trimmedQuery)],
        },
      };
    } else {
      searchQuery = this.buildTextSearchQuery(trimmedQuery, searchMode);
    }

    // Filter non-expired assets: no expiration date OR expiration date > now
    const nonExpiredFilter = {
      or: [
        {
          not: [
            {
              exists: {
                field: 'assetMetadata.pur:expirationDate',
              },
            },
          ],
        },
        {
          range: {
            'assetMetadata.pur:expirationDate': {
              gt: new Date().toISOString(),
            },
          },
        },
      ],
    };

    // Group search query and non-expired filter into one 'and' block
    const searchContext = { and: [searchQuery, nonExpiredFilter] };

    // Collect all filter parts
    // ContentAI requires 'and' arrays to have max 5 items
    const allFilterParts = [];

    // Add preset filters (e.g., 'custom-contentType:marketing
    // OR custom-contentType:customers')
    if (filters && filters.length > 0) {
      filters.forEach((filter) => {
        const termQuery = this.parsePresetFilter(filter);
        if (termQuery) {
          allFilterParts.push(termQuery);
        }
      });
    }

    // Add facet filter terms - group values by field
    // Supports both array of arrays (string[][]) and flat array (string[])
    if (facetFilters.length > 0) {
      // Flatten if array of arrays, otherwise use as-is
      const flatFilters = facetFilters.flat();

      const termsByField = {};
      flatFilters.forEach(({ key, value }) => {
        if (key && value) {
          const contentAIField = this.getContentAIFieldPath(key);
          if (!termsByField[contentAIField]) {
            termsByField[contentAIField] = [];
          }
          termsByField[contentAIField].push(value);
        }
      });

      Object.entries(termsByField).forEach(([field, values]) => {
        allFilterParts.push({
          term: {
            [field]: values,
          },
        });
      });
    }

    // Add numeric filters (date ranges)
    const dateRanges = this.parseNumericFilters(numericFilters);
    Object.entries(dateRanges).forEach(([field, range]) => {
      allFilterParts.push({
        range: {
          [field]: range,
        },
      });
    });

    // Build top-level andParts (max 5 items per 'and' imposed by ContentHub backend)
    const andParts = [searchContext];

    // Add filters chunked into nested 'and' blocks if needed
    if (allFilterParts.length > 0) {
      const filtersBlock = this.chunkIntoAnd(allFilterParts);
      if (filtersBlock) {
        andParts.push(filtersBlock);
      }
    }

    // Always wrap in 'and' structure
    return [{ and: andParts }];
  }

  /**
   * Build facets array for ContentAI request
   * @param {string[]} facetKeys - Facet keys
   * @param {string[][]} facetFilters - Facet filters
   * @param {string[]} numericFilters - Numeric filters
   * @returns {Array} ContentAI facets array
   */
  buildFacetsArray(facetKeys, facetFilters = [], numericFilters = []) {
    const facets = [];
    const processedFields = new Set();

    // Flatten if array of arrays, otherwise use as-is
    const flatFilters = facetFilters.flat();

    // Group facet filters by base key
    const filtersByKey = {};
    flatFilters.forEach(({ key, value }) => {
      if (!filtersByKey[key]) {
        filtersByKey[key] = [];
      }
      if (value) {
        filtersByKey[key].push(value);
      }
    });

    // Build scope terms from all selected CATEGORY facets (to apply to other facets)
    // Format: { term: { "field": ["value1", "value2"] } }
    const categoryScopeTerms = [];
    Object.entries(filtersByKey).forEach(([key, values]) => {
      if (values && values.length > 0) {
        const field = this.getContentAIFieldPath(key);
        categoryScopeTerms.push({
          facetKey: key,
          term: {
            [field]: values,
          },
        });
      }
    });

    // Build scope terms from STAT facets (date ranges) - these apply to ALL facets
    // Format: { range: { "field": { "gte": value, "lte": value } } }
    const dateRanges = this.parseNumericFilters(numericFilters);
    const statScopeTerms = [];
    Object.entries(dateRanges).forEach(([field, range]) => {
      statScopeTerms.push({ range: { [field]: range } });
    });

    // Process each unique facet
    facetKeys.forEach((facetKey) => {
      // Skip if already processed
      if (processedFields.has(facetKey)) return;
      processedFields.add(facetKey);

      const contentAIField = this.getContentAIFieldPath(facetKey);
      const isDateFacet = getDateFacets().includes(facetKey);

      // Get scope terms from OTHER category facets (not this one)
      const categoryTermsForThisFacet = categoryScopeTerms
        .filter((s) => s.facetKey !== facetKey)
        .map((s) => ({ term: s.term }));

      // Combine category terms with stat terms (stat terms apply to ALL facets)
      const allTermsForThisFacet = [...categoryTermsForThisFacet, ...statScopeTerms];

      // Build scope object if there are terms (chunked per ContentHub backend 5-item limit)
      const buildScope = (terms) => {
        if (terms.length === 0) return null;
        return this.chunkIntoAnd(terms);
      };

      if (isDateFacet) {
        // Build STAT facet for date fields
        const statFacet = {
          type: 'STAT',
          id: facetKey,
          field: contentAIField,
        };

        // Add scope from all terms (including date ranges for ALL facets)
        const scope = buildScope(allTermsForThisFacet);
        if (scope) {
          statFacet.scope = scope;
        }

        facets.push(statFacet);
      } else {
        // Build CATEGORY facet
        const bucketSize = getEffectiveFacetBucketSize(facetKey);
        const categoryFacet = {
          type: 'CATEGORY',
          id: facetKey,
          field: contentAIField,
          size: bucketSize,
          sort: 'COUNT_DESC',
        };

        // Add scope from OTHER category facets + ALL stat facets (date ranges)
        const scope = buildScope(allTermsForThisFacet);
        if (scope) {
          categoryFacet.scope = scope;
        }

        facets.push(categoryFacet);
      }
    });

    return facets;
  }

  /**
   * Build query request payload (for results)
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Object} ContentAI query request body
   */
  buildQueryRequest(query, options = {}) {
    const {
      facetFilters = [],
      numericFilters = [],
      filters = [],
      hitsPerPage = 24,
      cursor = null,
      orderBy = buildOrderBy(SORT_TYPE.LAST_MODIFIED, SORT_DIRECTION.DESCENDING),
      searchMode,
    } = options;

    const request = {
      query: this.buildQueryArray(query, {
        numericFilters, filters, facetFilters, searchMode,
      }),
      limit: hitsPerPage,
    };

    // Only include orderBy when provided (null = relevance / top results)
    if (orderBy) {
      request.orderBy = orderBy;
    }

    if (cursor) {
      request.cursor = cursor;
    }

    return request;
  }

  /**
   * Build facets scope request payload (all facets with scope from other selections)
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Object|null} ContentAI facets request body or null if no facets
   */
  buildFacetsScopeRequest(query, options = {}) {
    const {
      facets: facetKeys = [],
      facetFilters = [],
      numericFilters = [],
      filters = [],
      searchMode,
    } = options;

    const facetsArray = this.buildFacetsArray(facetKeys, facetFilters, numericFilters);
    if (facetsArray.length === 0) {
      return null;
    }

    return {
      query: this.buildQueryArray(query, { numericFilters, filters, searchMode }),
      limit: 0,
      facets: facetsArray,
    };
  }

  /**
   * Build facets include request payload (only selected facets with scope + includes)
   * Used to get counts for selected values only
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Object|null} ContentAI facets request body or null if no selected facets
   */
  buildFacetsIncludeRequest(query, options = {}) {
    const {
      facetFilters = [],
      numericFilters = [],
      filters = [],
    } = options;

    // Flatten if array of arrays, otherwise use as-is
    const flatFilters = facetFilters.flat();

    // Group facet filters by base key
    const filtersByKey = {};
    flatFilters.forEach(({ key, value }) => {
      if (!filtersByKey[key]) {
        filtersByKey[key] = [];
      }
      if (value) {
        filtersByKey[key].push(value);
      }
    });

    // Only process facets that have selections
    const selectedFacetKeys = Object.keys(filtersByKey).filter(
      (key) => filtersByKey[key].length > 0,
    );

    if (selectedFacetKeys.length === 0) {
      return null;
    }

    // Build scope terms from all selected CATEGORY facets
    const categoryScopeTerms = [];
    Object.entries(filtersByKey).forEach(([key, values]) => {
      if (values && values.length > 0) {
        const field = this.getContentAIFieldPath(key);
        categoryScopeTerms.push({
          facetKey: key,
          term: { [field]: values },
        });
      }
    });

    // Build scope terms from STAT facets (date ranges) - apply to ALL facets
    const dateRanges = this.parseNumericFilters(numericFilters);
    const statScopeTerms = [];
    Object.entries(dateRanges).forEach(([field, range]) => {
      statScopeTerms.push({ range: { [field]: range } });
    });

    // Build scope object (chunked to respect ContentHub backend limit of 5 items per 'and')
    const buildScope = (terms) => {
      if (terms.length === 0) return null;
      return this.chunkIntoAnd(terms);
    };

    // Build facets array with scope + includes
    const facets = [];
    selectedFacetKeys.forEach((facetKey) => {
      const contentAIField = this.getContentAIFieldPath(facetKey);
      const selectedValues = filtersByKey[facetKey];

      // Get scope terms from OTHER category facets (not this one)
      const categoryTermsForThisFacet = categoryScopeTerms
        .filter((s) => s.facetKey !== facetKey)
        .map((s) => ({ term: s.term }));

      // Combine with stat terms (date ranges apply to all)
      const allTermsForThisFacet = [...categoryTermsForThisFacet, ...statScopeTerms];

      const bucketSize = getEffectiveFacetBucketSize(facetKey);
      const facet = {
        type: 'CATEGORY',
        id: facetKey,
        field: contentAIField,
        size: bucketSize,
        sort: 'COUNT_DESC',
        includes: {
          values: selectedValues,
        },
      };

      // Add scope from other selected facets
      const scope = buildScope(allTermsForThisFacet);
      if (scope) {
        facet.scope = scope;
      }

      facets.push(facet);
    });

    return {
      query: this.buildQueryArray(query, { numericFilters, filters }),
      limit: 0,
      facets,
    };
  }

  /**
   * Search for assets using ContentAI API
   * Performs parallel requests: query, facets scope, and facets include (unless skipFacets is true)
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @param {string} [options.collectionId] - Collection ID for searching within a collection
   * @param {boolean} [options.skipFacetsRequest=false] - Skip facets request (query only)
   * @param {boolean} [options.useRealPermissions=false] - Build the country auth filter from
   *   the real, pre-simulation identity instead of the currently-simulated one, when
   *   sudo-simulating. No effect when not simulating.
   * @returns {Promise<Object>} Merged ContentAI response
   */
  async searchAssets(query, options = {}) {
    const { collectionId, skipFacetsRequest = false, useRealPermissions = false } = options;
    const queryRequest = this.buildQueryRequest(query, options);

    // Determine search URL - use collection-specific endpoint if collectionId provided
    const searchUrl = collectionId
      ? `/adobe/assets/contentai/collections/${collectionId}/search`
      : '/adobe/assets/contentai/search';

    // Worker-side flag (stripped before forwarding upstream): build the country
    // auth filter from the real, pre-simulation identity rather than whatever is
    // currently simulated. Used by the simulation country picker's own lookup.
    if (useRealPermissions) {
      queryRequest.useRealPermissions = true;
    }

    // Build parallel requests
    const requests = [
      this.makeRequest({
        url: searchUrl,
        method: 'POST',
        data: queryRequest,
      }),
    ];

    // Add facets requests unless skipFacetsRequest is true
    if (!skipFacetsRequest) {
      // Scope request: all facets with scope from other selections
      const facetsScopeRequest = this.buildFacetsScopeRequest(query, options);
      if (facetsScopeRequest) {
        if (useRealPermissions) {
          facetsScopeRequest.useRealPermissions = true;
        }
        requests.push(
          this.makeRequest({
            url: searchUrl,
            method: 'POST',
            data: facetsScopeRequest,
          }),
        );
      }

      // Include request: only selected facets with includes for exact counts
      const facetsIncludeRequest = this.buildFacetsIncludeRequest(query, options);
      if (facetsIncludeRequest) {
        if (useRealPermissions) {
          facetsIncludeRequest.useRealPermissions = true;
        }
        requests.push(
          this.makeRequest({
            url: searchUrl,
            method: 'POST',
            data: facetsIncludeRequest,
          }),
        );
      }
    }

    // Execute in parallel
    const [queryResponse, facetsScopeResponse, facetsIncludeResponse] = await Promise.all(requests);

    // Start with scope response facets
    const scopeFacets = facetsScopeResponse?.facets;

    // Only process if there are scope facets
    if (scopeFacets && scopeFacets.length > 0) {
      let mergedFacets = scopeFacets;

      // Merge include response facets (update values with accurate counts for selected items)
      if (facetsIncludeResponse?.facets) {
        // Create a map of include facets by id for quick lookup
        const includeFacetsMap = new Map();
        facetsIncludeResponse.facets.forEach((facet) => {
          includeFacetsMap.set(facet.id, facet);
        });

        // Update scope facets with include facet values
        mergedFacets = scopeFacets.map((scopeFacet) => {
          const includeFacet = includeFacetsMap.get(scopeFacet.id);
          if (!includeFacet || !includeFacet.values) {
            return scopeFacet;
          }

          // Create a map of include values by value for quick lookup
          const includeValuesMap = new Map();
          includeFacet.values.forEach((v) => {
            includeValuesMap.set(v.value, v);
          });

          // Track which include values have been used
          const usedIncludeValues = new Set();

          // Keep all scope values, but use count from include if same 'value' exists
          const updatedValues = (scopeFacet.values || []).map((scopeValue) => {
            const includeValue = includeValuesMap.get(scopeValue.value);
            if (includeValue) {
              usedIncludeValues.add(scopeValue.value);
              // Only update count from facetsIncludeResponse, keep everything else
              return { ...scopeValue, count: includeValue.count };
            }
            // Keep scope value as-is (don't remove anything)
            return scopeValue;
          });

          // Add any include values that don't exist in scope response
          includeFacet.values.forEach((includeValue) => {
            if (!usedIncludeValues.has(includeValue.value)) {
              updatedValues.push(includeValue);
            }
          });

          return { ...scopeFacet, values: updatedValues };
        });
      }

      queryResponse.facets = mergedFacets;
    }

    return queryResponse;
  }

  /**
   * Fetch expanded facet values for a single facet (used by "Show All" modal).
   * Makes a search request with limit 0 (no hits) and MAX_FACET_BUCKET_SIZE for the target facet.
   * @param {string} query - Current search query
   * @param {string} facetKey - The facet key to expand
   * @param {Object} options - Current search options (facetFilters, numericFilters, filters)
   * @returns {Promise<Object>} Raw ContentAI response with expanded facet values
   */
  async fetchExpandedFacet(query, facetKey, options = {}) {
    const {
      facetFilters = [],
      numericFilters = [],
      filters = [],
    } = options;

    const contentAIField = this.getContentAIFieldPath(facetKey);
    const isDateFacet = getDateFacets().includes(facetKey);

    // Build scope from other facet selections (same logic as buildFacetsArray)
    const flatFilters = facetFilters.flat();
    const filtersByKey = {};
    flatFilters.forEach(({ key, value }) => {
      if (!filtersByKey[key]) filtersByKey[key] = [];
      if (value) filtersByKey[key].push(value);
    });

    const categoryScopeTerms = [];
    Object.entries(filtersByKey).forEach(([key, values]) => {
      if (values.length > 0 && key !== facetKey) {
        categoryScopeTerms.push({
          term: { [this.getContentAIFieldPath(key)]: values },
        });
      }
    });

    const dateRanges = this.parseNumericFilters(numericFilters);
    const statScopeTerms = [];
    Object.entries(dateRanges).forEach(([field, range]) => {
      statScopeTerms.push({ range: { [field]: range } });
    });

    const allTerms = [...categoryScopeTerms, ...statScopeTerms];
    const scope = allTerms.length > 0 ? this.chunkIntoAnd(allTerms) : undefined;

    const facet = {
      type: isDateFacet ? 'STAT' : 'CATEGORY',
      id: facetKey,
      field: contentAIField,
      ...(!isDateFacet && { size: MAX_FACET_BUCKET_SIZE, sort: 'COUNT_DESC' }),
      ...(scope && { scope }),
    };

    const facets = [facet];

    const request = {
      query: this.buildQueryArray(query, { numericFilters, filters }),
      limit: 0,
      facets,
    };

    return this.makeRequest({
      url: '/adobe/assets/contentai/search',
      method: 'POST',
      data: request,
    });
  }

  // ============================================================
  // Asset Metadata & Renditions Methods
  // ============================================================

  /**
   * Get asset metadata.
   *
   * For sponsorship assets the worker withholds metadata until the user
   * accepts a disclaimer. The first call (without `disclaimerAccepted`) may
   * return `{ requiresDisclaimer: true, reason: 'sponsorship' }` in place of
   * the real metadata; callers should display the disclaimer and re-issue
   * this call with `disclaimerAccepted: true` to retrieve the metadata.
   *
   * @param {string} assetId - Asset ID
   * @param {string|Object} [optionsOrIfNoneMatch] - Either an ETag string
   *   (legacy positional arg, kept for backward compatibility) or an options
   *   object: `{ ifNoneMatch?, disclaimerAccepted? }`.
   * @returns {Promise<Object>} Metadata, or a disclaimer-required signal
   */
  async getMetadata(assetId, optionsOrIfNoneMatch) {
    const opts = typeof optionsOrIfNoneMatch === 'string'
      ? { ifNoneMatch: optionsOrIfNoneMatch }
      : (optionsOrIfNoneMatch || {});

    const headers = {};
    if (opts.ifNoneMatch) {
      headers['If-None-Match'] = opts.ifNoneMatch;
    }
    if (opts.disclaimerAccepted) {
      headers['x-disclaimer-accepted'] = 'true';
    }

    try {
      return await this.makeRequest({
        url: `/adobe/assets/${assetId}/metadata`,
        method: 'GET',
        headers,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('Not Modified')) {
        throw new Error('Asset metadata not modified');
      }
      throw new Error(`Failed to fetch metadata for assetId "${assetId}": ${error.message}`);
    }
  }

  /**
   * Change file extension to supported preview format
   * @private
   */
  // eslint-disable-next-line class-methods-use-this
  changeToSupportedPreview(fileName) {
    const lastDotIndex = fileName.lastIndexOf('.');
    if (lastDotIndex === -1) return fileName;

    const extension = fileName.substring(lastDotIndex + 1).toLowerCase()
      .replace(/(png)/, 'webp')
      .replace(/(mov|m3u8|mp4|mpeg|avi|asf|flv|m4v)/, 'jpg')
      .replace(/(tif)/, 'avif');
    const baseName = fileName.substring(0, lastDotIndex);

    return `${baseName}.${extension}`;
  }

  /**
   * Get preview PDF URL
   * @param {string} assetId - Asset ID
   * @param {string} repoName - Repository name
   * @param {string} [rendition='original'] - Rendition name
   * @returns {string} Preview URL
   */
  getPreviewPdfUrl(assetId, repoName, rendition = 'original') {
    const processedRepoName = this.changeToSupportedPreview(repoName);
    return `/api/adobe/assets/${assetId}/renditions/${rendition}/as/preview-${processedRepoName}`;
  }

  /**
   * Get optimized delivery preview URL
   * @param {string} assetId - Asset ID
   * @param {string} repoName - Repository name
   * @param {number} [width=350] - Image width
   * @returns {string} Preview URL
   */
  getOptimizedDeliveryPreviewUrl(assetId, repoName, width = 350) {
    const processedRepoName = this.changeToSupportedPreview(repoName);
    return `/api/adobe/assets/${assetId}/as/preview-${processedRepoName}?width=${width}&preferwebp=true`;
  }

  /**
   * Get download token response
   * @param {Object} asset - Asset object
   * @returns {Promise<{token: string, expiryTime: number}|undefined>}
   */
  async getDownloadTokenResp(asset) {
    return this.makeRequest({
      url: `/adobe/assets/${asset?.assetId}/token`,
      method: 'GET',
      allowUndefinedResponse: true,
    });
  }

  /**
   * Download asset's single rendition
   * @param {Object} asset - Asset object
   * @param {Object} [rendition] - Rendition object
   * @param {boolean} [isImagePreset=false] - Whether rendition is an image preset
   */
  async downloadAsset(asset, rendition = { name: ORIGINAL_RENDITION }, isImagePreset = false) {
    const tokenResp = await this.getDownloadTokenResp(asset);

    let queryParams = {};

    // Extract filename and extension
    let finalFilename = asset?.name || '';
    if (!finalFilename) {
      const baseFilename = `asset-${asset?.assetId}-${rendition?.name}`;
      if (asset?.format) {
        const extension = mimeTypeToExtension(asset?.format);
        finalFilename = extension ? `${baseFilename}.${extension}` : baseFilename;
      }
    }

    if (rendition && rendition.format && rendition.format !== asset?.format) {
      const lastDotIndex = finalFilename?.lastIndexOf('.');
      if (lastDotIndex && lastDotIndex > 0) {
        const nameWithoutExt = finalFilename?.substring(0, lastDotIndex);
        const newExtension = mimeTypeToExtension(rendition.format);
        if (newExtension) {
          finalFilename = `${nameWithoutExt}.${newExtension}`;
        }
      } else {
        const newExtension = mimeTypeToExtension(rendition.format);
        if (newExtension) {
          finalFilename = `${finalFilename}.${newExtension}`;
        }
      }
    }

    const assetNameDotIdx = asset?.name?.lastIndexOf('.') ?? -1;
    const nameWithoutExtension = assetNameDotIdx !== -1
      ? asset?.name?.substring(0, assetNameDotIdx)
      : asset?.name;
    const renditionNameDotIdx = rendition?.name?.lastIndexOf('.') ?? -1;
    const renditionNameWithoutExtension = renditionNameDotIdx !== -1
      ? rendition?.name?.substring(0, renditionNameDotIdx)
      : rendition?.name;

    let url;
    if (isImagePreset) {
      const formatPart = rendition?.format?.split(',')[0];
      const assetDotIdx = asset?.name?.lastIndexOf('.') ?? -1;
      const extension = (formatPart ? `.${formatPart}` : '')
        || (assetDotIdx !== -1 ? `.${asset?.name?.substring(assetDotIdx + 1)}` : '');
      finalFilename = `${nameWithoutExtension}_${renditionNameWithoutExtension}${extension}`;
      url = `/adobe/assets/${asset?.assetId}/as/${finalFilename}`;
      queryParams = {
        preset: rendition?.name || '',
        attachment: 'true',
      };
    } else {
      const renditionDotIdx = rendition?.name?.lastIndexOf('.') ?? -1;
      const assetDotIdx = asset?.name?.lastIndexOf('.') ?? -1;
      const extension = (renditionDotIdx !== -1 ? `.${rendition?.name?.substring(renditionDotIdx + 1)}` : '')
        || (assetDotIdx !== -1 ? `.${asset?.name?.substring(assetDotIdx + 1)}` : '');
      finalFilename = `${nameWithoutExtension}_${renditionNameWithoutExtension}${extension}`;
      url = `/adobe/assets/${asset?.assetId}/renditions/${rendition?.name}/as/${finalFilename}`;
    }

    if (tokenResp?.token && tokenResp?.expiryTime) {
      queryParams.token = tokenResp.token;
      queryParams.expiryTime = tokenResp.expiryTime.toString();
    }

    const searchParams = new URLSearchParams();
    Object.entries(queryParams).forEach(([key, value]) => {
      if (value !== undefined) {
        searchParams.append(key, String(value));
      }
    });

    const downloadUrl = `/api${url}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
    dispatchAssetAction(ASSET_AUDIT_ACTIONS.DOWNLOAD, asset?.assetId);
    this.downloadFromUrl(downloadUrl, finalFilename);
  }

  /**
   * Get asset renditions
   * @param {Object} asset - Asset object
   * @returns {Promise<{items?: Array}>}
   */
  async getAssetRenditions(asset) {
    try {
      return await this.makeRequest({
        url: `/adobe/assets/${asset?.assetId}/renditions`,
        method: 'GET',
      });
    } catch (error) {
      throw new Error(`Failed to fetch assetId "${asset?.assetId}": ${error.message}`);
    }
  }

  /**
   * Fetch rendition content as JSON data
   * @param {Object} asset - Asset object
   * @param {string} renditionName - Name of the rendition to fetch (e.g., 'structure.json')
   * @returns {Promise<Object>} Parsed JSON data from rendition
   */
  async fetchRenditionAsJson(asset, renditionName) {
    const tokenResp = await this.getDownloadTokenResp(asset);

    const params = {};
    if (tokenResp?.token && tokenResp?.expiryTime) {
      params.token = tokenResp.token;
      params.expiryTime = tokenResp.expiryTime.toString();
    }

    return this.makeRequest({
      url: `/adobe/assets/${asset?.assetId}/renditions/${renditionName}/as/${renditionName}`,
      method: 'GET',
      params,
    });
  }

  /**
   * Get image presets
   * @returns {Promise<{items: Array}>}
   */
  async getImagePresets() {
    try {
      return await this.makeRequest({
        url: '/adobe/assets/imagePresets',
        method: 'GET',
      });
    } catch (error) {
      throw new Error(`Failed to fetch image presets: ${error.message}`);
    }
  }

  // ============================================================
  // Archive Methods
  // ============================================================

  /**
   * Create assets archive
   * @param {Array<{asset: Object, renditions: Array}>} assetRenditionPairs - Assets with renditions
   * @returns {Promise<string|null>} Archive ID or null
   */
  async createAssetsArchive(assetRenditionPairs) {
    try {
      const payload = {
        items: assetRenditionPairs.map((pair) => ({
          assetId: pair.asset.assetId,
          includeRenditions: pair.renditions.map((rendition) => rendition.name),
        })),
      };

      // eslint-disable-next-line no-console
      console.warn('[createAssetsArchive] payload:', JSON.stringify(payload));
      const responseData = await this.makeRequest({
        url: '/adobe/assets/archives',
        method: 'POST',
        data: payload,
        allowUndefinedResponse: true,
      });

      // eslint-disable-next-line no-console
      console.warn('[createAssetsArchive] response:', JSON.stringify(responseData));
      if (!responseData) {
        return null;
      }

      return responseData.id;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[createAssetsArchive] error:', error);
      return null;
    }
  }

  /**
   * Get assets archive status
   * @param {string} archiveId - Archive ID
   * @returns {Promise<Object|undefined>}
   */
  async getAssetsArchiveStatus(archiveId) {
    return this.makeRequest({
      url: `/adobe/assets/archives/${archiveId}/status`,
      method: 'GET',
      allowUndefinedResponse: true,
    });
  }

  /**
   * Trigger download by creating a link and clicking it
   * @private
   */
  // eslint-disable-next-line class-methods-use-this
  triggerDownload(href, filename, cleanup) {
    try {
      const link = document.createElement('a');
      link.href = href;
      link.download = filename;
      link.style.display = 'none';

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      cleanup?.();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to trigger download:', error);
      cleanup?.();
    }
  }

  /**
   * Download a file from a direct URL
   * @param {string} url - Download URL
   * @param {string} [defaultFilename='download'] - Default filename
   */
  downloadFromUrl(url, defaultFilename = 'download') {
    try {
      const urlParts = url.split('/');
      const filename = urlParts[urlParts.length - 1]?.split('?')[0] || defaultFilename;
      this.triggerDownload(url, filename);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to download file from URL:', url, error);
    }
  }
}

// Export singleton instance
let clientInstance = null;

/**
 * Get DynamicMediaClient instance
 * @returns {DynamicMediaClient}
 */
export function getDynamicMediaClient() {
  if (!clientInstance) {
    clientInstance = new DynamicMediaClient();
  }
  return clientInstance;
}

// Backward compatibility aliases for ContentAI migration
export { DynamicMediaClient as ContentAIClient };
export const getContentAIClient = getDynamicMediaClient;
