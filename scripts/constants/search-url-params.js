/**
 * URL parameter keys for search filters
 * Shared between EDS blocks and React components
 */
export const SEARCH_URL_PARAMS = {
  QUERY: 'query',
  FULLTEXT: 'fulltext',
  FACET_FILTERS: 'facetFilters',
  NUMERIC_FILTERS: 'numericFilters',
  RIGHTS_FILTERS: 'rightsFilters',
  SEARCH_MODE: 'searchMode',
};

/**
 * Get all search URL param keys as an array
 */
export const getAllSearchParamKeys = () => Object.values(SEARCH_URL_PARAMS);
