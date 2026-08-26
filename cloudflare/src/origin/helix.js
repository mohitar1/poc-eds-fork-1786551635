import config from '../config.js';

const getExtension = (path) => {
  const basename = path.split('/').pop();
  const pos = basename.lastIndexOf('.');
  return basename === '' || pos < 1 ? '' : basename.slice(pos + 1);
};

const isMediaRequest = (url) => /\/media_[0-9a-f]{40,}[/a-zA-Z0-9_-]*\.[0-9a-z]+$/.test(url.pathname);
const isRUMRequest = (url) => /\/\.(rum|optel)\/.*/.test(url.pathname);

export async function originHelix(request, env) {
  const url = new URL(request.url);
  if (url.hostname !== 'localhost' && url.port) {
    // Cloudflare opens a couple more ports than 443, so we redirect visitors
    // to the default port to avoid confusion.
    // https://developers.cloudflare.com/fundamentals/reference/network-ports/#network-ports-compatible-with-cloudflares-proxy
    const redirectTo = new URL(request.url);
    redirectTo.port = '';
    return new Response(`Moved permanently to ${redirectTo.href}`, {
      status: 301,
      headers: {
        location: redirectTo.href,
      },
    });
  }

  if (isRUMRequest(url)) {
    // only allow GET, POST, OPTIONS
    if (!['GET', 'POST', 'OPTIONS'].includes(request.method)) {
      return new Response('Method Not Allowed', { status: 405 });
    }
  }

  const extension = getExtension(url.pathname);

  // remember original search params
  const savedSearch = url.search;

  // sanitize search params
  const { searchParams } = url;
  if (isMediaRequest(url)) {
    for (const [key] of searchParams.entries()) {
      if (!['format', 'height', 'optimize', 'width'].includes(key)) {
        searchParams.delete(key);
      }
    }
  } else if (extension === 'json') {
    for (const [key] of searchParams.entries()) {
      if (!['limit', 'offset', 'sheet'].includes(key)) {
        searchParams.delete(key);
      }
    }
  } else {
    // neither media nor json request: strip search params
    url.search = '';
  }
  searchParams.sort();

  const helixOrigin = request.helixOrigin || env.HELIX_ORIGIN;
  if (!helixOrigin) {
    // A var-less production deploy (wrangler deploy without --var and without
    // keep_vars) can wipe HELIX_ORIGIN, leaving it undefined. Fail with a clear
    // message instead of a TypeError that surfaces as Cloudflare Error 1101.
    console.error('HELIX_ORIGIN is not set (request.helixOrigin and env.HELIX_ORIGIN are both undefined)');
    return new Response('HELIX_ORIGIN is not configured', { status: 500 });
  }
  if (
    !helixOrigin.match(/^http:\/\/localhost:\d+$/) &&
    !helixOrigin.match(/^https:\/\/.*--.*--.*\.(?:aem|hlx)\.(live|page)$/)
  ) {
    return new Response('Invalid HELIX_ORIGIN', { status: 500 });
  }
  const protocolAndHost = helixOrigin.split('://');
  url.port = '';
  url.protocol = protocolAndHost[0];
  url.host = protocolAndHost[1];

  const req = new Request(url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });

  req.headers.set('user-agent', req.headers.get('user-agent'));
  req.headers.set('x-forwarded-host', req.headers.get('host'));
  req.headers.set('x-byo-cdn-type', 'cloudflare');
  // Local aem up manages its own Helix token (.hlx/.hlx-token); forwarding a
  // worker secret to localhost causes token-mismatch errors upstream.
  const isLocalHelix = /^http:\/\/localhost:\d+$/.test(helixOrigin);
  if (env.HELIX_ORIGIN_AUTHENTICATION && !isLocalHelix) {
    req.headers.set('authorization', `token ${await env.HELIX_ORIGIN_AUTHENTICATION.get()}`);
  }
  const pushInvalidation = config.HELIX_PUSH_INVALIDATION !== 'disabled';
  if (pushInvalidation) {
    req.headers.set('x-push-invalidation', 'enabled');
  }

  // console.log('>>>', req.method, req.url /*, req.headers*/);

  const options = {
    method: req.method,
  };

  if (pushInvalidation) {
    options.cf = {
      // cf doesn't cache html by default: need to override the default behavior
      cacheEverything: true,
    };
  } else {
    // disable caching if no push invalidation is happening
    // e.g. when using workers.dev directly without a domain/zone
    options.cache = 'no-store';
  }

  let resp = await fetch(req, options);

  // console.log('<<<', resp.status, resp.headers);

  resp = new Response(resp.body, resp);
  if (resp.status === 301 && savedSearch) {
    const location = resp.headers.get('location');
    if (location && !location.match(/\?.*$/)) {
      resp.headers.set('location', `${location}${savedSearch}`);
    }
  }
  if (resp.status === 304) {
    // 304 Not Modified - remove CSP header
    resp.headers.delete('Content-Security-Policy');
  }
  resp.headers.delete('age');
  resp.headers.delete('x-robots-tag');
  return resp;
}
