/**
 * Site image scraper for the bring-in lane (E3: "give it a site, pull sample assets").
 *
 * Pure-ish and dependency-injected (`fetchFn`) so URL extraction and the download loop are
 * unit-testable without real network. Two stages:
 *   1. extractImageUrls(html, baseUrl): parse og:image/twitter:image meta (highest priority),
 *      then <img src/data-src>, then srcset (largest width first), then <source srcset> into a
 *      deduped, prioritised, absolute-URL list — thumbnail/rendition URLs are filtered out.
 *   2. scrapeSiteImages({ pageUrl, ... }): fetch the page, extract, then for each candidate
 *      resolve the original asset URL (strips AEM .transform/ and CDN resize params), download
 *      the full-res bytes, and skip tiny images below minBytes.
 *
 * Output items are shaped for the classic uploader: { fileName, bytes, contentType, sourceUrl }.
 */

import {
  BRING_IN_MAX_IMAGES, BRING_IN_MAX_BYTES, BRING_IN_MIN_BYTES, BRING_IN_IMAGE_EXTENSIONS,
} from './constants.js';

const IMG_TAG_RE = /<img\b[^>]*>/gi;
const SOURCE_TAG_RE = /<source\b[^>]*>/gi;
const META_TAG_RE = /<meta\b[^>]*>/gi;
const ATTR_RE = (name) => new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s">]+))`, 'i');

// URL patterns that reliably indicate thumbnails, icons, or small renditions to skip.
const THUMBNAIL_PATTERNS = [
  /rendition-xs/i,
  /rendition-s(?:m|mall)?\b/i,
  /[/._-]thumb(?:nail)?[/._-]/i,
  /[/._-]icon[/._-]/i,
  /\bsprite\b/i,
  /\bfavicon\b/i,
  // CDN width params indicating tiny sizes (?w=1..99)
  /[?&]w=[1-9]\d?(?:&|$)/,
];

function looksLikeThumbnail(url) {
  return THUMBNAIL_PATTERNS.some((re) => re.test(url));
}

function getAttr(tag, name) {
  const m = tag.match(ATTR_RE(name));
  if (!m) return null;
  return (m[2] ?? m[3] ?? m[4] ?? '').trim();
}

/**
 * Parse a srcset attribute into its candidate URLs (dropping the width/density descriptors).
 * Preserves declaration order.
 */
export function parseSrcset(srcset) {
  if (!srcset) return [];
  return srcset
    .split(',')
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean);
}

/**
 * Parse a srcset attribute and return URLs sorted by width descriptor descending (best first).
 * Falls back to declaration order when no width descriptors are present.
 */
function parseSrcsetBest(srcset) {
  if (!srcset) return [];
  const entries = srcset.split(',').map((part) => {
    const tokens = part.trim().split(/\s+/);
    const url = tokens[0];
    const wToken = tokens.find((t) => /^\d+w$/i.test(t));
    return { url, w: wToken ? parseInt(wToken, 10) : 0 };
  }).filter(({ url }) => Boolean(url));
  // Sort largest width first so the best quality candidate is tried first.
  return entries.sort((a, b) => b.w - a.w).map(({ url }) => url);
}

/** Resolve a possibly-relative URL against the page URL; returns null if it can't be parsed. */
export function resolveUrl(raw, baseUrl) {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('#')) return null;
  try {
    return new URL(trimmed, baseUrl).href;
  } catch {
    return null;
  }
}

/** The lower-cased file extension of a URL's path, or '' when there is none. */
export function urlExtension(url) {
  try {
    const { pathname } = new URL(url);
    const base = pathname.split('/').pop() || '';
    const dot = base.lastIndexOf('.');
    return dot === -1 ? '' : base.slice(dot + 1).toLowerCase();
  } catch {
    return '';
  }
}

function looksLikeImageUrl(url) {
  const ext = urlExtension(url);
  // Accept known image extensions; also accept extension-less URLs (CDN/dynamic images),
  // which the download step re-validates via Content-Type.
  return ext === '' || BRING_IN_IMAGE_EXTENSIONS.includes(ext);
}

