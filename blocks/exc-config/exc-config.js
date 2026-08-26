/**
 * exc-config block
 *
 * Provides a table-based alternative to the JSON blob approach for authoring
 * excFacets (and other search config sections) in the docx.
 *
 * Docx table structure:
 *   Row 1  : block header row ("exc-config") — skipped by EDS convention
 *   Row 2  : section header — single populated cell, e.g. "excFacets"
 *   Row 3  : column headers — key | label | type | sortable | multiselect | filtertype | mincount
 *   Row 4+ : one facet per row
 *   (repeat Row 2–4+ for additional sections such as incFacets, sortOptions, …)
 *
 * Output is written to window.SearchResultsConfig.externalParams so that the
 * search-results block's trailing spread picks it up automatically, giving the
 * table config precedence over the legacy JSON blob without any changes to
 * search-results.js.
 */

import { parseExcConfigBlock } from '../search-results/utils/exc-config-parser.js';

export { FACET_SCHEMA, validateFacetRow, parseExcConfigBlock } from '../search-results/utils/exc-config-parser.js';

/**
 * Default export — EDS block decorator.
 * @param {HTMLElement} block
 */
export default function decorate(block) {
  const { config, errors } = parseExcConfigBlock(block);

  // Clear the block DOM — no visual output in production
  block.textContent = '';

  // Show validation errors inline in preview environments
  const isPreview = window.location.hostname.includes('.page')
    || window.location.hostname === 'localhost';
  if (errors.length > 0 && isPreview) {
    const errorBox = document.createElement('div');
    errorBox.className = 'exc-config-errors';
    errorBox.innerHTML = `<strong>⚠️ exc-config Validation Failed (${errors.length} issue/s):</strong><br/>- ${errors.join('<br/>- ')}`;
    block.appendChild(errorBox);
  }

  // Write parsed config to window.SearchResultsConfig.externalParams.
  // The trailing spread in search-results.js ensures this wins over any
  // inline JSON blob defined on that block.
  window.SearchResultsConfig = window.SearchResultsConfig || {};
  window.SearchResultsConfig.externalParams = {
    ...(window.SearchResultsConfig.externalParams || {}),
    ...config,
  };
}
