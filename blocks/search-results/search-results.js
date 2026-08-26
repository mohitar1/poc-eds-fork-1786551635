/* eslint-disable import/no-cycle */
/**
 * Search Results Block - Pure Vanilla JS Implementation
 * Main entry point with state management
 */

import {
  convertHtmlListToArray,
  extractMimeTypeMappings,
  fetchSpreadsheetData,
  getBlockKeyValues,
  stripHtmlAndNewlines,
  SEARCH_URL_PARAMS,
} from '../../scripts/scripts.js';
import { localizePath, getAppLabel } from '../../scripts/locale-utils.js';
import { getDateFacets, getFacetsConfig } from './constants/facets.js';
import { fetchTagsFromResponse } from './clients/tags-client.js';
import { getDynamicMediaClient, getContentAIClient } from './clients/dynamicmedia-client.js';
import {
  getExternalParams,
  getHitsPerPage,
  saveSearchFiltersToUrl,
  loadSearchFiltersFromUrl,
} from './utils/config.js';
import { parseExcConfigBlock } from './utils/exc-config-parser.js';
import { loadSearchExpandAllDetailsState } from './utils/toggle-state-storage.js';
import {
  fetchAssetById,
  populateAssetFromContentAIHit,
  parseContentAIResponse,
} from '../../scripts/asset-transformers.js';
import {
  initRenditionsFetcher,
  fetchAssetRenditions as fetchAssetRenditionsUtil,
} from './utils/renditions-fetcher.js';
import {
  SORT_TYPE,
  SORT_DIRECTION,
  DEFAULT_SORT_TYPE,
  DEFAULT_SORT_DIRECTION,
  loadSortPreference,
  saveSortPreference,
} from './utils/sort-utils.js';
import { getOrderBy } from './components/search-panel.js';
import {
  setState as setCartState,
  subscribe as subscribeCartState,
  extendState as extendCartState,
  loadCartFromStorage,
  getState as getCartGlobalState,
} from '../../scripts/cart-state.js';
import cartService from '../../scripts/utils/cart-service.js';

// Import toast utilities
// eslint-disable-next-line no-unused-vars
import showToast, { ToastQueue } from '../../scripts/toast/toast.js';

// Import components
import { createMainApp } from './components/main-app.js';

// Constants
const LOADING = {
  dmImages: 'dmImages',
};

// ContentAI match modes; FULLTEXT is the API's own default (mirrors MatchMode.yaml)
const DEFAULT_SEARCH_MODE = 'FULLTEXT';
const VALID_SEARCH_MODES = ['FULLTEXT', 'HYBRID'];

// Central state store
const state = {
  // External params
  externalParams: {},

  // Authentication
  authenticated: false,

  // Dynamic Media client
  dynamicMediaClient: null,

  // Search state
  query: '',
  searchResults: null,
  dmImages: [],
  loading: { [LOADING.dmImages]: false },
  selectedQueryType: 'All',

  // Pagination
  currentPage: 0,
  totalPages: 0,
  isLoadingMore: false,
  contentAICursor: null, // Cursor for ContentAI pagination

  // Facets
  facetCheckedState: {},
  selectedNumericFilters: [],
  expandedFacets: {},
  expandedHierarchyItems: {},
  excFacets: undefined,
  presetFilters: [],
  isTagsLoading: false, // True while fetching tags data from Tags API

  // UI state
  selectedCards: new Set(),
  expandAllDetails: true,
  viewType: 'grid',
  isMobileFilterOpen: false,
  deepLinkAsset: null,

  // Modals
  showPreviewModal: false,
  showDetailsModal: false,
  selectedCard: null,

  // Sort (use keys, not display values - translated at display time)
  selectedSortType: DEFAULT_SORT_TYPE,
  selectedSortDirection: DEFAULT_SORT_DIRECTION,

  // ContentAI match mode: FULLTEXT (default) or HYBRID
  searchMode: DEFAULT_SEARCH_MODE,

  // Renditions cache
  imagePresets: {},
  assetRenditionsCache: {},

  // Cart
  cartAssetItems: [],
  isCartPanelOpen: false,
  isDownloadPanelOpen: false,

  clearAllFacetsFunction: null,
};

// State change listeners
const listeners = new Set();

const CART_STATE_KEYS = ['cartAssetItems', 'isCartPanelOpen', 'isDownloadPanelOpen'];

let ph = null;