/**
 * Given a scraped image URL, return the URL of the original full-resolution asset.
 *
 * Rules applied in order:
 *   1. AEM transform suffix  — strip everything from ".transform/" onward.
 *      e.g. /image.jpg.transform/rendition-xs/image.png → /image.jpg
 *   2. Common CDN resize params — remove w/h/width/height/size/quality/format/fit/dpr query
 *      params so the original binary is fetched instead of a resized version.
 *
 * Returns the original URL string (unchanged when no pattern matches).
 */
export function resolveOriginalUrl(url) {
  try {
    const parsed = new URL(url);

    // [1] AEM .transform/ suffix — strip it and everything after.
    const TRANSFORM_RE = /\.transform\/.*/i;
    const transformIdx = parsed.pathname.search(TRANSFORM_RE);
    if (transformIdx !== -1) {
      parsed.pathname = parsed.pathname.slice(0, transformIdx);
      parsed.search = '';
      return parsed.href;
    }

    // [2] CDN resize query params — remove known sizing keys.
    const RESIZE_PARAMS = ['w', 'h', 'width', 'height', 'size', 'quality', 'q', 'format', 'fit', 'dpr', 'auto', 'crop'];
    let changed = false;
    for (const key of RESIZE_PARAMS) {
      if (parsed.searchParams.has(key)) {
        parsed.searchParams.delete(key);
        changed = true;
      }
    }
    if (changed) return parsed.href;
  } catch { /* pass */ }
  return url;
}

/**
 * Extract candidate absolute image URLs from a page's HTML, returned in priority order:
 *   1. og:image / twitter:image meta tags  (curated, usually hero-quality)
 *   2. <img src> / <img data-src>          (direct embeds)
 *   3. <img srcset> URLs                   (largest width descriptor first)
 *   4. <source srcset> URLs                (largest width descriptor first)
 *
 * Thumbnail/rendition URLs and <img> tags with explicit tiny dimensions are filtered out.
 * Duplicates are removed (first bucket wins).
 */
export function extractImageUrls(html, baseUrl) {
  const seen = new Set();
  // Four priority buckets; flattened at the end.
  const metaUrls = [];
  const srcUrls = [];
  const srcsetUrls = [];
  const sourceUrls = [];

  const addTo = (bucket, raw) => {
    const abs = resolveUrl(raw, baseUrl);
    if (!abs || seen.has(abs) || !looksLikeImageUrl(abs) || looksLikeThumbnail(abs)) return;
    seen.add(abs);
    bucket.push(abs);
  };

  // [1] og:image / twitter:image — highest quality, process first.
  for (const tag of html.match(META_TAG_RE) || []) {
    const prop = (getAttr(tag, 'property') || getAttr(tag, 'name') || '').toLowerCase();
    if (prop === 'og:image' || prop === 'og:image:url' || prop === 'twitter:image') {
      addTo(metaUrls, getAttr(tag, 'content'));
    }
  }

  // [2] <img> tags — skip those whose declared dimensions are clearly tiny (icons/flags).
  for (const tag of html.match(IMG_TAG_RE) || []) {
    const w = parseInt(getAttr(tag, 'width') || '0', 10);
    const h = parseInt(getAttr(tag, 'height') || '0', 10);
    if ((w > 0 && w < 100) || (h > 0 && h < 100)) continue;

    addTo(srcUrls, getAttr(tag, 'src'));
    addTo(srcUrls, getAttr(tag, 'data-src'));
    parseSrcsetBest(getAttr(tag, 'srcset')).forEach((u) => addTo(srcsetUrls, u));
  }

  // [3] <source> srcset (inside <picture>) — largest-width first.
  for (const tag of html.match(SOURCE_TAG_RE) || []) {
    parseSrcsetBest(getAttr(tag, 'srcset')).forEach((u) => addTo(sourceUrls, u));
  }

  return [...metaUrls, ...srcUrls, ...srcsetUrls, ...sourceUrls];
}

/** Map a Content-Type to a file extension (best-effort). */
export function extFromContentType(contentType) {
  if (!contentType) return '';
  const type = contentType.split(';')[0].trim().toLowerCase();
  const map = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
  };
  return map[type] || '';
}

/**
 * Derive a safe, unique DAM file name from an image URL.
 * For AEM transform URLs like foo.jpg.transform/rendition-xs/image.png the segment before
 * .transform (e.g. "foo.jpg") is used so the name is meaningful.
 */
