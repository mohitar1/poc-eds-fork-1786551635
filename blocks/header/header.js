import { getMetadata } from '../../scripts/aem.js';
import { loadFragment } from '../../scripts/scripts.js';
import {
  getAppLabel,
  localizePath,
} from '../../scripts/locale-utils.js';
import showProfileModal from './profile.js';

// media query match that indicates mobile/tablet width
const isDesktop = window.matchMedia('(min-width: 900px)');

function closeOnEscape(e) {
  if (e.code === 'Escape') {
    const nav = document.getElementById('nav');
    const navSections = nav.querySelector('.nav-sections');
    const navSectionExpanded = navSections?.querySelector('[aria-expanded="true"]');
    if (navSectionExpanded && isDesktop.matches) {
      // eslint-disable-next-line no-use-before-define
      toggleAllNavSections(navSections);
      navSectionExpanded.focus();
    } else if (!isDesktop.matches) {
      // eslint-disable-next-line no-use-before-define
      toggleMenu(nav, navSections);
      nav.querySelector('button').focus();
    }
  }
}

function closeOnOutsideClick(e) {
  const nav = document.getElementById('nav');
  if (!nav || isDesktop.matches) return;
  const navSections = nav.querySelector('.nav-sections');
  const hamburger = nav.querySelector('.nav-hamburger');
  const clickInSidebar = navSections?.contains(e.target);
  const clickOnHamburger = hamburger?.contains(e.target);
  if (navSections && !clickInSidebar && !clickOnHamburger) {
    // eslint-disable-next-line no-use-before-define
    toggleMenu(nav, navSections, false);
  }
}

// Close desktop dropdowns when clicking outside the expanded top-level item
function closeOnDesktopOutsideClick(e) {
  if (!isDesktop.matches) return;
  const nav = document.getElementById('nav');
  if (!nav) return;
  const navSections = nav.querySelector('.nav-sections');
  if (!navSections) return;

  const expanded = navSections.querySelector('.default-content-wrapper > ul > li[aria-expanded="true"]');
  if (!expanded) return;

  if (!expanded.contains(e.target)) {
    // eslint-disable-next-line no-use-before-define
    toggleAllNavSections(navSections);
  }
}

function openOnKeydown(e) {
  const focused = document.activeElement;
  const isNavDrop = focused.className === 'nav-drop';
  if (isNavDrop && (e.code === 'Enter' || e.code === 'Space')) {
    const dropExpanded = focused.getAttribute('aria-expanded') === 'true';
    // eslint-disable-next-line no-use-before-define
    toggleAllNavSections(focused.closest('.nav-sections'));
    focused.setAttribute('aria-expanded', dropExpanded ? 'false' : 'true');
  }
}

function focusNavSection() {
  document.activeElement.addEventListener('keydown', openOnKeydown);
}

/**
 * Toggles all nav sections
 * @param {Element} sections The container element
 * @param {Boolean} expanded Whether the element should be expanded or collapsed
 */
function toggleAllNavSections(sections, expanded = false) {
  if (!sections) return;
  sections.querySelectorAll('.nav-sections .default-content-wrapper > ul > li').forEach((section) => {
    section.setAttribute('aria-expanded', expanded);
  });
}

/**
 * Toggles the entire nav
 * @param {Element} nav The container element
 * @param {Element} navSections The nav sections within the container element
 * @param {*} forceExpanded Optional param to force nav expand behavior when not null
 */
function toggleMenu(nav, navSections, forceExpanded = null) {
  const expanded = forceExpanded !== null ? !forceExpanded : nav.getAttribute('aria-expanded') === 'true';
  const button = nav.querySelector('.nav-hamburger button');
  document.body.style.overflowY = (expanded || isDesktop.matches) ? '' : 'hidden';
  document.body.classList.toggle('nav-menu-open', !expanded && !isDesktop.matches);
  nav.setAttribute('aria-expanded', expanded ? 'false' : 'true');
  // Keep all sections collapsed when toggling menu
  toggleAllNavSections(navSections, false);
  button.setAttribute('aria-label', expanded ? 'Open navigation' : 'Close navigation');
  // enable nav dropdown keyboard accessibility
  const navDrops = navSections?.querySelectorAll('.nav-drop') || [];
  if (isDesktop.matches) {
    navDrops.forEach((drop) => {
      if (!drop.hasAttribute('tabindex')) {
        drop.setAttribute('tabindex', 0);
        drop.addEventListener('focus', focusNavSection);
      }
    });
  } else {
    navDrops.forEach((drop) => {
      drop.removeAttribute('tabindex');
      drop.removeEventListener('focus', focusNavSection);
    });
  }

  // enable menu collapse on escape keypress
  if (!expanded || isDesktop.matches) {
    // collapse menu on escape press
    window.addEventListener('keydown', closeOnEscape);
    // collapse menu on outside click (mobile)
    document.addEventListener('click', closeOnOutsideClick);
  } else {
    window.removeEventListener('keydown', closeOnEscape);
    document.removeEventListener('click', closeOnOutsideClick);
  }
}

