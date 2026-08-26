import {
  describe, it, expect, vi,
} from 'vitest';
import {
  parseSrcset, resolveUrl, urlExtension, extractImageUrls,
  fileNameFromUrl, extFromContentType, scrapeSiteImages, resolveOriginalUrl,
} from '../scrape-site.js';

function htmlRes(html) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'text/html' },
    text: async () => html,
  };
}

function imgRes(bytes, contentType = 'image/png') {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return {
    ok: true,
    status: 200,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? contentType : null) },
    arrayBuffer: async () => buf,
  };
}

const silent = { info: () => {}, warn: () => {} };

describe('parseSrcset', () => {
  it('extracts URLs, dropping width/density descriptors', () => {
    expect(parseSrcset('a.jpg 1x, b.jpg 2x')).toEqual(['a.jpg', 'b.jpg']);
    expect(parseSrcset('a.jpg 480w, b.jpg 800w')).toEqual(['a.jpg', 'b.jpg']);
    expect(parseSrcset('')).toEqual([]);
  });
});

describe('resolveUrl', () => {
  it('resolves relative URLs against the base', () => {
    expect(resolveUrl('/img/a.png', 'https://x.com/page')).toBe('https://x.com/img/a.png');
    expect(resolveUrl('b.png', 'https://x.com/dir/page')).toBe('https://x.com/dir/b.png');
  });
  it('drops data:, hash, and empty URLs', () => {
    expect(resolveUrl('data:image/png;base64,xxx', 'https://x.com')).toBeNull();
    expect(resolveUrl('#', 'https://x.com')).toBeNull();
    expect(resolveUrl('', 'https://x.com')).toBeNull();
  });
});

describe('urlExtension', () => {
  it('returns the lower-cased extension', () => {
    expect(urlExtension('https://x.com/a.JPG')).toBe('jpg');
    expect(urlExtension('https://x.com/a')).toBe('');
    expect(urlExtension('https://x.com/a.png?v=2')).toBe('png');
  });
});

describe('extractImageUrls', () => {
  it('pulls img src, data-src, srcset, source srcset, and og/twitter meta', () => {
    const html = `
      <img src="/a.jpg">
      <img data-src="/b.png">
      <img srcset="/c-480.webp 480w, /c-800.webp 800w">
      <picture><source srcset="/d.avif"></picture>
      <meta property="og:image" content="https://x.com/og.jpg">
      <meta name="twitter:image" content="/tw.png">
    `;
    const urls = extractImageUrls(html, 'https://x.com/page');
    expect(urls).toContain('https://x.com/a.jpg');
    expect(urls).toContain('https://x.com/b.png');
    expect(urls).toContain('https://x.com/c-480.webp');
    expect(urls).toContain('https://x.com/c-800.webp');
    expect(urls).toContain('https://x.com/d.avif');
    expect(urls).toContain('https://x.com/og.jpg');
    expect(urls).toContain('https://x.com/tw.png');
  });

  it('og:image and twitter:image appear before img src URLs', () => {
    const html = `
      <img src="/body.jpg">
      <meta property="og:image" content="https://x.com/hero.jpg">
      <meta name="twitter:image" content="https://x.com/tw.jpg">
    `;
    const urls = extractImageUrls(html, 'https://x.com');
    expect(urls.indexOf('https://x.com/hero.jpg')).toBeLessThan(urls.indexOf('https://x.com/body.jpg'));
    expect(urls.indexOf('https://x.com/tw.jpg')).toBeLessThan(urls.indexOf('https://x.com/body.jpg'));
  });

  it('srcset URLs are sorted largest-width first', () => {
    const html = '<img srcset="/small.jpg 200w, /large.jpg 1200w, /mid.jpg 600w">';
    const urls = extractImageUrls(html, 'https://x.com');
    expect(urls.indexOf('https://x.com/large.jpg')).toBeLessThan(urls.indexOf('https://x.com/mid.jpg'));
    expect(urls.indexOf('https://x.com/mid.jpg')).toBeLessThan(urls.indexOf('https://x.com/small.jpg'));
  });

  it('filters rendition-xs and other thumbnail URL patterns', () => {
    const html = `
      <img src="/hero.jpg">
      <img src="/image.png.transform/rendition-xs/image.png">
      <img src="/images/thumb-banner.jpg">
      <img src="/favicon.ico">
    `;
    const urls = extractImageUrls(html, 'https://x.com');
    expect(urls).toContain('https://x.com/hero.jpg');
    expect(urls).not.toContain('https://x.com/image.png.transform/rendition-xs/image.png');
    expect(urls).not.toContain('https://x.com/images/thumb-banner.jpg');
    expect(urls).not.toContain('https://x.com/favicon.ico');
  });

  it('skips <img> tags with explicit tiny dimensions', () => {
    const html = `
      <img src="/flag.png" width="32" height="20">
      <img src="/hero.jpg" width="1200" height="600">
    `;
    const urls = extractImageUrls(html, 'https://x.com');
    expect(urls).not.toContain('https://x.com/flag.png');
    expect(urls).toContain('https://x.com/hero.jpg');
  });

  it('dedupes and preserves bucket ordering', () => {
    const html = '<img src="/a.jpg"><img src="/a.jpg"><img src="/b.jpg">';
    expect(extractImageUrls(html, 'https://x.com')).toEqual([
      'https://x.com/a.jpg', 'https://x.com/b.jpg',
    ]);
  });

  it('skips non-image extensions but keeps extension-less URLs', () => {
    const html = '<img src="/a.jpg"><img src="/script.js"><img src="/cdn/dyn-image">';
    const urls = extractImageUrls(html, 'https://x.com');
    expect(urls).toContain('https://x.com/a.jpg');
    expect(urls).toContain('https://x.com/cdn/dyn-image');
    expect(urls).not.toContain('https://x.com/script.js');
  });
});

