/* eslint-disable import/no-cycle, import/prefer-default-export, no-use-before-define */
/**
 * Image Gallery Component - Displays search results in grid or list view
 */

import { getState, setState, subscribe } from '../search-results.js';
import cart from '../../../scripts/utils/cart-service.js';
import { createAssetCard } from './asset-card.js';
import { createSearchPanel } from './search-panel.js';
import { updateDropdownSelection } from './action-dropdown.js';
import { createAssetPreview, closeAssetPreview } from './asset-preview.js';
import { createAssetDetails, closeAssetDetails } from './asset-details/index.js';
import {
  pushModalState,
  handleModalClose,
  getUrlWithoutAssetId,
} from '../../../scripts/modal-utils.js';
import { buildAssetDetailsUrl } from '../../../scripts/asset-id-utils.js';
import showToast from '../../../scripts/toast/toast.js';
import { getAppLabel } from '../../../scripts/locale-utils.js';
import { getSearchPlaceholders, ph } from '../utils/placeholders.js';

let popstateHandler = null;
let escapeHandler = null;
let cartSyncCleanup = null;

function replaceMarkedTextWithLinks(message, hrefs = []) {
  const markerRegex = /(?:<<|{{)(.*?)(?:>>|}})/g;
  let markerIndex = 0;
  return String(message || '').replace(markerRegex, (fullMatch, label) => {
    const href = hrefs[markerIndex];
    markerIndex += 1;
    if (!href) return label;

    const anchorHref = href.startsWith('mailto:') ? href : `${href}`;
    const rel = href.startsWith('mailto:') ? '' : ' rel="noopener noreferrer"';
    const target = href.startsWith('mailto:') ? '' : ' target="_blank"';
    return `<a href="${anchorHref}"${target}${rel}>${label}</a>`;
  });
}

/**
 * Create the image gallery
 * @param {HTMLElement} container - Container element
 * @param {Object} callbacks - Callback functions
 */
