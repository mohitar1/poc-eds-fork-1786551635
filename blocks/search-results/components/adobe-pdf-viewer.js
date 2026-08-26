/* eslint-disable import/prefer-default-export, no-use-before-define */
/**
 * Adobe PDF Viewer Component - Pure JS implementation
 * Uses Adobe PDF Embed API (DC View SDK)
 * Converted from React AdobePDFViewer.tsx
 */

// Module state
let adobeDCViewInstance = null;

// Adobe PDF Embed API – one client ID per allowed domain.
// NOTE: Adobe PDF Embed client IDs are domain-locked. Register a client ID for the
// Spark production host at https://developer.adobe.com/document-services/apis/pdf-embed/
// and replace the placeholder below before PDF preview works on production.
const CLIENT_IDS = {
  localhost: '5b30e43dabf0482480341b9395596694',
  'frescopamedia.com': 'REPLACE_WITH_FRESCOPA_PDF_EMBED_CLIENT_ID',
};

/**
 * Resolve the Adobe PDF Embed API client ID for the current host.
 * @returns {string}
 */
function getAdobeClientId() {
  const { hostname } = window.location;
  if (hostname === 'localhost') return CLIENT_IDS.localhost;
  const domain = Object.keys(CLIENT_IDS).find(
    (d) => d !== 'localhost' && (hostname === d || hostname.endsWith(`.${d}`)),
  );
  return domain ? CLIENT_IDS[domain] : CLIENT_IDS.localhost;
}

// Cached promise so concurrent callers share the same Adobe SDK load cycle.
let adobePdfScriptPromise = null;

/**
 * Load Adobe PDF Embed API script.
 * Returns a cached promise so concurrent callers share the same load cycle.
 * @returns {Promise<void>} Resolves when window.AdobeDC is available
 */
