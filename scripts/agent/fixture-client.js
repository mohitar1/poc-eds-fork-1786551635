/**
 * Offline fixture client (for --fixture dry-runs). Implements the minimal AuthorClient
 * surface the plan/read path uses (search + metadata), backed by an in-memory asset list,
 * so the full generate -> normalize -> CSV pipeline can be previewed without credentials
 * or network. Never used for live writes.
 */

function fixtureRes(body, headers = {}, status = 200) {
  const lower = {};
  Object.keys(headers).forEach((k) => { lower[k.toLowerCase()] = headers[k]; });
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => lower[String(k).toLowerCase()] ?? null },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    arrayBuffer: async () => new ArrayBuffer(8),
  };
}

/**
 * @param {Array<{assetId,repoPath,repoName,dcFormat?,assetMetadata?}>} assets
 */
export function createFixtureClient(assets) {
  const byId = new Map(assets.map((a) => [a.assetId, a]));
  return {
    async request(op, opts = {}) {
      if (op === 'search') {
        const items = assets.map((a) => ({
          assetId: a.assetId,
          repositoryMetadata: { 'repo:path': a.repoPath, 'repo:name': a.repoName },
        }));
        return fixtureRes({ items });
      }
      if (op === 'metadata') {
        const parts = String(opts.path || '').split('/').filter(Boolean);
        const id = decodeURIComponent(parts[1] || '');
        const asset = byId.get(id) || {};
        return fixtureRes(
          {
            assetMetadata: asset.assetMetadata || {},
            repositoryMetadata: { 'dc:format': asset.dcFormat || 'application/octet-stream' },
          },
          { ETag: '"fixture"' },
        );
      }
      if (op === 'rendition') return fixtureRes('', {}, 404);
      return fixtureRes({});
    },
    async requestJson(op, opts) {
      return (await this.request(op, opts)).json();
    },
  };
}
