// Minimal excerpt of the real cloudflare/src/auth.js for this eval.
// Line numbers/content of the withAuthentication function match the real
// template as of this eval's authoring — the DISABLE_AUTHENTICATION block
// starts commented out, matching the template's shipped starting state.

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