function makeNavSection(role, nodes) {
  const section = document.createElement('div');
  section.classList.add(`nav-${role}`);
  section.dataset.role = role;
  const wrapper = document.createElement('div');
  wrapper.className = 'default-content-wrapper';
  nodes.forEach((node) => wrapper.append(node));
  section.append(wrapper);
  return section;
}

function isBrandContent(node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  if (node.tagName === 'UL') return false;
  return Boolean(
    node.querySelector?.('.icon-santander-icon')
    || node.querySelector?.('a[href] .icon'),
  );
}

function isToolsPlaceholder(node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  if (node.tagName === 'UL') return false;
  if (node.querySelector?.('.nav-icons-wrapper, .nav-cart-icon, .nav-message-icon')) return true;
  return !node.textContent?.replace(/\u00a0/g, ' ').trim();
}

/**
 * Nav is brand + tools (no link sections). DA often collapses both into one block
 * or mislabels the logo as tools — rebuild from content, not section count or role.
 */
function normalizeNavLayout(nav) {
  const nodes = [];
  [...nav.children].forEach((section) => {
    section.style.display = '';
    const wrapper = section.querySelector('.default-content-wrapper') || section;
    [...wrapper.children].forEach((child) => nodes.push(child));
  });

  const brandNodes = [];
  const linkNodes = [];
  const toolsNodes = [];

  nodes.forEach((node) => {
    if (node.tagName === 'UL') {
      linkNodes.push(node);
    } else if (isBrandContent(node)) {
      brandNodes.push(node);
    } else if (isToolsPlaceholder(node)) {
      toolsNodes.push(node);
    } else if (brandNodes.length === 0) {
      brandNodes.push(node);
    } else {
      toolsNodes.push(node);
    }
  });

  const layout = [
    makeNavSection('brand', brandNodes),
    makeNavSection('tools', toolsNodes),
  ];
  if (linkNodes.length) {
    layout.splice(1, 0, makeNavSection('sections', linkNodes));
  }
  nav.replaceChildren(...layout);
}

function getUserInitials() {
  if (!window.user || !window.user.name) {
    return '';
  }
  return window.user.name.split(' ').filter((name) => /^[A-Za-z]/.test(name)).map((name) => name.charAt(0)).join('')
    .toUpperCase();
}

// Map portal elements to their original menu containers for cleanup
const portalOrigins = new WeakMap();

/**
 * Opens a dropdown menu as a fixed-position overlay on document.body,
 * escaping the header-bar stacking context so menus render above the nav bar.
 *
 * @param {Element} triggerEl   The button that was clicked
 * @param {Element} menuEl      The .dropdown-menu element containing the <ul>
 * @param {string}  portalClass Extra class for type-specific styling (e.g. 'my-account-portal')
 * @returns {{ portal: Element, close: Function }}
 */
function openDropdownPortal(triggerEl, menuEl, portalClass = '') {
  // Close any existing dropdown portals and return their <ul> to original parents
  document.querySelectorAll('.header-dropdown-portal').forEach((p) => {
    const portalUl = p.querySelector('ul');
    const originalParent = portalOrigins.get(p);
    if (portalUl && originalParent) {
      originalParent.appendChild(portalUl);
    }
    p.remove();
  });

  const ul = menuEl.querySelector('ul');
  if (!ul) return { portal: null, close: () => {} };

  // Compute position from trigger button
  const rect = triggerEl.getBoundingClientRect();

  const portal = document.createElement('div');
  portal.className = `header-dropdown-portal${portalClass ? ` ${portalClass}` : ''}`;
  portal.style.top = `${rect.bottom + 5}px`;
  portal.style.left = `${rect.left + rect.width / 2}px`;
  portal.style.transform = 'translateX(-50%)';
  portalOrigins.set(portal, menuEl); // store reference for cleanup

  // Move the <ul> from the in-DOM dropdown to the portal
  portal.appendChild(ul);
  document.body.appendChild(portal);

  const close = () => {
    // Move <ul> back to its original dropdown container
    if (ul.parentElement === portal) {
      menuEl.appendChild(ul);
    }
    portal.remove();
  };

  return { portal, close };
}

