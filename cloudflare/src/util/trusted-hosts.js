/**
 * @fileoverview Trusted-host check for COA-returned image/asset URLs.
 *
 * Ported from the Content Hub reference app's `isTrustedHost` (client-side) so the
 * Worker can decide, server-side, whether a COA response URL is safe to fetch with
 * the cached IMS bearer token before streaming it back to the browser.
 */

const TRUSTED_HOST_SUFFIXES = ['adobe.io', 'adobeaemcloud.com'];

/**
 * @param {string} src - URL to check
 * @returns {boolean} true if the URL is https (or localhost) and its hostname is
 *   exactly a trusted suffix or a subdomain of one
 */
export function isTrustedHost(src) {
  try {
    const { hostname, protocol } = new URL(src);
    if (hostname !== 'localhost' && protocol !== 'https:') {
      return false;
    }
    return TRUSTED_HOST_SUFFIXES.some(
      (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
    );
  } catch {
    return false;
  }
}
