/**
 * Pluggable upload strategies for the bring-in lane (E3).
 *
 * Interface (all strategies implement):
 *   uploadAsset({ folderPath, fileName, bytes, contentType }) → { repoPath, repoName }
 *   ensureFolder({ folderPath })                              → { created: boolean }
 *   uploadImages({ folderPath, images })                      → { uploaded, failures }
 *
 * Strategies:
 *   RepositoryUploadStrategy  — /adobe/repository/ "block upload" (AEM UI approach).
 *                               Bytes go client → Azure Blob SAS URL directly; never
 *                               through AEM's JVM. Requires x-api-key + bearer.
 *                               5-step HAR-verified flow:
 *                                 1. GET /adobe/repository?path=<folder>  → txn token (t=)
 *                                 2. POST …;api=create;t=<txn>;path=<file>  → asset-id + ETag
 *                                 3. POST …;api=block_upload  → SAS URLs + finalize URL
 *                                 4. PUT each block to Azure Blob SAS URL (no auth needed)
 *                                 5. POST <finalize-URL>  → 201
 *
 *   ClassicUploadStrategy     — Legacy Sling / Assets HTTP API.
 *                               POST raw bytes to /api/assets/<path>. Bytes route through
 *                               AEM JVM. Verified live → 201. Kept as fallback.
 *
 *   OpenApiUploadStrategy     — Future placeholder for /adobe/assets converged upload.
 *                               Currently unusable (403003 with demo token). Throws so
 *                               callers can detect and fall back.
 *
 * Factory: createUploadStrategy(name, { client, apiKey, fetchFn })
 *   name: 'repository' | 'classic' | 'openapi' | null
 *        (auto: 'repository' if apiKey is present, else 'classic')
 */

/* eslint-disable max-classes-per-file */

import {
  ensureFolderClassic,
  uploadAssetClassic,
  uploadImagesClassic,
} from './classic-assets.js';
import { DAM_ROOT } from './constants.js';

// ---------------------------------------------------------------------------
// Shared path helpers
// ---------------------------------------------------------------------------

function encodeSegments(path) {
  return path
    .split('/')
    .map((seg) => (seg === '' ? '' : encodeURIComponent(seg)))
    .join('/');
}

function damRelPath(p) {
  if (p === DAM_ROOT) return '';
  if (p.startsWith(`${DAM_ROOT}/`)) return p.slice(DAM_ROOT.length);
  return p;
}

// ---------------------------------------------------------------------------
// RepositoryUploadStrategy
// ---------------------------------------------------------------------------

const REPO_BLOCK_SIZE = 5 * 1024 * 1024; // 5 MB; server may send a larger preferred size
const REPO_API_KEY = 'aem-assets-frontend-1';
const REL_PRIMARY = 'http://ns.adobe.com/adobecloud/rel/primary';
const REL_BLOCK_TRANSFER = 'http://ns.adobe.com/adobecloud/rel/block/transfer';
const REL_BLOCK_FINALIZE = 'http://ns.adobe.com/adobecloud/rel/block/finalize';

/* eslint-disable no-underscore-dangle */
export class RepositoryUploadStrategy {
  constructor({ client, apiKey, fetchFn = fetch }) {
    this.client = client;
    this.apiKey = apiKey || REPO_API_KEY;
    this.fetchFn = fetchFn;
  }

  async buildHeaders(extra = {}) {
    return this.client.buildHeaders({ 'x-api-key': this.apiKey, ...extra });
  }

  async repoFetch(method, url, { headers = {}, body } = {}) {
    const h = await this.buildHeaders(headers);
    return this.fetchFn(url, { method, headers: h, body });
  }

