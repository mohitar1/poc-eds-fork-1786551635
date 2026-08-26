/* eslint-disable import/no-cycle, no-restricted-syntax, no-plusplus */
/* eslint-disable no-continue, import/prefer-default-export, no-use-before-define */
/**
 * Facets Panel Component - Filter panel with hierarchical facets
 */

import {
  getState, setState, subscribe,
} from '../../search-results.js';
import { getDisplayFacetName } from '../../utils/display-utils.js';
import { createDatePicker } from './my-date-picker.js';
import { getDateFacets } from '../../constants/facets.js';
import { getSearchPlaceholders, ph } from '../../utils/placeholders.js';
import {
  lookupTitlePath, getTagsLookupMap, fetchMissingTag,
  fetchTagsFromResponse, searchTags,
} from '../../clients/tags-client.js';
import {
  getContentAIClient,
  getEffectiveFacetBucketSize,
} from '../../clients/dynamicmedia-client.js';
import { parseContentAIResponse } from '../../../../scripts/asset-transformers.js';
import { createActionDropdown } from '../action-dropdown.js';
import { escapeHtml } from '../../utils/dom-utils.js';

/**
 * Get locale from URL path (e.g., /en/search/all -> 'en', /ja/search/all -> 'ja')
 * @returns {string} Locale code from URL path, defaults to 'en'
 */
function getLocaleFromUrl() {
  const pathSegments = window.location.pathname.split('/').filter(Boolean);
  // First segment is the locale (e.g., 'en', 'ja')
  return pathSegments[0] || 'en';
}

/**
 * Resolve display name for a facet value
 * For ContentAI tags facets, looks up titlePath from tags lookup
 * @param {string} facetKey - Facet key (e.g., 'custom-brand')
 * @param {string} value - Facet value (e.g., 'brand/example-brand')
 * @param {Object} excFacets - Facet configurations
 * @returns {string} Display name
 */
function resolveFacetDisplayName(facetKey, value, excFacets) {
  // For tags facets, lookup from tags API data
  if (excFacets[facetKey]?.type === 'tags') {
    const locale = getLocaleFromUrl();
    const titlePath = lookupTitlePath(value, locale);

    if (titlePath) {
      // Extract last segment from titlePath (e.g., "Brand / Example-Brand" -> "Example-Brand")
      const parts = titlePath.split(' / ');
      return parts[parts.length - 1].trim();
    }
    // Fallback: return raw value (no manual formatting)
    return value;
  }

  // Fallback: use existing display name logic
  return getDisplayFacetName(facetKey, value);
}

// Cached placeholders for localization (for UI text like buttons, not facet labels)
let placeholders = null;

let containerElement = null;
const searchTerms = {}; // Track search terms for each facet (matches React's facetSearchTerms)
const searchMode = {}; // Track search mode for each facet (matches React's facetSearchMode)
const lastFacetsData = {}; // Cache facet data to avoid empty renders
const expandedHierarchyItems = {}; // Track expanded hierarchy items (user toggled)
const autoExpandedHierarchyItems = {}; // Auto-expanded items (from selected children)
const missingTagPaths = new Set(); // Track tag paths that need to be fetched
const fetchingTagPaths = new Set(); // Track tag paths currently being fetched
const attemptedTagPaths = new Set(); // Tag paths already attempted (prevent infinite loops)
const fetchingFacetIds = new Set(); // Facet IDs fetching (for spinner during re-render)
// Paths created by synthesizeMissingParents (parent checkbox cascades to descendants)
const synthesizedPaths = new Set();
let storedCallbacks = null; // Store callbacks for re-render after fetch completes

/** Facet keys removed from UI (legacy rights search) */
const REMOVED_FACET_KEYS = new Set([
  'custom-rightsStartDate',
  'custom-rightsEndDate',
  'custom-marketCovered',
  'custom-mediaCovered',
]);

/**
 * Calculate total visible checked count for facets
 * Only counts checked values that exist in current facet data (visible in UI)
 * @param {Object} facetCheckedState - Current checked state
 * @param {Object} facetsData - Current facet data from search results
 * @param {Object} excFacets - Facet configurations
 * @param {Object} state - Current app state
 * @returns {number} Total visible checked count
 */
function calculateVisibleCheckedCount(facetCheckedState, facetsData, excFacets, state) {
  let totalCount = 0;

  // Count checked values for each facet key in facetCheckedState
  Object.keys(facetCheckedState || {}).forEach((key) => {
    const checkedValues = facetCheckedState[key] || {};
    const facetData = facetsData?.[key] || {};
    // Build facetValues with preservation (same as renderFacetSections)
    const facetValues = { ...facetData };
    Object.keys(checkedValues).forEach((value) => {
      if (checkedValues[value] && facetValues[value] === undefined) {
        facetValues[value] = 0;
      }
    });
    // Only count checked values that exist in facetValues
    totalCount += Object.keys(facetValues).filter(
      (value) => checkedValues[value] === true,
    ).length;
  });

  // Count date facets (handle both hyphen and colon formats)
  const dateFacets = getDateFacets();
  dateFacets.forEach((key) => {
    const keyWithColon = key.replace(/-/g, ':');
    const keyWithHyphen = key.replace(/:/g, '-');
    const hasDateFilter = (state.selectedNumericFilters || []).some(
      (f) => f.startsWith(key) || f.startsWith(keyWithColon) || f.startsWith(keyWithHyphen),
    );
    if (hasDateFilter) totalCount += 1;
  });

  return totalCount;
}

/**
 * Create the facets panel
 * @param {HTMLElement} container - Container element
 * @param {Object} callbacks - Callback functions
 */
export async function createFacetsPanel(container, callbacks) {
  containerElement = container;

  // Load placeholders for localization
  if (!placeholders) {
    placeholders = await getSearchPlaceholders();
  }

  // Initial render
  render(callbacks);

  // Subscribe to state changes
  subscribe((state, prevState, updates) => {
    // Re-acquire container if it's no longer in DOM (e.g., after re-render of parent)
    if (!document.body.contains(containerElement)) {
      const newContainer = document.querySelector('#facet-filter-panel');
      if (newContainer) {
        containerElement = newContainer;
      }
    }

    // For facetCheckedState changes only (e.g., checkbox click), do targeted DOM updates
    // to avoid re-rendering all facet sections
    if (updates.facetCheckedState !== undefined
        && updates.searchResults === undefined
        && updates.expandedFacets === undefined) {
      // Find which facet key(s) changed by comparing old and new state
      const prevCheckedState = prevState.facetCheckedState || {};
      const currentCheckedState = state.facetCheckedState || {};
      const changedKeys = new Set();

      // Check keys in current state
      Object.keys(currentCheckedState).forEach((key) => {
        const prev = prevCheckedState[key] || {};
        const curr = currentCheckedState[key] || {};
        if (JSON.stringify(prev) !== JSON.stringify(curr)) {
          changedKeys.add(key);
        }
      });

      // Check keys that were removed
      Object.keys(prevCheckedState).forEach((key) => {
        if (!currentCheckedState[key]) {
          changedKeys.add(key);
        }
      });

      // Update only the changed facet badges
      changedKeys.forEach((facetKey) => {
        updateFacetBadgeCount(facetKey, state);
      });

      // Always update clear all count
      updateClearAllCount(state);
      return;
    }

    // Full re-render for other state changes
    if (updates.searchResults !== undefined
        || updates.expandedFacets !== undefined
        || updates.isTagsLoading !== undefined) {
      render(callbacks);
    }
  });
}

/**
 * Compute which facets should be auto-expanded based on their badge counts
 */
function computeAutoExpandedFacets(currentState, excFacets) {
  const autoExpanded = {};
  if (!excFacets) return autoExpanded;

  const { facetCheckedState, selectedNumericFilters } = currentState;

  Object.keys(excFacets).forEach((key) => {
    let hasChecked = false;

    // Check hierarchy facets (e.g., custom-brand.Root.#hierarchy.lvl0)
    Object.keys(facetCheckedState).forEach((checkedKey) => {
      if (checkedKey === key || checkedKey.startsWith(`${key}.`)) {
        const values = facetCheckedState[checkedKey];
        if (values && Object.values(values).some(Boolean)) hasChecked = true;
      }
    });

    // Check if this is a date facet with filters (handle both hyphen and colon formats)
    const dateFacets = getDateFacets();
    if (dateFacets.includes(key)) {
      const keyWithColon = key.replace(/-/g, ':');
      const keyWithHyphen = key.replace(/:/g, '-');
      const hasFilter = selectedNumericFilters?.some(
        (f) => f.startsWith(key) || f.startsWith(keyWithColon) || f.startsWith(keyWithHyphen),
      );
      if (hasFilter) hasChecked = true;
    }

    if (hasChecked) autoExpanded[key] = true;
  });

  return autoExpanded;
}

/**
 * Compute which hierarchy items should be auto-expanded based on selected child values
 * When a nested facet value is selected (e.g., brand/example-brand/example-variant),
 * all parent paths should be expanded to make the selection visible.
 * @param {Object} facetCheckedState - Current checked state for all facets
 * @param {Object} excFacets - Facet configurations
 */
function computeAutoExpandedHierarchyItems(facetCheckedState, excFacets) {
  // Clear previous auto-expanded items
  Object.keys(autoExpandedHierarchyItems).forEach((key) => {
    delete autoExpandedHierarchyItems[key];
  });

  // For each tags facet, check for selected nested values
  Object.entries(excFacets).forEach(([facetKey, facetConfig]) => {
    if (facetConfig?.type !== 'tags') return;

    const checkedValues = facetCheckedState[facetKey] || {};
    Object.entries(checkedValues).forEach(([tagPath, isChecked]) => {
      if (!isChecked) return;

      // Split the tagPath to get parent paths
      // e.g., "brand/example-brand/example-variant" -> ["brand", "brand/example-brand"]
      const parts = tagPath.split('/');
      if (parts.length <= 1) return; // No parents to expand

      // Build parent paths and mark them for expansion
      let currentPath = parts[0]; // Start with root (e.g., "brand")
      for (let i = 1; i < parts.length; i += 1) {
        // Mark this parent path as auto-expanded
        const hierarchyKey = `${facetKey}-${currentPath}`;
        autoExpandedHierarchyItems[hierarchyKey] = true;
        // Build next parent path
        currentPath = `${currentPath}/${parts[i]}`;
      }
    });
  });
}

/**
 * Update a single facet's badge count without full re-render
 * @param {string} facetKey - The facet key
 * @param {Object} state - Current state
 */
function updateFacetBadgeCount(facetKey, state) {
  if (!containerElement) return;

  const section = containerElement.querySelector(`.facet-filter-section[data-facet-key="${facetKey}"]`);
  if (!section) return;

  const { excFacets, facetCheckedState, selectedNumericFilters } = state;
  const facetConfig = excFacets?.[facetKey];
  if (!facetConfig) return;

  // Combine facets from search results
  const combinedFacets = {};
  state.searchResults?.forEach((searchResult) => {
    if (searchResult.facets) {
      Object.entries(searchResult.facets).forEach(([key, facetData]) => {
        if (!combinedFacets[key]) combinedFacets[key] = {};
        Object.entries(facetData).forEach(([facetName, count]) => {
          combinedFacets[key][facetName] = count;
        });
      });
    }
  });
  const facetsData = Object.keys(combinedFacets).length > 0 ? combinedFacets : lastFacetsData;

  // Compute hierarchy data (pass facetCheckedState to preserve 0-count selections)
  const hierarchyDataByFacet = computeHierarchyDataByFacet(
    excFacets,
    facetsData,
    facetCheckedState,
  );
  const hierarchyData = hierarchyDataByFacet[facetKey];
  const isHierarchyFacet = !!hierarchyData;
  const isTagsFacet = excFacets[facetKey]?.type === 'tags';

  // Calculate checked count (same logic as renderFacetSections)
  let checkedCount = 0;
  if (isHierarchyFacet && isTagsFacet) {
    // ContentAI tags facets use flat key
    const checkedValues = facetCheckedState[facetKey] || {};
    Object.keys(hierarchyData).forEach((level) => {
      const levelData = hierarchyData[level] || {};
      checkedCount += Object.keys(levelData).filter(
        (value) => checkedValues[value] === true,
      ).length;
    });
  } else if (getDateFacets().includes(facetKey)) {
    const keyWithColon = facetKey.replace(/-/g, ':');
    const keyWithHyphen = facetKey.replace(/:/g, '-');
    const hasDateFilter = selectedNumericFilters?.some(
      (f) => f.startsWith(facetKey) || f.startsWith(keyWithColon) || f.startsWith(keyWithHyphen),
    );
    checkedCount = hasDateFilter ? 1 : 0;
  } else {
    const checkedValues = facetCheckedState[facetKey] || {};
    const facetValues = { ...(facetsData[facetKey] || {}) };
    Object.keys(checkedValues).forEach((value) => {
      if (checkedValues[value] && facetValues[value] === undefined) {
        facetValues[value] = 0;
      }
    });
    checkedCount = Object.keys(facetValues).filter(
      (value) => checkedValues[value] === true,
    ).length;
  }

  // Update the badge in DOM
  const rightSection = section.querySelector('.facet-filter-right-section');
  if (!rightSection) return;

  let badge = rightSection.querySelector('.facet-filter-count-tag');
  if (checkedCount > 0) {
    if (badge) {
      badge.textContent = checkedCount;
    } else {
      badge = document.createElement('div');
      badge.className = 'assets-details-tag custom-tag facet-filter-count-tag';
      badge.textContent = checkedCount;
      rightSection.insertBefore(badge, rightSection.firstChild);
    }
  } else if (badge) {
    badge.remove();
  }
}

