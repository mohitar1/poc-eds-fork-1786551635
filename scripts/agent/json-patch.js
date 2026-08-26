/**
 * Build an RFC-6902 JSON Patch for the per-asset PATCH /assets/{id}/metadata path
 * (plan §2.9). repositoryMetadata is read-only and must never be included. `company`
 * and `dam:status` are always added by the controller (not the model).
 *
 * JSON Pointer note: our metadata keys (dc:title, dam:status, …) contain no `/` or `~`,
 * so no pointer escaping is required; we still escape defensively.
 */

import { FIELD, STATUS_APPROVED } from './constants.js';

function jsonPointerEscape(key) {
  return key.replace(/~/g, '~0').replace(/\//g, '~1');
}

function addOp(path, value) {
  return { op: 'add', path: `/${jsonPointerEscape(path)}`, value };
}

/**
 * Build the JSON Patch array from a normalized fields object plus the scope/status the
 * controller enforces.
 *
 * @param {Object} fields normalized generated fields (title, description, keywords,
 *   productCategory, campaign, channel, brand)
 * @param {Object} scope { company, status = 'approved' } — always applied
 * @returns {Array<{op,path,value}>}
 */
export function buildMetadataPatch(fields = {}, scope = {}) {
  const ops = [];

  if (fields.title) ops.push(addOp(FIELD.TITLE, fields.title));
  if (fields.description) ops.push(addOp(FIELD.DESCRIPTION, fields.description));
  if (Array.isArray(fields.keywords) && fields.keywords.length > 0) {
    ops.push(addOp(FIELD.SUBJECT, fields.keywords));
  }
  if (fields.productCategory) ops.push(addOp(FIELD.PRODUCT_CATEGORY, fields.productCategory));
  if (fields.campaign) ops.push(addOp(FIELD.CAMPAIGN, fields.campaign));
  if (fields.channel) ops.push(addOp(FIELD.CHANNEL, fields.channel));
  if (fields.brand) ops.push(addOp(FIELD.BRAND, fields.brand));

  // Scope + approval are always stamped by the controller.
  if (scope.company) ops.push(addOp(FIELD.COMPANY, scope.company));
  ops.push(addOp(FIELD.STATUS, scope.status || STATUS_APPROVED));

  return ops;
}

export const JSON_PATCH_CONTENT_TYPE = 'application/json-patch+json';
