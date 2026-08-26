/**
 * Environment configuration shared by all test suites.
 *
 * Set TEST_ENV to choose the target:
 *   production (default) | preview | local | branch:<name>
 */

const ENV_URLS = {
  production: 'https://frescopamedia.com',
  preview: 'https://preview.frescopamedia.com',
  local: 'http://localhost:8787',
};

/**
 * Return the base URL for the current test environment.
 */
export function getBaseUrl() {
  const env = process.env.TEST_ENV || 'production';

  // branch:my-feature → https://my-feature.dev.frescopamedia.com
  if (env.startsWith('branch:')) {
    const branch = env.split(':')[1];
    return `https://${branch}.dev.frescopamedia.com`;
  }

  return ENV_URLS[env] || ENV_URLS.production;
}

/**
 * Return a normalised environment name (production | preview | local | branch).
 */
export function getCurrentEnv() {
  const env = process.env.TEST_ENV || 'production';
  return env.startsWith('branch:') ? 'branch' : env;
}
