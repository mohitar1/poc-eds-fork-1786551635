/**
 * Shared parser for the table-based excFacets (and other search config sections).
 *
 * Used by both:
 *  - blocks/exc-config/exc-config.js  (standalone config block)
 *  - blocks/search-results/search-results.js  (table embedded inside the block)
 */

export const FACET_SCHEMA = {
  required: ['key', 'label'],
  enums: {
    type: ['string', 'number', 'boolean', 'date'],
    filtertype: ['checkbox', 'dropdown', 'radio', 'multi-select'],
  },
  booleans: ['sortable', 'multiselect', 'hidden'],
  numbers: ['mincount'],
};

/**
 * Validate a single parsed facet row object against FACET_SCHEMA.
 * @param {Object} rowObj - Column-header-keyed object for the row
 * @param {number} rowIndex - Human-readable row number for error messages
 * @param {Set<string>} existingKeys - Already-seen keys within the current section
 * @returns {string[]} Array of error messages (empty = valid)
 */
export function validateFacetRow(rowObj, rowIndex, existingKeys) {
  const errors = [];

  FACET_SCHEMA.required.forEach((field) => {
    if (!rowObj[field]) {
      errors.push(`Row ${rowIndex}: Missing required column "${field}".`);
    }
  });

  if (rowObj.key) {
    if (existingKeys.has(rowObj.key)) {
      errors.push(`Row ${rowIndex}: Duplicate key "${rowObj.key}" detected.`);
    } else {
      existingKeys.add(rowObj.key);
    }
  }

  Object.entries(FACET_SCHEMA.enums).forEach(([field, allowedValues]) => {
    const val = rowObj[field]?.toLowerCase();
    if (val && !allowedValues.includes(val)) {
      errors.push(
        `Row ${rowIndex}: Invalid ${field} "${rowObj[field]}". Allowed: [${allowedValues.join(', ')}]`,
      );
    }
  });

  FACET_SCHEMA.booleans.forEach((field) => {
    const val = rowObj[field]?.toLowerCase();
    if (val && !['true', 'false'].includes(val)) {
      errors.push(`Row ${rowIndex}: "${field}" must be "true" or "false" (got "${rowObj[field]}").`);
    }
  });

  FACET_SCHEMA.numbers.forEach((field) => {
    if (rowObj[field] && Number.isNaN(Number(rowObj[field]))) {
      errors.push(`Row ${rowIndex}: "${field}" must be a number (got "${rowObj[field]}").`);
    }
  });

  return errors;
}

/**
 * Parse a block element's table rows into a config object.
 *
 * Expected table structure (EDS rows):
 *   Row 1  : block header — skipped (slice(1))
 *   Row 2  : section header — single populated cell, e.g. "excFacets"
 *   Row 3  : column headers — key | label | type | sortable | multiselect | filtertype | mincount
 *   Row 4+ : one facet per row
 *   (repeat Row 2–4+ for more sections)
 *
 * Rows before the first section header (e.g. standard key-value rows like
 * "hitsPerPage | 24") are silently ignored, making it safe to call this on
 * a mixed-content block such as search-results.
 *
 * @param {HTMLElement} block
 * @returns {{ config: Object, errors: string[] }}
 */
export function parseExcConfigBlock(block) {
  const config = {};
  const allErrors = [];
  let currentSection = null;
  let headers = null;
  let existingKeys = new Set();
  let sectionRowIdx = 0;

  [...block.children].forEach((row, idx) => {
    const cols = [...row.children].map((col) => col.textContent.trim());

    // Section header: only the first cell is populated
    const isSection = cols[0] && cols.slice(1).every((c) => !c);
    if (isSection) {
      [currentSection] = cols;
      config[currentSection] = {};
      headers = null;
      existingKeys = new Set();
      sectionRowIdx = idx;
      return;
    }

    if (!currentSection) return;

    // First non-section row within a section = column header row
    if (!headers) {
      headers = cols.map((h) => h.toLowerCase());
      return;
    }

    // Data row — map cells by header position
    const rowObj = {};
    headers.forEach((header, colIdx) => {
      rowObj[header] = cols[colIdx] || '';
    });

    const rowNumber = idx - sectionRowIdx + 1;
    const rowErrors = validateFacetRow(rowObj, rowNumber, existingKeys);

    if (rowErrors.length > 0) {
      allErrors.push(...rowErrors);
    } else {
      config[currentSection][rowObj.key] = {
        label: rowObj.label,
        type: rowObj.type || 'string',
        sortable: rowObj.sortable === 'true',
        multiSelect: rowObj.multiselect === 'true',
        filterType: rowObj.filtertype || 'checkbox',
        minCount: Number(rowObj.mincount) || 0,
      };
    }
  });

  return { config, errors: allErrors };
}
