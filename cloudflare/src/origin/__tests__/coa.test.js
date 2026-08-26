import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A mutable stand-in for config.js's frozen singleton, so resolveCOAEndpoint's
// stage/prod branches can both be exercised without touching the real config.
const mockConfig = { AEM_ENV_ID: 'p203220-e2129061', COA_ENV: 'prod' };
vi.mock('../../config.js', () => ({ default: mockConfig }));

const {
  buildCOAEnvelope,
  buildFullPrompt,
  COA_MAX_ASSETS,
  deliveryDomainFromEnvId,
  originCoa,
  originCoaImage,
  resolveCOAEndpoint,
} = await import('../coa.js');

function makeKV() {
  const store = new Map();
  return {
    async getWithMetadata(key) {
      const entry = store.get(key);
      return entry ? { value: entry.value, metadata: entry.metadata } : { value: null, metadata: null };
    },
    async put(key, value, opts) {
      store.set(key, { value, metadata: opts?.metadata });
    },
  };
}

function makeSecret(value) {
  return { async get() { return value; } };
}

function makeEnv(overrides = {}) {
  return {
    AUTH_TOKENS: makeKV(),
    // originCoa/originCoaImage authenticate via dm.js's getIMSToken, i.e. the
    // same DM S2S technical account COA is called with in production.
    DM_CLIENT_ID: makeSecret('client-id-1'),
    DM_CLIENT_SECRET: makeSecret('client-secret-1'),
    ...overrides,
  };
}