async function loadAdobePdfScript() {
  if (adobePdfScriptPromise) return adobePdfScriptPromise;

  adobePdfScriptPromise = new Promise((resolve, reject) => {
    if (window.AdobeDC) {
      resolve();
      return;
    }

    /**
     * Poll for window.AdobeDC with a timeout.
     * @param {number} timeoutMs - Maximum time to wait
     */
    function waitForAdobeDC(timeoutMs) {
      let settled = false;
      const checkReady = setInterval(() => {
        if (window.AdobeDC && !settled) {
          settled = true;
          clearInterval(checkReady);
          resolve();
        }
      }, 100);

      setTimeout(() => {
        if (!settled) {
          settled = true;
          clearInterval(checkReady);
          if (window.AdobeDC) {
            resolve();
          } else {
            reject(new Error('Timeout waiting for Adobe PDF Embed API'));
          }
        }
      }, timeoutMs);
    }

    // Check if script tag is already in the DOM (e.g. added by another block)
    const existingScript = document.querySelector('script[src*="acrobatservices.adobe.com"]');
    if (existingScript) {
      waitForAdobeDC(10000);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://acrobatservices.adobe.com/view-sdk/viewer.js';
    script.async = true;
    script.onload = () => waitForAdobeDC(5000);
    script.onerror = () => reject(new Error('Failed to load Adobe PDF Embed API'));
    document.body.appendChild(script);
  });

  // If loading fails, clear the cached promise so a retry is possible
  adobePdfScriptPromise.catch(() => {
    adobePdfScriptPromise = null;
  });

  return adobePdfScriptPromise;
}

/**
 * Create Adobe PDF Viewer
 * @param {Object} options
 * @param {string} options.pdfUrl - URL of the PDF to display
 * @param {string} options.fileName - Name of the PDF file
 * @param {boolean} [options.showDownloadPDF=false] - Show download button
 * @param {boolean} [options.showPrintPDF=false] - Show print button
 * @param {number} [options.initialLoadDelayMs=0] - Delay before viewer initialization
 * @param {function(): void} [options.onClose] - Close handler
 * @returns {HTMLElement}
 */
export function createAdobePDFViewer(options) {
  const {
    pdfUrl,
    fileName,
    showDownloadPDF = false,
    showPrintPDF = false,
    initialLoadDelayMs = 0,
    onClose,
  } = options;

  // State
  let isLoading = true;
  let error = null;
  let isInFullscreen = false;

  // Create container
  const container = document.createElement('div');
  container.className = 'adobe-pdf-viewer-container';

  // Generate unique ID for the viewer div
  const viewerId = `adobe-dc-view-${Date.now()}`;

  /**
   * Handle fullscreen change
   */
  function handleFullscreenChange() {
    isInFullscreen = !!(
      document.fullscreenElement
      || document.webkitFullscreenElement
      || document.mozFullScreenElement
      || document.msFullscreenElement
    );

    // When exiting fullscreen, refocus to ensure keyboard events work
    if (!isInFullscreen) {
      setTimeout(() => {
        const viewerEl = container.querySelector('.adobe-pdf-viewer');
        if (viewerEl) viewerEl.focus();
      }, 100);
    }
  }

  /**
   * Handle escape key
   */
  function handleEscape(e) {
    if (e.key === 'Escape' && onClose) {
      // If in fullscreen, let browser handle ESC to exit fullscreen
      if (isInFullscreen) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  }

  /**
   * Initialize Adobe viewer
   */
  async function initializeViewer() {
    try {
      // Optional startup delay for contexts where Adobe SDK/DOM races on first mount.
      if (initialLoadDelayMs > 0) {
        await new Promise((resolve) => {
          window.setTimeout(resolve, initialLoadDelayMs);
        });
      }
      // Uses pdfviewer's loader: injects script if needed and polls for window.AdobeDC
      await loadAdobePdfScript();

      if (!window.AdobeDC) {
        throw new Error('Adobe PDF viewer not available');
      }

      adobeDCViewInstance = new window.AdobeDC.View({
        clientId: getAdobeClientId(),
        divId: viewerId,
      });

      // Fetch the PDF ourselves using the browser's session cookie, then pass
      // the content to Adobe SDK via its promise-based mode. This ensures:
      // 1. The session cookie is included (worker auth middleware requires it)
      // 2. The rendition URL is preserved (web-optimized /as/ URLs don't serve raw PDFs)

      const pdfFetchUrl = pdfUrl.startsWith('http') ? pdfUrl : `${window.location.origin}${pdfUrl}`;
      const pdfPromise = fetch(pdfFetchUrl, { credentials: 'same-origin' })
        .then((resp) => {
          if (!resp.ok) throw new Error(`Failed to fetch PDF: ${resp.status}`);
          return resp.arrayBuffer();
        });

      adobeDCViewInstance.previewFile(
        {
          content: { promise: pdfPromise },
          metaData: { fileName: fileName || 'document.pdf' },
        },
        {
          embedMode: 'SIZED_CONTAINER',
          showDownloadPDF,
          showPrintPDF,
          showLeftHandPanel: false,
        },
      );

      // Update loading state WITHOUT re-rendering the container via innerHTML,
      // which would destroy the Adobe SDK's render target div.
      isLoading = false;
      const loadingEl = container.querySelector('.adobe-pdf-loading');
      if (loadingEl) loadingEl.remove();
      const viewerEl = container.querySelector('.adobe-pdf-viewer');
      if (viewerEl) viewerEl.style.display = 'block';
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Error initializing Adobe PDF viewer:', err);
      error = err.message || 'Failed to initialize PDF viewer';
      isLoading = false;
      // Show error without destroying the container via innerHTML
      const loadingEl = container.querySelector('.adobe-pdf-loading');
      if (loadingEl) loadingEl.remove();
      const viewerEl = container.querySelector('.adobe-pdf-viewer');
      if (viewerEl) viewerEl.style.display = 'none';
      const errorDiv = document.createElement('div');
      errorDiv.className = 'adobe-pdf-error';
      errorDiv.innerHTML = `<p>${error}</p>${onClose ? '<button class="adobe-pdf-error-close">Close</button>' : ''}`;
      container.appendChild(errorDiv);
      const errorCloseBtn = errorDiv.querySelector('.adobe-pdf-error-close');
      errorCloseBtn?.addEventListener('click', () => { if (onClose) onClose(); });
    }
  }

  /**
   * Render the component
   */
  function render() {
    container.innerHTML = `
      ${onClose ? `
        <button class="adobe-pdf-close-button" aria-label="Close PDF viewer">×</button>
      ` : ''}

      ${isLoading ? `
        <div class="adobe-pdf-loading">
          <div class="adobe-pdf-spinner"></div>
          <p>Loading PDF...</p>
        </div>
      ` : ''}

      ${error ? `
        <div class="adobe-pdf-error">
          <p>${error}</p>
          ${onClose ? `
            <button class="adobe-pdf-error-close">Close</button>
          ` : ''}
        </div>
      ` : ''}

      <div
        id="${viewerId}"
        class="adobe-pdf-viewer"
        style="display: ${isLoading || error ? 'none' : 'block'};"
        tabindex="-1"
      ></div>
    `;

    bindEvents();
  }

  /**
   * Bind event handlers
   */
  function bindEvents() {
    // Close button
    const closeBtn = container.querySelector('.adobe-pdf-close-button');
    closeBtn?.addEventListener('click', () => {
      if (onClose) onClose();
    });

    // Error close button
    const errorCloseBtn = container.querySelector('.adobe-pdf-error-close');
    errorCloseBtn?.addEventListener('click', () => {
      if (onClose) onClose();
    });
  }

  /**
   * Cleanup function
   */
  function cleanup() {
    document.removeEventListener('keydown', handleEscape, true);
    document.removeEventListener('fullscreenchange', handleFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
    document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
  }

  // Store cleanup function on container
  container.cleanup = cleanup;

  // Add event listeners
  document.addEventListener('keydown', handleEscape, true);
  document.addEventListener('fullscreenchange', handleFullscreenChange);
  document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
  document.addEventListener('mozfullscreenchange', handleFullscreenChange);
  document.addEventListener('MSFullscreenChange', handleFullscreenChange);

  // Initial render
  render();

  // Initialize viewer
  initializeViewer();

  return container;
}

/**
 * Open PDF viewer in a modal overlay
 * @param {Object} options
 * @param {string} options.pdfUrl - URL of the PDF to display
 * @param {string} options.fileName - Name of the PDF file
 * @param {boolean} [options.showDownloadPDF=false] - Show download button
 * @param {boolean} [options.showPrintPDF=false] - Show print button
 * @returns {function(): void} Close function
 */
export function openPDFViewerModal(options) {
  const overlay = document.createElement('div');
  overlay.className = 'adobe-pdf-modal-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
  `;

  const close = () => {
    if (viewer.cleanup) viewer.cleanup();
    overlay.remove();
  };

  const viewer = createAdobePDFViewer({
    ...options,
    onClose: close,
  });

  viewer.style.cssText = `
    width: 90vw;
    height: 90vh;
    max-width: 1200px;
    background: white;
    border-radius: 8px;
    overflow: hidden;
  `;

  overlay.appendChild(viewer);
  document.body.appendChild(overlay);

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  return close;
}

export default {
  createAdobePDFViewer,
  openPDFViewerModal,
};
