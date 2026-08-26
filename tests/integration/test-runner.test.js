/**
 * Config-driven integration test runner.
 *
 * Reads every feature + test defined in test-config.js and generates
 * vitest `describe` / `it` blocks automatically.  No per-feature test
 * files needed — just add entries to the config.
 */

import { beforeAll, describe, it } from 'vitest';
import { testConfig } from './test-config.js';
import { makeRequest } from './setup/auth.js';
import { getBaseUrl, getCurrentEnv } from './setup/env.js';
import { assertExpectations, getExpectations } from './setup/assertions.js';

/* ------------------------------------------------------------------ */
/*  Pre-flight: bail early if the session cookie is missing            */
/* ------------------------------------------------------------------ */

const cookie = process.env.TEST_SESSION_COOKIE;

if (!cookie) {
  // eslint-disable-next-line no-console
  console.error([
    '',
    '  ✖ TEST_SESSION_COOKIE is not set — skipping all integration tests.',
    '',
    '  To fix:',
    '    1. Open DevTools → Application → Cookies',
    '    2. Copy the "session" cookie for frescopamedia.com',
    '    3. export TEST_SESSION_COOKIE="<value>"',
    '    4. Re-run the tests',
    '',
  ].join('\n'));

  describe('integration tests', () => {
    it.skip('requires TEST_SESSION_COOKIE', () => {});
  });
} else {
  /* ---------------------------------------------------------------- */
  /*  Normal run                                                       */
  /* ---------------------------------------------------------------- */

  const baseUrl = getBaseUrl();
  const env = getCurrentEnv();

  // eslint-disable-next-line no-console
  console.log(`\n  Integration tests → ${baseUrl}  (env: ${env})\n`);

  describe('integration tests', () => {
    // Sanity-check: make sure the cookie is still valid before running
    // all individual tests.  Use redirect: 'manual' so a 302 to the
    // login page is detected rather than silently followed.
    beforeAll(async () => {
      // Decode JWT expiry for a helpful message (middle segment is the payload)
      let expiryInfo = '';
      try {
        const payload = JSON.parse(atob(cookie.split('.')[1]));
        if (payload.exp) {
          const expiresAt = new Date(payload.exp * 1000);
          const now = new Date();
          const diffMs = expiresAt - now;
          if (diffMs < 0) {
            const agoMin = Math.round(-diffMs / 60000);
            expiryInfo = `\n  Cookie expired ${agoMin} minutes ago (at ${expiresAt.toISOString()}).`;
          } else {
            const inMin = Math.round(diffMs / 60000);
            // eslint-disable-next-line no-console
            console.log(`  Session cookie valid for ~${inMin} more minutes (expires ${expiresAt.toISOString()})\n`);
          }
        }
      } catch { /* ignore decode errors */ }

      const res = await makeRequest('/api/user', { redirect: 'manual' });
      if (res.status === 302 || res.status === 401 || res.status === 403) {
        throw new Error(
          `Session cookie appears expired or invalid (GET /api/user returned ${res.status}).${expiryInfo}\n`
          + 'Get a fresh cookie from the browser and re-export TEST_SESSION_COOKIE.',
        );
      }
    });

    Object.entries(testConfig).forEach(([feature, suites]) => {
      describe(feature, () => {
        /* ---------- API tests ---------- */
        if (suites.api?.length) {
          describe('API', () => {
            suites.api.forEach((spec) => {
              const testFn = spec.skip ? it.skip : it;
              testFn(`${spec.name} (${spec.method || 'GET'} ${spec.path})`, async () => {
                // API endpoints should never redirect — use manual to
                // catch auth redirects as real failures.
                const response = await makeRequest(spec.path, {
                  method: spec.method || 'GET',
                  body: spec.body,
                  query: spec.query,
                  headers: spec.headers,
                  redirect: 'manual',
                });

                const expectations = getExpectations(spec);
                assertExpectations(response, expectations);
              }, spec.timeout); // per-test timeout (falls back to vitest default)
            });
          });
        }

        /* ---------- Page load tests ---------- */
        if (suites.pages?.length) {
          describe('Pages', () => {
            suites.pages.forEach((spec) => {
              const testFn = spec.skip ? it.skip : it;
              testFn(`${spec.name} (${spec.path})`, async () => {
                // Pages may legitimately redirect (e.g. trailing slash,
                // EDS/Helix routing) — follow them.
                const response = await makeRequest(spec.path, {
                  method: 'GET',
                  query: spec.query,
                  redirect: 'follow',
                });

                const expectations = getExpectations(spec);
                assertExpectations(response, expectations);
              });
            });
          });
        }
      });
    });
  });
}