export function fileNameFromUrl(url, usedNames, contentType) {
  let base = 'image';
  try {
    const { pathname } = new URL(url);
    // Strip AEM transform suffix to get the real asset name.
    const transformIdx = pathname.toLowerCase().indexOf('.transform/');
    const effectivePath = transformIdx !== -1 ? pathname.slice(0, transformIdx) : pathname;
    const segments = effectivePath.split('/').filter(Boolean);
    const last = decodeURIComponent(segments.pop() || '').trim();
    if (last) base = last;
  } catch { /* keep default */ }

  base = base.split('?')[0].replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'image';

  let name = base;
  if (!/\.[a-z0-9]+$/i.test(name)) {
    const ext = extFromContentType(contentType);
    if (ext) name = `${name}.${ext}`;
  }

  let candidate = name;
  let n = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    const dot = name.lastIndexOf('.');
    candidate = dot === -1 ? `${name}-${n}` : `${name.slice(0, dot)}-${n}${name.slice(dot)}`;
    n += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Scrape a page for images and download their bytes.
 *
 * For each candidate URL, `resolveOriginalUrl` is applied first so AEM transform URLs and
 * CDN-resized URLs are replaced with their full-resolution originals before download.
 *
 * @param {Object} params
 * @param {string} params.pageUrl               the site/page to scrape
 * @param {number} [params.maxImages]           cap on how many images to bring in
 * @param {number} [params.maxBytes]            per-file byte cap (skips larger images)
 * @param {number} [params.minBytes]            minimum file size; skips icons/tiny renditions
 * @param {Function} [params.fetchFn]           injectable fetch
 * @param {Object} [params.log]                 console-like logger
 * @returns {Promise<{ images: Array<{fileName,bytes,contentType,sourceUrl}>, candidates: number }>}
 */
export async function scrapeSiteImages({
  pageUrl,
  maxImages = BRING_IN_MAX_IMAGES,
  maxBytes = BRING_IN_MAX_BYTES,
  minBytes = BRING_IN_MIN_BYTES,
  fetchFn = fetch,
  log = console,
}) {
  const pageRes = await fetchFn(pageUrl, { headers: { Accept: 'text/html' } });
  if (!pageRes.ok) {
    throw new Error(`scrape ${pageUrl} -> ${pageRes.status}`);
  }
  const html = await pageRes.text();
  const candidateUrls = extractImageUrls(html, pageUrl);
  log.info?.(`[agent] scraped ${candidateUrls.length} candidate image URL(s) from ${pageUrl}`);

  const images = [];
  const usedNames = new Set();

  for (const candidateUrl of candidateUrls) {
    if (images.length >= maxImages) break;
    // Resolve to the original full-resolution URL before downloading.
    const url = resolveOriginalUrl(candidateUrl);
    if (url !== candidateUrl) {
      log.info?.(`[agent] resolved original: ${candidateUrl} -> ${url}`);
    }
    try {
      const res = await fetchFn(url, { headers: { Accept: 'image/*' } });
      if (!res.ok) {
        log.warn?.(`[agent] skip ${url} -> ${res.status}`);
        continue;
      }
      const contentType = res.headers?.get?.('content-type') || '';
      if (contentType && !contentType.toLowerCase().startsWith('image/')) {
        log.warn?.(`[agent] skip ${url} -> not an image (${contentType})`);
        continue;
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength === 0) {
        log.warn?.(`[agent] skip ${url} -> empty body`);
        continue;
      }
      if (minBytes > 0 && buf.byteLength < minBytes) {
        log.warn?.(`[agent] skip ${url} -> ${buf.byteLength} bytes below minimum ${minBytes}`);
        continue;
      }
      if (buf.byteLength > maxBytes) {
        log.warn?.(`[agent] skip ${url} -> ${buf.byteLength} bytes exceeds cap ${maxBytes}`);
        continue;
      }
      // Use the original candidate URL for the filename so we get the meaningful name.
      const fileName = fileNameFromUrl(candidateUrl, usedNames, contentType);
      images.push({
        fileName, bytes: buf, contentType, sourceUrl: url,
      });
    } catch (err) {
      log.warn?.(`[agent] skip ${url} -> ${String(err.message || err)}`);
    }
  }

  log.info?.(`[agent] downloaded ${images.length} image(s) from ${pageUrl}`);
  return { images, candidates: candidateUrls.length };
}
