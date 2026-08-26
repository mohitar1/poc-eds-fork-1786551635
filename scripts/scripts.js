import {
  buildBlock,
  decorateBlocks,
  decorateButtons,
  decorateIcons,
  decorateSections,
  decorateTemplateAndTheme,
  getMetadata,
  loadCSS,
  loadFooter,
  loadHeader,
  loadSection,
  loadSections,
  waitForFirstImage,
} from './aem.js';

import { localizePath, getLocaleRedirectUrl } from './locale-utils.js';

// Re-export shared constants for use in blocks
export { SEARCH_URL_PARAMS, getAllSearchParamKeys } from './constants/search-url-params.js';

/**
 * Loads the logged inuser data.
 */
async function loadUser() {
  // TODO: run this every 5 minutes and warn when expiry is less than 30 minutes
  //       with option to re-authenticate

  window.user = undefined;
  try {
    const user = await fetch(`${window.location.origin}/api/user`);
    if (user.ok) {
      window.user = await user.json();
    }
  } catch (_ignore) {
    // do nothing
  }
}

/**
 * Check if a user matches any of the given role entries.
 * Supports a plain role ("partner") or a country-scoped role ("partner:us"),
 * where the scoped form requires both the role and the country to match.
 * @param {Object} user - The user object with roles and countries
 * @param {string[]} entries - Parsed role entries (lowercase, trimmed)
 * @returns {boolean} true if user matches at least one entry
 */
function matchesRoleEntries(user, entries) {
  return entries.some((entry) => {
    const [role, country] = entry.split(':');
    if (country) {
      return user.roles?.includes(role) && user.countries?.includes(country);
    }
    return user.roles?.includes(role);
  });
}

/**
 * Check if the current user is excluded from this page via exclude-roles metadata.
 * Redirects to 404 if excluded. Admins always bypass.
 */
function checkPageAccess() {
  const { user } = window;
  if (!user || user.roles?.includes('admin')) return;

  const excludeRoles = getMetadata('exclude-roles');
  if (!excludeRoles) return;

  const entries = excludeRoles.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (matchesRoleEntries(user, entries)) {
    window.location.replace('/404.html');
  }
}

