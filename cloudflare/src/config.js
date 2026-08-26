/**
 * Static worker configuration — single source of truth.
 *
 * Convention (see CLAUDE.md): configuration values that do NOT vary per
 * environment live here in code, not in wrangler.jsonc. Only genuinely
 * per-deploy values (HELIX_ORIGIN, worker name, route), secrets, and
 * bindings (KV/D1/Secret Store/Analytics Engine) stay in wrangler.jsonc.
 *
 * These values rarely change; when a partner/AI needs to adapt the worker
 * to a new tenant, this file plus wrangler.jsonc are the two places to edit.
 */

const config = {
  // AEM environment (Program-Environment) id for the backing DM tenant.
  AEM_ENV_ID: 'p203220-e2129061',

  // Content Optimization Agent environment. COA is called with the same DM
  // S2S technical account/token as Dynamic Media, so this must match whatever
  // IMS environment that account's credentials were issued against — not an
  // independent per-deploy choice.
  COA_ENV: 'prod',

  // Helix push-invalidation mode. 'disabled' turns off cache purge on publish.
  HELIX_PUSH_INVALIDATION: 'disabled',

  // Microsoft Entra ID (Azure AD) app used for SSO login.
  MICROSOFT_ENTRA_TENANT_ID: '983cbc50-8ad1-4dde-b705-7c80477a4186',
  MICROSOFT_ENTRA_CLIENT_ID: '93e6431f-2f57-4612-96c8-1464640b4280',
  // Entra common JWKS endpoint (tenant-independent) for id_token signature checks.
  MICROSOFT_ENTRA_JWKS_URL: 'https://login.microsoftonline.com/common/discovery/keys',

  // Lifetime of our own session JWT cookie.
  SESSION_COOKIE_EXPIRATION: '6h',

  // Cloudflare account id owning the Analytics Engine dataset queried by the analytics API.
  ANALYTICS_ACCOUNT_ID: 'd3259185ae56522248254092489d6755',

  // Alphabet for sqids id obfuscation.
  // NOTE: not yet consumed by shipping code — sqids encoding is a TODO
  // (see src/api/__tests__/audit-summary.test.js). Kept here so it lands
  // in the central config when that feature is implemented.
  SQIDS_ALPHABET: '8gGQeDOJsS069Pod4mU2BKWRXjpiThLkZEHCantwuV7IrcqfAzMbN3vx1YlF5y',
};

export default Object.freeze(config);
