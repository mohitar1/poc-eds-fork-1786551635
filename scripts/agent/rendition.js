/**
 * Fetch a small rendition to feed the vision model (plan §2.6).
 * [EDGE-RENDITION] if the preferred rendition 404s, fall back to the original.
 */

const DEFAULT_RENDITION = 'thumbnail';

/**
 * Return the raw bytes of a small rendition (or the original as a fallback) as an
 * ArrayBuffer, plus the content-type. Returns null when nothing is retrievable.
 */
export async function fetchRenditionBytes(client, assetId, {
  renditionName = DEFAULT_RENDITION, seoName = 'preview',
} = {}) {
  const encoded = encodeURIComponent(assetId);
  const paths = [
    `/assets/${encoded}/renditions/${renditionName}/as/${seoName}`,
    `/assets/${encoded}/original/as/${seoName}`,
  ];

  for (const path of paths) {
    const res = await client.request('rendition', { method: 'GET', path });
    if (res.ok) {
      const contentType = res.headers?.get?.('Content-Type') || null;
      const bytes = await res.arrayBuffer();
      return { bytes, contentType, source: path.includes('/original/') ? 'original' : 'rendition' };
    }
    if (res.status !== 404) {
      const text = await res.text().catch(() => '');
      throw new Error(`rendition ${assetId} -> ${res.status} ${text}`.trim());
    }
  }
  return null;
}

/**
 * Decide whether an asset is an image we should send to the vision model, from its
 * repositoryMetadata dc:format.
 */
export function isImageFormat(dcFormat) {
  return typeof dcFormat === 'string' && dcFormat.toLowerCase().startsWith('image/');
}
