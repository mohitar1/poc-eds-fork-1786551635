import {
  describe, it, expect, beforeEach, afterEach,
} from 'vitest';

const { default: decorate } = await import('../exc-config.js');
const { parseExcConfigBlock, validateFacetRow } = await import('../../search-results/utils/exc-config-parser.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a block DOM element from a 2-D array of row/cell strings.
 * The first row represents the EDS block header row (skipped by decorate).
 */
function buildBlock(rows) {
  const block = document.createElement('div');
  rows.forEach((cells) => {
    const row = document.createElement('div');
    cells.forEach((text) => {
      const cell = document.createElement('div');
      cell.textContent = text;
      row.appendChild(cell);
    });
    block.appendChild(row);
  });
  return block;
}

/**
 * Build a standard excFacets block with the given data rows.
 * Automatically prepends the EDS header row, section header, and column headers.
 */
function buildExcFacetsBlock(dataRows = []) {
  return buildBlock([
    ['excFacets', '', '', '', '', '', ''],
    ['key', 'label', 'type', 'sortable', 'multiselect', 'filtertype', 'mincount'],
    ...dataRows,
  ]);
}

const BRAND_ROW = ['brand', 'Brand', 'string', 'false', 'true', 'checkbox', '0'];
const CAMPAIGN_ROW = ['campaign', 'Campaign', 'string', 'false', 'true', 'checkbox', '0'];

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  delete window.SearchResultsConfig;
  delete window.location;
  window.location = { hostname: 'localhost' };
});

afterEach(() => {
  document.body.innerHTML = '';
  delete window.SearchResultsConfig;
});

// ---------------------------------------------------------------------------
// validateFacetRow — pure unit tests
// ---------------------------------------------------------------------------