function createMyAccount(t) {
  const myAccountWrapper = document.createElement('div');

  let activeAccountPortal = null;

  if (window.user) {
    const myAccount = document.createElement('div');
    myAccount.className = 'my-account';
    const myAccountButton = document.createElement('div');
    myAccountButton.className = 'my-account-button';
    const impersonationIndicator = window.user.su ? '<span class="impersonation-indicator"></span>' : '';
    myAccountButton.innerHTML = `
      <div class="avatar">
        ${getUserInitials()}
        ${impersonationIndicator}
      </div>
      ${t('myAccount', 'My Account')}
      <span class="down-arrow-icon"></span>
    `;

    const myAccountMenu = document.createElement('div');
    myAccountMenu.className = 'my-account-menu dropdown-menu';
    myAccountMenu.innerHTML = `
      <ul>
        <li><a href="#" id="my-profile-link">${t('myProfile', 'My Profile')}</a></li>
        <li><a href="/auth/logout">${t('logOut', 'Log Out')}</a></li>
      </ul>
    `;

    // Bind My Profile link handler once using event delegation (works regardless of portal state)
    myAccountMenu.querySelector('ul').addEventListener('click', (ev) => {
      const profileLink = ev.target.closest('#my-profile-link');
      if (!profileLink) return;
      ev.preventDefault();
      showProfileModal();
      activeAccountPortal?.close();
      activeAccountPortal = null;
      myAccountButton.classList.remove('active');
    });

    myAccountButton.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !!activeAccountPortal;
      if (isOpen) {
        activeAccountPortal.close();
        activeAccountPortal = null;
        myAccountButton.classList.remove('active');
      } else {
        activeAccountPortal = openDropdownPortal(myAccountButton, myAccountMenu, 'my-account-portal');
        myAccountButton.classList.add('active');
      }
    });
    myAccount.appendChild(myAccountButton);
    myAccount.appendChild(myAccountMenu);

    myAccountWrapper.append(myAccount);
  }

  document.addEventListener('click', (e) => {
    const myAccountBtn = myAccountWrapper.querySelector('.my-account-button');
    if (activeAccountPortal
      && !myAccountBtn?.contains(e.target)
      && !activeAccountPortal.portal?.contains(e.target)) {
      activeAccountPortal.close();
      activeAccountPortal = null;
      myAccountBtn?.classList.remove('active');
    }
  });

  return myAccountWrapper;
}