/**
 * Subscribe to state changes
 * @param {Function} listener - Callback function
 * @returns {Function} Unsubscribe function
 */
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Update state and notify listeners
 * @param {Object} updates - State updates
 */
export function setState(updates) {
  const prevState = { ...state };
  Object.assign(state, updates);

  const cartUpdates = {};
  let hasCartUpdates = false;
  CART_STATE_KEYS.forEach((key) => {
    if (key in updates) {
      cartUpdates[key] = updates[key];
      hasCartUpdates = true;
    }
  });
  if (hasCartUpdates) {
    setCartState(cartUpdates);
  }

  // Notify listeners
  listeners.forEach((listener) => {
    try {
      listener(state, prevState, updates);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('State listener error:', e);
    }
  });

  // Dispatch custom event for components
  window.dispatchEvent(new CustomEvent('searchResultsStateChange', {
    detail: { state, prevState, updates },
  }));
}

/**
 * Get current state
 * @returns {Object} Current state
 */
export function getState() {
  return state;
}

// Note: initRenditionsFetcher is called in decorate() after dynamicMediaClient is set

/**
 * Process and display ContentAI search results
 * @param {Object} rawResponse - Raw ContentAI search response
 * @param {boolean} isLoadingMoreFlag - Whether loading more results
 * @param {number} hitsPerPage - Hits per page for pagination calculation
 */
async function processContentAIImages(rawResponse, isLoadingMoreFlag = false, hitsPerPage = 24) {
  if (!isLoadingMoreFlag) {
    setState({ dmImages: [] });
  }

  setState({ searchResults: null });

  try {
    const parsed = parseContentAIResponse(rawResponse);
    const {
      hits,
      facets,
      totalCount,
      cursor,
    } = parsed;

    // Store cursor for next page
    setState({ contentAICursor: cursor });

    if (hits && hits.length > 0) {
      const processedImages = hits.map((hit) => populateAssetFromContentAIHit(hit));

      if (isLoadingMoreFlag) {
        setState({ dmImages: [...state.dmImages, ...processedImages] });
      } else {
        setState({ dmImages: processedImages });
      }
    }

    // Calculate pagination from ContentAI response
    const nbPages = Math.ceil(totalCount / hitsPerPage);

    // Store searchResults in a format compatible with facets panel
    // ContentAI facets format: { facetId: { value: count } }
    setState({
      searchResults: [{ facets, nbHits: totalCount, nbPages }],
      totalPages: nbPages,
    });
  } catch (error) {
    console.error('Error processing ContentAI images:', error);
  }

  setState({
    loading: { ...state.loading, [LOADING.dmImages]: false },
    isLoadingMore: false,
  });
}

/**
 * Perform search for images
 * @param {string} query - Search query
 * @param {number} page - Page number
 */
export async function performSearchImages(query, page = 0) {
  if (!state.dynamicMediaClient) return;

  const isLoadingMoreFlag = page > 0;
  if (isLoadingMoreFlag) {
    setState({ isLoadingMore: true });
  } else {
    setState({
      loading: { ...state.loading, [LOADING.dmImages]: true },
      currentPage: 0,
    });
  }

  // Derive selectedFacetFilters from facetCheckedState
  // ContentAI uses flat facet keys (no hierarchy prefix)
  const selectedFacetFilters = [];

  Object.keys(state.facetCheckedState).forEach((key) => {
    const facetFilter = [];
    Object.entries(state.facetCheckedState[key]).forEach(([facet, isChecked]) => {
      if (isChecked) {
        facetFilter.push({ key, value: facet });
      }
    });

    if (facetFilter.length > 0) {
      // Add as separate array (OR filtering within each facet)
      selectedFacetFilters.push(facetFilter);
    }
  });

  try {
    // Use ContentAI search
    const cursor = isLoadingMoreFlag ? state.contentAICursor : null;
    const hitsPerPage = getHitsPerPage();
    const rawResponse = await getContentAIClient().searchAssets(query.trim(), {
      facets: Object.keys(getFacetsConfig()),
      facetFilters: selectedFacetFilters,
      numericFilters: state.selectedNumericFilters,
      filters: state.presetFilters,
      hitsPerPage,
      cursor,
      orderBy: getOrderBy(),
      collectionId: state.externalParams?.collectionId,
      searchMode: state.searchMode,
    });

    await processContentAIImages(rawResponse, isLoadingMoreFlag, hitsPerPage);

    // Fetch tag names only after all pictures have rendered.
    // Set isTagsLoading immediately so the facet sections render
    // spinners on the first paint, then defer the actual fetch
    // until the browser is idle (images painted, no pending work).
    if (rawResponse.facets && state.excFacets) {
      setState({ isTagsLoading: true });
      const startTagsFetch = () => {
        fetchTagsFromResponse(rawResponse.facets, state.excFacets)
          .finally(() => {
            setState({ isTagsLoading: false });
          });
      };
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(startTagsFetch);
      } else {
        setTimeout(startTagsFetch, 0);
      }
    }
  } catch (error) {
    if (error?.message === 'Network error') {
      console.warn('Network error encountered, stopping execution');
      setState({
        loading: { ...state.loading, [LOADING.dmImages]: false },
        isLoadingMore: false,
      });
      return;
    }

    console.error('Error searching assets:', error);
    ToastQueue.negative('Something went wrong with the search');
    setState({
      loading: { ...state.loading, [LOADING.dmImages]: false },
      isLoadingMore: false,
    });

    if (!isLoadingMoreFlag) {
      setState({ dmImages: [] });
    }
  }
}

