import { Router } from 'itty-router';
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';
import config from './config.js';
import { createSession, getUser } from './user.js';
import { createSignedCookie, deleteCookie, isValidUrl, setCookie, validateSignedCookie } from './util/http.js';
import { maskEmail } from './util/log-utils.js';

/* Configure the path of a custom login/welcome page here.
   If not set (= undefined), unauthenticated users will always be redirected directly to the IDP login page.
   This page must be rendered by Helix or other origin without authentication (not done here). */
export const LOGIN_PAGE = '/public/welcome';

/* Configure the URL path prefix for auth flows here */
const AUTH_PREFIX = '/auth';

/* Cookie and request parameter names */
const COOKIE_SESSION = 'Session';
const COOKIE_STATE = 'State';
const COOKIE_LOGIN_VISITED = 'LoginVisited';
const ORIGINAL_URL_PARAM = 'url';

/* Required Cloudflare configuration = env variables.
   Entra tenant/client ids are now compile-time constants in config.js, not env vars. */
const REQUIRED_ENV_VARS = ['COOKIE_SECRET'];

async function createSessionJWT(request, env, session) {
  const payload = {
    ...session,
    // session id
    sid: crypto.randomUUID(),
  };

  const key = new TextEncoder().encode(await env.COOKIE_SECRET.get());

  const jwt = new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    // use current domain as issuer
    .setIssuer(request.uri.origin)
    // use same audience as MS entra IDP app
    .setAudience(config.MICROSOFT_ENTRA_CLIENT_ID)
    .setExpirationTime(config.SESSION_COOKIE_EXPIRATION)
    .setNotBefore('0m')
    .sign(key);

  return jwt;
}

async function validateSessionJWT(request, env, sessionJWT) {
  try {
    const key = new TextEncoder().encode(await env.COOKIE_SECRET.get());

    const { payload } = await jwtVerify(sessionJWT, key, {
      issuer: request.uri.origin,
      audience: config.MICROSOFT_ENTRA_CLIENT_ID,
      clockTolerance: 5,
    });
    return payload;
  } catch (error) {
    request.error = `Invalid ${COOKIE_SESSION} cookie: ${error.message}`;
    return null;
  }
}

async function validateMicrosoftSignInCallback(request, state) {
  const formData = await request.formData();
  if (formData.has('error')) {
    request.error = `Microsoft OIDC error: ${formData.get('error')} - ${formData.get('error_description')}`;
    return null;
  }

  if (!formData.has('id_token')) {
    request.error = 'Microsoft OIDC error: No id_token in form data';
    return null;
  }

  if (formData.get('state') !== state) {
    request.error = 'OIDC error: Invalid state parameter';
    return null;
  }

  return formData;
}

async function validateIdToken(request, rawIdToken, nonce) {
  const JWKS = createRemoteJWKSet(new URL(config.MICROSOFT_ENTRA_JWKS_URL));

  try {
    // validate id_token signature and expiry
    const { payload } = await jwtVerify(rawIdToken, JWKS, {
      audience: config.MICROSOFT_ENTRA_CLIENT_ID,
      issuer: `https://login.microsoftonline.com/${config.MICROSOFT_ENTRA_TENANT_ID}/v2.0`,
    });

    console.log('User login:', payload);

    // validate nonce
    if (payload.nonce !== nonce) {
      request.error = `OIDC error: Invalid nonce in id_token: ${payload.nonce}`;
      return null;
    }
    // validate tenant
    if (payload.tid !== config.MICROSOFT_ENTRA_TENANT_ID) {
      request.error = `OIDC error: Invalid tenant (tid) in id_token: ${payload.tid}`;
      return null;
    }
    return payload;
  } catch (error) {
    request.error = `OIDC error: Invalid id_token: ${error.message}`;
    return null;
  }
}

function unauthorized(request) {
  if (request.error) {
    console.warn(request.error);
    return new Response(`Unauthorized - ${request.error}`, { status: 401 });
  }
  return new Response('Unauthorized', { status: 401 });
}

function redirect(url, status = 302) {
  const response = new Response(null, { status });
  response.headers.set('Location', url);
  return response;
}