describe('validateFacetRow', () => {
  it('returns no errors for a valid row', () => {
    const errors = validateFacetRow(
      {
        key: 'brand', label: 'Brand', type: 'string', sortable: 'false', multiselect: 'true', filtertype: 'checkbox', mincount: '0',
      },
      3,
      new Set(),
    );
    expect(errors).toHaveLength(0);
  });

  it('reports missing required "key"', () => {
    const errors = validateFacetRow({ key: '', label: 'Brand' }, 3, new Set());
    expect(errors.some((e) => e.includes('"key"'))).toBe(true);
  });

  it('reports missing required "label"', () => {
    const errors = validateFacetRow({ key: 'brand', label: '' }, 3, new Set());
    expect(errors.some((e) => e.includes('"label"'))).toBe(true);
  });

  it('reports a duplicate key', () => {
    const seen = new Set(['brand']);
    const errors = validateFacetRow({ key: 'brand', label: 'Brand' }, 4, seen);
    expect(errors.some((e) => e.includes('Duplicate key'))).toBe(true);
  });

  it('reports an invalid "type" enum', () => {
    const errors = validateFacetRow({ key: 'brand', label: 'Brand', type: 'invalid' }, 3, new Set());
    expect(errors.some((e) => e.includes('Invalid type'))).toBe(true);
  });

  it('reports an invalid "filtertype" enum', () => {
    const errors = validateFacetRow({ key: 'brand', label: 'Brand', filtertype: 'slider' }, 3, new Set());
    expect(errors.some((e) => e.includes('Invalid filtertype'))).toBe(true);
  });

  it('reports an invalid boolean value for "sortable"', () => {
    const errors = validateFacetRow({ key: 'brand', label: 'Brand', sortable: 'yes' }, 3, new Set());
    expect(errors.some((e) => e.includes('"sortable"'))).toBe(true);
  });

  it('reports a non-numeric value for "mincount"', () => {
    const errors = validateFacetRow({ key: 'brand', label: 'Brand', mincount: 'abc' }, 3, new Set());
    expect(errors.some((e) => e.includes('"mincount"'))).toBe(true);
  });

  it('accepts enum values case-insensitively', () => {
    const errors = validateFacetRow({ key: 'brand', label: 'Brand', type: 'STRING' }, 3, new Set());
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// parseExcConfigBlock — parsing logic tests
// ---------------------------------------------------------------------------

describe('parseExcConfigBlock', () => {
  it('parses a single excFacets section correctly', () => {
    const block = buildExcFacetsBlock([BRAND_ROW, CAMPAIGN_ROW]);
    const { config, errors } = parseExcConfigBlock(block);

    expect(errors).toHaveLength(0);
    expect(config.excFacets).toBeDefined();
    expect(config.excFacets.brand).toEqual({
      label: 'Brand',
      type: 'string',
      sortable: false,
      multiSelect: true,
      filterType: 'checkbox',
      minCount: 0,
    });
    expect(config.excFacets.campaign).toEqual({
      label: 'Campaign',
      type: 'string',
      sortable: false,
      multiSelect: true,
      filterType: 'checkbox',
      minCount: 0,
    });
  });

  it('defaults type to "string" when omitted', () => {
    const block = buildExcFacetsBlock([['brand', 'Brand', '', 'false', 'true', 'checkbox', '0']]);
    const { config } = parseExcConfigBlock(block);
    expect(config.excFacets.brand.type).toBe('string');
  });

  it('defaults filterType to "checkbox" when omitted', () => {
    const block = buildExcFacetsBlock([['brand', 'Brand', 'string', '', '', '', '']]);
    const { config } = parseExcConfigBlock(block);
    expect(config.excFacets.brand.filterType).toBe('checkbox');
  });

  it('parses multiple sections (excFacets + incFacets)', () => {
    const block = buildBlock([
      ['excFacets', '', '', ''],
      ['key', 'label', 'type', 'sortable'],
      ['brand', 'Brand', 'string', 'false'],
      ['incFacets', '', '', ''],
      ['key', 'label', 'type', 'sortable'],
      ['productCategory', 'Category', 'string', 'true'],
    ]);
    const { config, errors } = parseExcConfigBlock(block);

    expect(errors).toHaveLength(0);
    expect(config.excFacets.brand).toBeDefined();
    expect(config.incFacets.productCategory).toBeDefined();
    expect(config.incFacets.productCategory.sortable).toBe(true);
  });

  it('does not carry duplicate-key state across sections', () => {
    const block = buildBlock([
      ['excFacets', '', ''],
      ['key', 'label', 'type'],
      ['brand', 'Brand', 'string'],
      ['incFacets', '', ''],
      ['key', 'label', 'type'],
      ['brand', 'Brand', 'string'], // same key is fine in a different section
    ]);
    const { errors } = parseExcConfigBlock(block);
    expect(errors).toHaveLength(0);
  });

  it('collects errors for invalid rows without stopping', () => {
    const block = buildExcFacetsBlock([
      ['', 'Brand', 'string', '', '', '', ''], // missing key
      CAMPAIGN_ROW, // valid — still parsed
    ]);
    const { config, errors } = parseExcConfigBlock(block);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('"key"');
    // valid row is still parsed
    expect(config.excFacets.campaign).toBeDefined();
  });

  it('reports duplicate keys within the same section', () => {
    const block = buildExcFacetsBlock([BRAND_ROW, BRAND_ROW]);
    const { errors } = parseExcConfigBlock(block);
    expect(errors.some((e) => e.includes('Duplicate key "brand"'))).toBe(true);
  });

  it('returns an empty config for a block with no rows', () => {
    const block = document.createElement('div');
    const { config, errors } = parseExcConfigBlock(block);
    expect(errors).toHaveLength(0);
    expect(Object.keys(config)).toHaveLength(0);
  });

  it('handles keys containing colons (e.g. dc:format)', () => {
    const block = buildExcFacetsBlock([['dc:format', 'Format', 'string', 'false', 'false', 'checkbox', '0']]);
    const { config, errors } = parseExcConfigBlock(block);
    expect(errors).toHaveLength(0);
    expect(config.excFacets['dc:format']).toBeDefined();
    expect(config.excFacets['dc:format'].label).toBe('Format');
  });
});

// ---------------------------------------------------------------------------
// decorate — integration tests
// ---------------------------------------------------------------------------

describe('decorate', () => {
  it('writes excFacets to window.SearchResultsConfig.externalParams', async () => {
    const block = buildExcFacetsBlock([BRAND_ROW]);
    await decorate(block);

    expect(window.SearchResultsConfig.externalParams.excFacets.brand).toBeDefined();
    expect(window.SearchResultsConfig.externalParams.excFacets.brand.label).toBe('Brand');
  });

  it('clears the block DOM after decoration', async () => {
    const block = buildExcFacetsBlock([BRAND_ROW]);
    await decorate(block);

    // Only the error box (if any) is allowed — no table rows remain
    expect(block.querySelectorAll('div > div').length).toBe(0);
  });

  it('preserves other keys already in externalParams', async () => {
    window.SearchResultsConfig = { externalParams: { hitsPerPage: 48 } };
    const block = buildExcFacetsBlock([BRAND_ROW]);
    await decorate(block);

    expect(window.SearchResultsConfig.externalParams.hitsPerPage).toBe(48);
    expect(window.SearchResultsConfig.externalParams.excFacets.brand).toBeDefined();
  });

  it('table config wins over a pre-existing excFacets value (coexistence)', async () => {
    window.SearchResultsConfig = {
      externalParams: {
        excFacets: { old: { label: 'Old', type: 'string' } },
      },
    };
    const block = buildExcFacetsBlock([BRAND_ROW]);
    await decorate(block);

    // Table-parsed excFacets replaces the pre-existing one
    expect(window.SearchResultsConfig.externalParams.excFacets.old).toBeUndefined();
    expect(window.SearchResultsConfig.externalParams.excFacets.brand).toBeDefined();
  });

  it('renders an error box in preview when validation fails', async () => {
    window.location = { hostname: 'localhost' };
    const block = buildExcFacetsBlock([
      ['', 'Brand', 'string', '', '', '', ''], // missing key
    ]);
    await decorate(block);

    const errorBox = block.querySelector('.exc-config-errors');
    expect(errorBox).not.toBeNull();
    expect(errorBox.textContent).toContain('Validation Failed');
  });

  it('does NOT render an error box in production even when validation fails', async () => {
    window.location = { hostname: 'www.example.com' };
    const block = buildExcFacetsBlock([
      ['', 'Brand', 'string', '', '', '', ''], // missing key
    ]);
    await decorate(block);

    expect(block.querySelector('.exc-config-errors')).toBeNull();
  });

  it('creates window.SearchResultsConfig if it does not exist', async () => {
    delete window.SearchResultsConfig;
    const block = buildExcFacetsBlock([BRAND_ROW]);
    await decorate(block);

    expect(window.SearchResultsConfig).toBeDefined();
    expect(window.SearchResultsConfig.externalParams.excFacets).toBeDefined();
  });
});
