/**
 * Normalize + validate model-generated metadata into the portal's facet vocabulary.
 *
 * The vision/LLM step (generate.js) returns a loose object; this module repairs it into
 * a strict, portal-ready shape (plan §2.7): clamps lengths, maps productCategory/channel
 * to the live facet vocabulary (null when there is no confident match — never invent a
 * one-off bucket), and cleans the keyword array. `company` and `dam:status` are stamped
 * by the controller, never by the model, so they are not handled here.
 */

import {
  TITLE_MAX, DESCRIPTION_MAX, KEYWORDS_MIN, KEYWORDS_MAX,
} from './constants.js';

// Default controlled vocabularies. Overridable per fork if the customer's facet buckets
// differ; keep these as the safe baseline drawn from the demo portal's excFacets.
export const DEFAULT_PRODUCT_CATEGORY_VOCAB = [
  'accounts', 'cards', 'loans', 'mortgages', 'insurance', 'investments',
  'payments', 'savings', 'business', 'wealth',
];

export const DEFAULT_CHANNEL_VOCAB = [
  'web', 'social', 'email', 'print', 'display', 'video', 'mobile', 'in-branch',
];

function clampString(value, max) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max).trim();
}

/**
 * Clean a keyword array: coerce to strings, lowercase, trim, drop empties, dedupe,
 * and cap at KEYWORDS_MAX. Returns [] when nothing usable is present.
 */
export function normalizeKeywords(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of input) {
    if (typeof raw !== 'string' && typeof raw !== 'number') continue;
    const kw = String(raw).trim().toLowerCase();
    if (!kw) continue;
    if (seen.has(kw)) continue;
    seen.add(kw);
    out.push(kw);
    if (out.length >= KEYWORDS_MAX) break;
  }
  return out;
}

/**
 * Map a loose value onto a controlled vocabulary, case-insensitively. Returns the
 * canonical vocab entry, or null when there is no confident match.
 */
export function mapToVocabulary(value, vocab) {
  if (typeof value !== 'string') return null;
  const needle = value.trim().toLowerCase();
  if (!needle) return null;
  const match = vocab.find((entry) => entry.toLowerCase() === needle);
  return match || null;
}

/**
 * Validate the raw model output shape. Returns { ok, errors } — non-blocking; the caller
 * repairs rather than rejects, but a completely unusable object (no title) is flagged.
 */
export function validateGeneratedShape(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: ['output is not an object'] };
  }
  if (typeof raw.title !== 'string' || !raw.title.trim()) {
    errors.push('missing title');
  }
  if (raw.description != null && typeof raw.description !== 'string') {
    errors.push('description must be a string');
  }
  if (raw.keywords != null && !Array.isArray(raw.keywords)) {
    errors.push('keywords must be an array');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Repair + normalize raw model output into portal-ready fields. Empty/undefined fields
 * are omitted (never written as empty strings). Returns a plain object holding only the
 * fields that survived normalization.
 */
export function normalizeGenerated(raw, options = {}) {
  const productCategoryVocab = options.productCategoryVocab || DEFAULT_PRODUCT_CATEGORY_VOCAB;
  const channelVocab = options.channelVocab || DEFAULT_CHANNEL_VOCAB;
  const out = {};

  const title = clampString(raw?.title, TITLE_MAX);
  if (title) out.title = title;

  const description = clampString(raw?.description, DESCRIPTION_MAX);
  if (description) out.description = description;

  const keywords = normalizeKeywords(raw?.keywords);
  if (keywords.length >= KEYWORDS_MIN) {
    out.keywords = keywords;
  } else if (keywords.length > 0) {
    // Fewer than the preferred minimum is still useful for filtering — keep them.
    out.keywords = keywords;
  }

  const productCategory = mapToVocabulary(raw?.productCategory, productCategoryVocab);
  if (productCategory) out.productCategory = productCategory;

  const channel = mapToVocabulary(raw?.channel, channelVocab);
  if (channel) out.channel = channel;

  const campaign = clampString(raw?.campaign, TITLE_MAX);
  if (campaign) out.campaign = campaign;

  const brand = clampString(raw?.brand, TITLE_MAX);
  if (brand) out.brand = brand;

  return out;
}