export async function createImageGallery(container, callbacks) {
  const {
    onLoadMoreResults,
    onFacetCheckbox,
    onClearAllFacets,
    fetchAssetRenditions,
    onAddToCart,
    onRemoveFromCart,
    onBulkAddToCart,
  } = callbacks;

  // Load placeholders for localization
  const placeholders = await getSearchPlaceholders();
  const t = await getAppLabel();
  const viewLargerImageLabel = t('viewLargerImage', 'Preview');
  const downloadLabel = ph(placeholders, 'download', 'Download');

  let selectedCards = new Set();
  let previousImageCount = 0; // Track image count for Load More optimization

  /**
   * Notify listeners (e.g. search-bar's generate-mode) that the selection changed.
   * Decouples image-gallery from search-bar — same CustomEvent-on-window pattern
   * already used for handleBulkShare/handleBulkAddToCollection below.
   */
  function dispatchAssetSelectionChanged() {
    const state = getState();
    const visibleImages = state.dmImages;
    const selectedAssets = visibleImages.filter((img) => selectedCards.has(img.assetId || ''));
    window.dispatchEvent(new CustomEvent('assetSelectionChanged', {
      detail: { selectedAssets },
    }));
  }

  /**
   * Update only the selection count in search panel without re-rendering the entire panel
   */
  function updateSelectionUI() {
    const state = getState();
    const { dmImages } = state;

    const visibleImages = dmImages;

    const displayedCount = visibleImages.length;
    const selectedCount = selectedCards.size;

    // Update only the selection count text (not the entire panel)
    const selectAllLabel = container.querySelector('.select-all span');
    if (selectAllLabel) {
      selectAllLabel.innerHTML = `Select All ${selectedCount > 0 ? `<span class="dropdown-count">(${selectedCount})</span>` : ''}`;
    }

    // Update select-all checkbox state
    const selectAllCheckbox = container.querySelector('#select-all');
    if (selectAllCheckbox) {
      selectAllCheckbox.checked = selectedCount > 0 && selectedCount === displayedCount;
    }

    // Update actions dropdown visibility and reset label when no selection
    const actionsDropdown = container.querySelector('.BulkActions');
    if (actionsDropdown) {
      if (selectedCount > 0) {
        actionsDropdown.classList.remove('hidden');
      } else {
        actionsDropdown.classList.add('hidden');
        // Reset dropdown to initial "Actions" label
        updateDropdownSelection(actionsDropdown, ph(placeholders, 'actions', 'Actions'));
      }
    }

    dispatchAssetSelectionChanged();
  }

  // Build gallery structure
  function render() {
    const state = getState();
    const {
      dmImages, loading, searchResults, viewType, expandAllDetails,
      cartAssetItems,
    } = state;
    const isLoading = loading.dmImages;

    const visibleImages = dmImages;

    const nbHits = searchResults?.[0]?.nbHits ?? 0;
    const totalCount = nbHits >= 10000 ? '10000+' : String(nbHits);
    const displayedCount = visibleImages.length;
    const selectedCount = selectedCards.size;
    const hasMorePages = state.currentPage + 1 < state.totalPages;
    const searchGuideUrl = ph(placeholders, 'assetSearchGuideUrl', '/en/training-resources');
    const trainingResourcesPageUrl = ph(placeholders, 'trainingResourcesPageUrl', '/en/training-resources');
    const assetManagementEmail = 'assetmanagers@example.com';
    const noResultsMessage1 = ph(placeholders, 'noResultsMessage1', 'Not getting any results from your search? Review our Asset Search Guide for best practices and search tips.');
    const noResultsMessage2 = ph(placeholders, 'noResultsMessage2', 'Still not finding what you need? Reach out to our Asset Management Team. Our team can help you find the right content for your next project.');
    const noResultsMessage1Html = replaceMarkedTextWithLinks(noResultsMessage1, [
      searchGuideUrl,
      trainingResourcesPageUrl,
    ]);
    const noResultsMessage2Html = replaceMarkedTextWithLinks(noResultsMessage2, [
      assetManagementEmail ? `mailto:${assetManagementEmail}` : '',
    ]);

    container.innerHTML = `
      <div id="search-panel-container"></div>
      
      <div class="image-grid-wrapper">
        ${isLoading && visibleImages.length === 0 ? `
          <div class="skeleton-grid" role="status" aria-label="Loading assets" aria-live="polite">
            ${Array.from({ length: 8 }, () => `
              <div class="skeleton-card" aria-hidden="true">
                <div class="skeleton-card-image"></div>
                <div class="skeleton-card-body">
                  <div class="skeleton-line skeleton-line-medium"></div>
                  <div class="skeleton-line skeleton-line-short"></div>
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}
        ${isLoading && visibleImages.length > 0 ? '<div class="search-overlay"></div>' : ''}
        ${visibleImages.length === 0 && !isLoading ? `
          <div class="no-images">
            <p>${noResultsMessage1Html}</p>
            <p>${noResultsMessage2Html}</p>
          </div>
        ` : ''}
        ${visibleImages.length > 0 ? `
          <div class="${viewType === 'grid' ? 'image-grid' : 'image-grid-list'}"
               id="assets-grid">
            <!-- Asset cards will be rendered here -->
          </div>
          ${state.isLoadingMore ? `
            <div class="loading-more-container">
              <div class="loading-spinner loading-spinner-sm" role="status" aria-label="Loading"></div>
            </div>
          ` : ''}
          ${!state.isLoadingMore && hasMorePages ? `
            <div class="load-more-button-container">
              <button class="load-more-button" id="load-more-btn">${ph(placeholders, 'loadMore', 'Load more')}</button>
            </div>
          ` : ''}
        ` : ''}
      </div>
    `;

    // Render search panel
    const searchPanelContainer = container.querySelector('#search-panel-container');
    if (searchPanelContainer) {
      createSearchPanel(searchPanelContainer, {
        totalCount,
        selectedCount,
        displayedCount,
        onSelectAll: handleSelectAll,
        onToggleMobileFilter: handleToggleMobileFilter,
        onBulkShare: handleBulkShare,
        onBulkAddToCollection: handleBulkAddToCollection,
        onBulkAddToCart: () => {
          onBulkAddToCart(selectedCards, getState().dmImages);
          selectedCards = new Set();
          clearAllCheckboxes();
          updateSelectionUI();
        },
        onShareSearch: handleShareSearch,
      });
    }

    // Render asset cards
    const assetsGrid = container.querySelector('#assets-grid');
    // Localized labels for asset cards
    const addToCartLabel = ph(placeholders, 'addToCart', 'Add To Cart');
    const removeFromCartLabel = ph(placeholders, 'removeFromCart', 'Remove From Cart');
    const sizeLabel = ph(placeholders, 'size', 'SIZE');
    const typeLabel = ph(placeholders, 'type', 'TYPE');
    const fileExtLabel = ph(placeholders, 'fileExtension', 'FILE EXT');

    if (assetsGrid && visibleImages.length > 0) {
      visibleImages.forEach((image, index) => {
        const cardElement = createAssetCard({
          image,
          viewMode: viewType,
          isSelected: selectedCards.has(image.assetId),
          expandAllDetails,
          index,
          sizeLabel,
          typeLabel,
          fileExtLabel,
          viewLargerImageLabel,
          downloadLabel,
          addToCartLabel,
          removeFromCartLabel,
          cartAssetItems,
          onAddToCart,
          onRemoveFromCart,
          onCardDetailClick: handleCardDetailClick,
          onPreviewClick: handlePreviewClick,
          onCheckboxChange: handleCheckboxChange,
          onFacetCheckbox,
          onClearAllFacets,
          fetchAssetRenditions,
        });
        assetsGrid.appendChild(cardElement);
      });
    }

    // Bind event listeners
    bindEvents();
  }

  function bindEvents() {
    // Load more button
    const loadMoreBtn = container.querySelector('#load-more-btn');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', onLoadMoreResults);
    }
  }

  /**
   * Append only new images to the grid (optimization for Load More)
   * @param {Array} newImages - New images to append
   */
  function appendNewImages(newImages) {
    const state = getState();
    const {
      viewType,
      expandAllDetails,
      cartAssetItems,
    } = state;

    const assetsGrid = container.querySelector('#assets-grid');
    if (!assetsGrid || newImages.length === 0) return;

    const currentCount = assetsGrid.children.length;

    newImages.forEach((image, index) => {
      const cardElement = createAssetCard({
        image,
        viewMode: viewType,
        isSelected: selectedCards.has(image.assetId),
        expandAllDetails,
        index: currentCount + index,
        sizeLabel: ph(placeholders, 'size', 'SIZE'),
        typeLabel: ph(placeholders, 'type', 'TYPE'),
        fileExtLabel: ph(placeholders, 'fileExtension', 'FILE EXT'),
        viewLargerImageLabel,
        downloadLabel,
        addToCartLabel: ph(placeholders, 'addToCart', 'Add To Cart'),
        removeFromCartLabel: ph(placeholders, 'removeFromCart', 'Remove From Cart'),
        cartAssetItems,
        onAddToCart,
        onRemoveFromCart,
        onCardDetailClick: handleCardDetailClick,
        onPreviewClick: handlePreviewClick,
        onCheckboxChange: handleCheckboxChange,
        onFacetCheckbox,
        onClearAllFacets,
        fetchAssetRenditions,
      });
      assetsGrid.appendChild(cardElement);
    });

    // Total count doesn't change during load more, no need to update search panel

    updateLoadMoreSection();
  }

  /**
   * Update the load more section without full re-render
   */
  function updateLoadMoreSection() {
    const state = getState();
    const hasMorePages = state.currentPage + 1 < state.totalPages;

    const existingLoadMore = container.querySelector('.load-more-button-container');
    const existingLoadingMore = container.querySelector('.loading-more-container');
    if (existingLoadMore) existingLoadMore.remove();
    if (existingLoadingMore) existingLoadingMore.remove();

    const gridWrapper = container.querySelector('.image-grid-wrapper');
    if (!gridWrapper) return;

    if (state.isLoadingMore) {
      const loadingDiv = document.createElement('div');
      loadingDiv.className = 'loading-more-container';
      loadingDiv.innerHTML = '<div class="loading-spinner loading-spinner-sm" role="status" aria-label="Loading"></div>';
      gridWrapper.appendChild(loadingDiv);
    } else if (hasMorePages) {
      const loadMoreDiv = document.createElement('div');
      loadMoreDiv.className = 'load-more-button-container';
      loadMoreDiv.innerHTML = '<button class="load-more-button" id="load-more-btn">Load more</button>';
      gridWrapper.appendChild(loadMoreDiv);

      const loadMoreBtn = loadMoreDiv.querySelector('#load-more-btn');
      if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', onLoadMoreResults);
      }
    }
  }

  /**
   * Update search overlay without full re-render
   */
  function updateSearchOverlay(isLoading) {
    const gridWrapper = container.querySelector('.image-grid-wrapper');
    if (!gridWrapper) return;

    const existingOverlay = gridWrapper.querySelector('.search-overlay');

    if (isLoading && !existingOverlay) {
      const overlay = document.createElement('div');
      overlay.className = 'search-overlay';
      gridWrapper.appendChild(overlay);
    } else if (!isLoading && existingOverlay) {
      existingOverlay.remove();
    }
  }

  /**
   * Toggle details visibility on all cards without re-render
   */
  function updateExpandAllDetails(expanded) {
    const assetsGrid = container.querySelector('#assets-grid');
    if (!assetsGrid) return;

    const metaGrids = assetsGrid.querySelectorAll('.product-meta-grid');
    metaGrids.forEach((grid) => {
      if (expanded) {
        grid.classList.remove('hidden');
      } else {
        grid.classList.add('hidden');
      }
    });
  }

  function handleSelectAll(isChecked) {
    const state = getState();
    const visibleImages = state.dmImages;

    if (isChecked) {
      selectedCards = new Set(visibleImages.map((img) => img.assetId || ''));
    } else {
      selectedCards = new Set();
    }

    // Update all checkboxes in the grid without re-rendering images
    const assetsGrid = container.querySelector('#assets-grid');
    if (assetsGrid) {
      const checkboxes = assetsGrid.querySelectorAll('.search-results-checkbox');
      checkboxes.forEach((checkbox) => {
        const card = checkbox.closest('.asset-card-view-grid, .asset-card-view-list');
        if (card) {
          checkbox.checked = selectedCards.has(card.id);
        }
      });
    }

    updateSelectionUI();
  }

  function handleCheckboxChange(imageId, isChecked) {
    if (isChecked) {
      selectedCards.add(imageId);
    } else {
      selectedCards.delete(imageId);
    }
    // Only update selection UI, not re-render the entire gallery with images
    updateSelectionUI();
  }

  function handleToggleMobileFilter() {
    const state = getState();
    setState({ isMobileFilterOpen: !state.isMobileFilterOpen });
  }

  function handleCardDetailClick(image, event) {
    if (event && event.stopPropagation) event.stopPropagation();
    setState({ selectedCard: image, showDetailsModal: true });

    // Build URL with asset ID for deep linking
    const assetId = image.assetId || image.id || '';
    const detailUrl = assetId ? buildAssetDetailsUrl(assetId, image?.name) : undefined;
    pushModalState('assetDetailsModal', detailUrl);

    createAssetDetails({
      asset: image,
      onClose: () => handleCloseDetailsModal(false),
      fetchAssetRenditions,
    });
  }

  function handlePreviewClick(image, event) {
    if (event && event.stopPropagation) event.stopPropagation();
    setState({ selectedCard: image, showPreviewModal: true });
    pushModalState('assetPreviewModal');

    createAssetPreview({
      asset: image,
      onClose: () => handleClosePreviewModal(false),
      fetchAssetRenditions,
      downloadLabel,
    });
  }

  function handleCloseDetailsModal(isPopState = false) {
    // Get URL without assetId to restore clean URL
    const cleanUrl = getUrlWithoutAssetId();

    handleModalClose({
      historyKey: 'assetDetailsModal',
      closeFn: closeAssetDetails,
      isPopState,
      onClose: () => setState({ selectedCard: null, showDetailsModal: false, deepLinkAsset: null }),
      restoreUrl: cleanUrl,
    });
  }

  function handleClosePreviewModal(isPopState = false) {
    handleModalClose({
      historyKey: 'assetPreviewModal',
      closeFn: closeAssetPreview,
      isPopState,
      onClose: () => setState({ selectedCard: null, showPreviewModal: false }),
    });
  }

  function handleBulkShare() {
    const state = getState();
    const visibleImages = state.dmImages;
    const selectedAssets = visibleImages.filter(
      (img) => selectedCards.has(img.assetId || ''),
    );

    if (selectedAssets.length === 0) return;

    window.dispatchEvent(new CustomEvent('openShareModal', {
      detail: { assets: selectedAssets },
    }));

    selectedCards = new Set();
    clearAllCheckboxes();
    updateSelectionUI();
  }

  function handleBulkAddToCollection() {
    const state = getState();
    const visibleImages = state.dmImages;
    const selectedAssets = visibleImages.filter(
      (img) => selectedCards.has(img.assetId || ''),
    );

    if (selectedAssets.length === 0) return;

    window.dispatchEvent(new CustomEvent('openCollectionModal', {
      detail: { assets: selectedAssets },
    }));

    selectedCards = new Set();
    clearAllCheckboxes();
    updateSelectionUI();
  }

  /**
   * Clear all checkboxes in the grid without re-rendering
   */
  function clearAllCheckboxes() {
    const assetsGrid = container.querySelector('#assets-grid');
    if (assetsGrid) {
      const checkboxes = assetsGrid.querySelectorAll('.search-results-checkbox');
      checkboxes.forEach((checkbox) => {
        checkbox.checked = false;
      });
    }
  }

  function handleShareSearch() {
    const state = getState();
    const {
      query, facetCheckedState, selectedNumericFilters,
    } = state;

    // Use current pathname for searchType
    const currentPath = window.location.pathname;
    let searchType = currentPath;
    if (!currentPath.includes('/search/')) {
      searchType = '/search/all';
    }

    const searchUrl = new URL(window.location.origin + searchType);

    // Use 'query' param (not 'fulltext')
    if (query) searchUrl.searchParams.set('query', query);

    // Facet filters
    if (Object.keys(facetCheckedState).length > 0) {
      searchUrl.searchParams.set('facetFilters', encodeURIComponent(JSON.stringify(facetCheckedState)));
    }

    // Numeric filters
    if (selectedNumericFilters.length > 0) {
      searchUrl.searchParams.set('numericFilters', encodeURIComponent(JSON.stringify(selectedNumericFilters)));
    }

    const toastMsg = ph(placeholders, 'searchLinkCopiedToClipboard', 'SEARCH LINK COPIED TO CLIPBOARD');
    navigator.clipboard.writeText(searchUrl.toString()).then(() => {
      showToast(toastMsg, 'success');
    }).catch(() => {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = searchUrl.toString();
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      showToast(toastMsg, 'success');
    });
  }

  // Initial render
  render();
  previousImageCount = getState().dmImages.length;

  if (cartSyncCleanup) {
    cartSyncCleanup();
    cartSyncCleanup = null;
  }

  cartSyncCleanup = cart.syncButtons({
    selector: '.add-to-cart-btn',
    getAssetIds: (btn) => {
      const cardEl = btn.closest('.asset-card-view-grid, .asset-card-view-list');
      return cardEl ? [cardEl.id] : [];
    },
    labels: {
      add: ph(placeholders, 'addToCart', 'Add To Cart'),
      remove: ph(placeholders, 'removeFromCart', 'Remove From Cart'),
    },
  });

  // Subscribe to state changes
  subscribe((currentState, prevState, updates) => {
    if (updates.cartAssetItems !== undefined && Object.keys(updates).length === 1) {
      return;
    }

    // Handle "Load More" starting - currentPage incremented, skip render
    if (updates.currentPage !== undefined && !updates.dmImages && !updates.loading) {
      return;
    }

    // Handle loading state change - just show/hide overlay without full re-render
    // Only use overlay if there are existing images; otherwise do full re-render for spinner
    // Skip if isLoadingMore is also being updated (let load more flow handle it)
    if (updates.loading !== undefined && updates.dmImages === undefined
        && updates.isLoadingMore === undefined && currentState.dmImages.length > 0) {
      updateSearchOverlay(currentState.loading.dmImages);
      return;
    }

    // Handle isLoadingMore becoming true - just show loading state, don't re-render images
    if (updates.isLoadingMore === true && !updates.dmImages) {
      updateLoadMoreSection();
      return;
    }

    // Handle "Load More" - append only new images (dmImages updated while isLoadingMore was true)
    if (updates.dmImages !== undefined && prevState.isLoadingMore === true) {
      if (currentState.dmImages.length > previousImageCount) {
        const newImages = currentState.dmImages.slice(previousImageCount);
        appendNewImages(newImages);
        previousImageCount = currentState.dmImages.length;
      }
      return;
    }

    // Skip re-render for pagination updates when in load more flow
    if (currentState.isLoadingMore === true) {
      if (updates.searchResults !== undefined
          || updates.totalPages !== undefined
          || updates.contentAICursor !== undefined) {
        return;
      }
    }

    // After load more completes, skip re-render for the final state cleanup
    if (updates.isLoadingMore === false && prevState.isLoadingMore === true && !updates.dmImages) {
      updateLoadMoreSection();
      return;
    }

    // Handle expandAllDetails change without full re-render
    if (updates.expandAllDetails !== undefined && !updates.dmImages) {
      updateExpandAllDetails(currentState.expandAllDetails);
      return;
    }

    // Skip re-render for sort changes - the search will trigger re-render when results come back
    if ((updates.selectedSortType !== undefined || updates.selectedSortDirection !== undefined)
        && !updates.dmImages && !updates.loading) {
      return;
    }

    // Re-render on relevant state changes
    if (updates.dmImages !== undefined
        || updates.loading !== undefined
        || updates.searchResults !== undefined
        || updates.viewType !== undefined
        || updates.isLoadingMore !== undefined
        || updates.currentPage !== undefined
        || updates.totalPages !== undefined) {
      // Reset selection when new search results come in (not load more)
      if (updates.dmImages !== undefined && !prevState.isLoadingMore) {
        selectedCards = new Set();
      }
      render();
      previousImageCount = currentState.dmImages.length;

      if (updates.viewType !== undefined) {
        if (cartSyncCleanup) cartSyncCleanup();
        cartSyncCleanup = cart.syncButtons({
          selector: '.add-to-cart-btn',
          getAssetIds: (btn) => {
            const cardEl = btn.closest('.asset-card-view-grid, .asset-card-view-list');
            return cardEl ? [cardEl.id] : [];
          },
          labels: {
            add: ph(placeholders, 'addToCart', 'Add To Cart'),
            remove: ph(placeholders, 'removeFromCart', 'Remove From Cart'),
          },
        });
      }
    }

    // Handle deep link asset
    if (updates.deepLinkAsset !== undefined && currentState.deepLinkAsset) {
      handleCardDetailClick(currentState.deepLinkAsset, { stopPropagation: () => {} });
    }
  });

  // Handle escape key for modals
  if (escapeHandler) {
    document.removeEventListener('keydown', escapeHandler);
  }

  escapeHandler = (event) => {
    if (event.key === 'Escape') {
      const state = getState();
      if (state.showDetailsModal) {
        handleCloseDetailsModal(false);
      } else if (state.showPreviewModal) {
        handleClosePreviewModal(false);
      }
    }
  };
  document.addEventListener('keydown', escapeHandler);

  // Handle browser back button
  if (popstateHandler) {
    window.removeEventListener('popstate', popstateHandler);
  }

  popstateHandler = () => {
    const state = getState();
    if (state.showDetailsModal) {
      handleCloseDetailsModal(true);
    } else if (state.showPreviewModal) {
      handleClosePreviewModal(true);
    }
  };
  window.addEventListener('popstate', popstateHandler);
}