function showSudoBanner() {
  const su = window.user?.su;
  if (!su) return;

  const bannerHeight = 36;
  const color = '#e8740c';
  const simUser = window.user;
  const extras = [
    simUser.country && `country: ${simUser.country}`,
    simUser.userType && `userType: ${simUser.userType}`,
  ].filter(Boolean);
  const label = `Simulating: ${simUser.email || '?'}${extras.length ? ` (${extras.join(', ')})` : ''}`;

  const style = document.createElement('style');
  style.textContent = `
    .sudo-banner {
      position: fixed; top: 0; left: 0; right: 0; height: ${bannerHeight}px;
      background: ${color}; color: #fff; display: flex; align-items: center;
      justify-content: center; gap: 16px; font-family: system-ui, sans-serif;
      font-size: 13px; font-weight: 600; z-index: 99999; letter-spacing: 0.3px;
    }
    .sudo-banner button {
      background: rgba(255,255,255,0.25); color: #fff; border: 1px solid rgba(255,255,255,0.5);
      border-radius: 4px; padding: 2px 12px; font-size: 12px; font-weight: 600;
      cursor: pointer;
    }
    .sudo-banner button:hover { background: rgba(255,255,255,0.45); }
    body.sudo-active {
      border: 3px solid ${color}; border-top: none;
      box-sizing: border-box; min-height: 100vh;
    }
    /* Push whichever fixed header bar is present (full nav or the minimal
       welcome bar) down so it clears the banner, and offset main by the
       same amount so page content stays below the fixed bar. Using a main
       offset (rather than growing header height) keeps this correct even on
       the welcome page, whose header carries an inline height style. */
    body.sudo-active header .nav-wrapper,
    body.sudo-active header .header-welcome-bar { top: ${bannerHeight}px; }
    body.sudo-active header nav[aria-expanded='true'] .nav-sections {
      top: calc(var(--nav-bar-height) + ${bannerHeight}px);
    }
    body.sudo-active main { margin-top: ${bannerHeight}px; }
  `;
  document.head.appendChild(style);

  const banner = document.createElement('div');
  banner.className = 'sudo-banner';
  banner.innerHTML = `<span>${label}</span><button type="button">Reset</button>`;
  banner.querySelector('button').addEventListener('click', () => {
    ['SUDO_NAME', 'SUDO_EMAIL', 'SUDO_COUNTRY', 'SUDO_EMPLOYEE_TYPE'].forEach((name) => {
      document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/`;
    });
    window.location.reload();
  });

  document.body.classList.add('sudo-active');
  document.body.prepend(banner);
}

/**
 * Builds hero block and prepends to main in a new section.
 * @param {Element} main The container element
 */
function buildHeroBlock(main) {
  const h1 = main.querySelector('h1');
  const picture = main.querySelector('picture');
  // eslint-disable-next-line no-bitwise
  if (h1 && picture && (h1.compareDocumentPosition(picture) & Node.DOCUMENT_POSITION_PRECEDING)) {
    const section = document.createElement('div');
    section.append(buildBlock('hero', { elems: [picture, h1] }));
    main.prepend(section);
  }
}

/**
 * Lazy preload hover-state icons after initial page load
 * This prevents blink on first hover while not blocking critical resources
 * Uses Image objects to force immediate caching
 */
function lazyPreloadHoverIcons() {
  const hoverIcons = [
    '/icons/shopping_cart_icon_red.svg',
    '/icons/download_icon_red.svg',
    '/icons/bell-circle-red.svg',
    '/icons/chart-circle-red.svg',
    '/icons/upload-icon-red.svg',
    '/icons/help-icon-red.svg',
  ];

  const preloadHoverIcons = () => {
    hoverIcons.forEach((iconPath) => {
      // Create Image object to force browser to load and cache
      const img = new Image();
      img.src = iconPath;
    });
  };

  // Load immediately but after DOM content is ready
  // This ensures icons are cached before user interaction
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', preloadHoverIcons);
  } else {
    // DOM already loaded, preload immediately
    preloadHoverIcons();
  }
}

/**
 * load fonts.css and set a session storage flag
 */
async function loadFonts() {
  await loadCSS(`${window.hlx.codeBasePath}/styles/fonts.css`);
  try {
    if (!window.location.hostname.includes('localhost')) sessionStorage.setItem('fonts-loaded', 'true');
  } catch (e) {
    // do nothing
  }
}

/**
 * Builds all synthetic blocks in a container element.
 * @param {Element} main The container element
 */
function buildAutoBlocks(main) {
  try {
    buildHeroBlock(main);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Auto Blocking failed', error);
  }
}

/**
 * Loads custom error page content using fragment block
 * @param {Element} main The main element
 */
function loadErrorPage(main) {
  // Extract locale from URL path (e.g., /ja/some-path or /en/some-path)
  const pathSegments = window.location.pathname.split('/').filter((s) => s);
  const locale = pathSegments.length > 0 && pathSegments[0].length === 2 ? pathSegments[0] : 'en';

  if (window.errorCode === '404') {
    const fragmentPath = `/${locale}/error-pages/404`;
    const fragmentLink = document.createElement('a');
    fragmentLink.href = fragmentPath;
    fragmentLink.textContent = fragmentPath;
    const fragment = buildBlock('fragment', [[fragmentLink]]);
    const section = main.querySelector('.section');
    if (section) {
      section.replaceChildren(fragment);
    }
  } else if (window.errorCode === '500') {
    const fragmentPath = `/${locale}/error-pages/500`;
    const fragmentLink = document.createElement('a');
    fragmentLink.href = fragmentPath;
    fragmentLink.textContent = fragmentPath;
    const fragment = buildBlock('fragment', [[fragmentLink]]);
    const section = main.querySelector('.section');
    if (section) {
      section.replaceChildren(fragment);
    }
  }
}

/**
 * Remove sections that the current user is not allowed to see.
 * If a section has a "roles" metadata property (e.g. "employee, partner:us"),
 * only users with a matching role can see it. Admins always see everything.
 * Supports the same syntax as page-level exclude-roles: partner, partner:us, etc.
 * @param {Element} main The main element
 */
function filterSectionsByRole(main) {
  const { user } = window;
  if (!user) return;
  if (user.roles?.includes('admin')) return;

  const sections = main.querySelectorAll('.section[data-roles]');
  sections.forEach((section) => {
    const entries = section.dataset.roles.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (!matchesRoleEntries(user, entries)) {
      section.remove();
    }
  });
}

/**
 * Decorates the main element.
 * @param {Element} main The main element
 */
/**
 * Normalize root-relative links that DA may emit as file:// URLs on docx import
 * (e.g. "file:////auth/login" -> "/auth/login").
 * @param {Element} main The container element
 */
function normalizeFileLinks(main) {
  main.querySelectorAll('a[href^="file:"]').forEach((link) => {
    const href = link.getAttribute('href');
    link.setAttribute('href', href.replace(/^file:\/+/, '/'));
  });
}

// eslint-disable-next-line import/prefer-default-export
export function decorateMain(main) {
  normalizeFileLinks(main);
  // hopefully forward compatible button decoration
  decorateButtons(main);
  decorateIcons(main);
  // Load error page content if this is an error page
  if (window.isErrorPage) {
    loadErrorPage(main);
  }
  buildAutoBlocks(main);
  decorateSections(main);
  decorateBlocks(main);
}

/**
 * Loads everything needed to get to LCP.
 * @param {Element} doc The container element
 */
async function loadEager(doc) {
  await loadUser();
  checkPageAccess();
  showSudoBanner();
  document.documentElement.lang = 'en';
  decorateTemplateAndTheme();

  const main = doc.querySelector('main');
  if (main) {
    decorateMain(main);
    filterSectionsByRole(main);
    document.body.classList.add('appear');
    await loadSection(main.querySelector('.section'), waitForFirstImage);
  }

  try {
    /* if desktop (proxy for fast connection) or fonts already loaded, load fonts.css */
    if (window.innerWidth >= 900 || sessionStorage.getItem('fonts-loaded')) {
      loadFonts();
    }
  } catch (e) {
    // do nothing
  }
}

/**
 * Loads everything that doesn't need to be delayed.
 * @param {Element} doc The container element
 */
async function loadLazy(doc) {
  const main = doc.querySelector('main');
  await loadSections(main);

  const { hash } = window.location;
  const element = hash ? doc.getElementById(hash.substring(1)) : false;
  if (hash && element) element.scrollIntoView();

  loadHeader(doc.querySelector('header'));
  loadFooter(doc.querySelector('footer'));

  loadCSS(`${window.hlx.codeBasePath}/styles/lazy-styles.css`);
  loadCSS(`${window.hlx.codeBasePath}/styles/global-modal.css`);
  loadCSS(`${window.hlx.codeBasePath}/styles/add-to-collection-modal.css`);
  loadCSS(`${window.hlx.codeBasePath}/scripts/share/share-assets-modal.css`);
  loadFonts();

  // Lazy preload hover icons to prevent blink on first hover
  lazyPreloadHoverIcons();

  // Initialize download/cart panels (provides global openCart/openDownloadPanel functions)
  // eslint-disable-next-line import/no-cycle
  import('./download-cart-panels.js').catch(() => {
    console.log('Download/cart panels module not available');
  });

  // Initialize add to collection modal functionality
  import('./collections/add-to-collection-modal.js').then(async ({ initAddToCollectionModal }) => {
    await initAddToCollectionModal();
  }).catch(() => {
    // Fallback for environments where the module might not be available
    console.log('Add to collection modal not available');
  });

  // Initialize asset audit tracking (fires asset:action events → /api/audit/event)
  import('./audit/asset-audit.js')
    .then(({ default: initAssetAuditTracking }) => initAssetAuditTracking())
    .catch((err) => console.warn('[asset-audit] failed to load:', err));

  // Show important unread notifications on any page when user is logged in
  if (window.user) {
    import('./notifications/priority-modal.js')
      .then((m) => m.checkAndShowPriorityMessages())
      .catch(() => {});
  }
}

// Initialize share assets modal functionality
import('./share/share-assets-modal.js').then(async ({ initShareAssetsModal }) => {
  await initShareAssetsModal();
}).catch(() => {
  // Fallback for environments where the module might not be available
  console.log('Share assets modal not available');
});

/**
 * Loads everything that happens a lot later,
 * without impacting the user experience.
 */
function loadDelayed() {
  // eslint-disable-next-line import/no-cycle
  window.setTimeout(() => import('./delayed.js'), 3000);
  // load anything that can be postponed to the latest here
}

async function loadPage() {
  await loadEager(document);
  await loadLazy(document);
  loadDelayed();
}

/**
 * Strips HTML tags and newlines from text
 * @param {string} text - The text to clean
 * @returns {string} Cleaned text without HTML tags or newlines
 */
export function stripHtmlAndNewlines(text) {
  if (!text) return text;

  // Create a temporary div to strip HTML tags
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = text;

  // Get text content and remove newlines
  return tempDiv.textContent.trim().replace(/\n/g, '');
}

/**
 * Converts HTML list elements to a nested array structure
 * @param {string} htmlString - HTML string containing ul or ol elements
 * @returns {Array} Array of list items with nested structure preserved
 */
export function convertHtmlListToArray(htmlString) {
  if (!htmlString?.trim()) return [];

  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = htmlString.trim();

  function processListItems(listElement) {
    return Array.from(listElement.children, (li) => {
      if (li.tagName !== 'LI') return null;

      // Extract direct text content efficiently
      const textContent = Array.from(li.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE
          || (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'UL' && node.tagName !== 'OL'))
        .map((node) => node.textContent)
        .join('')
        .trim();

      // Get direct child lists only
      const nestedLists = Array.from(li.children).filter((child) => child.tagName === 'UL' || child.tagName === 'OL');

      if (nestedLists.length === 0) {
        return textContent || null;
      }

      return {
        text: textContent,
        items: nestedLists.flatMap(processListItems),
      };
    }).filter(Boolean);
  }

  return Array.from(tempDiv.querySelectorAll('ul, ol'))
    .flatMap(processListItems);
}

/**
 * Extracts all key-value pairs from a block.
 * If the first line of a value contains "{{html}}",
 * it returns the HTML content with the marker removed.
 * Otherwise, it returns plain text content (no HTML tags, no newlines).
 * @param {Element} block The block element containing rows
 * @returns {Object} An object containing all key-value pairs from the block
 */
export function getBlockKeyValues(block) {
  const result = {};

  [...block.children].forEach((row) => {
    const divs = row.children;
    if (divs.length >= 2) {
      const keyDiv = divs[0];
      const valueDiv = divs[1];

      const keyP = keyDiv.querySelector('p');

      if (keyP) {
        const rowKey = keyP.textContent.trim();
        result[rowKey] = valueDiv.innerHTML.trim();
      }
    }
  });

  return result;
}

/**
 * Escapes a CSV field value by wrapping in quotes if needed and escaping internal quotes
 * @param {string} value - The value to escape
 * @returns {string} The escaped CSV field
 */
function escapeCsvField(value) {
  if (value == null || value === '') return '';

  const stringValue = String(value);

  // Check if field needs quoting (contains comma, newline, or quote)
  if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
    // Escape double quotes by doubling them
    const escaped = stringValue.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  return stringValue;
}

/**
 * Converts an array of data objects into CSV-like text
 * @param {Array} dataArray - Array of objects with consistent keys
 * @param {Array<string>} headers - Array of header names (column order)
 * @returns {string} CSV-formatted text with headers and data rows
 */
export function convertDataArrayToCsv(dataArray, headers = null) {
  if (!Array.isArray(dataArray) || dataArray.length === 0) {
    if (headers && Array.isArray(headers)) {
      return headers.join(',');
    }
    return '';
  }

  // If no headers provided, extract from first object
  const csvHeaders = headers || Object.keys(dataArray[0]);
  const csvLines = [csvHeaders.join(',')];

  dataArray.forEach((row) => {
    const fields = csvHeaders.map((header) => {
      const value = row[header];
      return escapeCsvField(value);
    });
    csvLines.push(fields.join(','));
  });

  return csvLines.join('\n');
}

/**
* Fetches spreadsheet data from EDS with automatic pagination.
* Automatically fetches all pages if response.total > response.limit.
* @param {string} sheetPath Path to the spreadsheet JSON endpoint
                            (e.g., 'data/products', 'content/pricing')
* @param {string} sheetName Optional sheet name filter
* @returns {Promise<Object>} Object representing spreadsheet data with all pages merged
*/
export async function fetchSpreadsheetData(sheetPath, sheetName = '') {
  try {
    let offset = 0;
    let result = null;
    let hasMoreData = true;

    // Make the path locale-aware (e.g., /configs -> /ja/configs for Japanese pages)
    const localizedPath = localizePath(`/${sheetPath}`);

    // Keep fetching until we have all data
    // eslint-disable-next-line no-await-in-loop
    while (hasMoreData) {
      const url = `${window.location.origin}${localizedPath}.json?offset=${offset}${sheetName ? `&sheet=${sheetName}` : ''}`;
      // eslint-disable-next-line no-await-in-loop
      const resp = await fetch(url);

      if (!resp.ok) {
        throw new Error(`Failed to fetch spreadsheet: ${resp.status} ${resp.statusText}`);
      }

      // eslint-disable-next-line no-await-in-loop
      const json = await resp.json();

      if (offset === 0) {
        // First page: store as result
        result = json;
      } else if (json.data && Array.isArray(json.data)) {
        // Subsequent pages: merge data
        result.data = result.data.concat(json.data);
      }

      // Check if we need to fetch more
      if (json.total && json.total > result.data.length) {
        offset += json.data.length;
      } else {
        hasMoreData = false;
      }
    }

    return result;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`Failed to load spreadsheet from ${sheetPath}:`, error);
    return { data: [] };
  }
}

/**
 * Parse mime-type-mappings sheet rows from configs into mapper-ready structure.
 * @param {Object} configs - Config sheets object
 * @returns {Array|null} Parsed mappings array or null when unavailable
 */
export function extractMimeTypeMappings(configs) {
  const rows = configs?.['mime-type-mappings']?.data;
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return rows
    .map((row) => ({
      type: row.type || row.Type || '',
      values: (row.values || row.Values || '')
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value),
    }))
    .filter((mapping) => mapping.type && mapping.values.length > 0);
}

/**
 * Ensure SparkConfig has mimeTypeMappings loaded from configs.
 * Used by non-search pages that rely on shared mime label mapping.
 * @param {string} warnPrefix - Prefix for warning logs
 * @returns {Promise<Array|null>} Loaded mappings or null
 */
export async function ensureMimeTypeMappingsConfig(
  warnPrefix = '[MimeTypeMappings]',
) {
  const existingMappings = window.SparkConfig?.externalParams?.mimeTypeMappings;
  if (Array.isArray(existingMappings) && existingMappings.length > 0) {
    return existingMappings;
  }

  try {
    const configs = await fetchSpreadsheetData('configs');
    const mimeTypeMappings = extractMimeTypeMappings(configs);

    window.SparkConfig = window.SparkConfig || {};
    window.SparkConfig.externalParams = {
      ...(window.SparkConfig.externalParams || {}),
      mimeTypeMappings,
    };

    return mimeTypeMappings;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`${warnPrefix} Could not load mime-type-mappings config:`, error);
    return null;
  }
}

/**
 * Fetches spreadsheet data and converts it to CSV format
 * @param {string} sheetPath Path to the spreadsheet JSON endpoint
 * @param {string} sheetName Optional sheet name filter
 * @param {Array<string>} headers Optional array of header names for column order
 * @returns {Promise<string>} CSV-formatted text
 */
export async function fetchSpreadsheetDataAsCsv(sheetPath, sheetName = '', headers = null) {
  const data = await fetchSpreadsheetData(sheetPath, sheetName);
  return convertDataArrayToCsv(data.data || [], headers);
}

/**
 * Loads a fragment.
 * @param {string} path The path to the fragment
 * @returns {HTMLElement} The root element of the fragment
 */
export async function loadFragment(path) {
  if (path && path.startsWith('/')) {
    const resp = await fetch(`${path}.plain.html`);
    // A fragment request that was redirected (e.g. auth bounce to the login page)
    // returns a full HTML document, not a fragment — ignore it instead of
    // injecting an entire page into the nav/footer.
    if (resp.ok && !resp.redirected) {
      const text = await resp.text();
      // Guard against full-document responses leaking into a fragment slot
      if (/<\/(html|head|body)>/i.test(text)) {
        return null;
      }
      const main = document.createElement('main');
      main.innerHTML = text;

      // reset base path for media to fragment base
      const resetAttributeBase = (tag, attr) => {
        main.querySelectorAll(`${tag}[${attr}^="./media_"]`).forEach((elem) => {
          elem[attr] = new URL(elem.getAttribute(attr), new URL(path, window.location)).href;
        });
      };
      resetAttributeBase('img', 'src');
      resetAttributeBase('source', 'srcset');

      decorateMain(main);
      await loadSections(main);
      return main;
    }
  }
  return null;
}

// Check if user should be redirected to their preferred locale
// (only applies to legacy URLs without explicit locale prefix)
const localeRedirect = getLocaleRedirectUrl();
if (localeRedirect) {
  window.location.replace(localeRedirect);
} else {
  loadPage();
}

// enable live preview in da.live
(async function loadDa() {
  if (!new URL(window.location.href).searchParams.get('dapreview')) return;
  // eslint-disable-next-line import/no-unresolved
  import('https://da.live/scripts/dapreview.js').then(({ default: daPreview }) => daPreview(loadPage));
}());