function redirectToLoginPage(request, seenBefore = request.cookies[COOKIE_LOGIN_VISITED]) {
  // build login page url
  const loginPage = new URL(request.uri.origin);

  // if login page was visited before, redirect to MS login directly (which might auto-SSO)
  loginPage.pathname = seenBefore ? `${AUTH_PREFIX}/login` : LOGIN_PAGE;

  // with original url path and query string as parameter
  const originalUrl = new URL(request.url);
  const url = originalUrl.pathname + originalUrl.search;
  if (url !== '/') {
    loginPage.searchParams.append(ORIGINAL_URL_PARAM, url);
  }

  const response = redirect(loginPage.href);

  // ensure session cookie is deleted (might be set but invalid)
  deleteCookie(response, COOKIE_SESSION);

  return response;
}

function getOriginalRedirectUrl(request, originalUrl) {
  let redirectUrl = `${request.uri.origin}/`;
  // get original redirect url from url param (if present)
  if (originalUrl?.startsWith('/') && originalUrl !== LOGIN_PAGE && originalUrl !== `${AUTH_PREFIX}/login`) {
    redirectUrl = originalUrl;
  }
  return redirectUrl;
}

/** middleware to check if user is authenticated */
export async function withAuthentication(request, env) {
  request.uri = new URL(request.url);

  // if (env.DISABLE_AUTHENTICATION === 'true') {
  //   request.user = {
  //     email: 'dev@localhost',
  //     name: 'Local Dev',
  //     roles: ['admin', 'employee'],
  //     permissions: ['preview', 'admin-reports', 'manage-rights', 'admin-rights', 'sudo'],
  //     countries: ['us'],
  //     userId: 'local-dev',
  //   };
  //   console.warn('Authentication is disabled because DISABLE_AUTHENTICATION is set');
  //   return;
  // }

  const sessionJWT = request.cookies[COOKIE_SESSION];
  if (!sessionJWT) {
    console.log('No session cookie found', request.url);
    return redirectToLoginPage(request);
  }

  const session = await validateSessionJWT(request, env, sessionJWT);
  if (!session) {
    console.warn(request.error);
    // if session cookie was found but invalid, user was previously logged in,
    // so let's send them straight to the MS login page which might auto-login them
    return redirectToLoginPage(request, true);
  }

  request.user = await getUser(request, env, session);
  if (!request.user) {
    request.error = request.error || 'User not allowed to access this application';
    return unauthorized(request);
  }

  // successfully authenticated
}

/** router for dedicated login & logout flows */
export const authRouter = Router({
  before: [
    (request, env) => {
      request.uri = new URL(request.url);

      const missing = REQUIRED_ENV_VARS.filter((v) => !env[v]);
      if (missing.length > 0) {
        console.error(`Missing required environment variables: ${missing.join(', ')}`);
        return new Response('Service Unavailable', { status: 503 });
      }
    },
  ],
});