async function createNavBar(t) {
  // load nav as fragment
  const navMeta = getMetadata('nav');
  const navPath = navMeta ? new URL(navMeta, window.location).pathname : localizePath('/nav');
  const fragment = await loadFragment(navPath);

  // decorate nav DOM
  const nav = document.createElement('nav');
  nav.id = 'nav';
  while (fragment.firstElementChild) nav.append(fragment.firstElementChild);

  normalizeNavLayout(nav);

  // Normalize file:// links that DA may emit on docx import (e.g. file:////en/search)
  nav.querySelectorAll('a[href]').forEach((link) => {
    const href = link.getAttribute('href');
    if (href && href.startsWith('file:')) {
      link.setAttribute('href', href.replace(/^file:\/+/, '/'));
    }
  });

  const navBrand = nav.querySelector('.nav-brand');
  if (navBrand) {
    const brandLink = navBrand.querySelector('.button');
    if (brandLink) {
      brandLink.className = '';
      brandLink.closest('.button-container').className = '';
    }
    // Ensure all brand links preserve current locale
    navBrand.querySelectorAll('a[href]').forEach((link) => {
      const href = link.getAttribute('href');
      if (href && href.startsWith('/')) {
        link.setAttribute('href', localizePath(href));
      }
    });
  }

  // Remove button styling from all header links
  nav.querySelectorAll('a.button').forEach((link) => link.classList.remove('button'));

  const navSections = nav.querySelector('.nav-sections');
  if (navSections) {
    // Localize all nav links to preserve current locale
    navSections.querySelectorAll('a[href]').forEach((link) => {
      const href = link.getAttribute('href');
      if (href && href.startsWith('/')) {
        link.setAttribute('href', localizePath(href));
      }
    });

    navSections.querySelectorAll(':scope .default-content-wrapper > ul > li').forEach((navSection) => {
      if (navSection.querySelector('ul')) navSection.classList.add('nav-drop');
      navSection.addEventListener('click', (e) => {
        if (!navSection.classList.contains('nav-drop')) return;
        const childList = navSection.querySelector('ul');
        if (childList && childList.contains(e.target)) return;

        if (!isDesktop.matches) e.preventDefault();
        const expanded = navSection.getAttribute('aria-expanded') === 'true';
        toggleAllNavSections(navSections);
        navSection.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      });
    });

    // Mark active nav link based on current URL
    const currentPath = window.location.pathname.replace(/\/$/, '');
    navSections.querySelectorAll('a[href]').forEach((link) => {
      try {
        const hrefPath = new URL(link.getAttribute('href'), window.location.origin).pathname.replace(/\/$/, '');
        if (hrefPath && hrefPath === currentPath) {
          link.classList.add('active');
          const li = link.closest('li');
          if (li) li.classList.add('active');
          const parentDrop = li?.closest('ul')?.closest('li.nav-drop') || link.closest('li.nav-drop');
          if (parentDrop) parentDrop.classList.add('active');
        }
      } catch {
        // ignore invalid URLs
      }
    });
  }

  document.addEventListener('click', closeOnDesktopOutsideClick);
  const tools = nav.querySelector('.nav-tools');

  // add shopping cart and download icons to nav-tools
  if (tools) {
    // Create wrapper div with flex layout
    const iconsWrapper = document.createElement('div');
    iconsWrapper.classList.add('nav-icons-wrapper');

    // Create message icon (bell with circle)
    const messageIcon = document.createElement('div');
    messageIcon.classList.add('nav-message-icon');
    messageIcon.setAttribute('data-tooltip', t('notifications', 'Notifications'));
    messageIcon.setAttribute('data-tooltip-position', 'bottom');
    messageIcon.innerHTML = `
      <button type="button" aria-label="${t('notifications', 'Notifications')}">
        <img src="/icons/bell-circle.svg" alt="${t('notifications', 'Notifications')}" />
        <span class="message-badge" style="display: none;"></span>
      </button>
    `;

    // Add click handler for message icon
    messageIcon.addEventListener('click', () => {
      window.location.href = localizePath('/my-dam/my-notifications');
    });

    // Create cart icon
    const cartIcon = document.createElement('div');
    cartIcon.classList.add('nav-cart-icon');
    cartIcon.setAttribute('data-tooltip', t('shoppingCart', 'Cart'));
    cartIcon.setAttribute('data-tooltip-position', 'bottom');
    cartIcon.innerHTML = `
      <button type="button" aria-label="${t('shoppingCart', 'Shopping Cart')}">
        <img src="/icons/shopping-cart-icon.svg" alt="${t('shoppingCart', 'Shopping Cart')}" />
        <span class="cart-badge" style="display: none;"></span>
      </button>
    `;

    // Add click handler for cart icon
    cartIcon.addEventListener('click', () => {
      if (window.openCart && typeof window.openCart === 'function') {
        window.openCart();
      }
    });

    // Create download icon
    const downloadIcon = document.createElement('div');
    downloadIcon.classList.add('nav-download-icon');
    downloadIcon.setAttribute('data-tooltip', t('download', 'Download'));
    downloadIcon.setAttribute('data-tooltip-position', 'bottom');
    downloadIcon.innerHTML = `
      <button type="button" aria-label="${t('download', 'Download')}">
        <img src="/icons/download-icon.svg" alt="${t('download', 'Download')}" />
        <span class="download-badge" style="display: none;"></span>
      </button>
    `;

    // Add click handler for download icon
    downloadIcon.addEventListener('click', () => {
      if (window.openDownloadPanel && typeof window.openDownloadPanel === 'function') {
        window.openDownloadPanel();
      }
    });

    // Create reports icon (only if user has admin-reports permission)
    if (window.user?.permissions?.includes('admin-reports')) {
      const reportsIcon = document.createElement('div');
      reportsIcon.classList.add('nav-reports-icon');
      reportsIcon.setAttribute('data-tooltip', t('reports', 'Reports'));
      reportsIcon.setAttribute('data-tooltip-position', 'bottom');
      reportsIcon.innerHTML = `
        <button type="button" aria-label="Reports">
          <img src="/icons/chart-circle.svg" alt="Reports" />
        </button>
      `;

      // Add click handler for reports icon
      reportsIcon.addEventListener('click', () => {
        window.location.href = '/en/reports/report-hub';
      });

      iconsWrapper.appendChild(reportsIcon);
    }

    // Append icons to wrapper (message, download, cart)
    iconsWrapper.appendChild(messageIcon);
    iconsWrapper.appendChild(downloadIcon);
    iconsWrapper.appendChild(cartIcon);

    // Append wrapper to tools
    tools.appendChild(iconsWrapper);

    // My Account sits in the same row as the icon cluster
    tools.appendChild(createMyAccount(t));

    // Expose function to update message badge (shows red circle indicator)
    window.updateMessageBadge = function (unreadCount) {
      const badge = messageIcon.querySelector('.message-badge');
      if (badge) {
        if (unreadCount && unreadCount > 0) {
          badge.style.display = 'block'; // Show red circle
        } else {
          badge.style.display = 'none'; // Hide circle
        }
      }
    };

    // Expose function to update cart badge
    window.updateCartBadge = function (numCartAssetItems) {
      const badge = cartIcon.querySelector('.cart-badge');
      if (badge) {
        if (numCartAssetItems && numCartAssetItems > 0) {
          badge.textContent = numCartAssetItems;
          badge.style.display = 'block';
        } else {
          badge.style.display = 'none';
        }
      }
    };

    // Expose function to update download badge
    window.updateDownloadBadge = function (numDownloadAssetItems) {
      const badge = downloadIcon.querySelector('.download-badge');
      if (badge) {
        if (numDownloadAssetItems && numDownloadAssetItems > 0) {
          badge.textContent = numDownloadAssetItems;
          badge.style.display = 'block';
        } else {
          badge.style.display = 'none';
        }
      }
    };

    // Update cart badge from localStorage (asset count)
    try {
      const cartAssetItems = JSON.parse(localStorage.getItem('cartAssetItems') || '[]');
      window.updateCartBadge(cartAssetItems.length);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error reading cart items from localStorage:', error);
      window.updateCartBadge(0);
    }

    // Update download badge from localStorage
    try {
      const downloadAssetItems = JSON.parse(localStorage.getItem('downloadArchives') || '[]');
      window.updateDownloadBadge(downloadAssetItems.length);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error reading download items from localStorage:', error);
      window.updateDownloadBadge(0);
    }
  }

  // hamburger for mobile
  const hamburger = document.createElement('div');
  hamburger.classList.add('nav-hamburger');
  hamburger.innerHTML = `<button type="button" aria-controls="nav" aria-label="${t('openNavigation', 'Open navigation')}">
      <span class="nav-hamburger-icon"></span>
    </button>`;
  hamburger.addEventListener('click', () => toggleMenu(nav, navSections));
  nav.prepend(hamburger);
  nav.setAttribute('aria-expanded', 'false');
  // prevent mobile nav behavior on window resize
  toggleMenu(nav, navSections, isDesktop.matches);
  isDesktop.addEventListener('change', () => toggleMenu(nav, navSections, isDesktop.matches));

  const navWrapper = document.createElement('div');
  navWrapper.className = 'nav-wrapper';
  navWrapper.append(nav);
  return navWrapper;
}

/**
 * loads and decorates the header, mainly the nav
 * @param {Element} block The header block element
 */
export default async function decorate(block) {
  block.textContent = '';

  if (getMetadata('header') === 'no') {
    // Minimal welcome-page header: just the brand logo, no nav or toolbar
    block.parentElement.style.height = 'var(--nav-height, 64px)';
    const welcomeBar = document.createElement('div');
    welcomeBar.className = 'header-welcome-bar';
    welcomeBar.innerHTML = `
      <a href="/" class="welcome-logo" aria-label="Home">
        <span class="icon icon-santander-icon">
          <img src="/icons/santander-icon.svg" alt="Santander" loading="eager" />
        </span>
      </a>`;
    block.append(welcomeBar);
    return;
  }

  // Load localized labels
  const t = await getAppLabel();

  block.append(await createNavBar(t));
}
