/**
 * @fileoverview Asset Access Control Functions
 *
 * This module provides functions to check asset metadata against authorization clauses.
 * Used for enforcing access control on individual asset metadata responses.
 *
 * @module origin/asset-access
 */

/**
 * Convert repo:ancestors array to taxonomy path format used in authClauses.
 * Example: ["org", "brand", "brand-a"] => "custom:brand/brand-a"
 * @param {string[]} ancestors - The repo:ancestors array from asset metadata
 * @returns {string} The taxonomy path string
 */
function ancestorsToTaxonomyPath(ancestors) {
  if (!ancestors || ancestors.length < 2) return '';
  // Format: first:second/third/fourth/...
  const [first, second, ...rest] = ancestors;
  let path = `${first}:${second}`;
  if (rest.length > 0) {
    path += `/${rest.join('/')}`;
  }
  return path;
}

/**
 * Extract all taxonomy paths from an asset metadata field.
 * Handles objects with repo:ancestors, string arrays, and simple strings.
 * @param {Array|string} fieldValue - The metadata field value
 * @returns {string[]} Array of taxonomy paths
 *
 * @example
 * // Simple string (e.g., custom:contentType)
 * extractTaxonomyPaths("marketing")
 * // Returns: ["marketing"]
 *
 * @example
 * // Simple string array (e.g., custom:country)
 * extractTaxonomyPaths(["us", "ca", "mx"])
 * // Returns: ["us", "ca", "mx"]
 *
 * @example
 * // Objects with repo:ancestors (e.g., custom:brand)
 * extractTaxonomyPaths([
 *   { "repo:ancestors": ["org", "brand", "brand-a"] },
 *   { "repo:ancestors": ["org", "brand", "brand-b"] }
 * ])
 * // Returns: ["custom:brand/brand-a", "custom:brand/brand-b"]
 */
function extractTaxonomyPaths(fieldValue) {
  if (!fieldValue) return [];
  if (!Array.isArray(fieldValue)) return [String(fieldValue)];

  const paths = [];
  for (const item of fieldValue) {
    if (item && typeof item === 'object' && Array.isArray(item['repo:ancestors'])) {
      const path = ancestorsToTaxonomyPath(item['repo:ancestors']);
      if (path) paths.push(path);
    } else if (typeof item === 'string') {
      paths.push(item);
    }
  }
  return paths;
}

/**
 * Check a single `not` clause entry (`notClause.term` or `notClause.exists`) against
 * asset metadata.
 * @param {Object} notClause - One entry from a `not` clause array
 * @param {Object} assetMetadata - The assetMetadata object from API response
 * @returns {{ violated: boolean, reason?: string }} Result with violation status and reason
 */
function checkNotClauseEntry(notClause, assetMetadata) {
  if (notClause.term) {
    for (const [fieldPath, deniedValues] of Object.entries(notClause.term)) {
      // Field path is like 'assetMetadata.custom:brand', extract the field name
      const fieldName = fieldPath.replace(/^assetMetadata\./, '');
      const assetPaths = extractTaxonomyPaths(assetMetadata[fieldName]);

      // Check if any asset value is in the denied list
      for (const assetPath of assetPaths) {
        if (deniedValues.includes(assetPath)) {
          return {
            violated: true,
            reason: `Denied ${fieldName} -- Asset has "${assetPath}" which is in denied list [${deniedValues.join(', ')}]`,
          };
        }
      }
    }
  }

  // NOT EXISTS - asset must NOT have a value for the field (i.e. field must be absent)
  if (notClause.exists) {
    const fieldPath = notClause.exists.field;
    const fieldName = fieldPath.replace(/^assetMetadata\./, '');
    const hasValue = extractTaxonomyPaths(assetMetadata[fieldName]).length > 0;
    if (hasValue) {
      return {
        violated: true,
        reason: `Denied ${fieldName} -- Asset has a value but rule requires it to be absent`,
      };
    }
  }

  return { violated: false };
}

