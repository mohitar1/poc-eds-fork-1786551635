import { getAppLabel } from '../../scripts/locale-utils.js';

// Function to update aria attributes for accessibility based on current page
function updateActiveSlide(block, currentPage) {
  const slides = block.querySelectorAll('.carousel-slide');
  const cardsPerScreen = getCardsPerScreen();

  slides.forEach((slide, idx) => {
    const startIndex = currentPage * cardsPerScreen;
    const endIndex = startIndex + cardsPerScreen - 1;
    const isVisible = idx >= startIndex && idx <= endIndex;

    slide.setAttribute('aria-hidden', !isVisible);
    slide.querySelectorAll('a').forEach((link) => {
      if (!isVisible) {
        link.setAttribute('tabindex', '-1');
      } else {
        link.removeAttribute('tabindex');
      }
    });
  });
}

function getCardsPerScreen() {
  const width = window.innerWidth;
  if (width <= 480) return 1; // Mobile
  if (width <= 768) return 2; // Small tablet
  if (width <= 1024) return 3; // Tablet
  return 4; // Desktop
}

function showSlide(block, slideIndex = 0) {
  const slides = block.querySelectorAll('.carousel-slide');
  const cardsPerScreen = getCardsPerScreen();
  const totalPages = Math.ceil(slides.length / cardsPerScreen);

  let realSlideIndex = slideIndex < 0 ? totalPages - 1 : slideIndex;
  if (slideIndex >= totalPages) realSlideIndex = 0;

  const container = block.querySelector('.carousel-slides');
  const containerWidth = container.offsetWidth;
  const scrollDistance = (containerWidth / cardsPerScreen) * cardsPerScreen * realSlideIndex;

  container.scrollTo({
    top: 0,
    left: scrollDistance,
    behavior: 'smooth',
  });

  // Update active page indicator, navigation arrows, and accessibility attributes
  updateActivePageIndicator(block, realSlideIndex);
  updateNavigationArrows(block, realSlideIndex, totalPages);
  updateActiveSlide(block, realSlideIndex);
}

function updateActivePageIndicator(block, pageIndex) {
  const indicators = block.querySelectorAll('.carousel-slide-indicator');
  indicators.forEach((indicator, idx) => {
    const button = indicator.querySelector('button');
    if (idx === pageIndex) {
      button.setAttribute('disabled', 'true');
    } else {
      button.removeAttribute('disabled');
    }
  });
}

function updateNavigationArrows(block, currentPage, totalPages) {
  const prevButton = block.querySelector('.slide-prev');
  const nextButton = block.querySelector('.slide-next');

  if (prevButton && nextButton) {
    // Disable previous arrow if on first page
    if (currentPage <= 0) {
      prevButton.setAttribute('disabled', 'true');
    } else {
      prevButton.removeAttribute('disabled');
    }

    // Disable next arrow if on last page
    if (currentPage >= totalPages - 1) {
      nextButton.setAttribute('disabled', 'true');
    } else {
      nextButton.removeAttribute('disabled');
    }

    // If only one page, disable both
    if (totalPages <= 1) {
      prevButton.setAttribute('disabled', 'true');
      nextButton.setAttribute('disabled', 'true');
    }
  }
}

// Hide nav arrows + pagination dots entirely when everything fits on one page
// (re-evaluated on resize since cardsPerScreen changes per breakpoint).
function updatePaginationVisibility(block, totalPages) {
  const navButtons = block.querySelector('.carousel-navigation-buttons');
  const indicatorsNav = block.querySelector('.carousel-slide-indicators-nav');
  // Use inline display (not the `hidden` attribute) since `.carousel-navigation-buttons`
  // already has an explicit `display: flex` rule that would otherwise out-specificity it.
  const display = totalPages <= 1 ? 'none' : '';
  if (navButtons) navButtons.style.display = display;
  if (indicatorsNav) indicatorsNav.style.display = display;
}

function resizeCarousel(block) {
  const slides = block.querySelectorAll('.carousel-slide');
  const slideIndicatorsContainer = block.querySelector('.carousel-slide-indicators');
  const cardsPerScreen = getCardsPerScreen();
  const totalPages = Math.ceil(slides.length / cardsPerScreen);

  updatePaginationVisibility(block, totalPages);

  // Clear existing indicators
  slideIndicatorsContainer.innerHTML = '';

  // Recreate indicators based on new screen size
  for (let pageIdx = 0; pageIdx < totalPages; pageIdx += 1) {
    const indicator = document.createElement('li');
    indicator.classList.add('carousel-slide-indicator');
    indicator.dataset.targetSlide = pageIdx;
    indicator.innerHTML = `<button type="button" aria-label="Show Page ${pageIdx + 1} of ${totalPages}"></button>`;
    slideIndicatorsContainer.append(indicator);

    // Add click handler
    indicator.querySelector('button').addEventListener('click', (e) => {
      const slideIndicator = e.currentTarget.parentElement;
      const pageIndex = parseInt(slideIndicator.dataset.targetSlide, 10);
      showSlide(block, pageIndex);
      block.dataset.activePage = pageIndex;
    });
  }

  // Reset to first page and update indicators
  block.dataset.activePage = '0';
  updateActivePageIndicator(block, 0);
  updateNavigationArrows(block, 0, totalPages);
  updateActiveSlide(block, 0);
  showSlide(block, 0);
}