describe('extFromContentType / fileNameFromUrl', () => {
  it('maps content types to extensions', () => {
    expect(extFromContentType('image/jpeg')).toBe('jpg');
    expect(extFromContentType('image/svg+xml; charset=utf-8')).toBe('svg');
    expect(extFromContentType('text/html')).toBe('');
  });

  it('derives a safe file name from the URL path', () => {
    const used = new Set();
    expect(fileNameFromUrl('https://x.com/img/Hero Banner.jpg', used, 'image/jpeg')).toBe('Hero-Banner.jpg');
  });

  it('appends an extension from content-type when the URL has none', () => {
    const used = new Set();
    expect(fileNameFromUrl('https://x.com/cdn/dynimg', used, 'image/png')).toBe('dynimg.png');
  });

  it('de-duplicates colliding names', () => {
    const used = new Set();
    expect(fileNameFromUrl('https://x.com/a.jpg', used, 'image/jpeg')).toBe('a.jpg');
    expect(fileNameFromUrl('https://y.com/a.jpg', used, 'image/jpeg')).toBe('a-2.jpg');
  });

  it('extracts meaningful name from AEM .transform URLs', () => {
    const used = new Set();
    const url = 'https://www.santander.com/content/dam/paises/argentina.png.transform/rendition-xs/image.png';
    expect(fileNameFromUrl(url, used, 'image/png')).toBe('argentina.png');
  });
});

describe('resolveOriginalUrl', () => {
  it('strips AEM .transform/ suffix to get the original asset', () => {
    expect(resolveOriginalUrl(
      'https://www.santander.com/content/dam/img.jpg.transform/rendition-xs/image.png',
    )).toBe('https://www.santander.com/content/dam/img.jpg');
  });

  it('removes CDN resize query params', () => {
    expect(resolveOriginalUrl('https://cdn.x.com/img.jpg?w=400&h=300&q=80'))
      .toBe('https://cdn.x.com/img.jpg');
  });

  it('returns the URL unchanged when no transform or resize params present', () => {
    expect(resolveOriginalUrl('https://x.com/hero.jpg')).toBe('https://x.com/hero.jpg');
  });
});