/**
 * Main search function
 * @param {string} [searchQuery] - Optional search query
 */
export function search(searchQuery) {
  setState({ currentPage: 0 });
  const queryToUse = searchQuery !== undefined ? searchQuery : state.query;
  performSearchImages(queryToUse, 0);
}

/**
 * Load more results (pagination)
 */
export function handleLoadMoreResults() {
  if (state.currentPage + 1 < state.totalPages && !state.isLoadingMore) {
    const nextPage = state.currentPage + 1;
    setState({ currentPage: nextPage });
    performSearchImages(state.query, nextPage);
  }
}

/**
 * Handle facet checkbox change
 * @param {string} key - Facet key
 * @param {string} facet - Facet value
 */
export function handleFacetCheckbox(key, facet) {
  const newFacetCheckedState = {
    ...state.facetCheckedState,
    [key]: {
      ...state.facetCheckedState[key],
      [facet]: !state.facetCheckedState[key]?.[facet],
    },
  };
  setState({ facetCheckedState: newFacetCheckedState });
}

/**
 * Clear all facet selections
 */
export function handleClearAllFacets() {
  setState({
    facetCheckedState: {},
    selectedNumericFilters: [],
    expandedFacets: {},
    expandedHierarchyItems: {},
  });
}

/**
 * Fetch and cache renditions for an asset
 * Re-exported from renditions-fetcher.js for backward compatibility
 * @param {Object} asset - Asset object
 */
export async function fetchAssetRenditions(asset) {
  return fetchAssetRenditionsUtil(asset);
}

/**
 * Add a single asset to the cart.
 */
export async function handleAddToCart(image) {
  await cartService.add(image, { type: 'asset', fetchDetails: false });
  if (!ph) ph = await getAppLabel();
  showToast(ph('assetAddedToCart', 'Asset added to cart'), 'success');
}

/**
 * Remove a single asset from the cart.
 */
export async function handleRemoveFromCart(image) {
  const imageId = image.assetId || image.id;
  cartService.remove(imageId, { type: 'asset' });
  if (!ph) ph = await getAppLabel();
  showToast(ph('assetRemovedFromCart', 'Asset removed from cart'), 'success');
}

/**
 * Bulk add selected assets to the cart.
 */
export async function handleBulkAddToCart(selectedCardIds, images) {
  const itemsToAdd = [];
  selectedCardIds.forEach((cardId) => {
    const image = images.find((img) => (img.assetId || img.id) === cardId);
    if (image) itemsToAdd.push(image);
  });

  if (itemsToAdd.length === 0) return;

  await cartService.add(itemsToAdd, { type: 'asset', fetchDetails: false });
  if (!ph) ph = await getAppLabel();
  showToast(
    ph('assetsAddedToCart', '{0} asset(s) added to cart').replace('{0}', itemsToAdd.length),
    'success',
  );
}

/**
 * Initialize the block
 * @param {HTMLElement} block - Block element
 */
