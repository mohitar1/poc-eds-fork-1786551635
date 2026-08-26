import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

vi.mock('../../../scripts/locale-utils.js', () => ({
  getAppLabel: async () => (key, fallback) => fallback || key,
  localizePath: (path) => path,
}));

const generateRenditions = vi.fn();
vi.mock('../../search-results/clients/coa-client.js', () => ({
  COA_SCHEMAS: {
    IMAGE: 'https://ns.adobe.com/experience/dx-agent/data-schema/image',
    GENERAL_TEXT: 'https://ns.adobe.com/experience/dx-agent/data-schema/general-text-response',
  },
  generateRenditions: (...args) => generateRenditions(...args),
}));

const { default: decorate } = await import('../renditions.js');
const { getCoaState, setCoaState, clearCoaResult } = await import('../../../scripts/coa-state.js');

const IMAGE_SCHEMA = 'https://ns.adobe.com/experience/dx-agent/data-schema/image';

function imagePart(overrides = {}) {
  return {
    kind: 'data',
    data: { src: 'https://foo.adobe.io/rendition.jpg' },
    metadata: { schema: IMAGE_SCHEMA, title: 'Instagram Square rendition for hero.jpg' },
    ...overrides,
  };
}

describe('renditions block', () => {
  beforeEach(() => {
    sessionStorage.clear();
    clearCoaResult();
    generateRenditions.mockReset();
    generateRenditions.mockResolvedValue({ parts: [] });
    delete window.location;
    window.location = { href: '', pathname: '/en/renditions' };
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('redirects to /search when there is no result, loading, or error state', async () => {
    const block = document.createElement('div');
    await decorate(block);
    expect(window.location.href).toBe('/search');
  });

  it('renders a loading state while coaIsLoading is true', async () => {
    setCoaState({
      coaIsLoading: true, coaResult: null, coaError: null, coaRequestId: 'req-1',
    });
    const block = document.createElement('div');
    await decorate(block);
    expect(block.querySelector('.renditions-loading')).not.toBeNull();
  });

  describe('coaPendingRequest — the actual generate call happens on this page', () => {
    it('issues generateRenditions() itself when a pending request is present, then clears it', async () => {
      setCoaState({
        coaIsLoading: true,
        coaResult: null,
        coaError: null,
        coaRequestId: 'req-1',
        coaPendingRequest: { prompt: 'Get me Instagram renditions', assets: [{ id: 'a1', name: 'hero.jpg' }] },
      });

      const block = document.createElement('div');
      await decorate(block);

      expect(generateRenditions).toHaveBeenCalledWith(
        'Get me Instagram renditions',
        [{ id: 'a1', name: 'hero.jpg' }],
      );
      expect(getCoaState().coaPendingRequest).toBeNull();
    });

    it('applies the result once generateRenditions() resolves', async () => {
      let resolveGenerate;
      generateRenditions.mockImplementation(
        () => new Promise((resolve) => { resolveGenerate = resolve; }),
      );

      setCoaState({
        coaIsLoading: true,
        coaResult: null,
        coaError: null,
        coaRequestId: 'req-1',
        coaPendingRequest: { prompt: 'a prompt', assets: [{ id: 'a1', name: 'hero.jpg' }] },
      });

      const block = document.createElement('div');
      await decorate(block);
      expect(block.querySelector('.renditions-loading')).not.toBeNull();

      resolveGenerate({ parts: [imagePart()] });
      await Promise.resolve();
      await Promise.resolve();

      expect(getCoaState().coaIsLoading).toBe(false);
      expect(block.querySelectorAll('.rendition-card')).toHaveLength(1);
    });

    it('applies the error once generateRenditions() rejects', async () => {
      let rejectGenerate;
      generateRenditions.mockImplementation(
        () => new Promise((_resolve, reject) => { rejectGenerate = reject; }),
      );

      setCoaState({
        coaIsLoading: true,
        coaResult: null,
        coaError: null,
        coaRequestId: 'req-1',
        coaPendingRequest: { prompt: 'a prompt', assets: [{ id: 'a1', name: 'hero.jpg' }] },
      });

      const block = document.createElement('div');
      await decorate(block);

      rejectGenerate(new Error('COA request failed with status 500'));
      await Promise.resolve();
      await Promise.resolve();

      expect(getCoaState().coaIsLoading).toBe(false);
      expect(block.querySelector('.renditions-error')?.textContent).toContain('COA request failed with status 500');
    });

    it('discards a late-resolving result if the request id has since changed (staleness guard)', async () => {
      let resolveGenerate;
      generateRenditions.mockImplementation(
        () => new Promise((resolve) => { resolveGenerate = resolve; }),
      );

      setCoaState({
        coaIsLoading: true,
        coaResult: null,
        coaError: null,
        coaRequestId: 'req-1',
        coaPendingRequest: { prompt: 'a prompt', assets: [{ id: 'a1', name: 'hero.jpg' }] },
      });

      const block = document.createElement('div');
      await decorate(block);

      // A newer request supersedes this one (e.g. clearCoaResult() ran, or a
      // second generate was issued) before the fetch resolves.
      setCoaState({ coaRequestId: 'req-2' });

      resolveGenerate({ parts: [imagePart()] });
      await Promise.resolve();
      await Promise.resolve();

      expect(getCoaState().coaResult).toBeNull();
    });

    it('does not call generateRenditions() again when there is no pending request', async () => {
      setCoaState({
        coaIsLoading: false,
        coaResult: { parts: [imagePart()] },
        coaError: null,
      });

      const block = document.createElement('div');
      await decorate(block);

      expect(generateRenditions).not.toHaveBeenCalled();
    });
  });

  it('renders an error message when coaError is set', async () => {
    setCoaState({ coaIsLoading: false, coaResult: null, coaError: 'COA request failed with status 500' });
    const block = document.createElement('div');
    await decorate(block);
    expect(block.querySelector('.renditions-error')?.textContent).toContain('COA request failed with status 500');
  });

  it('renders the empty state when the result has zero image parts', async () => {
    setCoaState({
      coaIsLoading: false,
      coaError: null,
      coaResult: { parts: [{ kind: 'text', text: 'Sorry, I could not generate that.' }] },
    });
    const block = document.createElement('div');
    await decorate(block);
    expect(block.querySelector('.renditions-empty')).not.toBeNull();
  });

  it('filters out parts with isSecondary=true from the grid', async () => {
    setCoaState({
      coaIsLoading: false,
      coaError: null,
      coaResult: {
        parts: [
          imagePart(),
          imagePart({ metadata: { schema: IMAGE_SCHEMA, title: 'secondary', isSecondary: true } }),
        ],
      },
    });
    const block = document.createElement('div');
    await decorate(block);
    expect(block.querySelectorAll('.rendition-card')).toHaveLength(1);
  });

  it('strips the " for <filename>" suffix from the rendition title', async () => {
    setCoaState({
      coaIsLoading: false,
      coaError: null,
      coaResult: { parts: [imagePart()] },
    });
    const block = document.createElement('div');
    await decorate(block);
    const title = block.querySelector('.rendition-card-title')?.textContent;
    expect(title).toBe('Instagram Square rendition');
  });

  it('renders a card per non-secondary image part with a proxied image src', async () => {
    setCoaState({
      coaIsLoading: false,
      coaError: null,
      coaResult: { parts: [imagePart(), imagePart({ data: { src: 'https://foo.adobe.io/rendition2.jpg' } })] },
    });
    const block = document.createElement('div');
    await decorate(block);
    const cards = block.querySelectorAll('.rendition-card');
    expect(cards).toHaveLength(2);
    const img = cards[0].querySelector('.rendition-card-image');
    expect(img.getAttribute('src')).toBe(`/api/adobe/coa/image?src=${encodeURIComponent('https://foo.adobe.io/rendition.jpg')}`);
  });

  it('copy-links assembles selected (or all) src URLs as newline-joined text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    setCoaState({
      coaIsLoading: false,
      coaError: null,
      coaResult: {
        parts: [
          imagePart({ data: { src: 'https://foo.adobe.io/a.jpg' } }),
          imagePart({ data: { src: 'https://foo.adobe.io/b.jpg' } }),
        ],
      },
    });
    const block = document.createElement('div');
    await decorate(block);

    block.querySelector('.renditions-copy-links').click();

    expect(writeText).toHaveBeenCalledWith('https://foo.adobe.io/a.jpg\nhttps://foo.adobe.io/b.jpg');
  });

  it('copy-links only copies the selected card when one is checked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    setCoaState({
      coaIsLoading: false,
      coaError: null,
      coaResult: {
        parts: [
          imagePart({ data: { src: 'https://foo.adobe.io/a.jpg' } }),
          imagePart({ data: { src: 'https://foo.adobe.io/b.jpg' } }),
        ],
      },
    });
    const block = document.createElement('div');
    await decorate(block);

    block.querySelectorAll('.rendition-checkbox')[0].checked = true;
    block.querySelector('.renditions-copy-links').click();

    expect(writeText).toHaveBeenCalledWith('https://foo.adobe.io/a.jpg');
  });
});