/**
 * Check if asset metadata violates the authorization clauses.
 *
 * Evaluates these clause types:
 * - `not` clauses: Asset must NOT have any of the specified values (denial); a `not` clause
 *   may also wrap an `exists` check to require the field be entirely absent
 * - `term` clauses: Asset must have at least one of the specified values (allowance)
 * - `or` clauses: At least one sub-clause must pass (evaluated recursively)
 *
 * Asset metadata fields can have different formats:
 * - `custom:brand`: Array of objects with repo:ancestors
 * - `custom:country`: Array of strings like ["us", "ca", "mx"]
 * - `custom:intendedCustomers`: Array of strings like ["none"]
 * - `custom:contentType`: Simple string like "marketing"
 *
 * @param {Object[]} authClauses - Array of authorization clauses from search filter
 * @param {Object} assetMetadata - The assetMetadata object from API response
 * @returns {{ violated: boolean, reason?: string }} Result with violation status and reason
 *
 * @example
 * // authClauses from search filter
 * const authClauses = [
 *   { not: [{ term: { 'assetMetadata.custom:brand': ['custom:brand/brand-a'] } }] },
 *   { not: [{ term: { 'assetMetadata.custom:contentType': ['customers'] } }] },
 *   { term: { 'assetMetadata.custom:country': ['us', 'all-countries'] } }
 * ];
 *
 * // assetMetadata from response (different field formats)
 * const assetMetadata = {
 *   'custom:brand': [{ 'repo:ancestors': ['org', 'brand', 'brand-a'] }],
 *   'custom:country': ['us', 'ca', 'mx'],
 *   'custom:intendedCustomers': ['none'],
 *   'custom:contentType': 'marketing'
 * };
 *
 * const result = checkAssetMetadataAuthorization(authClauses, assetMetadata);
 * // result: { violated: true, reason: 'Denied custom:brand -- Asset has "custom:brand/brand-a" which is in denied list [...]' }
 */
function checkAssetMetadataAuthorization(authClauses, assetMetadata) {
  if (!authClauses || authClauses.length === 0) {
    return { violated: false };
  }
  if (!assetMetadata) {
    return { violated: false };
  }

  for (const clause of authClauses) {
    // Handle OR clauses recursively - at least one must pass
    if (clause.or && Array.isArray(clause.or)) {
      const orResults = clause.or.map((subClause) => checkAssetMetadataAuthorization([subClause], assetMetadata));
      const anyPassed = orResults.some((r) => !r.violated);
      if (!anyPassed) {
        // All sub-clauses violated - find the first reason
        const firstViolation = orResults.find((r) => r.violated);
        return firstViolation || { violated: true, reason: 'None of the OR conditions matched' };
      }
      continue;
    }

    // Handle NOT clauses - asset must NOT have any of the denied values
    if (clause.not && Array.isArray(clause.not)) {
      for (const notClause of clause.not) {
        const result = checkNotClauseEntry(notClause, assetMetadata);
        if (result.violated) {
          return result;
        }
      }
      continue;
    }

    // Handle TERM clauses - asset must have at least one of the allowed values
    if (clause.term) {
      for (const [fieldPath, allowedValues] of Object.entries(clause.term)) {
        // Field path is like 'assetMetadata.custom:country', extract the field name
        const fieldName = fieldPath.replace(/^assetMetadata\./, '');
        const assetPaths = extractTaxonomyPaths(assetMetadata[fieldName]);

        // Check if at least one asset value is in the allowed list
        const hasAllowed = assetPaths.some((path) => allowedValues.includes(path));
        if (!hasAllowed && assetPaths.length > 0) {
          // Asset has values but none are allowed
          return {
            violated: true,
            reason: `Not allowed ${fieldName} -- Asset has [${assetPaths.join(', ')}] but user only allowed for [${allowedValues.join(', ')}]`,
          };
        }
        // If asset has no values for this field, it's not a violation
        // (the field might be optional or not applicable to this asset)
      }
    }
  }

  return { violated: false };
}

/**
 * Enforce asset metadata authorization and return 403 if violated.
 * Parses the response body, checks against auth clauses, and returns
 * either a 403 Forbidden response or the original response.
 *
 * @param {Object[]} authClauses - Authorization clauses from buildAssetAuthClauses
 * @param {Response} response - Response from Adobe API with asset metadata
 * @param {string} [userEmail] - User email for logging (optional)
 * @returns {Promise<Response>} Either 403 Forbidden or the original response
 */
async function enforceAssetMetadataAuthorization(authClauses, response, userEmail) {
  // Empty array means admin - no check needed
  if (authClauses.length === 0) {
    return response;
  }

  // Parse response to get asset metadata
  let responseData;
  try {
    responseData = await response.clone().json();
  } catch {
    // If we can't parse JSON, pass through
    return response;
  }

  const assetMetadata = responseData?.assetMetadata;
  if (!assetMetadata) {
    // No asset metadata to check, pass through
    return response;
  }

  // Check if asset metadata violates auth clauses
  const { violated, reason } = checkAssetMetadataAuthorization(authClauses, assetMetadata);

  if (violated) {
    if (userEmail) {
      console.warn(`[${userEmail}] Asset Metadata access denied: ${reason}`);
    }
    return new Response('Forbidden', { status: 403 });
  }

  return response;
}

export {
  ancestorsToTaxonomyPath,
  checkAssetMetadataAuthorization,
  enforceAssetMetadataAuthorization,
  extractTaxonomyPaths,
};
