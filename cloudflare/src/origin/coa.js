/**
 * @fileoverview Content Optimization Agent (COA) Origin Handler
 *
 * Proxies COA "generate renditions" requests server-side. The browser holds no
 * Adobe IMS token, so this Worker builds the full JSON-RPC/A2A envelope and
 * authenticates on the browser's behalf. COA is called with the same DM S2S
 * technical account as Dynamic Media, so this reuses `dm.js`'s `getIMSToken`
 * rather than minting/caching a second token under separate COA credentials.
 * The `x-api-key` follows the same rule `originDynamicMedia` uses for every
 * non-collections DM call: the DM client id itself, not the collections-only
 * `aem-assets-content-hub-1` key.
 *
 * @module origin/coa
 */

import { decodeJwt } from 'jose';
import config from '../config.js';
import { getIMSToken } from './dm.js';
import { isTrustedHost } from '../util/trusted-hosts.js';

const COA_ENDPOINTS = {
  prod: 'https://aem-content-optimizer-agent.adobe.io/',
  stage: 'https://aem-assets-adobe-aem-content-optimisation-agent-dep-e3caae.stage.cloud.adobe.io/',
};

/** IMS extension metadata key COA expects for identifying the calling user's org/id */
const IMS_IDENTITY_METADATA_KEY = 'https://ns.adobe.com/a2a/extensions/adobe/ims-identity/v0';

export const COA_MAX_ASSETS = 20;

/**
 * @param {string} aemEnvId - e.g. 'p203220-e2129061'
 * @returns {string} delivery domain, e.g. 'delivery-p203220-e2129061.adobeaemcloud.com'
 */
export function deliveryDomainFromEnvId(aemEnvId) {
  return `delivery-${aemEnvId}.adobeaemcloud.com`;
}

export function resolveCOAEndpoint() {
  return config.COA_ENV === 'stage' ? COA_ENDPOINTS.stage : COA_ENDPOINTS.prod;
}

export function buildFullPrompt(userPrompt, assets, deliveryDomain) {
  const assetContext = assets
    .map((a) => `assetid=${a.id}, delivery_domain=${deliveryDomain}, assetName=${a.name}`)
    .join('. ');
  return `${userPrompt}. ${assetContext}`;
}

export function buildCOAEnvelope(fullPrompt, { imsOrgId, imsUserId }) {
  return {
    jsonrpc: '2.0',
    id: crypto.randomUUID(),
    method: 'message/send',
    params: {
      message: {
        role: 'user',
        parts: [{ kind: 'text', text: fullPrompt }],
        messageId: crypto.randomUUID(),
      },
      metadata: {
        [IMS_IDENTITY_METADATA_KEY]: { imsOrgId, imsUserId },
        chatId: crypto.randomUUID(),
        interactionId: crypto.randomUUID(),
        createdDate: new Date().toISOString(),
        applicationName: 'assethub-spark',
        upstreamClient: 'web-ui',
        userSurface: 'search-bar',
        pageContext: {},
        messageEntities: {},
        userPermissions: {},
        isTestRequest: false,
      },
    },
  };
}

/**
 * @param {Request} request
 * @param {Object} env
 * @returns {Promise<Response>}
 */
export async function originCoa(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  const { userPrompt, assets } = payload ?? {};
  if (typeof userPrompt !== 'string' || !userPrompt.trim() || !Array.isArray(assets) || assets.length === 0) {
    return new Response('Invalid request: userPrompt and assets are required', { status: 400 });
  }

  const cappedAssets = assets.slice(0, COA_MAX_ASSETS).map((a) => ({ id: a.id, name: a.name }));

  const deliveryDomain = deliveryDomainFromEnvId(config.AEM_ENV_ID);
  const fullPrompt = buildFullPrompt(userPrompt, cappedAssets, deliveryDomain);

  const imsToken = await getIMSToken(request, env);
  if (!imsToken) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Both must come from the same token — mixing this token's user_id with an
  // org id from a different IMS identity fails COA's payload validation.
  const { org: imsOrgId, user_id: imsUserId } = decodeJwt(imsToken);
  const envelope = buildCOAEnvelope(fullPrompt, { imsOrgId, imsUserId });
  const endpoint = resolveCOAEndpoint();

  const coaHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${imsToken}`,
    'x-ims-client-id': 'exc_app',
    'x-api-key': await env.DM_CLIENT_ID.get(),
    'x-request-id': crypto.randomUUID(),
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: coaHeaders,
    body: JSON.stringify(envelope),
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      return Response.json({ error: 'Failed to authenticate user' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    }
    return Response.json(
      { error: `COA request failed with status ${response.status}` },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const data = await response.json();
  if (data.error) {
    return Response.json(
      { error: data.error.message ?? 'COA returned an error' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const parts = data?.result?.status?.message?.parts ?? [];
  return Response.json({ parts }, { headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Streams a COA-returned image/asset URL back to the browser, attaching the
 * cached DM IMS token only if the URL's host is on the trusted allowlist.
 * The browser has no IMS token of its own, so this proxy is what makes
 * `<img>`/download URLs in the renditions grid work at all.
 *
 * @param {Request} request
 * @param {Object} env
 * @returns {Promise<Response>}
 */
export async function originCoaImage(request, env) {
  const url = new URL(request.url);
  const src = url.searchParams.get('src');
  if (!src || !isTrustedHost(src)) {
    return new Response('Invalid or untrusted src', { status: 400 });
  }

  const imsToken = await getIMSToken(request, env);
  if (!imsToken) {
    return new Response('Unauthorized', { status: 401 });
  }

  const upstream = await fetch(src, {
    headers: { Authorization: `Bearer ${imsToken}` },
  });

  const headers = new Headers(upstream.headers);
  headers.set('Cache-Control', 'no-store');
  return new Response(upstream.body, { status: upstream.status, headers });
}
