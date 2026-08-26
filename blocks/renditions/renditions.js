/**
 * Renditions Block
 * Renders AI-generated image renditions from the Content Optimization Agent (COA).
 * Reads state handed off by search-bar's "generate mode" via scripts/coa-state.js —
 * navigating here is a real page load, not a client-side route change.
 */

import {
  getCoaState, setCoaState, subscribeCoaState, clearCoaResult,
} from '../../scripts/coa-state.js';
import { localizePath, getAppLabel } from '../../scripts/locale-utils.js';
import { COA_SCHEMAS, generateRenditions } from '../search-results/clients/coa-client.js';

const COPY_CONFIRMATION_MS = 2000;
const DOWNLOAD_STAGGER_MS = 400;

function isRenditionImagePart(part) {
  return part.kind === 'data' && part.metadata?.schema === COA_SCHEMAS.IMAGE && !part.metadata?.isSecondary;
}

function deriveTitle(part, t) {
  const rawTitle = part.metadata?.title ?? part.data?.alttext ?? t('renditionFallback', 'Rendition');
  const stripped = rawTitle.replace(/\s+for\s+.+$/i, '').trim();
  return stripped || t('renditionFallback', 'Rendition');
}

function imageProxyUrl(src) {
  return `/api/adobe/coa/image?src=${encodeURIComponent(src)}`;
}

function renderHeader(t) {
  return `
    <div class="renditions-header">
      <a class="renditions-back-link" href="${localizePath('/search')}">${t('backToSearch', '← Back to search')}</a>
      <h1 class="renditions-title">${t('generatedRenditions', 'Generated Renditions')}</h1>
    </div>
  `;
}

function renderLoading(t) {
  return `
    <div class="renditions-loading">
      <div class="loading-spinner"></div>
      <p>${t('generatingRenditions', 'Generating renditions…')}</p>
    </div>
  `;
}

function renderError(message) {
  return `
    <div class="renditions-error">
      <p>${message}</p>
    </div>
  `;
}

function renderEmpty(t) {
  return `
    <div class="renditions-empty">
      <p>${t('noRenditionsGenerated', 'No renditions were generated. Try a different prompt.')}</p>
    </div>
  `;
}

function renderCard(part, index, t) {
  const src = part.data?.src ?? '';
  const title = deriveTitle(part, t);
  return `
    <div class="rendition-card" data-index="${index}" data-src="${src}">
      <label class="rendition-card-select">
        <input type="checkbox" class="rendition-checkbox" data-index="${index}">
      </label>
      <img class="rendition-card-image" src="${imageProxyUrl(src)}" alt="${title}" loading="lazy">
      <div class="rendition-card-body">
        <p class="rendition-card-title">${title}</p>
        <a class="rendition-card-download" href="${imageProxyUrl(src)}" download data-index="${index}">
          ${t('download', 'Download')}
        </a>
      </div>
    </div>
  `;
}

function renderGrid(imageParts, t) {
  return `
    <div class="renditions-toolbar">
      <button type="button" class="renditions-copy-links">${t('copyLinks', 'Copy links')}</button>
      <button type="button" class="renditions-download-all">${t('download', 'Download')}</button>
    </div>
    <div class="renditions-grid">
      ${imageParts.map((part, i) => renderCard(part, i, t)).join('')}
    </div>
  `;
}

function showDismissibleErrorModal(message, onDismiss, t) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'renditions-modal-overlay';

    const container = document.createElement('div');
    container.className = 'renditions-modal-container';
    container.setAttribute('role', 'dialog');
    container.setAttribute('aria-modal', 'true');
    container.setAttribute('aria-labelledby', 'renditions-modal-title');
    container.innerHTML = `
      <div class="renditions-modal-header">
        <h2 id="renditions-modal-title" class="renditions-modal-title">${t('unableToGenerateRendition', 'Unable to generate rendition')}</h2>
      </div>
      <div class="renditions-modal-content"><p>${message}</p></div>
      <div class="renditions-modal-actions">
        <button type="button" class="primary-button" data-action="close">${t('close', 'Close')}</button>
      </div>
    `;

    overlay.appendChild(container);
    document.body.appendChild(overlay);

    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKeyDown, true);
      overlay.remove();
      onDismiss();
      resolve();
    };
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        settle();
      }
    }
    document.addEventListener('keydown', onKeyDown, true);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) settle();
    });
    container.querySelector('[data-action="close"]').addEventListener('click', settle);

    requestAnimationFrame(() => container.querySelector('[data-action="close"]').focus());
  });
}

function getSelectedOrAllCards(block) {
  const cards = [...block.querySelectorAll('.rendition-card')];
  const selected = cards.filter((card) => card.querySelector('.rendition-checkbox')?.checked);
  return selected.length > 0 ? selected : cards;
}

function bindGridEvents(block, t) {
  const copyBtn = block.querySelector('.renditions-copy-links');
  copyBtn?.addEventListener('click', () => {
    const links = getSelectedOrAllCards(block).map((card) => card.dataset.src).filter(Boolean).join('\n');
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(links).then(() => {
      const original = copyBtn.textContent;
      copyBtn.textContent = t('copied', 'Copied!');
      setTimeout(() => { copyBtn.textContent = original; }, COPY_CONFIRMATION_MS);
    }).catch(() => {});
  });

  const downloadAllBtn = block.querySelector('.renditions-download-all');
  downloadAllBtn?.addEventListener('click', () => {
    getSelectedOrAllCards(block).forEach((card, i) => {
      setTimeout(() => {
        const link = card.querySelector('.rendition-card-download');
        link?.click();
      }, i * DOWNLOAD_STAGGER_MS);
    });
  });
}

export default async function decorate(block) {
  const t = await getAppLabel();

  // The search bar only stores the prompt/assets before navigating here (a
  // full-page load would otherwise abort a fetch started on the previous
  // page). This page issues the actual generate call, so its lifetime
  // matches the page that will render the result.
  const { coaPendingRequest, coaRequestId } = getCoaState();
  if (coaPendingRequest) {
    const { prompt, assets } = coaPendingRequest;
    setCoaState({ coaPendingRequest: null });

    generateRenditions(prompt, assets)
      .then((result) => {
        if (getCoaState().coaRequestId !== coaRequestId) return;
        setCoaState({ coaIsLoading: false, coaResult: result, coaError: null });
      })
      .catch((err) => {
        if (getCoaState().coaRequestId !== coaRequestId) return;
        setCoaState({ coaIsLoading: false, coaError: err.message || 'Failed to generate renditions' });
      });
  }

  function render() {
    const { coaIsLoading, coaResult, coaError } = getCoaState();

    if (!coaResult && !coaIsLoading && !coaError) {
      window.location.href = localizePath('/search');
      return;
    }

    const header = renderHeader(t);

    if (coaIsLoading) {
      block.innerHTML = header + renderLoading(t);
      return;
    }

    if (coaError) {
      block.innerHTML = header + renderError(coaError);
      return;
    }

    const parts = coaResult?.parts ?? [];
    const imageParts = parts.filter(isRenditionImagePart);

    if (imageParts.length === 0) {
      const textMessage = parts
        .filter((p) => p.kind === 'text')
        .map((p) => p.text ?? '')
        .join('\n')
        .trim();

      block.innerHTML = header + renderEmpty(t);

      if (textMessage) {
        showDismissibleErrorModal(textMessage, () => {
          clearCoaResult();
          window.location.href = localizePath('/search');
        }, t);
      }
      return;
    }

    block.innerHTML = header + renderGrid(imageParts, t);
    bindGridEvents(block, t);
  }

  subscribeCoaState(render);
  render();
}