  /** Step 1: GET folder to obtain the current transaction token. */
  async getFolderTxn(folderPath) {
    const url = `${this.client.authorHost}/adobe/repository?path=${encodeURIComponent(folderPath)}`;
    const res = await this.repoFetch('GET', url);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`repository GET ${folderPath} -> ${res.status} ${body}`.trim());
    }
    const location = res.headers?.get?.('location') || '';
    const m = location.match(/;t=(\d+)/);
    const txn = m ? m[1] : '';
    await res.json().catch(() => {}); // drain
    return { txn };
  }

  /** Step 2: Create the asset placeholder (zero-byte POST with ;api=create). */
  async createAsset(folderPath, fileName, contentType, txn) {
    const txnPart = txn ? `;t=${txn}` : '';
    const url = [
      `${this.client.authorHost}/adobe/repository`,
      encodeSegments(folderPath),
      `;api=create${txnPart};path=${encodeURIComponent(fileName)};intermediates=true`,
    ].join('');
    const res = await this.repoFetch('POST', url, {
      headers: { 'Content-Type': contentType, 'Content-Length': '0' },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`repository create ${fileName} -> ${res.status} ${body}`.trim());
    }
    const assetId = res.headers?.get?.('asset-id') || '';
    const etag = res.headers?.get?.('etag') || '"0"';
    return { assetId, etag };
  }

  /** Step 3: Initiate block upload; returns SAS URLs, finalize URL, and preferred block size. */
  async initiateBlockUpload(folderPath, fileName, bytes, contentType, etag, txn) {
    const txnPart = txn ? `;t=${txn}` : '';
    const url = [
      `${this.client.authorHost}/adobe/repository`,
      encodeSegments(folderPath),
      `;api=block_upload;path=${encodeURIComponent(fileName)}${txnPart}`,
    ].join('');
    const payload = {
      'repo:size': bytes.byteLength,
      'repo:blocksize': REPO_BLOCK_SIZE,
      'dc:format': contentType,
      'repo:resource': { 'repo:reltype': REL_PRIMARY },
      'repo:md5': null,
      'repo:expires': null,
      'repo:if-match': etag,
      'repo:if-none-match': null,
      _links: null,
    };
    const res = await this.repoFetch('POST', url, {
      headers: { 'Content-Type': 'application/vnd.adobecloud.bulk-transfer+json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`repository block_upload ${fileName} -> ${res.status} ${body}`.trim());
    }
    const json = await res.json();
    const preferredBlockSize = json['repo:blocksize'] || REPO_BLOCK_SIZE;
    const links = json._links || {};
    const transferLinks = links[REL_BLOCK_TRANSFER] || [];
    const blockUrls = (Array.isArray(transferLinks) ? transferLinks : [transferLinks])
      .map((l) => l?.href).filter(Boolean);
    const finalizeUrl = links[REL_BLOCK_FINALIZE]?.href;
    if (!finalizeUrl) {
      throw new Error(`repository block_upload ${fileName}: no finalize URL in response`);
    }
    return {
      blockUrls,
      finalizeUrl,
      preferredBlockSize,
      bodyForFinalize: { ...payload, _links: json._links },
    };
  }

  /** Step 4: PUT each block directly to Azure Blob Storage (no auth header needed). */
  async putBlocks(bytes, blockUrls, blockSize) {
    const totalBlocks = Math.ceil(bytes.byteLength / blockSize) || 1;
    if (blockUrls.length < totalBlocks) {
      throw new Error(`block_upload: got ${blockUrls.length} SAS URLs for ${totalBlocks} blocks`);
    }
    for (let i = 0; i < totalBlocks; i += 1) {
      const start = i * blockSize;
      const chunk = bytes.slice(start, start + blockSize);
      // SAS URL carries auth — no Authorization header.
      const res = await this.fetchFn(blockUrls[i], {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(chunk.byteLength),
        },
        body: chunk,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`block PUT ${i + 1}/${totalBlocks} -> ${res.status} ${body}`.trim());
      }
    }
  }

  /** Step 5: Finalize — tell AEM all blocks are committed. Returns the DAM repo path. */
  async finalize(finalizeUrl, bodyForFinalize) {
    const res = await this.repoFetch('POST', finalizeUrl, {
      headers: { 'Content-Type': 'application/vnd.adobecloud.bulk-transfer+json' },
      body: JSON.stringify(bodyForFinalize),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`repository finalize -> ${res.status} ${body}`.trim());
    }
    const location = res.headers?.get?.('location') || '';
    const m = location.match(/\/content\/dam\/.+/);
    return m ? m[0].split('?')[0] : '';
  }

  async uploadAsset({
    folderPath, fileName, bytes, contentType,
  }) {
    const { txn } = await this.getFolderTxn(folderPath);
    const { etag } = await this.createAsset(folderPath, fileName, contentType, txn);
    const {
      blockUrls, finalizeUrl, preferredBlockSize, bodyForFinalize,
    } = await this.initiateBlockUpload(folderPath, fileName, bytes, contentType, etag, txn);
    await this.putBlocks(bytes, blockUrls, preferredBlockSize);
    const repoPath = await this.finalize(finalizeUrl, bodyForFinalize);
    return { repoPath: repoPath || `${folderPath}/${fileName}`, repoName: fileName };
  }

  async ensureFolder({ folderPath }) {
    return ensureFolderClassic({ client: this.client, folderPath });
  }

  async uploadImages({ folderPath, images }) {
    const uploaded = [];
    const failures = [];
    for (const img of images) {
      try {
        const res = await this.uploadAsset({
          folderPath,
          fileName: img.fileName,
          bytes: img.bytes,
          contentType: img.contentType,
        });
        uploaded.push(res);
      } catch (err) {
        failures.push({ fileName: img.fileName, error: String(err.message || err) });
      }
    }
    return { uploaded, failures };
  }
}
/* eslint-enable no-underscore-dangle */

