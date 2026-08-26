/**
 * Build the bulk metadata-import CSV (plan §2.9).
 *
 * `POST /assets/metadata/import` takes a UTF-8 CSV (RFC-4180). The first column is an
 * identifier column (`assetId` and/or `assetPath`); every other column is a typed
 * property header `prop[type]`. An empty cell means "no change". Multi-value (`string[]`)
 * cells are a JSON array serialized then CSV-escaped, e.g. `["a","b"]` becomes the CSV
 * field `"[""a"",""b""]"`.
 */

import { CSV_MAX_BYTES, FIELD } from './constants.js';

// Registry mapping a normalized row key -> { header, array } for the CSV column.
const COLUMN_REGISTRY = [
  { key: 'title', header: `${FIELD.TITLE}[string]` },
  { key: 'description', header: `${FIELD.DESCRIPTION}[string]` },
  { key: 'keywords', header: `${FIELD.SUBJECT}[string[]]`, array: true },
  { key: 'productCategory', header: `${FIELD.PRODUCT_CATEGORY}[string]` },
  { key: 'campaign', header: `${FIELD.CAMPAIGN}[string]` },
  { key: 'channel', header: `${FIELD.CHANNEL}[string]` },
  { key: 'brand', header: `${FIELD.BRAND}[string]` },
  { key: 'company', header: `${FIELD.COMPANY}[string]` },
  { key: 'status', header: `${FIELD.STATUS}[string]` },
];

/**
 * RFC-4180 escape a single CSV field. Wraps in double quotes (doubling any interior
 * quotes) when the value contains a quote, comma, or newline. Empty stays empty.
 */
export function csvEscapeCell(value) {
  if (value == null || value === '') return '';
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Serialize a string[] value to its pre-escape JSON-array form: ["a","b"].
 * csvEscapeCell then wraps/doubles it into the final CSV field.
 */
export function serializeArrayCell(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return '';
  return `[${arr.map((v) => `"${String(v)}"`).join(',')}]`;
}

/**
 * Build the CSV text from normalized rows.
 * @param {Object[]} rows each row: { assetId?, assetPath?, title?, description?,
 *   keywords?, productCategory?, campaign?, channel?, brand?, company?, status? }
 * @param {Object} [options]
 * @param {'assetPath'|'assetId'} [options.idColumn='assetPath'] identifier column
 * @returns {{ csv: string, byteLength: number, exceedsMax: boolean, columns: string[] }}
 */
export function buildMetadataCsv(rows, options = {}) {
  const idColumn = options.idColumn || 'assetPath';
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      csv: '', byteLength: 0, exceedsMax: false, columns: [],
    };
  }

  // Only include columns that at least one row populates (avoids stray headers -> 422).
  const usedColumns = COLUMN_REGISTRY.filter((col) => rows.some((row) => {
    const val = row[col.key];
    if (col.array) return Array.isArray(val) && val.length > 0;
    return val != null && val !== '';
  }));

  const headerCells = [idColumn, ...usedColumns.map((c) => c.header)];
  const lines = [headerCells.map(csvEscapeCell).join(',')];

  for (const row of rows) {
    const idValue = row[idColumn] ?? row.assetPath ?? row.assetId ?? '';
    const cells = [csvEscapeCell(idValue)];
    for (const col of usedColumns) {
      const raw = col.array ? serializeArrayCell(row[col.key]) : row[col.key];
      cells.push(csvEscapeCell(raw));
    }
    lines.push(cells.join(','));
  }

  const csv = lines.join('\r\n');
  const byteLength = Buffer.byteLength(csv, 'utf8');
  return {
    csv,
    byteLength,
    exceedsMax: byteLength > CSV_MAX_BYTES,
    columns: headerCells,
  };
}

/**
 * Split rows into multiple CSV jobs so no single CSV exceeds CSV_MAX_BYTES
 * ([EDGE-IMPORT-SPLIT]). Greedy: grow a batch until the built CSV would exceed the cap.
 */
export function buildMetadataCsvBatches(rows, options = {}) {
  const batches = [];
  let current = [];
  for (const row of rows) {
    const candidate = [...current, row];
    const built = buildMetadataCsv(candidate, options);
    if (built.exceedsMax && current.length > 0) {
      batches.push(buildMetadataCsv(current, options));
      current = [row];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) {
    batches.push(buildMetadataCsv(current, options));
  }
  return batches;
}