authRouter
  // middleware for login page special cases
  .get(LOGIN_PAGE, async (request, env) => {
    if (env.DISABLE_AUTHENTICATION !== 'true') {
      // a) if no session cookie, but has seenBefore cookie, redirect to MS login directly
      const sessionJWT = request.cookies[COOKIE_SESSION];
      if (!sessionJWT && request.cookies[COOKIE_LOGIN_VISITED]) {
        return redirectToLoginPage(request, true);
      }

      // b) if valid session cookie, redirect to url param or main page
      const session = await validateSessionJWT(request, env, sessionJWT);
      if (session) {
        return redirect(getOriginalRedirectUrl(request, request.uri.searchParams.get(ORIGINAL_URL_PARAM)));
      }

      // c) otherwise show login page = do nothing here and pass through
    }
  })

  // start OIDC login flow
  .get(`${AUTH_PREFIX}/login`, async (request, env) => {
    // build redirect_uri
    const redirectUrl = new URL(request.uri.origin);
    redirectUrl.pathname = `${AUTH_PREFIX}/callback`;

    // find the original url
    const url = new URL(request.url);
    // first look for an explicit query parameter (if present)
    let originalUrl = url.searchParams.get(ORIGINAL_URL_PARAM);
    if (!originalUrl) {
      // fallback to Referer header
      const referer = isValidUrl(request.headers.get('Referer'));
      if (referer && referer.origin === request.uri.origin) {
        // extract the original url from the Referer header
        originalUrl = referer.searchParams.get(ORIGINAL_URL_PARAM);
      }
    }

    const state = {
      // pass over original url inside the state parameter as that's the only way to pass back user data
      state: crypto.randomUUID() + (originalUrl ? `|${originalUrl}` : ''),
      nonce: crypto.randomUUID(),
    };

    // redirect to MS login page
    const authorizeUrl =
      `https://login.microsoftonline.com/${config.MICROSOFT_ENTRA_TENANT_ID}/oauth2/v2.0/authorize?` +
      new URLSearchParams({
        client_id: config.MICROSOFT_ENTRA_CLIENT_ID,
        response_type: 'id_token',
        redirect_uri: redirectUrl.href,
        response_mode: 'form_post',
        scope: 'openid profile',
        state: state.state,
        nonce: state.nonce,
      });

    const response = redirect(authorizeUrl);

    const userAgent = request.headers.get('User-Agent');

    // store state in signed cookie
    await createSignedCookie(response, await env.COOKIE_SECRET.get(), COOKIE_STATE, state, {
      // SameSite=None in order to appear later in /auth/callback which is cross-site because it originates from the OIDC provider
      SameSite: 'None',
      // Chrome wants Secure with SameSite=None and ignores it for http://localhost. Safari does not like Secure on http://localhost (non SSL)
      Secure: userAgent?.includes('Chrome') || userAgent?.includes('Firefox') || request.uri.hostname !== 'localhost',
      // extra safe guarding, 10 minutes for the login flow should be enough
      MaxAge: 60 * 10,
    });

    // track visit of login page (special requirement)
    setCookie(response, COOKIE_LOGIN_VISITED, '1', {
      // "permanent" cookie
      Expires: new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000).toUTCString(),
    });

    return response;
  })

  // handle OIDC login callback
  .post(`${AUTH_PREFIX}/callback`, async (request, env) => {
    const state = await validateSignedCookie(request, await env.COOKIE_SECRET.get(), COOKIE_STATE);
    if (!state) {
      return unauthorized(request);
    }

    const formData = await validateMicrosoftSignInCallback(request, state.state);
    if (!formData) {
      return unauthorized(request);
    }

    request.idToken = await validateIdToken(request, formData.get('id_token'), state.nonce);
    if (!request.idToken) {
      return unauthorized(request);
    }

    const session = await createSession(request, env);
    if (!session) {
      request.error = request.error || 'User not allowed to access this application';
      return unauthorized(request);
    }

    const sessionJWT = await createSessionJWT(request, env, session);

    // Track login analytics event
    if (!session.userId) {
      console.warn(
        '[Analytics] Login event written with no user ID — user may be missing User ID in IDP token.',
        `email=${maskEmail(session.email)}`,
        `company=${session.company}`,
      );
    }
    const { trackAnalyticsEvent } = await import('./util/analytics-helper.js');
    await trackAnalyticsEvent(env, 'login', {
      userId: session.userId,
      country: session.country,
      employeeType: session.employeeType,
      company: session.company,
      roles: session.roles || [],
    });

    // Store/update user login for reporting
    const { upsertUserLogin } = await import('./api/user-logins.js');
    await upsertUserLogin(env, {
      email: session.email,
      userId: session.userId,
      fullName: session.name,
      title: session.title,
      country: session.country,
      employeeType: session.employeeType,
      company: session.company,
      roles: session.roles || [],
      permissions: session.permissions || [],
    });

    // get original redirect url from state parameter (if present)
    const redirectUrl = getOriginalRedirectUrl(request, state.state.split('|')[1]);

    const response = redirect(redirectUrl);

    // set session cookie
    setCookie(response, COOKIE_SESSION, sessionJWT, {
      // SameSite=Lax because this request is considered cross-site because it originates from the OIDC provider
      SameSite: 'Lax',
      // Safari does not like Secure on http://localhost (non SSL)
      Secure: request.uri.hostname !== 'localhost',
    });
    // remove temporary cookies
    deleteCookie(response, COOKIE_STATE);

    return response;
  })

  // trigger logout
  .get(`${AUTH_PREFIX}/logout`, withAuthentication, (request, _env) => {
    console.log('User logout:', request.user.email);

    // redirect to MS logout page
    const logoutUrl =
      `https://login.microsoftonline.com/${config.MICROSOFT_ENTRA_TENANT_ID}/oauth2/logout?` +
      new URLSearchParams({
        post_logout_redirect_uri: `${request.uri.origin}/en/`,
      });

    const response = redirect(logoutUrl);
    deleteCookie(response, COOKIE_SESSION);
    return response;
  })

  .all(`${AUTH_PREFIX}/*`, () => new Response('Not Found', { status: 404 }));