function bindEvents(block) {
  const slideIndicators = block.querySelector('.carousel-slide-indicators');
  if (!slideIndicators) return;

  // Set initial active page
  block.dataset.activePage = '0';

  slideIndicators.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', (e) => {
      const slideIndicator = e.currentTarget.parentElement;
      const pageIndex = parseInt(slideIndicator.dataset.targetSlide, 10);
      showSlide(block, pageIndex);
      block.dataset.activePage = pageIndex;
    });
  });

  block.querySelector('.slide-prev').addEventListener('click', () => {
    const currentPage = parseInt(block.dataset.activePage || '0', 10);
    const newPage = Math.max(0, currentPage - 1);
    showSlide(block, newPage);
    block.dataset.activePage = newPage;
  });

  block.querySelector('.slide-next').addEventListener('click', () => {
    const currentPage = parseInt(block.dataset.activePage || '0', 10);
    const slides = block.querySelectorAll('.carousel-slide');
    const cardsPerScreen = getCardsPerScreen();
    const totalPages = Math.ceil(slides.length / cardsPerScreen);
    const newPage = Math.min(totalPages - 1, currentPage + 1);
    showSlide(block, newPage);
    block.dataset.activePage = newPage;
  });

  // Initialize first page as active
  const slides = block.querySelectorAll('.carousel-slide');
  const cardsPerScreen = getCardsPerScreen();
  const totalPages = Math.ceil(slides.length / cardsPerScreen);

  updateActivePageIndicator(block, 0);
  updateNavigationArrows(block, 0, totalPages);
  updateActiveSlide(block, 0);

  // Handle window resize to recalculate pages
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      resizeCarousel(block);
    }, 250);
  });
}

function createSlide(row, slideIndex, carouselId) {
  const slide = document.createElement('li');
  slide.dataset.slideIndex = slideIndex;
  slide.setAttribute('id', `carousel-${carouselId}-slide-${slideIndex}`);
  slide.classList.add('carousel-slide');

  let cardLinkUrl = null;

  row.querySelectorAll(':scope > div').forEach((column, colIdx) => {
    column.classList.add(`carousel-slide-${colIdx === 0 ? 'image' : 'content'}`);

    // Check for links in content column
    if (colIdx !== 0) {
      const link = column.querySelector('a');
      if (link) {
        cardLinkUrl = link.href;
        // Replace link with its text content while preserving structure
        const linkText = link.textContent;
        const parent = link.parentNode;

        // If the link is the only content in its parent, replace it with text
        if (parent.children.length === 1 && parent.textContent.trim() === linkText.trim()) {
          parent.textContent = linkText;
        } else {
          // Replace just the link with its text content
          link.replaceWith(document.createTextNode(linkText));
        }
      }
    }

    slide.append(column);
  });

  // If we found a link, make the entire card clickable
  if (cardLinkUrl) {
    slide.style.cursor = 'pointer';
    slide.setAttribute('role', 'link');
    slide.setAttribute('tabindex', '0');

    // Add click handler
    const handleCardClick = (e) => {
      e.preventDefault();
      window.open(cardLinkUrl, '_self');
    };

    // Add keyboard handler for accessibility
    const handleCardKeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        window.open(cardLinkUrl, '_blank');
      }
    };

    slide.addEventListener('click', handleCardClick);
    slide.addEventListener('keydown', handleCardKeydown);

    // Store the URL as data attribute for potential future use
    slide.dataset.cardLink = cardLinkUrl;
  }

  const labeledBy = slide.querySelector('h1, h2, h3, h4, h5, h6');
  if (labeledBy) {
    slide.setAttribute('aria-labelledby', labeledBy.getAttribute('id'));
  }

  return slide;
}

let carouselId = 0;
export default async function decorate(block) {
  carouselId += 1;
  block.setAttribute('id', `carousel-${carouselId}`);
  const rows = block.querySelectorAll(':scope > div');

  const ph = await getAppLabel();

  block.setAttribute('role', 'region');
  block.setAttribute('aria-roledescription', ph('carousel', 'Carousel'));

  const container = document.createElement('div');
  container.classList.add('carousel-slides-container');

  const slidesWrapper = document.createElement('ul');
  slidesWrapper.classList.add('carousel-slides');
  block.prepend(slidesWrapper);

  const slideIndicatorsNav = document.createElement('nav');
  slideIndicatorsNav.classList.add('carousel-slide-indicators-nav');
  slideIndicatorsNav.setAttribute('aria-label', ph('carouselSlideControls', 'Carousel Slide Controls'));
  const slideIndicators = document.createElement('ol');
  slideIndicators.classList.add('carousel-slide-indicators');
  slideIndicatorsNav.append(slideIndicators);
  block.append(slideIndicatorsNav);

  const slideNavButtons = document.createElement('div');
  slideNavButtons.classList.add('carousel-navigation-buttons');
  slideNavButtons.innerHTML = `
    <button type="button" class="slide-prev" aria-label="${ph('previousSlide', 'Previous Slide')}"></button>
    <button type="button" class="slide-next" aria-label="${ph('nextSlide', 'Next Slide')}"></button>
  `;

  container.append(slideNavButtons);

  rows.forEach((row, idx) => {
    const slide = createSlide(row, idx, carouselId);
    slidesWrapper.append(slide);
    row.remove();
  });

  // Create page indicators based on cards per screen
  const cardsPerScreen = getCardsPerScreen();
  const totalPages = Math.ceil(rows.length / cardsPerScreen);

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx += 1) {
    const indicator = document.createElement('li');
    indicator.classList.add('carousel-slide-indicator');
    indicator.dataset.targetSlide = pageIdx;
    indicator.innerHTML = `<button type="button" aria-label="${ph('showSlide', 'Show Page')} ${pageIdx + 1} ${ph('of', 'of')} ${totalPages}"></button>`;
    slideIndicators.append(indicator);
  }

  container.append(slidesWrapper);
  block.prepend(container);

  // Hide nav arrows + pagination dots entirely when everything fits on one page
  // (must run after the nav buttons are attached to block via `container`)
  updatePaginationVisibility(block, totalPages);

  bindEvents(block);
}
