/**
 * CLI config: argument parsing, customerKey -> paths, and credential resolution
 * (plan §3.0 / §1.5 reuse map). No new secret is introduced — the DM technical-account
 * creds collected in migration Phase B.7 (cloudflare/.secrets) are read at call time.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const FLAG_WITH_VALUE = new Set([
  'customer-key', 'dam-path', 'source-url', 'secrets-file', 'limit',
  'publish-target', 'write-mode', 'concurrency', 'report-file', 'fixture',
  'aem-env-id',
]);

const BOOLEAN_FLAGS = new Set(['dry-run', 'force', 'no-publish', 'bring-in']);

/** Slugify a customer/brand name into a folder-safe key (e.g. "Santander AG" -> santander-ag). */
export function slugify(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Parse a dotenv-style file into a plain object. */
export function parseEnvFile(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Resolve DM client credentials. Order: explicit env (SPARK_DM_CLIENT_ID/SECRET) ->
 * cloudflare/.secrets (SPARK_DM_CLIENT_ID/SECRET) -> root secret.env
 * (SPARK_DM_CLIENT_ID/SECRET). Throws with guidance when none are found.
 */
export function resolveCreds({ secretsFile, repoRoot = process.cwd(), env = process.env } = {}) {
  if (env.SPARK_DM_CLIENT_ID && env.SPARK_DM_CLIENT_SECRET) {
    return { clientId: env.SPARK_DM_CLIENT_ID, clientSecret: env.SPARK_DM_CLIENT_SECRET, source: 'env' };
  }

  const candidates = [
    { file: secretsFile || resolve(repoRoot, 'cloudflare/.secrets'), id: 'SPARK_DM_CLIENT_ID', secret: 'SPARK_DM_CLIENT_SECRET' },
    { file: resolve(repoRoot, 'secret.env'), id: 'SPARK_DM_CLIENT_ID', secret: 'SPARK_DM_CLIENT_SECRET' },
  ];

  for (const c of candidates) {
    if (!existsSync(c.file)) continue;
    const parsed = parseEnvFile(readFileSync(c.file, 'utf8'));
    if (parsed[c.id] && parsed[c.secret]) {
      return { clientId: parsed[c.id], clientSecret: parsed[c.secret], source: c.file };
    }
  }

  throw new Error(
    'No DM credentials found. Set SPARK_DM_CLIENT_ID/SPARK_DM_CLIENT_SECRET, or provide '
    + 'SPARK_DM_CLIENT_ID/SECRET in cloudflare/.secrets (migration Phase B.7).',
  );
}

/**
 * Resolve a pre-issued author IMS bearer token (AUTHOR_SPARK_IMS_TOKEN) and its paired
 * API key (AUTHOR_SPARK_IMS_API_KEY). When the token is present it is used verbatim and NO
 * client_credentials grant is performed; the paired API key is sent as `x-api-key` (the
 * author metadata endpoint validates x-api-key against the token's own client, so the DM
 * client id does not work with a Content-Hub-issued token). Order: env ->
 * cloudflare/.secrets -> root secret.env. Returns { token, apiKey, source } or null when
 * no token is set. A leading "Bearer " on the token is stripped.
 */
export function resolveImsToken({ secretsFile, repoRoot = process.cwd(), env = process.env } = {}) {
  const clean = (v) => v.replace(/^Bearer\s+/i, '').trim();

  const candidates = [
    secretsFile || resolve(repoRoot, 'cloudflare/.secrets'),
    resolve(repoRoot, 'secret.env'),
  ];

  // The API key may be supplied in the environment even when the token comes from a file
  // (and vice versa), so resolve it independently: env wins, then the first file that has it.
  const resolveApiKey = (fileParsed) => {
    if (env.AUTHOR_SPARK_IMS_API_KEY) return env.AUTHOR_SPARK_IMS_API_KEY.trim();
    if (fileParsed?.AUTHOR_SPARK_IMS_API_KEY) return fileParsed.AUTHOR_SPARK_IMS_API_KEY.trim();
    for (const file of candidates) {
      if (!existsSync(file)) continue;
      const parsed = parseEnvFile(readFileSync(file, 'utf8'));
      if (parsed.AUTHOR_SPARK_IMS_API_KEY) return parsed.AUTHOR_SPARK_IMS_API_KEY.trim();
    }
    return null;
  };

  if (env.AUTHOR_SPARK_IMS_TOKEN) {
    return {
      token: clean(env.AUTHOR_SPARK_IMS_TOKEN),
      apiKey: resolveApiKey(null),
      source: 'env',
    };
  }

  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const parsed = parseEnvFile(readFileSync(file, 'utf8'));
    if (parsed.AUTHOR_SPARK_IMS_TOKEN) {
      return {
        token: clean(parsed.AUTHOR_SPARK_IMS_TOKEN),
        apiKey: resolveApiKey(parsed),
        source: file,
      };
    }
  }

  return null;
}

/**
 * Resolve the AEM environment id (pNNN-eNNN), used to build the author host
 * (author-<aemEnvId>.adobeaemcloud.com). Order: explicit opt -> env AEM_ENV_ID ->
 * cloudflare/src/config.js (the worker's own AEM_ENV_ID). Throws when none resolve.
 */
export function resolveAemEnvId({ aemEnvId, repoRoot = process.cwd(), env = process.env } = {}) {
  const fromOpt = aemEnvId || env.AEM_ENV_ID || null;
  if (fromOpt) return fromOpt;

  const configFile = resolve(repoRoot, 'cloudflare/src/config.js');
  if (existsSync(configFile)) {
    const text = readFileSync(configFile, 'utf8');
    const m = text.match(/AEM_ENV_ID:\s*['"]([^'"]+)['"]/);
    if (m) return m[1];
  }

  throw new Error(
    'No AEM environment id found. Pass --aem-env-id pNNN-eNNN, set AEM_ENV_ID, '
    + 'or run from a repo whose cloudflare/src/config.js defines AEM_ENV_ID.',
  );
}

/**
 * Parse argv (process.argv.slice(2)) into a normalized options object.
 */
export function parseArgs(argv) {
  const opts = {
    dryRun: false,
    force: false,
    noPublish: false,
    bringIn: false,
    writeMode: 'bulk',
    concurrency: 4,
    publishTarget: 'AEM_PUBLISH',
    limit: null,
    sourceUrl: null,
    reportFile: null,
    customerKey: null,
    damPath: null,
    secretsFile: null,
    fixture: null,
    aemEnvId: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const name = token.slice(2);
    if (BOOLEAN_FLAGS.has(name)) {
      if (name === 'dry-run') opts.dryRun = true;
      else if (name === 'force') opts.force = true;
      else if (name === 'no-publish') opts.noPublish = true;
      else if (name === 'bring-in') opts.bringIn = true;
      continue;
    }
    if (FLAG_WITH_VALUE.has(name)) {
      const value = argv[i + 1];
      i += 1;
      switch (name) {
        case 'customer-key': opts.customerKey = slugify(value); break;
        case 'dam-path': opts.damPath = value; break;
        case 'source-url': opts.sourceUrl = value; break;
        case 'secrets-file': opts.secretsFile = value; break;
        case 'limit': opts.limit = Number(value); break;
        case 'publish-target': opts.publishTarget = value; break;
        case 'write-mode': opts.writeMode = value; break;
        case 'concurrency': opts.concurrency = Number(value); break;
        case 'report-file': opts.reportFile = value; break;
        case 'fixture': opts.fixture = value; break;
        case 'aem-env-id': opts.aemEnvId = value; break;
        default: break;
      }
    }
  }

  if (opts.customerKey && !opts.damPath) {
    opts.damPath = `/content/dam/${opts.customerKey}`;
  }
  if (opts.sourceUrl) opts.bringIn = true;

  return opts;
}

export function validateOptions(opts) {
  const errors = [];
  if (!opts.customerKey) errors.push('--customer-key is required');
  if (opts.writeMode && !['bulk', 'patch'].includes(opts.writeMode)) {
    errors.push(`--write-mode must be bulk|patch (got ${opts.writeMode})`);
  }
  if (opts.publishTarget && !['AEM_PUBLISH', 'DYNAMIC_MEDIA'].includes(opts.publishTarget)) {
    errors.push(`--publish-target must be AEM_PUBLISH|DYNAMIC_MEDIA (got ${opts.publishTarget})`);
  }
  return errors;
}