// A syntactically valid (unsigned) JWT with `org`/`user_id` claims, since
// originCoa calls decodeJwt() on whatever getIMSToken() returns and derives
// both imsOrgId and imsUserId from that single token (mixing an org id from a
// different identity fails COA's payload validation).
function makeFakeJwt(claims) {
  const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${b64url({ alg: 'none' })}.${b64url(claims)}.`;
}

const FAKE_IMS_TOKEN = makeFakeJwt({
  org: 'B7F737215D35CC430A495EF5@AdobeOrg',
  user_id: 'fake-service-user-id',
});

function allowedRequest(body, { method = 'POST' } = {}) {
  return new Request('https://spark.example/api/adobe/coa/generate', {
    method,
    headers: { 'Content-Type': 'application/json', 'user-agent': 'vitest' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('coa.js - pure logic', () => {
  describe('deliveryDomainFromEnvId', () => {
    it('builds the adobeaemcloud.com delivery domain from an AEM env id', () => {
      expect(deliveryDomainFromEnvId('p203220-e2129061')).toBe('delivery-p203220-e2129061.adobeaemcloud.com');
    });
  });

  describe('resolveCOAEndpoint', () => {
    afterEach(() => {
      mockConfig.COA_ENV = 'prod';
    });

    it('resolves to prod by default', () => {
      expect(resolveCOAEndpoint()).toBe('https://aem-content-optimizer-agent.adobe.io/');
    });

    it('resolves to stage when config.COA_ENV=stage', () => {
      mockConfig.COA_ENV = 'stage';
      expect(resolveCOAEndpoint()).toBe(
        'https://aem-assets-adobe-aem-content-optimisation-agent-dep-e3caae.stage.cloud.adobe.io/',
      );
    });
  });

  describe('buildFullPrompt', () => {
    it('appends assetid/delivery_domain/assetName context per asset', () => {
      const prompt = buildFullPrompt(
        'Get me Instagram renditions',
        [{ id: 'urn:aaid:aem:1', name: 'hero.jpg' }, { id: 'urn:aaid:aem:2', name: 'banner.jpg' }],
        'delivery-p1-e1.adobeaemcloud.com',
      );
      expect(prompt).toBe(
        'Get me Instagram renditions. assetid=urn:aaid:aem:1, delivery_domain=delivery-p1-e1.adobeaemcloud.com, assetName=hero.jpg. '
        + 'assetid=urn:aaid:aem:2, delivery_domain=delivery-p1-e1.adobeaemcloud.com, assetName=banner.jpg',
      );
    });
  });

  describe('buildCOAEnvelope', () => {
    it('builds a JSON-RPC 2.0 message/send envelope with applicationName/userSurface set', () => {
      const envelope = buildCOAEnvelope('full prompt text', {
        imsOrgId: '0E29196E66578EA50A494023@AdobeOrg',
        imsUserId: 'user-id-1',
      });
      expect(envelope.jsonrpc).toBe('2.0');
      expect(envelope.method).toBe('message/send');
      expect(envelope.params.message.role).toBe('user');
      expect(envelope.params.message.parts).toEqual([{ kind: 'text', text: 'full prompt text' }]);
      expect(envelope.params.metadata.applicationName).toBe('assethub-spark');
      expect(envelope.params.metadata.userSurface).toBe('search-bar');
      expect(envelope.params.metadata.isTestRequest).toBe(false);
    });

    it('includes the IMS identity extension with imsOrgId/imsUserId', () => {
      const envelope = buildCOAEnvelope('prompt', {
        imsOrgId: '0E29196E66578EA50A494023@AdobeOrg',
        imsUserId: 'user-id-1',
      });
      expect(envelope.params.metadata['https://ns.adobe.com/a2a/extensions/adobe/ims-identity/v0']).toEqual({
        imsOrgId: '0E29196E66578EA50A494023@AdobeOrg',
        imsUserId: 'user-id-1',
      });
    });
  });

  describe('COA_MAX_ASSETS', () => {
    it('is 20', () => {
      expect(COA_MAX_ASSETS).toBe(20);
    });
  });
});

describe('originCoa', () => {
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  function imsTokenResponse() {
    return new Response(JSON.stringify({ access_token: FAKE_IMS_TOKEN, expires_in: 3600 }), { status: 200 });
  }

  it('rejects non-POST methods', async () => {
    const request = allowedRequest(undefined, { method: 'GET' });
    const response = await originCoa(request, makeEnv());
    expect(response.status).toBe(405);
  });

  it('rejects a request missing userPrompt or assets', async () => {
    const request = allowedRequest({ userPrompt: '', assets: [] });
    const response = await originCoa(request, makeEnv());
    expect(response.status).toBe(400);
  });

  it('caps assets at COA_MAX_ASSETS before building the prompt', async () => {
    fetchSpy.mockImplementation((url) => {
      if (String(url).includes('ims/token')) return Promise.resolve(imsTokenResponse());
      return Promise.resolve(new Response(JSON.stringify({ result: { status: { message: { parts: [] } } } }), { status: 200 }));
    });

    const tooManyAssets = Array.from({ length: 25 }, (_, i) => ({ id: `id-${i}`, name: `name-${i}` }));
    const request = allowedRequest({ userPrompt: 'test prompt', assets: tooManyAssets });
    const response = await originCoa(request, makeEnv());
    expect(response.status).toBe(200);

    const coaCall = fetchSpy.mock.calls.find(([url]) => !String(url).includes('ims/token'));
    const sentBody = JSON.parse(coaCall[1].body);
    const promptText = sentBody.params.message.parts[0].text;
    const assetIdCount = (promptText.match(/assetid=/g) || []).length;
    expect(assetIdCount).toBe(20);
  });

  it('maps a 401 from COA to "Failed to authenticate user"', async () => {
    fetchSpy.mockImplementation((url) => {
      if (String(url).includes('ims/token')) return Promise.resolve(imsTokenResponse());
      return Promise.resolve(new Response('Unauthorized', { status: 401 }));
    });

    const request = allowedRequest({ userPrompt: 'test', assets: [{ id: 'a1', name: 'x.jpg' }] });
    const response = await originCoa(request, makeEnv());
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('Failed to authenticate user');
  });

  it('maps a 500 from COA to a generic status-coded error', async () => {
    fetchSpy.mockImplementation((url) => {
      if (String(url).includes('ims/token')) return Promise.resolve(imsTokenResponse());
      return Promise.resolve(new Response('Server error', { status: 500 }));
    });

    const request = allowedRequest({ userPrompt: 'test', assets: [{ id: 'a1', name: 'x.jpg' }] });
    const response = await originCoa(request, makeEnv());
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toBe('COA request failed with status 500');
  });

  it('maps a 200 response containing data.error to a passthrough message', async () => {
    fetchSpy.mockImplementation((url) => {
      if (String(url).includes('ims/token')) return Promise.resolve(imsTokenResponse());
      return Promise.resolve(new Response(JSON.stringify({ error: { message: 'agent unavailable' } }), { status: 200 }));
    });

    const request = allowedRequest({ userPrompt: 'test', assets: [{ id: 'a1', name: 'x.jpg' }] });
    const response = await originCoa(request, makeEnv());
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toBe('agent unavailable');
  });

  it('returns the parts array on success and never forwards the raw envelope', async () => {
    const parts = [{ kind: 'data', data: { src: 'https://x.adobe.io/img.jpg' }, metadata: { schema: 'img-schema' } }];
    fetchSpy.mockImplementation((url) => {
      if (String(url).includes('ims/token')) return Promise.resolve(imsTokenResponse());
      return Promise.resolve(new Response(JSON.stringify({ result: { status: { message: { parts } } } }), { status: 200 }));
    });

    const request = allowedRequest({ userPrompt: 'test', assets: [{ id: 'a1', name: 'x.jpg' }] });
    const response = await originCoa(request, makeEnv());
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = await response.json();
    expect(body).toEqual({ parts });
    expect(body.result).toBeUndefined();

    const coaCall = fetchSpy.mock.calls.find(([url]) => !String(url).includes('ims/token'));
    const [, coaRequestInit] = coaCall;
    expect(coaRequestInit.headers['x-api-key']).toBe('client-id-1');
    expect(coaRequestInit.headers['x-request-id']).toBeTruthy();
    expect(coaRequestInit.headers['x-ims-client-id']).toBe('exc_app');

    const sentBody = JSON.parse(coaRequestInit.body);
    const imsIdentity = sentBody.params.metadata['https://ns.adobe.com/a2a/extensions/adobe/ims-identity/v0'];
    expect(imsIdentity.imsOrgId).toBe('B7F737215D35CC430A495EF5@AdobeOrg');
    expect(imsIdentity.imsUserId).toBe('fake-service-user-id');
  });

  it('caches the IMS token in KV and does not re-fetch it on the next call', async () => {
    let tokenFetches = 0;
    fetchSpy.mockImplementation((url) => {
      if (String(url).includes('ims/token')) {
        tokenFetches += 1;
        return Promise.resolve(imsTokenResponse());
      }
      return Promise.resolve(new Response(JSON.stringify({ result: { status: { message: { parts: [] } } } }), { status: 200 }));
    });

    const env = makeEnv();
    const request1 = allowedRequest({ userPrompt: 'test', assets: [{ id: 'a1', name: 'x.jpg' }] });
    await originCoa(request1, env);
    const request2 = allowedRequest({ userPrompt: 'test 2', assets: [{ id: 'a1', name: 'x.jpg' }] });
    await originCoa(request2, env);

    expect(tokenFetches).toBe(1);
  });
});

describe('originCoaImage', () => {
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  function imageRequest(src) {
    return new Request(`https://spark.example/api/adobe/coa/image?src=${encodeURIComponent(src)}`);
  }

  it('rejects a src on an untrusted host', async () => {
    const response = await originCoaImage(imageRequest('https://evil.example.com/img.jpg'), makeEnv());
    expect(response.status).toBe(400);
  });

  it('streams back a trusted-host image with the cached IMS token attached', async () => {
    fetchSpy.mockImplementation((url) => {
      if (String(url).includes('ims/token')) {
        return Promise.resolve(new Response(JSON.stringify({ access_token: FAKE_IMS_TOKEN, expires_in: 3600 }), { status: 200 }));
      }
      return Promise.resolve(new Response('image-bytes', { status: 200, headers: { 'content-type': 'image/jpeg' } }));
    });

    const response = await originCoaImage(imageRequest('https://foo.adobe.io/img.jpg'), makeEnv());
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');

    const imageCall = fetchSpy.mock.calls.find(([url]) => !String(url).includes('ims/token'));
    expect(imageCall[1].headers.Authorization).toBe(`Bearer ${FAKE_IMS_TOKEN}`);
  });
});
