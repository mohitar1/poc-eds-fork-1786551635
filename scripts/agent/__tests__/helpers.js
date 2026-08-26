/**
 * Shared test doubles for the agent unit tests: a Response-like factory and a queued
 * fake AuthorClient.
 */

export function makeRes({
  status = 200, body = {}, headers = {},
} = {}) {
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
 * A fake AuthorClient that dequeues a scripted Response per request/requestJson call.
 * `calls` records every invocation for assertions.
 */
export function makeClient(responses) {
  const queue = [...responses];
  const calls = [];
  return {
    calls,
    async request(op, opts) {
      calls.push({ op, opts });
      const next = queue.shift();
      if (!next) throw new Error(`no scripted response for ${op}`);
      return next;
    },
    async requestJson(op, opts) {
      calls.push({ op, opts });
      const next = queue.shift();
      if (!next) throw new Error(`no scripted response for ${op}`);
      return next.json();
    },
  };
}