/**
 * Update the clear all facets count badge
 */
function updateClearAllCount(state) {
  if (!containerElement) return;

  const clearAllBtn = containerElement.querySelector('#clear-all-facets');
  if (!clearAllBtn) return;

  // Combine facets data from search results (same as render())
  const combinedFacets = {};
  state.searchResults?.forEach((searchResult) => {
    if (searchResult.facets) {
      Object.entries(searchResult.facets).forEach(([key, facetData]) => {
        if (!combinedFacets[key]) {
          combinedFacets[key] = {};
        }
        Object.entries(facetData).forEach(([facetName, count]) => {
          combinedFacets[key][facetName] = count;
        });
      });
    }
  });

  // Use combined facets, or cached data if current is empty
  const facetsData = Object.keys(combinedFacets).length > 0 ? combinedFacets : lastFacetsData;

  // Calculate total visible checked count
  const totalCheckedCount = calculateVisibleCheckedCount(
    state.facetCheckedState,
    facetsData,
    state.excFacets || {},
    state,
  );

  // Update or create the count span
  let countSpan = clearAllBtn.querySelector('.clear-all-count');
  if (totalCheckedCount > 0) {
    if (countSpan) {
      countSpan.textContent = `(${totalCheckedCount})`;
    } else {
      countSpan = document.createElement('span');
      countSpan.className = 'clear-all-count';
      countSpan.textContent = `(${totalCheckedCount})`;
      clearAllBtn.appendChild(countSpan);
    }
  } else if (countSpan) {
    countSpan.remove();
  }
}

function render(callbacks) {
  // Store callbacks for re-render after fetch completes
  storedCallbacks = callbacks;

  const state = getState();
  const {
    excFacets, searchResults, facetCheckedState, expandedFacets,
  } = state;

  // Combine facets from all search results (matches React behavior)
  const combinedFacets = {};
  searchResults?.forEach((searchResult) => {
    if (searchResult.facets) {
      Object.entries(searchResult.facets).forEach(([key, facetData]) => {
        if (!combinedFacets[key]) {
          combinedFacets[key] = {};
        }
        Object.entries(facetData).forEach(([facetName, count]) => {
          combinedFacets[key][facetName] = count;
        });
      });
    }
  });

  // Use combined facets, or cached data if current is empty
  const facets = Object.keys(combinedFacets).length > 0 ? combinedFacets : lastFacetsData;

  // Cache facet data when we have it
  if (Object.keys(combinedFacets).length > 0) {
    Object.assign(lastFacetsData, combinedFacets);
  }

  // Auto-expand facets with badge count > 0, but only if user hasn't explicitly set them
  const autoExpandedFacets = computeAutoExpandedFacets(state, excFacets);
  const effectiveExpandedFacets = { ...autoExpandedFacets, ...expandedFacets };

  // Auto-expand hierarchy items (sub-levels) when a child facet is selected
  computeAutoExpandedHierarchyItems(facetCheckedState, excFacets);

  // Calculate total visible checked count across all facets (only counts visible items)
  const totalCheckedCount = calculateVisibleCheckedCount(
    facetCheckedState,
    facets,
    excFacets,
    state,
  );

  const facetsPanelReady = searchResults?.length
    && !state.isTagsLoading;

  // Get localized strings
  const filtersLabel = ph(placeholders, 'filters', 'Filters');
  const clearAllLabel = ph(placeholders, 'clearAll', 'CLEAR ALL');

  let filtersTabContent;
  if (!facetsPanelReady) {
    filtersTabContent = `
          <div class="facet-filter-list facet-filters-loading" id="facet-list">
            <div class="facet-loading-spinner">
              <div class="loading-spinner loading-spinner-lg" role="status" aria-label="Loading"></div>
            </div>
          </div>
        `;
  } else {
    filtersTabContent = `
          <div class="facet-filter-list" id="facet-list">
            ${renderFacetSections(excFacets, facets, facetCheckedState, effectiveExpandedFacets)}
          </div>
        `;
  }

  containerElement.innerHTML = `
    <div class="facet-filter-container">
      <div class="facet-filter">
        <div class="facet-filter-header">
          <div class="facet-filter-tabs">
            <div class="facet-filter-tab-group left active" style="cursor: pointer;">
              <button class="facet-filter-tab active" id="filters-tab">
                ${filtersLabel}
                ${totalCheckedCount > 0 ? `<div class="assets-details-tag custom-tag facet-filter-count-tag">${totalCheckedCount}</div>` : ''}
              </button>
              <button class="facet-filter-tab clear" id="clear-all-btn">${clearAllLabel}</button>
            </div>
          </div>
        </div>

        ${filtersTabContent}
      </div>
    </div>
  `;

  bindEvents(callbacks);

  // Focus the search input that has autofocus (React uses autoFocus prop, we need manual focus)
  const autofocusInput = containerElement.querySelector('.facet-search-input[autofocus]');
  if (autofocusInput) {
    // Use setTimeout to ensure DOM is ready
    setTimeout(() => autofocusInput.focus(), 0);
  }

  // Fetch missing tags asynchronously and update DOM
  fetchMissingTagsAndUpdateDOM();
}

/**
 * Show loading spinner in a facet section (same style as initial tags loading)
 * Stores original content to restore later
 * @param {string} facetId - The facet ID
 */
function showFacetSpinner(facetId) {
  if (!containerElement) return;

  const section = containerElement.querySelector(
    `.facet-filter-section[data-facet-key="${facetId}"]`,
  );
  if (!section) return;

  const checkboxList = section.querySelector('.facet-filter-checkbox-list');
  if (!checkboxList) return;

  // Don't add if already showing spinner
  if (checkboxList.classList.contains('facet-tags-loading')) return;

  // Store original content for restoration
  checkboxList.dataset.originalContent = checkboxList.innerHTML;
  checkboxList.classList.add('facet-tags-loading');

  const loadingTagsLabel = ph(placeholders, 'loadingTags', 'Loading...');
  checkboxList.innerHTML = `
    <div class="facet-loading-spinner">
      <div class="loading-spinner loading-spinner-sm" role="status" aria-label="Loading"></div>
      <span>${loadingTagsLabel}</span>
    </div>
  `;

  // Disable the "Show all" button while loading
  const showAllBtn = section.querySelector('.facet-show-all-btn');
  if (showAllBtn) showAllBtn.disabled = true;
}

/**
 * Fetch missing tag paths and update DOM labels.
 * Called after render to asynchronously resolve missing tag labels.
 */
