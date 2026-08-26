/*
 * Copyright 2022 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { error, Router, withCookies } from 'itty-router';
import { analyticsApi, searchMetricsApi } from './api/analytics';
import { auditGetExportCsv, auditGetSummary, auditPostEvent } from './api/audit';
import { notificationsApi } from './api/notifications';
import { authRouter, withAuthentication } from './auth';
import { originCoa, originCoaImage } from './origin/coa';
import { originDynamicMedia } from './origin/dm';
import { originHelix } from './origin/helix';
import { isUserExcluded, parsePageExclusions } from './origin/page-access';
import { handleScheduledTokenRefresh } from './scheduled/token-refresh';
import { apiUser } from './user';
import { cors } from './util/itty';

// Shared CORS origins
const allowedOrigins = [
  'https://frescopamedia.com',
  'https://preview.frescopamedia.com',
  /https:\/\/.*\.dev\.frescopamedia\.com$/,
  /http:\/\/localhost:.*/,
];

const BLOCKED_TLS = ['TLSv1', 'TLSv1.1'];

/** Block requests using outdated TLS versions (1.0, 1.1). */
function withTlsCheck(request) {
  const { hostname } = new URL(request.url);
  if (hostname === 'localhost') return undefined;

  const tlsVersion = request.cf?.tlsVersion;
  if (BLOCKED_TLS.includes(tlsVersion)) {
    return new Response('Please use newer TLS version', { status: 403 });
  }
  return undefined;
}

/** Switch to AEM preview content for preview hostnames. */
function withPreviewOrigin(request, env) {
  const { hostname } = new URL(request.url);
  if (hostname === 'preview.frescopamedia.com') {
    request.helixOrigin = env.HELIX_ORIGIN.replace('.aem.live', '.aem.page');
    console.info(`Preview hostname detected: ${hostname}, using Helix origin: ${request.helixOrigin}`);
  }
}

const { preflight, corsify } = cors({
  origin: allowedOrigins,
  allowMethods: ['GET', 'POST', 'DELETE', 'PUT'],
  credentials: true,
  maxAge: 600,
});

const router = Router({
  before: [withTlsCheck, preflight, withPreviewOrigin],
  finally: [corsify],
  catch: (err) => {
    console.error('error', err);
    throw err;
  },
});

router
  // parse cookies (middleware)
  .all('*', (request) => {
    withCookies(request);
    for (const key in request.cookies) {
      request.cookies[key] = decodeURIComponent(request.cookies[key]);
    }
  })

  // login and logout flows (must come first)
  .all('*', authRouter.fetch)

  // redirect bare root to the default locale home (search-first portal)
  .get('/', (request) => Response.redirect(`${new URL(request.url).origin}/en/`, 302))

  // public static assets
  .get('/public/*', originHelix)
  .get('/tools/*', originHelix)
  .get('/scripts/*', originHelix)
  .get('/styles/*', originHelix)
  .get('/blocks/*', originHelix)
  .get('/fonts/*', originHelix)
  .get('/icons/*', originHelix)
  .get('/favicon.ico', originHelix)
  .get('/robots.txt', originHelix)

  // from here on authentication required (middleware)
  .all('*', withAuthentication)

  // restrict config/access paths to users with 'admin' permission
  .all('/config/access/*', (request) => {
    if (!request.user?.roles?.includes('admin')) {
      return new Response('Forbidden', { status: 403 });
    }
  })

  // user info
  .get('/api/user', apiUser)

  // dynamic media (asset proxy, search, metadata)
  .all('/api/adobe/assets/*', originDynamicMedia)

  // Content Optimization Agent (AI image renditions)
  .post('/api/adobe/coa/generate', originCoa)
  .get('/api/adobe/coa/image', originCoaImage)

  // Notifications API
  .all('/api/messages/*', notificationsApi)
  .all('/api/messages', notificationsApi)

  // Analytics API (D1 search metrics only)
  .get('/api/analytics/search-metrics', searchMetricsApi)
  .get('/api/analytics/test', analyticsApi)

  // Asset activity audit API (D1)
  .post('/api/audit/event', auditPostEvent)
  .get('/api/audit/summary', auditGetSummary)
  .get('/api/audit/export.csv', auditGetExportCsv)

  // catch-all for unknown API routes
  .all('/api/*', () => error(404))

  // all other routes: serve from Helix with page-level access control
  .all('*', async (request, env) => {
    const response = await originHelix(request, env);

    if (response.status === 404) {
      return Response.redirect(`${new URL(request.url).origin}/404.html`, 302);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') || !request.user) {
      return response;
    }

    if (request.user.roles?.includes('admin')) {
      return response;
    }

    const html = await response.clone().text();
    const exclusions = parsePageExclusions(html);
    if (isUserExcluded(request.user, exclusions)) {
      console.warn(
        `[PageAccess] Denied ${request.user.email} from ${new URL(request.url).pathname} (user roles: ${request.user.roles}, excluded: ${JSON.stringify(exclusions)})`,
      );
      return Response.redirect(`${new URL(request.url).origin}/404.html`, 302);
    }

    return response;
  });

export default {
  ...router,
  async scheduled(controller, env, ctx) {
    switch (controller.cron) {
      case '0 0 1 * *':
        console.info('[Cron] Monthly token refresh triggered');
        await handleScheduledTokenRefresh(env, ctx);
        break;

      default:
        console.warn(`[Cron] Unknown cron schedule: ${controller.cron}`);
    }
  },
};