describe('scrapeSiteImages', () => {
  // Use minBytes:0 in unit tests since the mock payloads are intentionally tiny.
  const png = new Uint8Array([1, 2, 3, 4]);

  it('scrapes the page then downloads each image', async () => {
    const fetchFn = vi.fn(async (url) => {
      if (url === 'https://x.com/page') return htmlRes('<img src="/a.png"><img src="/b.png">');
      return imgRes(png);
    });
    const out = await scrapeSiteImages({
      pageUrl: 'https://x.com/page', fetchFn, log: silent, minBytes: 0,
    });
    expect(out.candidates).toBe(2);
    expect(out.images).toHaveLength(2);
    expect(out.images[0]).toMatchObject({ fileName: 'a.png', contentType: 'image/png' });
    expect(out.images[0].bytes.byteLength).toBe(4);
  });

  it('honors maxImages', async () => {
    const fetchFn = vi.fn(async (url) => (url.endsWith('/page')
      ? htmlRes('<img src="/a.png"><img src="/b.png"><img src="/c.png">')
      : imgRes(png)));
    const out = await scrapeSiteImages({
      pageUrl: 'https://x.com/page', maxImages: 2, fetchFn, log: silent, minBytes: 0,
    });
    expect(out.images).toHaveLength(2);
  });

  it('skips non-image responses and oversized files', async () => {
    const big = new Uint8Array(10);
    const fetchFn = vi.fn(async (url) => {
      if (url.endsWith('/page')) return htmlRes('<img src="/a.png"><img src="/b.png">');
      if (url.endsWith('/a.png')) {
        return {
          ok: true, status: 200, headers: { get: () => 'text/html' }, arrayBuffer: async () => big.buffer,
        };
      }
      return imgRes(big);
    });
    const out = await scrapeSiteImages({
      pageUrl: 'https://x.com/page', maxBytes: 4, fetchFn, log: silent, minBytes: 0,
    });
    // a.png is non-image (text/html), b.png exceeds the 4-byte cap -> none survive
    expect(out.images).toHaveLength(0);
  });

  it('skips images below minBytes', async () => {
    const small = new Uint8Array(100); // 100 bytes
    const large = new Uint8Array(20000); // 20 KB
    const fetchFn = vi.fn(async (url) => {
      if (url.endsWith('/page')) return htmlRes('<img src="/small.png"><img src="/large.png">');
      if (url.endsWith('/small.png')) return imgRes(small);
      return imgRes(large);
    });
    const out = await scrapeSiteImages({
      pageUrl: 'https://x.com/page', minBytes: 10 * 1024, fetchFn, log: silent,
    });
    expect(out.images).toHaveLength(1);
    expect(out.images[0].fileName).toBe('large.png');
  });

  it('resolves original URL before downloading (AEM transform)', async () => {
    const transformUrl = 'https://x.com/img/hero.jpg.transform/rendition-md/image.jpg';
    const originalUrl = 'https://x.com/img/hero.jpg';
    const downloadedUrls = [];
    const fetchFn = vi.fn(async (url) => {
      downloadedUrls.push(url);
      if (url === 'https://x.com/page') {
        return htmlRes(`<img src="${transformUrl}">`);
      }
      return imgRes(new Uint8Array(11 * 1024).fill(1));
    });
    const out = await scrapeSiteImages({
      pageUrl: 'https://x.com/page', fetchFn, log: silent, minBytes: 0,
    });
    // Should have downloaded the original, not the transform URL.
    expect(downloadedUrls).toContain(originalUrl);
    expect(downloadedUrls).not.toContain(transformUrl);
    // Filename should come from the candidate (transform) URL, which resolves to hero.jpg.
    expect(out.images[0].fileName).toBe('hero.jpg');
    // sourceUrl should be the resolved original.
    expect(out.images[0].sourceUrl).toBe(originalUrl);
  });

  it('throws when the page fetch fails', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 404, text: async () => '' }));
    await expect(scrapeSiteImages({ pageUrl: 'https://x.com/page', fetchFn, log: silent }))
      .rejects.toThrow(/404/);
  });
});