export default async function decorate(block) {
  // Get block key-value pairs
  const blockObj = getBlockKeyValues(block);

  // Parse table-format excFacets before clearing the DOM
  const { config: tableConfig } = parseExcConfigBlock(block);

  // Get configs
  const configs = await fetchSpreadsheetData('configs');

  // Load MIME type mappings from configs multi-sheet
  // User can add a 'mime-type-mappings' sheet in configs.xlsx with columns: type, values
  const mimeTypeMappings = extractMimeTypeMappings(configs);

  // Clear the block
  block.textContent = '';

  // Create container
  const container = document.createElement('div');
  container.id = 'search-results-container';
  container.className = 'search-results-container search-results-wrapper';
  block.append(container);

  // Safe JSON parse helper - shows error toast on malformed JSON
  const safeJsonParse = (jsonString, fieldName = 'JSON') => {
    if (!jsonString || jsonString.trim() === '') return {};
    try {
      return JSON.parse(stripHtmlAndNewlines(jsonString));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Failed to parse ${fieldName}:`, error.message);
      showToast(`Invalid ${fieldName} JSON configuration. Please check the block settings.`, 'error');
      return {};
    }
  };

  // Set external params
  window.SearchResultsConfig = window.SearchResultsConfig || {};

  // Parse excFacets: try JSON blob first, fall back to table format embedded in this block
  const jsonExcFacets = safeJsonParse(blockObj.excFacets, 'excFacets');
  const hasJsonExcFacets = Object.keys(jsonExcFacets).length > 0;
  const tableExcFacets = tableConfig.excFacets || {};

  window.SearchResultsConfig.externalParams = {
    isBlockIntegration: true,
    hitsPerPage: stripHtmlAndNewlines(blockObj.hitsPerPage) || '',
    sortType: stripHtmlAndNewlines(blockObj.sortType) || '',
    sortDirection: stripHtmlAndNewlines(blockObj.sortDirection) || '',
    searchMode: stripHtmlAndNewlines(blockObj.searchMode) || '',
    excFacets: hasJsonExcFacets ? jsonExcFacets : tableExcFacets,
    mimeTypeMappings,
    presetFilters: blockObj.presetFilters ? convertHtmlListToArray(blockObj.presetFilters) : [],
    ...(window.SearchResultsConfig.externalParams || {}),
  };

  const externalParams = getExternalParams();

  // Cache excFacets for use by other blocks (e.g. collection-details) that reuse this machinery
  const excFacets = getFacetsConfig();
  if (excFacets && Object.keys(excFacets).length > 0) {
    try { localStorage.setItem('sr-excFacets', JSON.stringify(excFacets)); } catch (_) { /* no-op */ }
  }

  // Initialize state
  setState({
    externalParams,
    authenticated: true,
    dynamicMediaClient: getDynamicMediaClient(),
    excFacets,
    presetFilters: externalParams.presetFilters || [],
    expandAllDetails: loadSearchExpandAllDetailsState(true),
  });

  // Initialize the renditions fetcher with state accessors (after dynamicMediaClient is set)
  initRenditionsFetcher(getState, setState);

  loadCartFromStorage();
  setState({ cartAssetItems: getCartGlobalState().cartAssetItems || [] });
  extendCartState({
    dynamicMediaClient: getDynamicMediaClient(),
    imagePresets: state.imagePresets,
    assetRenditionsCache: state.assetRenditionsCache,
    authenticated: true,
  });

  // Set up global functions for EDS header integration
  window.openDetailsView = (asset) => {
    if (asset?.assetId) {
      setState({ deepLinkAsset: asset, showDetailsModal: true, selectedCard: asset });
    }
  };
  window.closeDetailsView = () => {
    setState({ deepLinkAsset: null, showDetailsModal: false, selectedCard: null });
  };

  // Read URL parameters
  const params = new URLSearchParams(window.location.search);
  const queryParam = params.get('query');
  const fulltextParam = params.get('fulltext');

  // Use 'query' if present, otherwise fall back to 'fulltext'
  const urlQuery = queryParam || fulltextParam;

  // Migrate 'fulltext' to 'query' in URL if fulltext exists
  if (fulltextParam) {
    const url = new URL(window.location.href);
    url.searchParams.delete('fulltext');
    if (urlQuery) {
      url.searchParams.set('query', urlQuery);
    }
    window.history.replaceState({}, '', url.toString());
  }

  if (urlQuery) {
    setState({ query: urlQuery });
  }

  // Resolve sort: URL param > session storage (user preference) > block config > hardcoded default
  const validSortTypes = Object.values(SORT_TYPE);
  const validSortDirections = Object.values(SORT_DIRECTION);
  const blockSortType = validSortTypes.includes(externalParams.sortType)
    ? externalParams.sortType : DEFAULT_SORT_TYPE;
  const blockSortDirection = validSortDirections.includes(externalParams.sortDirection)
    ? externalParams.sortDirection : DEFAULT_SORT_DIRECTION;
  const urlSortType = params.get('sortType');
  const urlSortDirection = params.get('sortDirection');
  // Sort: URL params > session (user preference per page) > block config > default (Top Results)
  const currentPathname = window.location.pathname;
  const sessionPreference = loadSortPreference(currentPathname);

  let sortTypeParam;
  let sortDirectionParam;
  if (validSortTypes.includes(urlSortType)) {
    sortTypeParam = urlSortType;
    sortDirectionParam = validSortDirections.includes(urlSortDirection)
      ? urlSortDirection : blockSortDirection;
  } else if (sessionPreference) {
    sortTypeParam = sessionPreference.sortType;
    sortDirectionParam = sessionPreference.sortDirection;
  } else {
    sortTypeParam = blockSortType;
    sortDirectionParam = blockSortDirection;
  }

  // Top Results only supports descending; auto-fix if ascending was specified
  if (sortTypeParam === SORT_TYPE.TOP_RESULTS && sortDirectionParam === SORT_DIRECTION.ASCENDING) {
    sortDirectionParam = SORT_DIRECTION.DESCENDING;
  }

  // Resolve search mode: URL param > default (FULLTEXT). Omitted from the URL for the default,
  // matching the API's own "omit for FULLTEXT" convention (see MatchQueryMatch.yaml default).
  const urlSearchMode = params.get(SEARCH_URL_PARAMS.SEARCH_MODE);
  const searchModeParam = VALID_SEARCH_MODES.includes(urlSearchMode)
    ? urlSearchMode : DEFAULT_SEARCH_MODE;

  setState({
    selectedSortType: sortTypeParam,
    selectedSortDirection: sortDirectionParam,
    searchMode: searchModeParam,
  });

  // Always ensure sort options are in the URL (populate defaults if missing)
  {
    const url = new URL(window.location.href);
    url.searchParams.set('sortType', sortTypeParam);
    url.searchParams.set('sortDirection', sortDirectionParam);
    window.history.replaceState({}, '', url.toString());
  }
  // Check for assetId deep link parameter
  const assetIdParam = params.get('assetId');

  // Load filters from URL parameters
  const urlFilters = loadSearchFiltersFromUrl();
  if (urlFilters) {
    // Auto-expand facets that have values from URL
    const expandedFacets = {};

    // Expand facets from facetCheckedState
    if (urlFilters.facetCheckedState) {
      Object.keys(urlFilters.facetCheckedState).forEach((key) => {
        const values = urlFilters.facetCheckedState[key];
        if (values && Object.values(values).some((v) => v)) {
          // For hierarchy facets, expand the parent facet (remove hierarchy suffix)
          const baseFacetKey = key.includes('.#hierarchy') ? key.split('.#hierarchy')[0] : key;
          expandedFacets[baseFacetKey] = true;
        }
      });
    }

    // Expand date facets if numericFilters contain date filters
    // (handle both hyphen and colon formats)
    const dateFacets = getDateFacets();
    dateFacets.forEach((key) => {
      const keyWithColon = key.replace(/-/g, ':');
      const keyWithHyphen = key.replace(/:/g, '-');
      const hasFilter = urlFilters.selectedNumericFilters?.some(
        (f) => f.startsWith(key) || f.startsWith(keyWithColon) || f.startsWith(keyWithHyphen),
      );
      if (hasFilter) {
        expandedFacets[key] = true;
      }
    });

    setState({
      facetCheckedState: urlFilters.facetCheckedState || {},
      selectedNumericFilters: urlFilters.selectedNumericFilters || [],
      expandedFacets,
    });
  }

  // Create main app
  createMainApp(container);

  // Auto-search on load
  if (state.dynamicMediaClient && state.excFacets !== undefined) {
    search();
  }

  // Handle assetId deep link - fetch asset and open details modal
  if (assetIdParam) {
    fetchAssetById(assetIdParam).then((asset) => {
      if (asset) {
        setState({ deepLinkAsset: asset });
      }
    }).catch((error) => {
      // eslint-disable-next-line no-console
      console.error('Error fetching deep link asset:', error);
    });
  }

  // Subscribe to state changes to save filters to URL
  subscribe((currentState, prevState, updates) => {
    // Save filters to URL when they change
    if (updates.query !== undefined
        || updates.facetCheckedState !== undefined
        || updates.selectedNumericFilters !== undefined) {
      saveSearchFiltersToUrl(
        currentState.facetCheckedState,
        currentState.selectedNumericFilters,
        currentState.query,
      );
    }

    // Persist sort to URL and session storage when user changes dropdown (per-page preference)
    if (updates.selectedSortType !== undefined || updates.selectedSortDirection !== undefined) {
      const url = new URL(window.location.href);
      url.searchParams.set('sortType', currentState.selectedSortType);
      url.searchParams.set('sortDirection', currentState.selectedSortDirection);
      window.history.replaceState({}, '', url.toString());
      saveSortPreference(
        currentState.selectedSortType,
        currentState.selectedSortDirection,
        window.location.pathname,
      );
    }

    // Persist search mode to URL when it changes (omit param for the default, matching
    // the API's own "omit for FULLTEXT" convention)
    if (updates.searchMode !== undefined) {
      const url = new URL(window.location.href);
      if (currentState.searchMode && currentState.searchMode !== DEFAULT_SEARCH_MODE) {
        url.searchParams.set(SEARCH_URL_PARAMS.SEARCH_MODE, currentState.searchMode);
      } else {
        url.searchParams.delete(SEARCH_URL_PARAMS.SEARCH_MODE);
      }
      window.history.replaceState({}, '', url.toString());
    }

    const canSearch = currentState.authenticated && currentState.dynamicMediaClient;
    if (canSearch) {
      if (updates.facetCheckedState !== undefined
          || updates.selectedNumericFilters !== undefined
          || (updates.searchMode !== undefined
            && updates.searchMode !== prevState.searchMode)) {
        search(undefined, { force: true });
      }

      // Auto-search when sort options change
      // Only search if the value actually changed
      const sortTypeChanged = updates.selectedSortType !== undefined
          && updates.selectedSortType !== prevState.selectedSortType;
      const sortDirectionChanged = updates.selectedSortDirection !== undefined
          && updates.selectedSortDirection !== prevState.selectedSortDirection;
      if (sortTypeChanged || sortDirectionChanged) {
        // Get current query from input field (user may have typed without pressing Enter)
        const queryInputElement = document.querySelector('input.query-input');
        const currentInputQuery = queryInputElement?.value || currentState.query;

        // Update state.query if input has different value
        if (currentInputQuery !== currentState.query) {
          setState({ query: currentInputQuery });
        }

        // Check if the search.js query-dropdown has a different path selected
        const queryDropdown = document.querySelector('.query-dropdown .custom-select');
        const selectedSearchPath = queryDropdown?.dataset.value;
        const currentPath = window.location.pathname;

        // Localize the selected path for proper comparison and navigation
        const localizedSearchPath = selectedSearchPath ? localizePath(selectedSearchPath) : null;

        // If dropdown exists and has a different path, navigate to that page
        if (localizedSearchPath && localizedSearchPath !== currentPath) {
          // Build URL with current search parameters and sort options
          const newParams = new URLSearchParams(window.location.search);
          newParams.set('query', currentInputQuery);
          newParams.set('sortType', currentState.selectedSortType);
          newParams.set('sortDirection', currentState.selectedSortDirection);
          window.location.href = `${localizedSearchPath}?${newParams.toString()}`;
        } else {
          // Same page, perform in-place search with current input query
          search(currentInputQuery, { force: true });
        }
      }
    }

    // Update query input
    if (updates.query !== undefined) {
      const queryElement = document.querySelector('input.query-input');
      if (queryElement) {
        queryElement.value = currentState.query;
        // Dispatch input event to update clear icon visibility
        queryElement.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  });

  subscribeCartState((cartState, prevCartState, cartUpdates) => {
    const searchStateUpdates = {};
    let hasUpdates = false;

    if (cartUpdates.cartAssetItems !== undefined) {
      searchStateUpdates.cartAssetItems = cartState.cartAssetItems;
      hasUpdates = true;
    }

    if (hasUpdates) {
      const prevState = { ...state };
      Object.assign(state, searchStateUpdates);
      listeners.forEach((listener) => {
        try {
          listener(state, prevState, searchStateUpdates);
        } catch (e) {
          console.error('State listener error:', e);
        }
      });
    }
  });
}
