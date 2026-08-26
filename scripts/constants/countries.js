/**
 * ISO-3166-1 alpha-2 country code to lowercase country name mapping.
 * Independent frontend copy of cloudflare/src/constants/countries.js — the worker and
 * frontend runtimes are decoupled, so this list must be kept in sync by hand if markets
 * change. Used only to recognize that a user's ISO country code (e.g. 'IN', from the
 * Entra ID `ctry` claim) refers to the same country as a full-name facet value (e.g.
 * 'india') — NOT to filter or translate the set of countries shown to a user.
 */
export const COUNTRY_CODE_TO_NAME = Object.freeze({
  us: 'usa',
  gb: 'uk',
  in: 'india',
  ca: 'canada',
  au: 'australia',
  de: 'germany',
  fr: 'france',
  it: 'italy',
  es: 'spain',
  pt: 'portugal',
  nl: 'netherlands',
  be: 'belgium',
  ch: 'switzerland',
  at: 'austria',
  se: 'sweden',
  no: 'norway',
  dk: 'denmark',
  fi: 'finland',
  pl: 'poland',
  ie: 'ireland',
  br: 'brazil',
  mx: 'mexico',
  jp: 'japan',
  cn: 'china',
  sg: 'singapore',
  ae: 'uae',
});

/**
 * Check whether a raw facet value refers to the same country as a given ISO code —
 * either by matching the code itself or its mapped full name, case-insensitively.
 * @param {string} facetValue - Raw facet value (code or full name, any case)
 * @param {string} isoCode - ISO-3166-1 alpha-2 country code to compare against
 * @returns {boolean}
 */
export function facetValueMatchesCountryCode(facetValue, isoCode) {
  if (!facetValue || !isoCode) return false;
  const normalizedValue = String(facetValue).trim().toLowerCase();
  const normalizedCode = String(isoCode).trim().toLowerCase();
  if (normalizedValue === normalizedCode) return true;
  return COUNTRY_CODE_TO_NAME[normalizedCode] === normalizedValue;
}