async function fetchMissingTagsAndUpdateDOM() {
  if (missingTagPaths.size === 0) return;

  // Copy and clear the set to avoid duplicate fetches
  const pathsToFetch = Array.from(missingTagPaths).map((json) => JSON.parse(json));
  missingTagPaths.clear();

  const facetIds = new Set(pathsToFetch.map(({ facetId }) => facetId).filter(Boolean));
  facetIds.forEach((facetId) => fetchingFacetIds.add(facetId));
  facetIds.forEach((facetId) => showFacetSpinner(facetId));
  pathsToFetch.forEach(({ tagPath }) => fetchingTagPaths.add(tagPath));

  const fetchPromises = pathsToFetch.map(async ({ tagPath, facetId }) => {
    try {
      const titlePath = await fetchMissingTag(tagPath, facetId);

      if (titlePath) {
        const parts = titlePath.split(/[:/]/);
        const displayName = parts[parts.length - 1].trim();
        updateTagLabelInDOM(tagPath, displayName);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[Facets] Failed to fetch tag ${tagPath}:`, error);
    } finally {
      fetchingTagPaths.delete(tagPath);
      attemptedTagPaths.add(tagPath);
    }
  });

  await Promise.all(fetchPromises);

  facetIds.forEach((facetId) => {
    fetchingFacetIds.delete(facetId);
  });

  if (storedCallbacks) {
    render(storedCallbacks);
  }
}

/**
 * Update tag label in DOM after fetching
 * @param {string} tagPath - The tag path to update
 * @param {string} displayName - The resolved display name
 */
function updateTagLabelInDOM(tagPath, displayName) {
  if (!containerElement) return;

  // Find all checkbox labels with this facet value
  const checkboxes = containerElement.querySelectorAll(
    `.facet-filter-checkbox-input[data-facet-value="${CSS.escape(tagPath)}"]`,
  );

  checkboxes.forEach((checkbox) => {
    const label = checkbox.closest('.facet-filter-checkbox')?.querySelector('.facet-label-text');
    if (label && label.classList.contains('fallback-label')) {
      label.textContent = displayName;
      label.classList.remove('fallback-label');
    }
  });
}

/**
 * ContentAI paths like `metadata:` or `brand` (namespace segment but no `/`) are taxonomy
 * roots from the index, not leaf/tag rows — hide them next to real paths such as
 * `brand/example-sub-brand`. Algolia-style paths (`Brand / X`)
 * have no lone `:` pattern and are kept.
 * @param {string} tagPath
 * @returns {boolean}
 */
function isContentAINamespaceRootTagPath(tagPath) {
  return typeof tagPath === 'string'
    && tagPath.includes(':')
    && !tagPath.includes('/');
}

/**
 * Remove namespace-only root rows from every level (e.g. synthesized `brand` at level 0).
 * @param {Object} hierarchyData
 */
function pruneContentAINamespaceRootPaths(hierarchyData) {
  Object.keys(hierarchyData).forEach((level) => {
    const levelData = hierarchyData[level];
    if (!levelData) return;
    Object.keys(levelData).forEach((tagPath) => {
      if (isContentAINamespaceRootTagPath(tagPath)) {
        delete levelData[tagPath];
      }
    });
    if (Object.keys(levelData).length === 0) {
      delete hierarchyData[level];
    }
  });
}

/**
 * Build hierarchy data from ContentAI flat facet values
 * Converts tagPath format (brand/example-brand) to hierarchy levels
 * Keys are tagPaths (for API), display lookup happens in renderHierarchyLevel
 * @param {Object} flatFacetData - Flat facet data { tagPath: count }
 * @returns {Object} Hierarchy data by level { 1: { tagPath: count }, 2: {...} }
 */
function buildContentAIHierarchy(flatFacetData) {
  const hierarchyData = {};

  Object.entries(flatFacetData || {}).forEach(([tagPath, count]) => {
    // Skip root values without '/' (e.g., 'brand')
    if (!tagPath.includes('/')) return;

    // Count '/' to determine level (brand/example-brand = level 1)
    const slashCount = (tagPath.match(/\//g) || []).length;
    const level = slashCount;

    if (!hierarchyData[level]) {
      hierarchyData[level] = {};
    }

    // Store tagPath as key (data), display conversion happens at render time
    hierarchyData[level][tagPath] = count;
  });

  return hierarchyData;
}

/**
 * Synthesize missing parent entries so the hierarchy can render from level 1.
 * Called after maxHierarchyLevels filtering to avoid creating parents for pruned levels.
 * Synthesized parents get the sum of their direct children's counts.
 * API-returned parents keep their original counts (children are not added on top).
 * @param {Object} hierarchyData - Hierarchy data by level (mutated in place)
 */
function synthesizeMissingParents(hierarchyData) {
  const levels = Object.keys(hierarchyData).map(Number).sort((a, b) => a - b);
  for (let i = levels.length - 1; i >= 0; i -= 1) {
    const level = levels[i];
    if (level <= 1) break;
    Object.keys(hierarchyData[level]).forEach((tagPath) => {
      const lastSlash = tagPath.lastIndexOf('/');
      if (lastSlash <= 0) return;
      const parentPath = tagPath.substring(0, lastSlash);
      const parentLevel = level - 1;
      if (!hierarchyData[parentLevel]) {
        hierarchyData[parentLevel] = {};
      }
      if (hierarchyData[parentLevel][parentPath] === undefined) {
        const childCount = hierarchyData[level][tagPath] || 0;
        hierarchyData[parentLevel][parentPath] = childCount;
        synthesizedPaths.add(parentPath);
      } else if (typeof hierarchyData[parentLevel][parentPath] === 'number'
        && synthesizedPaths.has(parentPath)) {
        hierarchyData[parentLevel][parentPath] += (hierarchyData[level][tagPath] || 0);
      }
    });
  }
}

/**
 * Sum facet hit counts for immediate children of parentFullPath in hierarchy data.
 */
function sumDirectChildFacetCounts(parentFullPath, hierarchyData, parentLevel, pathSep) {
  const childLevel = parentLevel + 1;
  const nextLevel = hierarchyData[childLevel];
  if (!nextLevel) return 0;
  if (pathSep === '/') {
    const prefix = `${parentFullPath}/`;
    let sum = 0;
    Object.entries(nextLevel).forEach(([path, c]) => {
      if (!path.startsWith(prefix)) return;
      const rest = path.slice(prefix.length);
      if (rest.includes('/')) return;
      sum += Number(c) || 0;
    });
    return sum;
  }
  const prefix = `${parentFullPath} / `;
  let sum = 0;
  Object.entries(nextLevel).forEach(([path, c]) => {
    if (!path.startsWith(prefix)) return;
    const rest = path.slice(prefix.length);
    if (rest.includes(' / ')) return;
    sum += Number(c) || 0;
  });
  return sum;
}

/**
 * Hit count beside a hierarchy row. Parents with 0 in the facet payload (common once selected)
 * use summed direct children; if those are also 0, fall back to current search hit count for
 * synthesized parents so the label does not go blank.
 */
function getHierarchyFacetDisplayCount(
  facetFullPath,
  storedCount,
  hierarchyData,
  itemLevel,
  pathSeparator,
  hasSubLevels,
  isChecked,
  facetTechId,
) {
  const n = typeof storedCount === 'number' ? storedCount : 0;
  if (n > 0) return n;

  let fromChildren = 0;
  if (hasSubLevels) {
    fromChildren = sumDirectChildFacetCounts(
      facetFullPath,
      hierarchyData,
      itemLevel,
      pathSeparator,
    );
  }
  if (fromChildren > 0) return fromChildren;

  const state = getState();
  const facetBuckets = state.searchResults?.[0]?.facets?.[facetTechId];
  const pathInFacetResponse = !!(facetBuckets
    && Object.prototype.hasOwnProperty.call(facetBuckets, facetFullPath));
  const zeroInFacetResponse = pathInFacetResponse
    && Number(facetBuckets[facetFullPath]) === 0;
  const isSynth = synthesizedPaths.has(facetFullPath);
  const useSearchTotal = hasSubLevels && isChecked
    && (isSynth || !pathInFacetResponse || zeroInFacetResponse);
  if (useSearchTotal) {
    const nbHits = state.searchResults?.[0]?.nbHits;
    if (typeof nbHits === 'number' && nbHits > 0) return nbHits;
  }

  return n;
}

/**
 * True when this input is a tags hierarchy row with nested facet values (any parent with children).
 * Covers synthesized parents and API-returned parents (those have no data-synthesized flag).
 */
function isFacetHierarchyParentCheckbox(checkbox) {
  const container = checkbox.closest('.facet-hierarchy-container');
  if (!container) return false;
  return !!container.querySelector(':scope > .hierarchy-children input[data-facet-value]');
}

/**
 * Apply hierarchy parent checkbox: update facet map and visible descendant checkboxes.
 * On uncheck, removes the parent and every descendant path from state (not only nodes in the DOM).
 * @param {string} facetKey
 * @param {string} parentFullPath - data-facet-value (full hierarchy path)
 * @param {boolean} shouldCheck
 * @param {Object} excFacets
 * @param {HTMLElement} checkbox - the parent input (for closest container + DOM sync)
 * @param {Object} previousFacetMap - current map for this facet key
 * @returns {Object} New facet value map for facetKey
 */
function buildFacetMapAfterHierarchyParentToggle(
  facetKey,
  parentFullPath,
  shouldCheck,
  excFacets,
  checkbox,
  previousFacetMap,
) {
  const facetMap = { ...previousFacetMap };
  const pathSep = excFacets[facetKey]?.type === 'tags' ? '/' : ' / ';
  const descendantPrefix = pathSep === '/' ? `${parentFullPath}/` : `${parentFullPath} / `;
  const container = checkbox.closest('.facet-hierarchy-container');

  if (!shouldCheck) {
    delete facetMap[parentFullPath];
    Object.keys(facetMap).forEach((path) => {
      if (path.startsWith(descendantPrefix)) {
        delete facetMap[path];
      }
    });
    if (container) {
      container.querySelectorAll('.hierarchy-children input[data-facet-value]').forEach((child) => {
        child.checked = false;
      });
    }
    return facetMap;
  }

  facetMap[parentFullPath] = true;
  if (container) {
    container.querySelectorAll('.hierarchy-children input[data-facet-value]').forEach((child) => {
      facetMap[child.dataset.facetValue] = true;
      child.checked = true;
    });
  }
  return facetMap;
}

const TAGS_FACET_DISPLAY_LIMIT = 20;

/** True if any path in the set is a strict descendant of tagPath (ContentAI tag paths use `/`). */
function tagPathHasDescendantInSet(tagPath, allPaths) {
  const prefix = `${tagPath}/`;
  return [...allPaths].some((p) => p.startsWith(prefix));
}

/**
 * Convert raw DM Tags Search API items to the modal items format.
 * Extracts the last segment of the titlePath as the display name.
 */
function convertTagSearchResults(items) {
  const locale = getLocaleFromUrl();
  return items
    .filter((item) => item.tagPath && item.i18n)
    .map((item) => {
      let titlePath = null;
      for (const entry of item.i18n) {
        if (entry.locale === locale) {
          titlePath = entry.titlePath;
          break;
        }
        if (entry.locale === 'default' && !titlePath) {
          titlePath = entry.titlePath;
        }
      }
      if (!titlePath && item.i18n.length > 0) {
        titlePath = item.i18n[0].titlePath;
      }

      let displayName;
      if (titlePath) {
        const parts = titlePath.split(' / ');
        displayName = parts[parts.length - 1].trim();
      } else {
        const parts = item.tagPath.split('/');
        displayName = parts[parts.length - 1];
      }

      return {
        value: item.tagPath,
        count: 0,
        displayName,
        isFallback: !titlePath,
        showFacetCount: false,
      };
    });
}

function getAllSelectableItems(hierarchyData, facetKey, excFacets, flatFacetValues) {
  const items = [];
  const isTagsFacet = excFacets?.[facetKey]?.type === 'tags';

  if (hierarchyData && isTagsFacet) {
    const tagsLookup = getTagsLookupMap();
    const locale = getLocaleFromUrl();

    const allPaths = new Set();
    Object.keys(hierarchyData).forEach((lvl) => {
      Object.keys(hierarchyData[lvl] || {}).forEach((p) => allPaths.add(p));
    });

    Object.keys(hierarchyData).sort((a, b) => Number(a) - Number(b)).forEach((level) => {
      const levelData = hierarchyData[level];
      Object.entries(levelData).forEach(([tagPath, count]) => {
        const displayInfo = getContentAIDisplayName(tagPath, tagsLookup, locale, facetKey);
        const showFacetCount = !tagPathHasDescendantInSet(tagPath, allPaths);
        items.push({
          value: tagPath,
          count,
          displayName: displayInfo.text,
          isFallback: displayInfo.isFallback,
          showFacetCount,
        });
      });
    });
  } else if (flatFacetValues) {
    Object.entries(flatFacetValues).forEach(([value, count]) => {
      const displayName = resolveFacetDisplayName(facetKey, value, excFacets);
      items.push({
        value,
        count,
        displayName,
        isFallback: false,
        showFacetCount: true,
      });
    });
  }

  return items;
}

function sortModalItems(items, sortMode, checkedValues) {
  return [...items].sort((a, b) => {
    const isCheckedA = checkedValues[a.value] === true;
    const isCheckedB = checkedValues[b.value] === true;

    switch (sortMode) {
      case 'most-results':
        return b.count - a.count;
      case 'alphabetical':
        return a.displayName.localeCompare(b.displayName);
      case 'selected-most-results':
        if (isCheckedA !== isCheckedB) return isCheckedA ? -1 : 1;
        return b.count - a.count;
      case 'selected-alphabetical':
        if (isCheckedA !== isCheckedB) return isCheckedA ? -1 : 1;
        return a.displayName.localeCompare(b.displayName);
      default:
        return 0;
    }
  });
}

function renderModalItemsList(items, facetKey, checkedValues, sortMode, modalSearchTerm) {
  let filtered = items;
  if (modalSearchTerm) {
    const term = modalSearchTerm.toLowerCase();
    filtered = items.filter((item) => item.displayName.toLowerCase().includes(term));
  }

  const sorted = sortModalItems(filtered, sortMode, checkedValues);

  if (sorted.length === 0) {
    const noMatchingFiltersLabel = ph(placeholders, 'noMatchingFilters', 'No matching filters');
    return `<p class="facet-modal-empty">${noMatchingFiltersLabel}</p>`;
  }

  return sorted.map((item) => {
    const isChecked = checkedValues[item.value] === true;
    const checkboxId = `modal-${facetKey}-${item.value.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const safeDisplayName = escapeHtml(item.displayName);
    const displayNameHtml = item.isFallback
      ? `<span class="facet-label-text fallback-label">${safeDisplayName}</span>`
      : `<span class="facet-label-text">${safeDisplayName}</span>`;

    return `
      <div class="facet-hierarchy-container" data-hierarchy-item="${item.value}">
        <div class="facet-hierarchy-row">
          <label class="facet-filter-checkbox-label" for="${checkboxId}">
            <input class="facet-filter-checkbox-input" type="checkbox" id="${checkboxId}" ${isChecked ? 'checked' : ''} data-facet-key="${facetKey}" data-facet-value="${item.value}" />
            ${displayNameHtml}${item.showFacetCount && item.count > 0 ? ` (${item.count})` : ''}
          </label>
        </div>
      </div>
    `;
  }).join('');
}

async function openFacetModal(facetKey, callbacks) {
  const state = getState();
  const { excFacets, facetCheckedState } = state;

  const facetConfig = excFacets[facetKey];
  const facetName = facetConfig.label || facetConfig.name || facetKey;

  const isTagsFacet = excFacets[facetKey]?.type === 'tags';
  let hierarchyData = null;
  let flatFacetValues = null;
  let isHierarchyModal = isTagsFacet;
  let allItems = [];
  let currentSortMode = 'most-results';
  let currentModalSearchTerm = '';

  // API-based tag search (tags facets only)
  const API_SEARCH_MIN_CHARS = 2;
  let apiSearchResults = null;
  let searchAbortCtrl = null;

  const modalExpandedKeys = new Set();

  const overlay = document.createElement('div');
  overlay.className = 'facet-modal-overlay';
  overlay.dataset.facetKey = facetKey;

  const selectAllLabel = ph(placeholders, 'selectAll', 'Select all');
  const clearAllLabel = ph(placeholders, 'clearAll', 'Clear all');

  // Render hierarchy content using the shared renderHierarchyLevel (no truncation)
  function renderHierarchyContent() {
    const origSearchTerm = searchTerms[facetKey];
    searchTerms[facetKey] = currentModalSearchTerm || '';
    const latestState = getState();
    const html = renderHierarchyLevel(
      hierarchyData,
      facetKey,
      1,
      '',
      latestState.facetCheckedState,
      excFacets,
      false,
      null,
      null,
      0,
      currentSortMode,
    );
    if (origSearchTerm !== undefined) {
      searchTerms[facetKey] = origSearchTerm;
    } else {
      delete searchTerms[facetKey];
    }
    const noMatchLabel = ph(placeholders, 'noMatchingFilters', 'No matching filters');
    return html || `<p class="facet-modal-empty">${noMatchLabel}</p>`;
  }

  function renderContent() {
    if (apiSearchResults !== null) {
      const latestState = getState();
      const checked = latestState.facetCheckedState[facetKey] || {};
      return renderModalItemsList(
        apiSearchResults,
        facetKey,
        checked,
        currentSortMode,
        '',
      );
    }
    if (isHierarchyModal) return renderHierarchyContent();
    const latestState = getState();
    const latestChecked = latestState.facetCheckedState[facetKey] || {};
    return renderModalItemsList(
      allItems,
      facetKey,
      latestChecked,
      currentSortMode,
      currentModalSearchTerm,
    );
  }

  overlay.innerHTML = `
    <div class="facet-modal">
      <div class="facet-modal-header">
        <h2>${facetName}</h2>
        <button class="facet-modal-close" type="button" aria-label="Close">&times;</button>
      </div>
      <div class="facet-modal-body">
        <div class="facet-modal-search">
          <div class="facet-search-input-wrapper">
            <img src="/icons/search.svg" alt="Search" class="facet-search-icon-inside" />
            <input type="text" class="facet-modal-search-input"
              placeholder="Search ${facetName}..." />
            <img src="/icons/close-menu.svg" alt="Clear"
              class="facet-modal-search-clear" style="display:none;" />
          </div>${isTagsFacet ? `
          <button type="button" class="facet-modal-search-btn">
            ${ph(placeholders, 'search', 'Search')}
          </button>` : ''}
        </div>
        <div class="facet-modal-controls facet-modal-controls-disabled">
          <label class="facet-modal-select-all-label">
            <input type="checkbox" class="facet-modal-select-all-checkbox" disabled />
            ${selectAllLabel}
          </label>
          <div class="facet-modal-sort-dropdown-container">
            <span class="facet-modal-sort-label">Sort by</span>
          </div>
        </div>
        <div class="facet-modal-values-list">
          <div class="facet-loading-spinner"><div class="loading-spinner loading-spinner-sm" role="status" aria-label="Loading"></div><span>Loading...</span></div>
        </div>
      </div>
      <div class="facet-modal-footer">
        <button class="facet-modal-clear-all" type="button">${clearAllLabel}</button>
        <button class="facet-modal-apply-btn" type="button">${ph(placeholders, 'apply', 'Apply')}</button>
      </div>
    </div>
  `;

  const valuesList = overlay.querySelector('.facet-modal-values-list');
  const searchInput = overlay.querySelector('.facet-modal-search-input');
  const searchClear = overlay.querySelector('.facet-modal-search-clear');
  const selectAllCheckbox = overlay.querySelector('.facet-modal-select-all-checkbox');

  const sortOptions = [
    { key: 'most-results', label: 'Most results' },
    { key: 'selected-most-results', label: 'Selected and most results' },
    { key: 'alphabetical', label: 'Alphabetical' },
    { key: 'selected-alphabetical', label: 'Selected and alphabetical' },
  ];
  const sortDropdownContainer = overlay.querySelector('.facet-modal-sort-dropdown-container');
  const sortDropdownEl = createActionDropdown({
    className: 'facet-modal-sort',
    items: sortOptions.map((o) => o.label),
    selectedItem: sortOptions.find((o) => o.key === currentSortMode)?.label,
    onSelectedItemChange: (label) => {
      const opt = sortOptions.find((o) => o.label === label);
      if (opt) {
        currentSortMode = opt.key;
        refreshList();
      }
    },
    show: true,
  });
  sortDropdownContainer.appendChild(sortDropdownEl);

  // Bind expand/collapse toggles local to the modal (does not affect sidebar state)
  function bindModalHierarchyToggles() {
    if (!isHierarchyModal) return;
    valuesList.querySelectorAll('[data-toggle-hierarchy]').forEach((toggle) => {
      toggle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const hKey = toggle.dataset.toggleHierarchy;
        const container = toggle.closest('.facet-hierarchy-container');
        const caret = container?.querySelector(`.caret-icon[data-toggle-hierarchy="${hKey}"]`);
        const children = container?.querySelector(':scope > .hierarchy-children');
        const isExpanding = children?.style.display === 'none';
        if (caret) caret.classList.toggle('expanded', isExpanding);
        if (children) children.style.display = isExpanding ? '' : 'none';
        // Track expanded state within the modal for restoring after re-renders
        if (isExpanding) modalExpandedKeys.add(hKey);
        else modalExpandedKeys.delete(hKey);
        // Sync back to sidebar state so closing the modal reflects the change
        expandedHierarchyItems[hKey] = isExpanding;
      });
    });
  }

  function restoreModalExpandedState() {
    if (!isHierarchyModal || modalExpandedKeys.size === 0) return;
    modalExpandedKeys.forEach((hKey) => {
      const caret = valuesList.querySelector(`.caret-icon[data-toggle-hierarchy="${CSS.escape(hKey)}"]`);
      if (!caret) return;
      caret.classList.add('expanded');
      const container = caret.closest('.facet-hierarchy-container');
      const children = container?.querySelector(':scope > .hierarchy-children');
      if (children) children.style.display = '';
    });
  }

  function refreshList() {
    valuesList.innerHTML = renderContent();
    bindModalCheckboxes();
    bindModalHierarchyToggles();
    restoreModalExpandedState();

    const controls = overlay.querySelector('.facet-modal-controls');
    if (controls) controls.classList.remove('facet-modal-controls-disabled');
    selectAllCheckbox.disabled = false;

    updateSelectAllState();
  }

  function getVisibleItems() {
    if (apiSearchResults !== null) return apiSearchResults;
    if (!currentModalSearchTerm) return allItems;
    const term = currentModalSearchTerm.toLowerCase();
    return allItems.filter(
      (item) => item.displayName.toLowerCase().includes(term),
    );
  }

  function updateSelectAllState() {
    const latestState = getState();
    const latestChecked = latestState.facetCheckedState[facetKey] || {};
    const visibleItems = getVisibleItems();
    const checkedCount = visibleItems.filter(
      (item) => latestChecked[item.value] === true,
    ).length;
    selectAllCheckbox.checked = visibleItems.length > 0
      && checkedCount === visibleItems.length;
    selectAllCheckbox.indeterminate = checkedCount > 0
      && checkedCount < visibleItems.length;
  }

  function bindModalCheckboxes() {
    const checkboxes = valuesList.querySelectorAll('input[type="checkbox"][data-facet-value]');
    checkboxes.forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        const value = checkbox.dataset.facetValue;

        if (isFacetHierarchyParentCheckbox(checkbox)) {
          const currentState = getState();
          const newChecked = buildFacetMapAfterHierarchyParentToggle(
            facetKey,
            value,
            checkbox.checked,
            currentState.excFacets || {},
            checkbox,
            currentState.facetCheckedState[facetKey] || {},
          );
          setState({
            facetCheckedState: {
              ...currentState.facetCheckedState,
              [facetKey]: newChecked,
            },
          });
        } else {
          callbacks.onFacetCheckbox(facetKey, value);
        }
        refreshList();
      });
    });
  }

  // API search trigger (tags facets only)
  async function triggerApiSearch() {
    if (!isTagsFacet
      || currentModalSearchTerm.length < API_SEARCH_MIN_CHARS) {
      return;
    }
    if (searchAbortCtrl) searchAbortCtrl.abort();
    searchAbortCtrl = new AbortController();
    try {
      const data = await searchTags(
        currentModalSearchTerm,
        searchAbortCtrl.signal,
      );
      apiSearchResults = data.items
        ? convertTagSearchResults(data.items)
        : [];
      refreshList();
    } catch (err) {
      if (err.name !== 'AbortError') {
        // eslint-disable-next-line no-console
        console.error('[Facets] Tags search failed:', err);
      }
    }
  }

  // Search input — local filtering for non-tags facets,
  // just update term for tags facets (API search on button)
  searchInput.addEventListener('input', (e) => {
    currentModalSearchTerm = e.target.value;
    searchClear.style.display = currentModalSearchTerm ? '' : 'none';
    if (!isTagsFacet) {
      refreshList();
    }
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && isTagsFacet) {
      e.preventDefault();
      triggerApiSearch();
    }
  });

  const searchBtn = overlay.querySelector('.facet-modal-search-btn');
  if (searchBtn) {
    searchBtn.addEventListener('click', triggerApiSearch);
  }

  searchClear.addEventListener('click', () => {
    currentModalSearchTerm = '';
    searchInput.value = '';
    searchClear.style.display = 'none';
    apiSearchResults = null;
    if (searchAbortCtrl) searchAbortCtrl.abort();
    refreshList();
  });

  // Select all
  selectAllCheckbox.addEventListener('change', () => {
    const visibleItems = getVisibleItems();
    const shouldCheck = selectAllCheckbox.checked;
    const currentState = getState();
    const newChecked = { ...(currentState.facetCheckedState[facetKey] || {}) };
    visibleItems.forEach((item) => {
      newChecked[item.value] = shouldCheck;
    });
    setState({
      facetCheckedState: {
        ...currentState.facetCheckedState,
        [facetKey]: newChecked,
      },
    });
    refreshList();
  });

  // Clear all
  const clearAllBtn = overlay.querySelector('.facet-modal-clear-all');
  clearAllBtn.addEventListener('click', () => {
    const currentState = getState();
    const newChecked = { ...(currentState.facetCheckedState[facetKey] || {}) };
    allItems.forEach((item) => {
      newChecked[item.value] = false;
    });
    setState({
      facetCheckedState: {
        ...currentState.facetCheckedState,
        [facetKey]: newChecked,
      },
    });
    refreshList();
  });

  // Close modal
  function closeModal() {
    if (searchAbortCtrl) searchAbortCtrl.abort();
    document.body.style.overflow = '';
    overlay.remove();
    render(callbacks);
  }

  overlay.querySelector('.facet-modal-close').addEventListener('click', closeModal);
  overlay.querySelector('.facet-modal-apply-btn').addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  document.addEventListener('keydown', function handleEscape(e) {
    if (e.key === 'Escape' && document.body.contains(overlay)) {
      closeModal();
      document.removeEventListener('keydown', handleEscape);
    }
  });

  // Show modal immediately with loading spinner
  document.body.style.overflow = 'hidden';
  document.body.appendChild(overlay);
  searchInput.focus();

  // Build facet filters from current state for the expanded facet request
  const selectedFacetFilters = [];
  Object.keys(facetCheckedState).forEach((key) => {
    const facetFilter = [];
    Object.entries(facetCheckedState[key]).forEach(([facet, isChecked]) => {
      if (isChecked) facetFilter.push({ key, value: facet });
    });
    if (facetFilter.length > 0) selectedFacetFilters.push(facetFilter);
  });

  try {
    // Step 1: Make search call with just this facet (max bucket size, no hits)
    const rawResponse = await getContentAIClient().fetchExpandedFacet(
      state.query || '',
      facetKey,
      {
        facetFilters: selectedFacetFilters,
        numericFilters: state.selectedNumericFilters || [],
        filters: state.presetFilters || [],
      },
    );

    // Bail out if modal was closed while fetching
    if (!document.body.contains(overlay)) return;

    // Step 2: Parse the response to get expanded facet values
    const parsed = parseContentAIResponse(rawResponse);
    const expandedFacets = parsed.facets || {};

    // Step 3: Build hierarchy or flat data from expanded response
    if (isTagsFacet) {
      const hierarchyDataByFacet = computeHierarchyDataByFacet(
        { [facetKey]: excFacets[facetKey] },
        expandedFacets,
        facetCheckedState,
      );
      hierarchyData = hierarchyDataByFacet[facetKey];
    } else {
      flatFacetValues = { ...(expandedFacets[facetKey] || {}) };
      const checked = facetCheckedState[facetKey] || {};
      Object.keys(checked).forEach((v) => {
        if (checked[v] && flatFacetValues[v] === undefined) {
          flatFacetValues[v] = 0;
        }
      });
    }

    isHierarchyModal = !!hierarchyData;

    // Step 4: For tags facets, resolve tag names before showing values
    // so the initial spinner stays visible until display names are ready.
    if (isTagsFacet && rawResponse.facets) {
      await fetchTagsFromResponse(
        rawResponse.facets,
        { [facetKey]: excFacets[facetKey] },
      );

      if (!document.body.contains(overlay)) return;
    }

    allItems = getAllSelectableItems(hierarchyData, facetKey, excFacets, flatFacetValues);
    refreshList();
    searchInput.focus();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[Facets] Failed to fetch expanded facet ${facetKey}:`, error);

    // Bail out if modal was closed
    if (!document.body.contains(overlay)) return;

    // Fall back to showing whatever we have from cached data
    const combinedFacets = {};
    (state.searchResults || []).forEach((searchResult) => {
      if (searchResult.facets) {
        Object.entries(searchResult.facets).forEach(([k, facetData]) => {
          if (!combinedFacets[k]) combinedFacets[k] = {};
          Object.entries(facetData).forEach(([fn, count]) => {
            combinedFacets[k][fn] = count;
          });
        });
      }
    });
    const cachedFacets = Object.keys(combinedFacets).length > 0 ? combinedFacets : lastFacetsData;

    if (isTagsFacet) {
      const hierarchyDataByFacet = computeHierarchyDataByFacet(
        { [facetKey]: excFacets[facetKey] },
        cachedFacets,
        facetCheckedState,
      );
      hierarchyData = hierarchyDataByFacet[facetKey];
    } else {
      flatFacetValues = { ...(cachedFacets[facetKey] || {}) };
    }
    isHierarchyModal = !!hierarchyData;
    allItems = getAllSelectableItems(hierarchyData, facetKey, excFacets, flatFacetValues);
    refreshList();
    searchInput.focus();
  }
}

/**
 * Compute hierarchy data for all facets (matches React's hierarchyDataByFacet)
 * Detects hierarchy facets by looking for hierarchy keys in search results data
 * For ContentAI, detects by type: 'tags' in config
 * @param {Object} excFacets - Facet configurations
 * @param {Object} facetsData - All facet data from search results
 * @param {Object} facetCheckedState - Current checked state (preserves selected items with 0 count)
 * @returns {Object} Map of facetTechId to hierarchy data
 */
function computeHierarchyDataByFacet(excFacets, facetsData, facetCheckedState = {}) {
  const hierarchyMap = {};
  // Rebuild each pass; otherwise paths stay "synthesized" forever after one response
  // that omitted the parent even when later responses include it from the API.
  synthesizedPaths.clear();

  Object.keys(excFacets).forEach((facetTechId) => {
    // Hierarchy facets are type 'tags'
    const isTagsFacet = excFacets[facetTechId]?.type === 'tags';

    if (isTagsFacet) {
      // ContentAI: Build hierarchy from flat tagPath values
      const flatData = { ...(facetsData[facetTechId] || {}) };

      // Preserve selected values with 0 count if not in API response
      const checkedValues = facetCheckedState[facetTechId] || {};
      Object.keys(checkedValues).forEach((tagPath) => {
        if (checkedValues[tagPath] && flatData[tagPath] === undefined) {
          flatData[tagPath] = 0;
        }
      });

      const hierarchyData = buildContentAIHierarchy(flatData);

      // Filter levels based on maxHierarchyLevels config
      // Level 1 = first level after root (e.g., brand/example-brand)
      // Level 2 = second level (e.g., brand/example-brand/example-variant)
      const maxLevels = excFacets[facetTechId]?.maxHierarchyLevels;
      if (maxLevels && typeof maxLevels === 'number') {
        Object.keys(hierarchyData).forEach((level) => {
          const levelNum = parseInt(level, 10);
          if (levelNum > maxLevels) {
            delete hierarchyData[levelNum];
          }
        });
      }

      // Synthesize missing parents after pruning, so we only create
      // parents for the levels that survived the maxHierarchyLevels cutoff.
      synthesizeMissingParents(hierarchyData);
      pruneContentAINamespaceRootPaths(hierarchyData);

      // Sort each level based on facet's sortDirection setting
      const sortDirection = excFacets[facetTechId]?.sortDirection?.toLowerCase();
      if (sortDirection === 'asc' || sortDirection === 'desc') {
        Object.keys(hierarchyData).forEach((level) => {
          const levelNum = parseInt(level, 10);
          const sortedEntries = Object.entries(hierarchyData[levelNum])
            .sort(([pathA], [pathB]) => {
              const lastTokenA = pathA.split(' / ').pop()?.trim() || '';
              const lastTokenB = pathB.split(' / ').pop()?.trim() || '';
              return sortDirection === 'asc'
                ? lastTokenA.localeCompare(lastTokenB)
                : lastTokenB.localeCompare(lastTokenA);
            });
          hierarchyData[levelNum] = Object.fromEntries(sortedEntries);
        });
      }

      if (Object.keys(hierarchyData).length > 0) {
        hierarchyMap[facetTechId] = hierarchyData;
      }
    }
  });

  return hierarchyMap;
}

/**
 * Check if an item directly matches the search term (by its own name, not path)
 * @param {string} facetTechId - The technical ID of the facet
 * @param {string} facetName - The facet name (full hierarchy path)
 * @param {string} searchTerm - The search term
 * @param {boolean} [isTagsFacet] - Whether this is a ContentAI tags facet
 * @param {Object} [tagsLookup] - Pre-fetched tags lookup map (for tags facets)
 * @param {string} [locale] - Locale code (for tags facets)
 * @returns {boolean} Whether the item directly matches
 */
function doesItemDirectlyMatch(
  facetTechId,
  facetName,
  searchTerm,
  isTagsFacet = false,
  tagsLookup = null,
  locale = null,
) {
  if (!searchTerm) return false;

  let displayedFacetName;
  if (isTagsFacet && tagsLookup && locale) {
    const { text } = getContentAIDisplayName(facetName, tagsLookup, locale, facetTechId);
    displayedFacetName = text;
  } else if (isTagsFacet) {
    const parts = facetName.split('/');
    displayedFacetName = parts[parts.length - 1];
  } else {
    const pathParts = facetName.split(' / ');
    const baseFacetName = pathParts[pathParts.length - 1].trim();
    displayedFacetName = getDisplayFacetName(facetTechId, baseFacetName);
  }

  return displayedFacetName.toLowerCase().includes(searchTerm.toLowerCase());
}

/**
 * Helper function to check if hierarchy item should be shown based on search
 * Shows item if it matches OR if any descendant matches (matches React behavior)
 * @param {Object} hierarchyData - Hierarchy data by level
 * @param {string} facetTechId - The technical ID of the facet
 * @param {string} facetName - The facet name/path
 * @param {string} searchTerm - Search term to filter by
 * @param {number} level - Current hierarchy level
 * @param {boolean} parentDirectlyMatched - Whether parent directly matched the search
 * @param {boolean} [isTagsFacet] - Whether this is a ContentAI tags facet
 * @param {Object} [tagsLookup] - Pre-fetched tags lookup map (for tags facets)
 * @param {string} [locale] - Locale code (for tags facets)
 * @returns {boolean} Whether to show this item
 */
function shouldShowHierarchyItem(
  hierarchyData,
  facetTechId,
  facetName,
  searchTerm,
  level,
  parentDirectlyMatched = false,
  isTagsFacet = false,
  tagsLookup = null,
  locale = null,
) {
  if (!searchTerm) return true;

  // If parent directly matched, show all children
  if (parentDirectlyMatched) return true;

  // Check if item directly matches
  if (doesItemDirectlyMatch(
    facetTechId,
    facetName,
    searchTerm,
    isTagsFacet,
    tagsLookup,
    locale,
  )) {
    return true;
  }

  // ContentAI tags use '/' separator, Algolia uses ' / '
  const pathSeparator = isTagsFacet ? '/' : ' / ';
  const prefix = `${facetName}${pathSeparator}`;

  // Check if any descendant items at deeper levels match the search term
  const deeperLevels = Object.keys(hierarchyData)
    .map(Number).filter((dl) => dl > level).sort((a, b) => a - b);
  return deeperLevels.some((dl) => {
    const deeperLevelData = hierarchyData[dl];
    if (!deeperLevelData) return false;
    return Object.keys(deeperLevelData).some((deeperFacetName) => {
      if (!deeperFacetName.startsWith(prefix)) return false;
      return doesItemDirectlyMatch(
        facetTechId,
        deeperFacetName,
        searchTerm,
        isTagsFacet,
        tagsLookup,
        locale,
      );
    });
  });
}

/**
 * Fast lookup of titlePath using pre-fetched lookup object
 * @param {Object} tagsLookup - Pre-fetched tags lookup map
 * @param {string} tagPath - Tag path to lookup
 * @param {string} locale - Locale code
 * @returns {string|null} titlePath or null
 */
function fastLookupTitlePath(tagsLookup, tagPath, locale) {
  if (!tagsLookup || !tagsLookup[tagPath]) return null;

  const entry = tagsLookup[tagPath];

  // Try exact locale match first
  if (entry[locale]) return entry[locale];

  // Try 'default' key
  if (entry.default) return entry.default;

  // Try locale prefix match (e.g., 'en' matches 'en_US' or 'en-US')
  const localePrefix = locale.split(/[-_]/)[0];
  const matchingKey = Object.keys(entry).find(
    (key) => key !== 'id' && key.startsWith(localePrefix),
  );
  if (matchingKey) return entry[matchingKey];

  // Last resort: return first available titlePath (skip 'id' key)
  const firstKey = Object.keys(entry).find((key) => key !== 'id');
  return firstKey ? entry[firstKey] : null;
}

/**
 * Get display name for ContentAI tagPath
 * @param {string} tagPath - Tag path like 'brand/example-brand'
 * @param {Object} tagsLookup - Pre-fetched tags lookup map
 * @param {string} locale - Locale code
 * @param {string} [facetId=null] - Facet ID to associate when fetching missing tags
 * @returns {{ text: string, isFallback: boolean }} Display name and fallback indicator
 */
function getContentAIDisplayName(tagPath, tagsLookup, locale, facetId = null) {
  // Use fast lookup with pre-fetched data (avoids repeated function calls)
  const titlePath = tagsLookup
    ? fastLookupTitlePath(tagsLookup, tagPath, locale)
    : lookupTitlePath(tagPath, locale);

  if (titlePath) {
    // titlePath: "Brand / Example-Brand" -> extract last segment "Example-Brand"
    // Split by " / " to preserve titles with "/" (e.g., "Sprite Zero/diet/light")
    const parts = titlePath.split(' / ');
    return { text: parts[parts.length - 1].trim(), isFallback: false };
  }

  // Track missing tag path for async fetch (only if not already fetching or attempted)
  if (!fetchingTagPaths.has(tagPath) && !attemptedTagPaths.has(tagPath)) {
    missingTagPaths.add(JSON.stringify({ tagPath, facetId }));
  }

  const pathParts = tagPath.split('/');
  return { text: pathParts[pathParts.length - 1], isFallback: true };
}

/**
 * Render hierarchy level items recursively
 * @param {Object} hierarchyData - Hierarchy data by level
 * @param {string} facetTechId - The technical ID of the facet
 * @param {number} level - Current hierarchy level
 * @param {string} parentPath - Parent path for filtering children
 * @param {Object} facetCheckedState - Current checked state
 * @param {Object} excFacets - Facet configurations (to detect ContentAI vs Algolia)
 * @param {boolean} parentDirectlyMatched - Whether parent directly matched search
 * @returns {string} HTML for hierarchy items
 */
function renderHierarchyLevel(
  hierarchyData,
  facetTechId,
  level,
  parentPath,
  facetCheckedState,
  excFacets,
  parentDirectlyMatched = false,
  tagsLookup = null,
  locale = null,
  maxVisibleItems = 0,
  sortMode = 'selected-most-results',
  _sharedCtx = null,
) {
  const levelData = hierarchyData[level];
  if (!levelData) return '';

  const searchTerm = searchTerms[facetTechId] || '';
  const items = [];

  // Determine if this is a 'tags' facet (hierarchy)
  const isTagsFacet = excFacets[facetTechId]?.type === 'tags';

  // Get tags lookup ONCE at level 1 for tags facets (perf optimization)
  // eslint-disable-next-line no-param-reassign
  if (level === 1 && isTagsFacet && !tagsLookup) {
    // eslint-disable-next-line no-param-reassign
    tagsLookup = getTagsLookupMap();
    // eslint-disable-next-line no-param-reassign
    locale = getLocaleFromUrl();
  }

  // ContentAI tags facets use flat key (facetTechId)
  const checkboxKey = facetTechId;

  // Get checked values for sorting
  const checkedValues = facetCheckedState[checkboxKey] || {};
  const pathSeparator = isTagsFacet ? '/' : ' / ';

  // --- Shared context: computed once at level 1, reused across all recursive calls ---
  let ctx = _sharedCtx;
  if (!ctx) {
    // Collect all checked paths across all hierarchy levels
    const allCheckedPaths = [];
    Object.keys(hierarchyData).forEach((dl) => {
      Object.keys(hierarchyData[dl]).forEach((path) => {
        if (checkedValues[path] === true) allCheckedPaths.push(path);
      });
    });

    // Build a path→count map across all levels for fast count lookups
    const pathCountMap = {};
    Object.keys(hierarchyData).forEach((dl) => {
      Object.entries(hierarchyData[dl]).forEach(([path, count]) => {
        if (count != null && (pathCountMap[path] == null || count > pathCountMap[path])) {
          pathCountMap[path] = count;
        }
      });
    });

    // Pre-index children per parent for O(1) child-set lookups at any level
    const childrenByParent = {};
    Object.keys(hierarchyData).forEach((dl) => {
      Object.keys(hierarchyData[dl]).forEach((path) => {
        const sepIdx = path.lastIndexOf(pathSeparator);
        if (sepIdx > 0) {
          const parent = path.substring(0, sepIdx);
          if (!childrenByParent[parent]) childrenByParent[parent] = [];
          childrenByParent[parent].push(path);
        }
      });
    });

    ctx = {
      allCheckedPaths,
      pathCountMap,
      displayNameCache: {},
      displayInfoCache: {},
      childrenByParent,
      parentPathsWithChildrenByLevel: {},
    };
  }

  const { allCheckedPaths, pathCountMap, displayNameCache } = ctx;

  const getDisplayNameForSort = (facetName) => {
    if (displayNameCache[facetName] !== undefined) return displayNameCache[facetName];
    let name;
    if (isTagsFacet && tagsLookup) {
      let info = ctx.displayInfoCache[facetName];
      if (!info) {
        info = getContentAIDisplayName(facetName, tagsLookup, locale, facetTechId);
        ctx.displayInfoCache[facetName] = info;
      }
      name = info.text.toLowerCase();
    } else {
      const parts = facetName.split(pathSeparator);
      name = parts[parts.length - 1].toLowerCase();
    }
    displayNameCache[facetName] = name;
    return name;
  };

  // At level > 1, filter to only entries matching parentPath (avoids sorting the entire level)
  const relevantEntries = (level > 1 && parentPath)
    ? Object.entries(levelData).filter(([name]) => {
      const sepIdx = name.lastIndexOf(pathSeparator);
      return sepIdx > 0 && name.substring(0, sepIdx) === parentPath;
    })
    : Object.entries(levelData);

  if (relevantEntries.length === 0) return '';

  // Pre-compute per-entry sort metadata
  const entryMeta = {};
  relevantEntries.forEach(([name]) => {
    const isDirectlyChecked = checkedValues[name] === true;
    const prefix = `${name}/`;
    const descendants = allCheckedPaths.filter((p) => p.startsWith(prefix));
    const hasDescendant = descendants.length > 0;

    let priority = 2;
    if (isDirectlyChecked) priority = 0;
    else if (hasDescendant) priority = 1;

    let maxDescCount = 0;
    let minDescName = null;
    if (hasDescendant || isDirectlyChecked) {
      const allDesc = isDirectlyChecked ? [name, ...descendants] : descendants;
      allDesc.forEach((path) => {
        const c = pathCountMap[path];
        if (c != null && c > maxDescCount) maxDescCount = c;
        const dn = getDisplayNameForSort(path);
        if (minDescName === null || dn.localeCompare(minDescName) < 0) minDescName = dn;
      });
    }

    entryMeta[name] = {
      priority,
      displayName: getDisplayNameForSort(name),
      maxDescCount,
      minDescName: minDescName || '',
    };
  });

  const useActiveFirst = sortMode === 'selected-most-results' || sortMode === 'selected-alphabetical';
  const useAlphabetical = sortMode === 'alphabetical' || sortMode === 'selected-alphabetical';

  const sortedEntries = relevantEntries.sort(([nameA, countA], [nameB, countB]) => {
    const metaA = entryMeta[nameA];
    const metaB = entryMeta[nameB];

    if (useActiveFirst) {
      if (metaA.priority !== metaB.priority) return metaA.priority - metaB.priority;

      if (metaA.priority === 0) {
        if (useAlphabetical) {
          const cmp = metaA.displayName.localeCompare(metaB.displayName);
          if (cmp !== 0) return cmp;
        } else {
          return (countB || 0) - (countA || 0);
        }
      } else if (metaA.priority === 1) {
        if (useAlphabetical) {
          const cmp = metaA.minDescName.localeCompare(metaB.minDescName);
          if (cmp !== 0) return cmp;
        } else if (metaA.maxDescCount !== metaB.maxDescCount) {
          return metaB.maxDescCount - metaA.maxDescCount;
        }
      }
    }

    // Synthesized parents (null count) without selections go to bottom
    const isSynthA = countA === null;
    const isSynthB = countB === null;
    if (isSynthA && !isSynthB) return 1;
    if (!isSynthA && isSynthB) return -1;

    if (useAlphabetical) {
      return metaA.displayName.localeCompare(metaB.displayName);
    }

    // Default: sort by count descending (applies to 'most-results' and 'selected-most-results')
    return (countB || 0) - (countA || 0);
  });

  // Pre-compute which parent paths have children (cached per level in shared context)
  if (!ctx.parentPathsWithChildrenByLevel[level]) {
    const pset = new Set();
    const nextLevelData = hierarchyData[level + 1];
    if (nextLevelData) {
      Object.keys(nextLevelData).forEach((subFacetName) => {
        const lastSepIndex = subFacetName.lastIndexOf(pathSeparator);
        if (lastSepIndex > 0) {
          pset.add(subFacetName.substring(0, lastSepIndex));
        }
      });
    }
    ctx.parentPathsWithChildrenByLevel[level] = pset;
  }
  const parentPathsWithChildren = ctx.parentPathsWithChildrenByLevel[level];

  // Level-1 roots in the truncated sidebar (same set whether or not facet search is active)
  let allowedLevel1Keys = null;
  if (level === 1 && maxVisibleItems > 0) {
    allowedLevel1Keys = new Set();
    const activeLevel1Count = sortedEntries.filter(
      ([name]) => entryMeta[name] && entryMeta[name].priority < 2,
    ).length;
    const uncheckedSlots = Math.max(0, maxVisibleItems - activeLevel1Count);
    let renderedLevel1Unchecked = 0;
    sortedEntries.forEach(([facetName]) => {
      const isActiveItem = entryMeta[facetName] && entryMeta[facetName].priority < 2;
      if (isActiveItem) {
        allowedLevel1Keys.add(facetName);
        return;
      }
      if (renderedLevel1Unchecked < uncheckedSlots) {
        renderedLevel1Unchecked += 1;
        allowedLevel1Keys.add(facetName);
      }
    });
  }

  sortedEntries.forEach(([facetName, count]) => {
    if (level === 1 && allowedLevel1Keys && !allowedLevel1Keys.has(facetName)) {
      return;
    }

    let displayNameHtml;

    if (isTagsFacet) {
      let info = ctx.displayInfoCache[facetName];
      if (!info) {
        info = getContentAIDisplayName(facetName, tagsLookup, locale, facetTechId);
        ctx.displayInfoCache[facetName] = info;
      }
      const safeText = escapeHtml(info.text);
      displayNameHtml = info.isFallback
        ? `<span class="facet-label-text fallback-label">${safeText}</span>`
        : `<span class="facet-label-text">${safeText}</span>`;
    } else {
      const pathParts = facetName.split(' / ');
      const baseFacetName = pathParts[pathParts.length - 1].trim();
      displayNameHtml = getDisplayFacetName(facetTechId, baseFacetName);
    }

    // Filter based on search term - check full hierarchy path and descendants
    const shouldShow = shouldShowHierarchyItem(
      hierarchyData,
      facetTechId,
      facetName,
      searchTerm,
      level,
      parentDirectlyMatched,
      isTagsFacet,
      tagsLookup,
      locale,
    );
    if (searchTerm && !shouldShow) {
      return;
    }

    const fullPath = facetName;
    const itemKey = `${facetTechId}-${facetName}`;

    // Check if this item directly matches (to pass to children)
    const thisItemDirectlyMatches = doesItemDirectlyMatch(
      facetTechId,
      facetName,
      searchTerm,
      isTagsFacet,
      tagsLookup,
      locale,
    );

    // Check if this item has sub-levels (O(1) lookup using precomputed Set)
    const hasSubLevels = parentPathsWithChildren.has(fullPath);

    const indentClass = level > 1 ? 'facet-hierarchy-container-indented' : '';

    // CSS classes
    const containerClasses = [
      'facet-hierarchy-container',
      indentClass,
      hasSubLevels ? 'facet-hierarchy-container-with-sublevel' : '',
    ].filter(Boolean).join(' ');

    const hierarchyItemKey = `${facetTechId}-${fullPath}`;
    // User toggle takes precedence over auto-expand
    const isHierarchyItemExpanded = expandedHierarchyItems[hierarchyItemKey] !== undefined
      ? expandedHierarchyItems[hierarchyItemKey]
      : autoExpandedHierarchyItems[hierarchyItemKey];
    const isChecked = facetCheckedState[checkboxKey]?.[facetName] === true;
    const checkboxId = `facet-${checkboxKey}-${facetName.replace(/[^a-zA-Z0-9]/g, '_')}`;

    // Render children (auto-expand when searching or when child is selected)
    const shouldExpand = searchTerm ? true : isHierarchyItemExpanded;
    // Always render children if hasSubLevels, but hide if not expanded
    const childrenHtml = hasSubLevels
      ? renderHierarchyLevel(
        hierarchyData,
        facetTechId,
        level + 1,
        fullPath,
        facetCheckedState,
        excFacets,
        thisItemDirectlyMatches || parentDirectlyMatched,
        tagsLookup,
        locale,
        0,
        sortMode,
        ctx,
      )
      : '';

    // Wrap children in container for show/hide toggle
    const childrenWrapperHtml = hasSubLevels
      ? `<div class="hierarchy-children" style="${shouldExpand ? '' : 'display: none;'}">${childrenHtml}</div>`
      : '';

    const isSynthesized = synthesizedPaths.has(fullPath);
    const synthAttr = isSynthesized ? ' data-synthesized="true"' : '';
    const isLeaf = !hasSubLevels;
    const displayCount = isLeaf
      ? getHierarchyFacetDisplayCount(
        fullPath,
        count,
        hierarchyData,
        level,
        pathSeparator,
        hasSubLevels,
        isChecked,
        facetTechId,
      )
      : 0;
    const showCountParen = isLeaf && displayCount > 0;
    const labelHtml = `<label class="facet-filter-checkbox-label">
            <input class="facet-filter-checkbox-input" type="checkbox" id="${checkboxId}" ${isChecked ? 'checked' : ''} data-facet-key="${checkboxKey}" data-facet-value="${facetName}"${synthAttr} />
            ${displayNameHtml}${showCountParen ? ` (${displayCount})` : ''}
          </label>`;

    items.push(`
        <div class="${containerClasses}" data-hierarchy-item="${itemKey}">
          <div class="facet-hierarchy-row">
            ${labelHtml}
            ${hasSubLevels ? `
              <span class="facet-filter-arrow-sub-level caret-icon ${shouldExpand ? 'expanded' : ''}" data-toggle-hierarchy="${hierarchyItemKey}" data-facet-tech-id="${facetTechId}" data-full-path="${fullPath}"></span>
            ` : ''}
          </div>
          ${childrenWrapperHtml}
        </div>
      `);
  });

  return items.join('');
}

function renderFacetSections(excFacets, facetsData, facetCheckedState, expandedFacets) {
  if (!excFacets) return '<p>No filters available</p>';

  // Get current state for special facet counts
  const currentState = getState();

  // Compute hierarchy data (pass facetCheckedState to preserve 0-count selections)
  const hierarchyDataByFacet = computeHierarchyDataByFacet(
    excFacets,
    facetsData,
    facetCheckedState,
  );

  const sections = [];

  const allFacets = Object.entries(excFacets).filter(([key]) => !REMOVED_FACET_KEYS.has(key));

  allFacets.forEach(([key, facetConfig]) => {
    // Use label first (from EXC config/DA), then name, then key as fallback
    // Note: Facet labels are DA-managed (Tier 2), not code-managed
    const facetName = facetConfig.label || facetConfig.name || key;
    const isExpanded = expandedFacets[key] === true; // Default to collapsed

    // Check if this is a hierarchy facet by looking at computed hierarchy data (matches React)
    const hierarchyData = hierarchyDataByFacet[key];
    const isHierarchyFacet = !!hierarchyData;

    // Get facet values for non-hierarchy facets
    let facetValues = {};
    if (!isHierarchyFacet) {
      facetValues = { ...(facetsData[key] || {}) };
      // Preserve selected values with 0 count if not in API response
      const checkedValues = facetCheckedState[key] || {};
      Object.keys(checkedValues).forEach((value) => {
        if (checkedValues[value] && facetValues[value] === undefined) {
          facetValues[value] = 0;
        }
      });
      // Tags facet with only namespace roots (no "/") has empty hierarchy — still filter flat list
      if (excFacets[key]?.type === 'tags') {
        facetValues = Object.fromEntries(
          Object.entries(facetValues).filter(([k]) => !isContentAINamespaceRootTagPath(k)),
        );
      }
    }

    // For hierarchy facets, count checked items across all levels
    // Count from facetCheckedState directly to include checked items even if not in search results
    let checkedCount = 0;
    // Tags facets use flat key
    const isTagsFacet = excFacets[key]?.type === 'tags';

    if (isHierarchyFacet && isTagsFacet) {
      // ContentAI tags facets: checked values stored under flat key
      const checkedValues = facetCheckedState[key] || {};
      // Count all checked values across all hierarchy levels
      Object.keys(hierarchyData).forEach((level) => {
        const levelData = hierarchyData[level] || {};
        checkedCount += Object.keys(levelData).filter(
          (value) => checkedValues[value] === true,
        ).length;
      });
    } else if (getDateFacets().includes(key)) {
      // Count max 1 if any date range filter is set for this date facet
      // (handle both hyphen and colon formats)
      const { selectedNumericFilters } = currentState;
      const keyWithColon = key.replace(/-/g, ':');
      const keyWithHyphen = key.replace(/:/g, '-');
      const hasDateFilter = selectedNumericFilters.some(
        (f) => f.startsWith(key) || f.startsWith(keyWithColon) || f.startsWith(keyWithHyphen),
      );
      checkedCount = hasDateFilter ? 1 : 0;
    } else {
      const checkedValues = facetCheckedState[key] || {};
      // Only count checked values that exist in facetValues (visible in the facet list)
      checkedCount = Object.keys(facetValues).filter(
        (value) => checkedValues[value] === true,
      ).length;
    }

    // Determine if we have values to show
    const hasValues = isHierarchyFacet
      ? Object.keys(hierarchyData).length > 0
      : Object.keys(facetValues).length > 0;

    // Skip rendering facet section when API returned no values (don't show empty filter labels)
    const isDateFacet = getDateFacets().includes(key);
    const skipFacetSection = !isDateFacet && !hasValues;

    if (skipFacetSection) return;

    const facetType = facetConfig.type || 'standard';

    const sidebarFacetDisplayLimit = excFacets[key]?.displayFacetsLimit
      || TAGS_FACET_DISPLAY_LIMIT;
    const sidebarFacetBucketSize = getEffectiveFacetBucketSize(key);
    const sidebarFacetRawCount = Object.keys(facetsData[key] || {}).length;
    const sidebarFacetLevel1Count = Object.keys(hierarchyData?.[1] || {}).length;
    const sidebarFacetMayHaveMore = isHierarchyFacet
      ? (sidebarFacetLevel1Count >= sidebarFacetDisplayLimit
        || sidebarFacetRawCount === sidebarFacetBucketSize)
      : (sidebarFacetRawCount >= sidebarFacetDisplayLimit
        || sidebarFacetRawCount === sidebarFacetBucketSize);

    // Generate checkbox list HTML
    let checkboxListHtml = '';
    if (isExpanded) {
      // Special handling for date facets - render DateRange component (matches React)
      if (facetType === 'date' || getDateFacets().includes(key)) {
        checkboxListHtml = `
          <div class="date-range-filter" data-facet-key="${key}">
            <div class="date-range-wrapper">
              <div class="date-range-inputs">
                <div class="date-range-input-wrapper">
                  <div id="${key}-start-date" class="date-picker-container"></div>
                </div>
                <div class="date-range-input-wrapper">
                  <div id="${key}-end-date" class="date-picker-container"></div>
                </div>
              </div>
            </div>
          </div>
        `;
      } else if (facetType === 'tags' && (currentState.isTagsLoading || fetchingFacetIds.has(key))) {
        const loadingTagsLabel = ph(placeholders, 'loadingTags', 'Loading...');
        const showAllLabel = ph(placeholders, 'showAll', 'Show all');
        checkboxListHtml = `
          <div class="facet-filter-checkbox-list facet-tags-loading">
            <div class="facet-loading-spinner">
              <div class="loading-spinner loading-spinner-sm" role="status" aria-label="Loading"></div>
              <span>${loadingTagsLabel}</span>
            </div>
          </div>
          <button class="facet-show-all-btn" data-facet-key="${key}" type="button" disabled>
            ${showAllLabel}
          </button>
        `;
      } else if (hasValues) {
        if (isHierarchyFacet) {
          checkboxListHtml = `
            <div class="facet-filter-checkbox-list">
              ${renderHierarchyLevel(hierarchyData, key, 1, '', facetCheckedState, excFacets, false, null, null, sidebarFacetDisplayLimit)}
            </div>
          `;
          const level1Count = Object.keys(hierarchyData[1] || {}).length;
          const totalEntries = Object.keys(facetsData[key] || {}).length;
          if (level1Count >= sidebarFacetDisplayLimit || totalEntries === sidebarFacetBucketSize) {
            // We want "totalEntries === bucketSize" because when totalEntries reaches the cap,
            // more values may exist in the modal where we will make a larger bucketSize request.
            const showAllLabel = ph(placeholders, 'showAll', 'Show all');
            // Omit count beside "Show all" because the sidebar facets is limited by bucketSize,
            // thus it might be under actual count.
            checkboxListHtml += `
              <button class="facet-show-all-btn" data-facet-key="${key}" type="button">
                ${showAllLabel}
              </button>
            `;
          }
        } else {
          const checkedValues = facetCheckedState[key] || {};
          const totalEntries = Object.keys(facetValues).length;
          checkboxListHtml = `
            <div class="facet-filter-checkbox-list">
              ${renderFacetValues(key, facetValues, checkedValues, excFacets, sidebarFacetDisplayLimit)}
            </div>
          `;
          if (totalEntries >= sidebarFacetDisplayLimit || totalEntries === sidebarFacetBucketSize) {
            // We want "totalEntries === bucketSize" because when totalEntries reaches the cap,
            // more values may exist in the modal where we will make a larger bucketSize request.
            const showAllLabel = ph(placeholders, 'showAll', 'Show all');
            // Omit count beside "Show all" because the sidebar facets is limited by bucketSize,
            // thus it might be under actual count.
            checkboxListHtml += `
              <button class="facet-show-all-btn" data-facet-key="${key}" type="button">
                ${showAllLabel}
              </button>
            `;
          }
        }
      }
    }
    const isSearchMode = searchMode[key] === true;
    const currentSearchTerm = searchTerms[key] || '';
    // Escape special HTML characters in the search term for the value attribute
    const escapedSearchTerm = currentSearchTerm
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const showSearchScopeHintFacet = hasValues
      && facetType !== 'date'
      && !getDateFacets().includes(key);

    const facetSearchScopeHintId = `facet-search-scope-${key.replace(
      /[^a-zA-Z0-9_-]/g,
      '_',
    )}`;
    let facetSearchScopeSrHtml = '';
    if (isSearchMode && showSearchScopeHintFacet) {
      const fullMsg = sidebarFacetMayHaveMore
        ? ph(
          placeholders,
          'facetSearchSidebarScopeWithShowAll',
          'Search applies only to facet values loaded in the sidebar from your current results. Use Show all to load and search more values.',
        )
        : ph(
          placeholders,
          'facetSearchSidebarScope',
          'Search applies only to facet values loaded from your current results.',
        );
      facetSearchScopeSrHtml = `<span id="${facetSearchScopeHintId}" class="facet-search-scope-sr-only">${escapeHtml(fullMsg)}</span>`;
    }
    const searchInputAriaDesc = (isSearchMode && showSearchScopeHintFacet)
      ? ` aria-describedby="${facetSearchScopeHintId}"`
      : '';

    // Render button - either search mode or normal mode (matches React's FacetItem)
    let buttonHtml;
    if (isSearchMode) {
      // Search mode button (matches React's facet-filter-button-search)
      buttonHtml = `
        <div class="facet-filter-button facet-filter-button-search">
          <div class="facet-search-container">
            ${facetSearchScopeSrHtml}
            <div class="facet-search-input-wrapper">
              <img src="/icons/search.svg" alt="Search" class="facet-search-icon-inside" />
              <input type="text" class="facet-search-input" data-facet="${key}" value="${escapedSearchTerm}" placeholder="Search ${facetName}..." autofocus${searchInputAriaDesc} />
              <img src="/icons/close-menu.svg" alt="Close" class="facet-search-close-icon" data-facet="${key}" />
            </div>
          </div>
          <div class="facet-filter-right-section">
            ${checkedCount > 0 ? `<div class="assets-details-tag custom-tag facet-filter-count-tag">${checkedCount}</div>` : ''}
            <div class="facet-filter-expand-cluster">
              <span class="facet-filter-arrow-top-level ${isExpanded ? 'expanded' : ''}" data-toggle="${key}"></span>
            </div>
          </div>
        </div>
      `;
    } else {
      // Normal button mode (uses <div> like React, not <button>)
      buttonHtml = `
        <div class="facet-filter-button" data-toggle="${key}" tabindex="0" aria-expanded="${isExpanded}">
          <span class="facet-filter-label">${facetName}</span>
          <div class="facet-filter-right-section">
            ${checkedCount > 0 ? `<div class="assets-details-tag custom-tag facet-filter-count-tag">${checkedCount}</div>` : ''}
            ${isExpanded && facetType !== 'date' ? `<img src="/icons/search.svg" alt="Search" class="facet-search-trigger" data-facet="${key}"${sidebarFacetMayHaveMore ? ' data-has-show-all="true"' : ''} />` : ''}
            <span class="facet-filter-arrow ${isExpanded ? 'expanded' : ''}"></span>
          </div>
        </div>
      `;
    }

    const sectionHtml = `
      <div class="facet-filter-section" data-facet-key="${key}">
        ${buttonHtml}
        ${checkboxListHtml}
      </div>
    `;

    sections.push(sectionHtml);
  });

  return sections.join('');
}

/**
 * Facet value keys that appear in the truncated sidebar (all checked + unchecked slots).
 * Sidebar facet search only considers this set. maxItems <= 0 means no truncation (all keys).
 * @param {Array<[string, number]>} sortedEntries - Pre-sorted [value, count] rows
 * @param {Object} checkedValues - facetValue -> boolean
 * @param {number} maxItems - displayFacetsLimit
 * @returns {Set<string>}
 */
function getTruncatedSidebarFacetKeys(sortedEntries, checkedValues, maxItems) {
  if (maxItems <= 0) {
    return new Set(sortedEntries.map(([v]) => v));
  }
  const allowed = new Set();
  const activeCount = sortedEntries.filter(([v]) => checkedValues[v] === true).length;
  const uncheckedSlots = Math.max(0, maxItems - activeCount);
  let uncheckedRendered = 0;
  sortedEntries.forEach(([value]) => {
    if (checkedValues[value] === true) {
      allowed.add(value);
      return;
    }
    if (uncheckedRendered < uncheckedSlots) {
      uncheckedRendered += 1;
      allowed.add(value);
    }
  });
  return allowed;
}

function renderFacetValues(key, facetValues, checkedValues, excFacets, maxItems = 0) {
  const searchTerm = searchTerms[key] || '';
  // Asset metadata can contain empty-string values (e.g. a stray '' entry in an
  // allowedCountries array) — never render those as a blank, unlabeled checkbox.
  const entries = Object.entries(facetValues).filter(([value]) => value !== '');

  // Sort: selected items first, then by count (highest first) or sortDirection
  const sortDirection = excFacets[key]?.sortDirection?.toLowerCase();
  const sortedAll = [...entries].sort(([nameA, countA], [nameB, countB]) => {
    const isCheckedA = checkedValues[nameA] === true;
    const isCheckedB = checkedValues[nameB] === true;

    // Selected items first
    if (isCheckedA && !isCheckedB) return -1;
    if (!isCheckedA && isCheckedB) return 1;

    // Then sort by sortDirection if specified, otherwise by count
    if (sortDirection === 'asc' || sortDirection === 'desc') {
      const displayNameA = resolveFacetDisplayName(key, nameA, excFacets);
      const displayNameB = resolveFacetDisplayName(key, nameB, excFacets);
      if (sortDirection === 'asc') {
        return displayNameA.localeCompare(displayNameB);
      }
      return displayNameB.localeCompare(displayNameA);
    }

    // Default: sort by count (highest first)
    return countB - countA;
  });

  const sidebarKeys = getTruncatedSidebarFacetKeys(sortedAll, checkedValues, maxItems);
  const q = searchTerm.toLowerCase();
  const sortedEntries = searchTerm
    ? sortedAll.filter(([facetName]) => {
      if (!sidebarKeys.has(facetName)) return false;
      const displayFacetName = resolveFacetDisplayName(key, facetName, excFacets);
      return displayFacetName.toLowerCase().includes(q);
    })
    : sortedAll;

  if (sortedEntries.length === 0) {
    const noMatchingFiltersLabel = ph(placeholders, 'noMatchingFilters', 'No matching filters');
    return `<p style="font-size: 12px; color: #666;">${noMatchingFiltersLabel}</p>`;
  }

  // Truncate: show all active items + up to remaining slots for unchecked (only when not searching)
  const shouldTruncate = maxItems > 0 && !searchTerm;
  const activeCount = shouldTruncate
    ? sortedEntries.filter(([v]) => checkedValues[v] === true).length
    : 0;
  const uncheckedSlots = shouldTruncate ? Math.max(0, maxItems - activeCount) : Infinity;
  let uncheckedRendered = 0;

  return sortedEntries.filter(([value]) => {
    if (!shouldTruncate) return true;
    if (checkedValues[value] === true) return true;
    if (uncheckedRendered < uncheckedSlots) {
      uncheckedRendered += 1;
      return true;
    }
    return false;
  }).map(([value, count]) => {
    const isChecked = checkedValues[value] === true;
    const displayName = escapeHtml(resolveFacetDisplayName(key, value, excFacets));
    const checkboxId = `facet-${key}-${value.replace(/[^a-zA-Z0-9]/g, '_')}`;

    return `
      <label class="facet-filter-checkbox-label" for="${checkboxId}">
        <input class="facet-filter-checkbox-input" type="checkbox" id="${checkboxId}" ${isChecked ? 'checked' : ''} data-facet-key="${key}" data-facet-value="${value}" />
        ${displayName} (${count})
      </label>
    `;
  }).join('');
}

/**
 * Update only the checkbox list for a specific facet (for search filtering without full re-render)
 * This prevents losing focus/cursor position in the search input
 * @param {string} facetKey - The facet key to update
 * @param {Object} callbacks - Callback functions
 */
function updateFacetCheckboxList(facetKey, callbacks) {
  const state = getState();
  const { excFacets, searchResults, facetCheckedState } = state;

  // Combine facets from all search results
  const combinedFacets = {};
  searchResults?.forEach((searchResult) => {
    if (searchResult.facets) {
      Object.entries(searchResult.facets).forEach(([key, facetData]) => {
        if (!combinedFacets[key]) {
          combinedFacets[key] = {};
        }
        Object.entries(facetData).forEach(([facetName, count]) => {
          combinedFacets[key][facetName] = count;
        });
      });
    }
  });

  // Find the checkbox list container for this facet
  const facetSection = containerElement.querySelector(`[data-facet-key="${facetKey}"]`);
  if (!facetSection) return;

  const checkboxList = facetSection.querySelector('.facet-filter-checkbox-list');
  if (!checkboxList) return;

  // Check if this is a tags (hierarchy) facet
  const isTagsFacet = excFacets[facetKey]?.type === 'tags';

  if (isTagsFacet) {
    // ContentAI tags facet - compute hierarchy from flat tagPath values
    const hierarchyDataByFacet = computeHierarchyDataByFacet(
      { [facetKey]: excFacets[facetKey] },
      combinedFacets,
      facetCheckedState,
    );
    const hierarchyData = hierarchyDataByFacet[facetKey];
    if (hierarchyData) {
      const sidebarFacetDisplayLimit = excFacets[facetKey]?.displayFacetsLimit
        || TAGS_FACET_DISPLAY_LIMIT;
      // Re-render hierarchy facet
      checkboxList.innerHTML = renderHierarchyLevel(
        hierarchyData,
        facetKey,
        1,
        '',
        facetCheckedState,
        excFacets,
        false,
        null,
        null,
        sidebarFacetDisplayLimit,
      );
      // Re-bind hierarchy toggle events
      bindHierarchyToggleEvents(checkboxList);
    } else {
      // Only namespace roots in response — no hierarchy; keep flat list in sync (filtered roots)
      let facetValues = { ...(combinedFacets[facetKey] || lastFacetsData[facetKey] || {}) };
      const checkedValues = facetCheckedState[facetKey] || {};
      Object.keys(checkedValues).forEach((value) => {
        if (checkedValues[value] && facetValues[value] === undefined) {
          facetValues[value] = 0;
        }
      });
      facetValues = Object.fromEntries(
        Object.entries(facetValues).filter(([k]) => !isContentAINamespaceRootTagPath(k)),
      );
      const sidebarFacetDisplayLimit = excFacets[facetKey]?.displayFacetsLimit
        || TAGS_FACET_DISPLAY_LIMIT;
      checkboxList.innerHTML = renderFacetValues(
        facetKey,
        facetValues,
        checkedValues,
        excFacets,
        sidebarFacetDisplayLimit,
      );
    }
  } else {
    // Get the facet values and checked state
    const facetValues = { ...(combinedFacets[facetKey] || lastFacetsData[facetKey] || {}) };
    const checkedValues = facetCheckedState[facetKey] || {};
    // Preserve selected values with 0 count if not in API response
    Object.keys(checkedValues).forEach((value) => {
      if (checkedValues[value] && facetValues[value] === undefined) {
        facetValues[value] = 0;
      }
    });
    const sidebarFacetDisplayLimit = excFacets[facetKey]?.displayFacetsLimit
      || TAGS_FACET_DISPLAY_LIMIT;
    // Re-render only the checkbox list content
    checkboxList.innerHTML = renderFacetValues(
      facetKey,
      facetValues,
      checkedValues,
      excFacets,
      sidebarFacetDisplayLimit,
    );
  }

  // Re-bind checkbox events — hierarchy parents cascade to descendants
  const checkboxes = checkboxList.querySelectorAll('.facet-filter-checkbox-input');
  checkboxes.forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      const { facetKey: key, facetValue } = checkbox.dataset;

      if (isFacetHierarchyParentCheckbox(checkbox)) {
        const currentState = getState();
        const newChecked = buildFacetMapAfterHierarchyParentToggle(
          key,
          facetValue,
          checkbox.checked,
          currentState.excFacets || {},
          checkbox,
          currentState.facetCheckedState[key] || {},
        );
        setState({
          facetCheckedState: {
            ...currentState.facetCheckedState,
            [key]: newChecked,
          },
        });
      } else {
        callbacks.onFacetCheckbox(key, facetValue, checkbox.checked);
      }
    });
  });
}

/**
 * Toggle a hierarchy item's expanded state (DOM-only, no re-render)
 * @param {string} hierarchyKey - The hierarchy item key
 * @param {string} facetTechId - The facet technical ID
 * @param {string} fullPath - The full path of the item
 */
function toggleHierarchyItem(hierarchyKey, facetTechId, fullPath) {
  // User toggle takes precedence over auto-expand
  const isCurrentlyExpanded = expandedHierarchyItems[hierarchyKey] !== undefined
    ? expandedHierarchyItems[hierarchyKey]
    : autoExpandedHierarchyItems[hierarchyKey];

  // Toggle the current item (user override takes precedence)
  expandedHierarchyItems[hierarchyKey] = !isCurrentlyExpanded;

  // If collapsing, recursively collapse all descendants (matches React behavior)
  if (isCurrentlyExpanded) {
    Object.keys(expandedHierarchyItems).forEach((key) => {
      if (key.startsWith(`${facetTechId}-${fullPath} / `)) {
        expandedHierarchyItems[key] = false;
      }
    });
  }

  // Toggle DOM directly without full re-render
  const toggle = containerElement?.querySelector(`[data-toggle-hierarchy="${hierarchyKey}"]`);
  if (toggle) {
    // Toggle arrow icon on the caret element specifically
    const container = toggle.closest('.facet-hierarchy-container');
    const caret = container?.querySelector(`.caret-icon[data-toggle-hierarchy="${hierarchyKey}"]`);
    if (caret) {
      caret.classList.toggle('expanded');
    }

    // Find parent container and toggle children wrapper visibility
    if (container) {
      const childrenWrapper = container.querySelector(':scope > .hierarchy-children');
      if (childrenWrapper) {
        childrenWrapper.style.display = isCurrentlyExpanded ? 'none' : '';
      }
    }
  }
}

/**
 * Bind hierarchy toggle events for a checkbox list
 * @param {HTMLElement} checkboxList - The checkbox list container
 */
function bindHierarchyToggleEvents(checkboxList) {
  const hierarchyToggles = checkboxList.querySelectorAll('[data-toggle-hierarchy]');
  hierarchyToggles.forEach((toggle) => {
    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const hierarchyKey = toggle.dataset.toggleHierarchy;
      const { facetTechId } = toggle.dataset;
      const { fullPath } = toggle.dataset;
      toggleHierarchyItem(hierarchyKey, facetTechId, fullPath);
    });
  });
}

async function bindEvents(callbacks) {
  const { onFacetCheckbox, onClearAllFacets } = callbacks;

  // Clear all button
  const clearAllBtn = containerElement.querySelector('#clear-all-btn');
  clearAllBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    Object.keys(expandedHierarchyItems).forEach((key) => {
      delete expandedHierarchyItems[key];
    });
    Object.keys(searchMode).forEach((key) => {
      delete searchMode[key];
    });
    Object.keys(searchTerms).forEach((key) => {
      delete searchTerms[key];
    });
    // Call parent's clear all handler
    onClearAllFacets?.();
  });

  // Facet toggle buttons
  const toggleButtons = containerElement.querySelectorAll('.facet-filter-button[data-toggle]');
  toggleButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.toggle;
      const state = getState();
      const wasExpanded = state.expandedFacets[key] === true;
      const newExpandedFacets = {
        ...state.expandedFacets,
        // Toggle: if true -> false, if false/undefined -> true
        [key]: !wasExpanded,
      };
      // If collapsing, close search mode and clear search terms (matches React)
      if (wasExpanded) {
        searchMode[key] = false;
        delete searchTerms[key];
      }
      setState({ expandedFacets: newExpandedFacets });
    });
  });

  // Top-level arrow in search mode (for collapsing from search mode)
  const topLevelArrows = containerElement.querySelectorAll('.facet-filter-arrow-top-level[data-toggle]');
  topLevelArrows.forEach((arrow) => {
    arrow.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = arrow.dataset.toggle;
      const state = getState();
      const wasExpanded = state.expandedFacets[key] === true;
      const newExpandedFacets = {
        ...state.expandedFacets,
        [key]: !wasExpanded,
      };
      // If collapsing, close search mode and clear search terms (matches React)
      if (wasExpanded) {
        searchMode[key] = false;
        delete searchTerms[key];
      }
      setState({ expandedFacets: newExpandedFacets });
    });
  });

  // "Show all" buttons for tags facets - open modal
  const showAllBtns = containerElement.querySelectorAll('.facet-show-all-btn');
  showAllBtns.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = btn.dataset.facetKey;
      openFacetModal(key, callbacks);
    });
  });

  // Hierarchy item toggle (sub-level expand/collapse)
  // Uses the shared toggleHierarchyItem function
  const hierarchyToggles = containerElement.querySelectorAll('[data-toggle-hierarchy]');
  hierarchyToggles.forEach((toggle) => {
    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const hierarchyKey = toggle.dataset.toggleHierarchy;
      const { facetTechId } = toggle.dataset;
      const { fullPath } = toggle.dataset;
      toggleHierarchyItem(hierarchyKey, facetTechId, fullPath);
    });
  });

  // Facet checkboxes — hierarchy parents cascade to all descendants
  const checkboxes = containerElement.querySelectorAll('input[data-facet-key]');
  checkboxes.forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      const key = checkbox.dataset.facetKey;
      const value = checkbox.dataset.facetValue;

      if (isFacetHierarchyParentCheckbox(checkbox)) {
        const currentState = getState();
        const newChecked = buildFacetMapAfterHierarchyParentToggle(
          key,
          value,
          checkbox.checked,
          currentState.excFacets || {},
          checkbox,
          currentState.facetCheckedState[key] || {},
        );
        setState({
          facetCheckedState: {
            ...currentState.facetCheckedState,
            [key]: newChecked,
          },
        });
      } else {
        onFacetCheckbox?.(key, value);
      }
    });
  });

  // Facet search trigger icons
  // When "Show all" exists for this facet, open the modal (with search focused)
  // instead of switching to inline search mode.
  const searchTriggers = containerElement.querySelectorAll('.facet-search-trigger');
  searchTriggers.forEach((trigger) => {
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const facetKey = trigger.dataset.facet;
      if (trigger.dataset.hasShowAll === 'true') {
        openFacetModal(facetKey, callbacks);
      } else {
        searchMode[facetKey] = !searchMode[facetKey];
        if (!searchMode[facetKey]) {
          delete searchTerms[facetKey];
        }
        render(callbacks);
      }
    });
  });

  // Facet search inputs
  const searchInputs = containerElement.querySelectorAll('.facet-search-input');
  searchInputs.forEach((input) => {
    // Stop click propagation to prevent facet toggle (matches React)
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('input', (e) => {
      const facetKey = input.dataset.facet;
      searchTerms[facetKey] = e.target.value;
      // Instead of full re-render, just update the checkbox list for this facet
      // This prevents losing focus/cursor position in the input
      updateFacetCheckboxList(facetKey, callbacks);
    });
    // Handle Escape key to close search (matches React's handleFacetSearchEscape)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const facetKey = input.dataset.facet;
        searchMode[facetKey] = false;
        delete searchTerms[facetKey];
        render(callbacks);
      }
    });
  });

  // Search close icons - toggle search mode off (matches React's onToggleSearch)
  const closeIcons = containerElement.querySelectorAll('.facet-search-close-icon');
  closeIcons.forEach((icon) => {
    icon.addEventListener('click', (e) => {
      e.stopPropagation();
      const facetKey = icon.dataset.facet;
      // Exit search mode and clear search term (matches React)
      searchMode[facetKey] = false;
      delete searchTerms[facetKey];
      render(callbacks);
    });
  });

  // Initialize date pickers for all date facets
  await initializeDateFacetPickers();
}

/**
 * Initialize date pickers for all date type facets
 */
async function initializeDateFacetPickers() {
  const dateFacetKeys = getDateFacets();
  const state = getState();
  const { selectedNumericFilters } = state;

  // Use for...of to properly await async createDatePicker calls
  for (const facetKey of dateFacetKeys) {
    // Use attribute selector to handle colons in IDs (e.g., repo:modifyDate)
    const startContainer = containerElement.querySelector(`[id="${facetKey}-start-date"]`);
    const endContainer = containerElement.querySelector(`[id="${facetKey}-end-date"]`);

    // Check if container needs initialization AND is not already being initialized
    // The 'data-initializing' attribute prevents race conditions when multiple renders happen
    const needsStartInit = startContainer
      && !startContainer.hasChildNodes()
      && !startContainer.hasAttribute('data-initializing');
    const needsEndInit = endContainer
      && !endContainer.hasChildNodes()
      && !endContainer.hasAttribute('data-initializing');

    if (!needsStartInit && !needsEndInit) continue;

    // Mark containers as initializing BEFORE async operations to prevent duplicate initialization
    if (needsStartInit) startContainer.setAttribute('data-initializing', 'true');
    if (needsEndInit) endContainer.setAttribute('data-initializing', 'true');

    // Parse existing numeric filters to get current date values for this facet
    let currentStartDate = null;
    let currentEndDate = null;
    selectedNumericFilters.forEach((filter) => {
      if (filter.startsWith(`${facetKey} >=`)) {
        const timestamp = parseFloat(filter.split('>=')[1].trim()) * 1000;
        currentStartDate = new Date(timestamp);
      } else if (filter.startsWith(`${facetKey} <=`)) {
        const timestamp = parseFloat(filter.split('<=')[1].trim()) * 1000;
        currentEndDate = new Date(timestamp);
      }
    });

    // Helper function to update numeric filters for this date facet
    const updateDateRangeFilters = (startDate, endDate) => {
      const currentState = getState();
      // Remove existing filters for this facet
      const otherFilters = (currentState.selectedNumericFilters || []).filter(
        (f) => !f.startsWith(facetKey),
      );
      // Add new date range filters
      const newFilters = [...otherFilters];
      if (startDate) {
        // Set start date to beginning of day (00:00:00) in local time
        const startOfDay = new Date(startDate);
        startOfDay.setHours(0, 0, 0, 0);
        newFilters.push(`${facetKey} >= ${Math.floor(startOfDay.getTime() / 1000)}`);
      }
      if (endDate) {
        // Set end date to end of day (23:59:59) in local time
        const endOfDay = new Date(endDate);
        endOfDay.setHours(23, 59, 59, 999);
        newFilters.push(`${facetKey} <= ${Math.floor(endOfDay.getTime() / 1000)}`);
      }
      setState({ selectedNumericFilters: newFilters });
    };

    // Store date values in closure for cross-picker access
    let storedStartDate = currentStartDate;
    let storedEndDate = currentEndDate;

    // Store picker references for cross-picker constraint updates
    let startPickerRef = null;
    let endPickerRef = null;

    // Create start date picker (From) with maxValue constraint to prevent selecting after end date
    if (needsStartInit) {
      // eslint-disable-next-line no-await-in-loop
      const startPicker = await createDatePicker({
        label: 'From',
        ariaLabel: 'From date',
        value: currentStartDate,
        showClearButton: !!currentStartDate,
        maxValue: currentEndDate,
        onChange: (date) => {
          storedStartDate = date;
          if (endPickerRef?.setMinValue) {
            endPickerRef.setMinValue(date);
          }
          updateDateRangeFilters(storedStartDate, storedEndDate);
        },
        onClear: () => {
          storedStartDate = null;
          if (endPickerRef?.setMinValue) {
            endPickerRef.setMinValue(null);
          }
          updateDateRangeFilters(storedStartDate, storedEndDate);
        },
      });
      startPickerRef = startPicker;
      // Only append if container is still in DOM and hasn't been re-rendered
      // (check if it's still the same element we marked as initializing)
      if (startContainer.isConnected && startContainer.hasAttribute('data-initializing')) {
        startContainer.removeAttribute('data-initializing');
        startContainer.appendChild(startPicker);
      }
    }

    // Create end date picker (To) with minValue constraint to prevent selecting before start date
    if (needsEndInit) {
      // eslint-disable-next-line no-await-in-loop
      const endPicker = await createDatePicker({
        label: 'To',
        ariaLabel: 'To date',
        value: currentEndDate,
        showClearButton: !!currentEndDate,
        minValue: currentStartDate,
        onChange: (date) => {
          storedEndDate = date;
          if (startPickerRef?.setMaxValue) {
            startPickerRef.setMaxValue(date);
          }
          updateDateRangeFilters(storedStartDate, storedEndDate);
        },
        onClear: () => {
          storedEndDate = null;
          if (startPickerRef?.setMaxValue) {
            startPickerRef.setMaxValue(null);
          }
          updateDateRangeFilters(storedStartDate, storedEndDate);
        },
      });
      endPickerRef = endPicker;
      // Only append if container is still in DOM and hasn't been re-rendered
      if (endContainer.isConnected && endContainer.hasAttribute('data-initializing')) {
        endContainer.removeAttribute('data-initializing');
        endContainer.appendChild(endPicker);
      }
    }
  }
}