// ---------------------------------------------------------------------------
// ClassicUploadStrategy
// ---------------------------------------------------------------------------

export class ClassicUploadStrategy {
  constructor({ client }) {
    this.client = client;
  }

  uploadAsset({
    folderPath, fileName, bytes, contentType,
  }) {
    return uploadAssetClassic({
      client: this.client, folderPath, fileName, bytes, contentType,
    });
  }

  ensureFolder({ folderPath }) {
    return ensureFolderClassic({ client: this.client, folderPath });
  }

  uploadImages({ folderPath, images }) {
    return uploadImagesClassic({ client: this.client, folderPath, images });
  }
}

// ---------------------------------------------------------------------------
// OpenApiUploadStrategy (future placeholder)
// ---------------------------------------------------------------------------

// eslint-disable-next-line max-classes-per-file
export class OpenApiUploadStrategy {
  // eslint-disable-next-line class-methods-use-this
  uploadAsset() {
    return Promise.reject(new Error(
      'OpenApiUploadStrategy: not yet implemented '
      + '(converged /adobe/assets upload requires an allowlisted client ID)',
    ));
  }

  // eslint-disable-next-line class-methods-use-this
  ensureFolder() {
    return Promise.reject(new Error('OpenApiUploadStrategy: not yet implemented'));
  }

  // eslint-disable-next-line class-methods-use-this
  uploadImages() {
    return Promise.reject(new Error('OpenApiUploadStrategy: not yet implemented'));
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the appropriate upload strategy.
 *
 * @param {'repository'|'classic'|'openapi'|null} name
 * @param {object} opts
 * @param {object}   opts.client        — ClassicAuthorClient instance
 * @param {string}   [opts.apiKey]      — x-api-key; required by 'repository' strategy
 * @param {Function} [opts.fetchFn]     — injectable fetch
 * @returns {RepositoryUploadStrategy|ClassicUploadStrategy|OpenApiUploadStrategy}
 */
export function createUploadStrategy(name, { client, apiKey, fetchFn }) {
  const resolved = name || (apiKey ? 'repository' : 'classic');
  if (resolved === 'repository') return new RepositoryUploadStrategy({ client, apiKey, fetchFn });
  if (resolved === 'classic') return new ClassicUploadStrategy({ client });
  if (resolved === 'openapi') return new OpenApiUploadStrategy();
  throw new Error(`Unknown upload strategy "${name}". Use 'repository', 'classic', or 'openapi'.`);
}

// Re-export helpers used by callers that previously imported from classic-assets.
export { ensureFolderClassic, damRelPath };
