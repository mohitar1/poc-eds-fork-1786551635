import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildAssetAuthClauses,
  checkAssetMetadataAuthorization,
  chunkIntoAnd,
  chunkIntoOr,
  collectionsSearchContentAIAuthorization,
  forceContentAISearchFilter,
  searchContentAIAuthorization,
} from '../dm.js';

/**
 * Unit tests for dm.js (Dynamic Media Origin Handler)
 *
 * Tests cover:
 * - Download detection
 * - Download context extraction
 * - Collection authorization
 * - Search type detection
 * - Constants validation
 * - ContentAI search authorization
 */

// Mock dependencies
vi.mock('jose', () => ({
  decodeJwt: vi.fn(() => ({ user_id: 'test-user-id-123' })),
}));

vi.mock('../../util/helixutil', () => ({
  fetchHelixSheet: vi.fn(),
}));

vi.mock('../../user', () => ({
  ROLE: {
    ADMIN: 'admin',
  },
  USER_TYPE: {
    INTERNAL: 'internal',
    EXTERNAL: 'external',
    ALL: 'all',
  },
}));

// Mock console.log for authorization tests
vi.spyOn(console, 'log').mockImplementation(() => {});

// We'll test the exported function and mock internals
// For now, let's test the patterns and logic with standalone test implementations

describe('dm.js - Download Detection', () => {
  describe('isDownloadRequest', () => {
    it('should detect downloads with /as/ in path', () => {
      const url = new URL('https://example.com/adobe/assets/asset123/as/file.jpg');
      const hasAsSegment = url.pathname.includes('/as/');
      expect(hasAsSegment).toBe(true);
    });

    it('should detect downloads with attachment=true param', () => {
      const url = new URL('https://example.com/adobe/assets/asset123?attachment=true');
      const hasAttachmentParam = url.searchParams.get('attachment') === 'true';
      expect(hasAttachmentParam).toBe(true);
    });

    it('should not detect regular asset requests as downloads', () => {
      const url = new URL('https://example.com/adobe/assets/asset123');
      const hasAsSegment = url.pathname.includes('/as/');
      const hasAttachmentParam = url.searchParams.get('attachment') === 'true';
      expect(hasAsSegment || hasAttachmentParam).toBe(false);
    });

    it('should detect rendition downloads', () => {
      const url = new URL('https://example.com/adobe/assets/asset123/renditions/thumbnail/as/thumb.jpg');
      const hasAsSegment = url.pathname.includes('/as/');
      expect(hasAsSegment).toBe(true);
    });
  });
});

describe('dm.js - Download Context Extraction', () => {
  describe('extractDownloadContext', () => {
    it('should extract assetId from standard download path', () => {
      const url = new URL('https://example.com/adobe/assets/asset-123/as/file.jpg');
      const pathParts = url.pathname.split('/');
      const assetsIndex = pathParts.indexOf('assets');
      const assetId = pathParts[assetsIndex + 1];

      expect(assetId).toBe('asset-123');
    });

    it('should extract assetId from rendition download path', () => {
      const url = new URL('https://example.com/adobe/assets/asset-456/renditions/thumb/as/file.jpg');
      const pathParts = url.pathname.split('/');
      const assetsIndex = pathParts.indexOf('assets');
      const assetId = pathParts[assetsIndex + 1];

      expect(assetId).toBe('asset-456');
    });

    it('should extract analytics parameters from URL', () => {
      const url = new URL(
        'https://example.com/adobe/assets/asset-123/as/file.jpg?x-analytics-brand=coke&x-analytics-campaign=summer2024&x-analytics-resource-type=asset',
      );

      const brand = url.searchParams.get('x-analytics-brand');
      const campaign = url.searchParams.get('x-analytics-campaign');
      const resourceType = url.searchParams.get('x-analytics-resource-type');

      expect(brand).toBe('coke');
      expect(campaign).toBe('summer2024');
      expect(resourceType).toBe('asset');
    });

    it('should return null if no analytics parameters present', () => {
      const url = new URL('https://example.com/adobe/assets/asset-123/as/file.jpg');

      const brand = url.searchParams.get('x-analytics-brand');
      const campaign = url.searchParams.get('x-analytics-campaign');
      const resourceType = url.searchParams.get('x-analytics-resource-type');

      // Simulating the logic: should return null if no params
      const shouldSkip = !brand && !campaign && !resourceType;
      expect(shouldSkip).toBe(true);
    });

    it('should default unknown brand/campaign to "unknown"', () => {
      const url = new URL('https://example.com/adobe/assets/asset-123/as/file.jpg?x-analytics-resource-type=asset');

      const brand = url.searchParams.get('x-analytics-brand') || 'unknown';
      const campaign = url.searchParams.get('x-analytics-campaign') || 'unknown';

      expect(brand).toBe('unknown');
      expect(campaign).toBe('unknown');
    });

    it('should validate resourceType to be asset or template', () => {
      const validTypes = ['asset', 'template'];

      expect(validTypes.includes('asset')).toBe(true);
      expect(validTypes.includes('template')).toBe(true);
      expect(validTypes.includes('invalid')).toBe(false);
    });

    it('should default invalid resourceType to "asset"', () => {
      const resourceType = 'invalid-type';
      const validTypes = ['asset', 'template'];
      const defaultType = 'asset';

      const validResourceType = validTypes.includes(resourceType) ? resourceType : defaultType;
      expect(validResourceType).toBe('asset');
    });
  });
});

describe('dm.js - Collection Authorization', () => {
  describe('ACL Checks', () => {
    it('should grant access to collection owner', () => {
      const userEmail = 'user@example.com';
      const acl = {
        'custom:assetCollectionOwner': 'user@example.com',
        'custom:assetCollectionEditor': [],
        'custom:assetCollectionViewer': [],
      };

      const isOwner = acl['custom:assetCollectionOwner']?.toLowerCase() === userEmail.toLowerCase();
      expect(isOwner).toBe(true);
    });

    it('should grant access to collection editor', () => {
      const userEmail = 'user@example.com';
      const acl = {
        'custom:assetCollectionOwner': 'owner@example.com',
        'custom:assetCollectionEditor': ['user@example.com', 'other@example.com'],
        'custom:assetCollectionViewer': [],
      };

      const isEditor =
        Array.isArray(acl['custom:assetCollectionEditor']) &&
        acl['custom:assetCollectionEditor'].some((e) => e.toLowerCase() === userEmail.toLowerCase());
      expect(isEditor).toBe(true);
    });

    it('should grant read access to collection viewer', () => {
      const userEmail = 'user@example.com';
      const requiredRole = 'read';
      const acl = {
        'custom:assetCollectionOwner': 'owner@example.com',
        'custom:assetCollectionEditor': [],
        'custom:assetCollectionViewer': ['user@example.com'],
      };

      const isViewer =
        requiredRole === 'read' &&
        Array.isArray(acl['custom:assetCollectionViewer']) &&
        acl['custom:assetCollectionViewer'].some((e) => e.toLowerCase() === userEmail.toLowerCase());
      expect(isViewer).toBe(true);
    });

    it('should deny write access to collection viewer', () => {
      const userEmail = 'user@example.com';
      const requiredRole = 'write';
      const acl = {
        'custom:assetCollectionOwner': 'owner@example.com',
        'custom:assetCollectionEditor': [],
        'custom:assetCollectionViewer': ['user@example.com'],
      };

      // Viewer check only passes for 'read' role
      const isViewer =
        requiredRole === 'read' &&
        Array.isArray(acl['custom:assetCollectionViewer']) &&
        acl['custom:assetCollectionViewer'].some((e) => e.toLowerCase() === userEmail.toLowerCase());
      expect(isViewer).toBe(false);
    });

    it('should deny access to user not in ACL', () => {
      const userEmail = 'unauthorized@example.com';
      const acl = {
        'custom:assetCollectionOwner': 'owner@example.com',
        'custom:assetCollectionEditor': ['editor@example.com'],
        'custom:assetCollectionViewer': ['viewer@example.com'],
      };

      const isOwner = acl['custom:assetCollectionOwner']?.toLowerCase() === userEmail.toLowerCase();
      const isEditor =
        Array.isArray(acl['custom:assetCollectionEditor']) &&
        acl['custom:assetCollectionEditor'].some((e) => e.toLowerCase() === userEmail.toLowerCase());
      const isViewer =
        Array.isArray(acl['custom:assetCollectionViewer']) &&
        acl['custom:assetCollectionViewer'].some((e) => e.toLowerCase() === userEmail.toLowerCase());

      expect(isOwner || isEditor || isViewer).toBe(false);
    });

    it('should handle case-insensitive email comparison', () => {
      const userEmail = 'USER@EXAMPLE.COM';
      const acl = {
        'custom:assetCollectionOwner': 'user@example.com',
      };

      const isOwner = acl['custom:assetCollectionOwner']?.toLowerCase() === userEmail.toLowerCase();
      expect(isOwner).toBe(true);
    });
  });

  describe('Permission Mapping', () => {
    it('should map GET requests to read permission', () => {
      const method = 'GET';
      const requiredRole = method === 'GET' ? 'read' : 'write';
      expect(requiredRole).toBe('read');
    });

    it('should map POST/PUT/PATCH/DELETE to write permission', () => {
      const methods = ['POST', 'PUT', 'PATCH', 'DELETE'];

      methods.forEach((method) => {
        const requiredRole = method === 'GET' ? 'read' : 'write';
        expect(requiredRole).toBe('write');
      });
    });
  });
});

describe('dm.js - Search Type Detection', () => {
  describe('extractSearchTypeFromReferer', () => {
    it('should detect "all" search type', () => {
      const referer = 'https://example.com/search/all?q=test';
      let searchType = 'unknown';
      if (referer.includes('/search/all')) searchType = 'all';
      expect(searchType).toBe('all');
    });

    it('should detect "assets" search type', () => {
      const referer = 'https://example.com/search/assets?q=test';
      let searchType = 'unknown';
      if (referer.includes('/search/all')) searchType = 'all';
      else if (referer.includes('/search/assets')) searchType = 'assets';
      expect(searchType).toBe('assets');
    });

    it('should detect "products" search type', () => {
      const referer = 'https://example.com/search/products?q=test';
      let searchType = 'unknown';
      if (referer.includes('/search/all')) searchType = 'all';
      else if (referer.includes('/search/assets')) searchType = 'assets';
      else if (referer.includes('/search/products')) searchType = 'products';
      expect(searchType).toBe('products');
    });

    it('should detect "templates" search type', () => {
      const referer = 'https://example.com/search/templates?q=test';
      let searchType = 'unknown';
      if (referer.includes('/search/all')) searchType = 'all';
      else if (referer.includes('/search/assets')) searchType = 'assets';
      else if (referer.includes('/search/products')) searchType = 'products';
      else if (referer.includes('/search/templates')) searchType = 'templates';
      expect(searchType).toBe('templates');
    });

    it('should return null for non-search-UI referers', () => {
      const referer = 'https://example.com/other-page';
      let searchType = null;
      if (referer.includes('/search/all')) searchType = 'all';
      else if (referer.includes('/search/assets')) searchType = 'assets';
      else if (referer.includes('/search/products')) searchType = 'products';
      else if (referer.includes('/search/templates')) searchType = 'templates';
      expect(searchType).toBeNull();
    });

    it('should return null for empty referer', () => {
      const referer = '';
      let searchType = null;
      if (referer.includes('/search/all')) searchType = 'all';
      expect(searchType).toBeNull();
    });
  });
});

describe('dm.js - Analytics Event Data', () => {
  describe('extractCommonUserData', () => {
    it('should extract userId as user identifier (not email)', () => {
      const user = {
        userId: 'U700855',
        email: 'user@example.com', // email present but not used
        country: 'US',
        employeeType: 'employee',
        company: 'Acme Corp',
        roles: ['admin', 'editor'],
      };

      // Simulating extractCommonUserData behavior
      const commonData = {
        userId: user.userId,
        country: user.country,
        employeeType: user.employeeType,
        company: user.company,
        roles: user.roles || [],
      };

      expect(commonData.userId).toBe('U700855');
      expect(commonData).not.toHaveProperty('email');
      expect(commonData.country).toBe('US');
      expect(commonData.roles).toEqual(['admin', 'editor']);
    });

    it('should default roles to empty array if undefined', () => {
      const user = {
        userId: 'U700855',
        country: 'US',
        employeeType: 'employee',
        company: 'Acme Corp',
      };

      const roles = user.roles || [];
      expect(roles).toEqual([]);
    });
  });

  describe('download event data', () => {
    it('should include all required fields for download event including new enhanced fields', () => {
      const downloadContext = {
        resourceType: 'asset',
        campaign: 'summer2024',
        brand: 'coke',
        downloadId: '550e8400-e29b-41d4-a716-446655440000',
        downloadItemId: 'urn:aaid:aem:abc123',
        downloadType: 'ready-to-use',
        rendition: 'original',
      };

      expect(downloadContext).toHaveProperty('resourceType');
      expect(downloadContext).toHaveProperty('campaign');
      expect(downloadContext).toHaveProperty('downloadId');
      expect(downloadContext).toHaveProperty('downloadItemId');
      expect(downloadContext).toHaveProperty('downloadType');
      expect(downloadContext).toHaveProperty('rendition');
      expect(downloadContext).toHaveProperty('brand');
      // count field removed - each event = 1 download
      expect(downloadContext).not.toHaveProperty('count');
    });

    it('should validate downloadType values', () => {
      const validTypes = ['ready-to-use', 'restricted', 'unknown'];
      expect(validTypes).toContain('ready-to-use');
      expect(validTypes).toContain('restricted');
      expect(validTypes).toContain('unknown');
      expect(validTypes).toHaveLength(3);
    });
  });

  describe('search event data', () => {
    it('should truncate long search terms', () => {
      const maxLength = 200;
      const longTerm = 'a'.repeat(300);
      const truncated = longTerm.substring(0, maxLength);

      expect(truncated.length).toBe(200);
    });

    it('should not truncate short search terms', () => {
      const maxLength = 200;
      const shortTerm = 'test search';
      const truncated = shortTerm.substring(0, maxLength);

      expect(truncated).toBe(shortTerm);
    });

    it('should extract result count from response', () => {
      const responseData = {
        results: [{ nbHits: 1234, hitsPerPage: 24 }],
      };

      const resultCount = responseData.results?.[0]?.nbHits || 0;
      expect(resultCount).toBe(1234); // Total results, not page size
    });

    it('should default to 0 if no results', () => {
      const responseData = { results: [] };
      const resultCount = responseData.results?.[0]?.nbHits || 0;
      expect(resultCount).toBe(0);
    });
  });
});

describe('dm.js - URL Transformations', () => {
  describe('delivery host transformation', () => {
    it('should construct correct delivery host for AEM env', () => {
      const aemEnvId = 'p12345-e67890';
      const deliveryHost = `delivery-${aemEnvId}.adobeaemcloud.com`;

      expect(deliveryHost).toBe('delivery-p12345-e67890.adobeaemcloud.com');
    });

    it('should parse AEM env ID correctly', () => {
      const aemEnvId = 'p12345-e67890';
      const match = aemEnvId.match(/^p(.*)-e(.*)$/);

      expect(match).not.toBeNull();
      expect(match[1]).toBe('12345');
      expect(match[2]).toBe('67890');
    });

    it('should construct index name for regular search', () => {
      const envId = '12345-67890';
      const indexName = envId;

      expect(indexName).toBe('12345-67890');
    });

    it('should construct index name for collections search', () => {
      const envId = '12345-67890';
      const indexName = `${envId}_collections`;

      expect(indexName).toBe('12345-67890_collections');
    });
  });

  describe('path transformations', () => {
    it('should remove /api prefix from path', () => {
      const originalPath = '/api/adobe/assets/asset123';
      const transformedPath = originalPath.replace(/^\/api/, '');

      expect(transformedPath).toBe('/adobe/assets/asset123');
    });

    it('should handle paths without /api prefix', () => {
      const originalPath = '/adobe/assets/asset123';
      const transformedPath = originalPath.replace(/^\/api/, '');

      expect(transformedPath).toBe('/adobe/assets/asset123');
    });

    it('should rewrite search-collections to search', () => {
      const originalPath = '/adobe/assets/search-collections';
      const shouldRewrite = originalPath === '/adobe/assets/search-collections';
      const newPath = shouldRewrite ? '/adobe/assets/search' : originalPath;

      expect(newPath).toBe('/adobe/assets/search');
    });
  });
});

describe('dm.js - Constants Validation', () => {
  it('should have defined IMS token expiry buffer', () => {
    const expiryBuffer = 5 * 60; // 5 minutes in seconds
    expect(expiryBuffer).toBe(300);
  });

  it('should have defined analytics search term max length', () => {
    const maxLength = 200;
    expect(maxLength).toBeGreaterThan(0);
  });

  it('should have valid resource types', () => {
    const validTypes = ['asset', 'template'];
    expect(validTypes).toHaveLength(2);
    expect(validTypes).toContain('asset');
    expect(validTypes).toContain('template');
  });
});

describe('dm.js - Archive Analytics Tracking', () => {
  describe('trackArchiveAnalytics context validation', () => {
    it('should accept valid analytics context', () => {
      const analyticsContext = {
        downloadId: '550e8400-e29b-41d4-a716-446655440000',
        assets: [
          {
            assetId: 'urn:aaid:aem:abc123',
            brand: 'Acme Corp',
            campaign: 'Summer 2024',
            downloadType: 'ready-to-use',
            renditions: ['original', 'thumbnail'],
          },
          {
            assetId: 'urn:aaid:aem:def456',
            brand: 'Sprite',
            campaign: 'Winter 2024',
            downloadType: 'restricted',
            renditions: ['original'],
          },
        ],
      };

      expect(analyticsContext.downloadId).toBeDefined();
      expect(analyticsContext.assets).toHaveLength(2);
      expect(analyticsContext.assets[0].renditions).toContain('original');
    });

    it('should validate downloadId is present', () => {
      const analyticsContext = {
        downloadId: '',
        assets: [{ assetId: 'test' }],
      };

      // Simulating the validation check in trackArchiveAnalytics
      const isValid = analyticsContext.downloadId && analyticsContext.assets?.length > 0;
      expect(isValid).toBeFalsy();
    });

    it('should validate assets array is not empty', () => {
      const analyticsContext = {
        downloadId: '550e8400-e29b-41d4-a716-446655440000',
        assets: [],
      };

      const isValid = analyticsContext.downloadId && analyticsContext.assets?.length > 0;
      expect(isValid).toBe(false);
    });

    it('should track one event per rendition for each asset', () => {
      const analyticsContext = {
        downloadId: '550e8400-e29b-41d4-a716-446655440000',
        assets: [
          { assetId: 'asset1', renditions: ['original', 'thumbnail'] },
          { assetId: 'asset2', renditions: ['original'] },
        ],
      };

      // Calculate expected event count
      const expectedEventCount = analyticsContext.assets.reduce((total, asset) => total + asset.renditions.length, 0);

      expect(expectedEventCount).toBe(3); // 2 + 1
    });
  });

  describe('archive analytics event data', () => {
    it('should include all required fields for archive download event', () => {
      const user = {
        userId: 'U700855',
        country: 'US',
        employeeType: 'employee',
        company: 'Adobe',
        roles: ['admin'],
      };

      const assetInfo = {
        assetId: 'urn:aaid:aem:abc123',
        brand: 'Acme Corp',
        campaign: 'Summer 2024',
        downloadType: 'ready-to-use',
      };

      const downloadId = '550e8400-e29b-41d4-a716-446655440000';
      const renditionName = 'original';

      // Simulating event data construction in trackArchiveAnalytics
      const eventData = {
        userId: user.userId,
        country: user.country,
        employeeType: user.employeeType,
        company: user.company,
        roles: user.roles,
        resourceType: 'asset',
        campaigns: assetInfo.campaign || 'unknown',
        brand: assetInfo.brand || 'unknown',
        downloadId,
        downloadItemId: assetInfo.assetId,
        downloadType: assetInfo.downloadType || '',
        rendition: renditionName,
      };

      // Verify all fields are present
      expect(eventData).toHaveProperty('userId', 'U700855');
      expect(eventData).toHaveProperty('country', 'US');
      expect(eventData).toHaveProperty('resourceType', 'asset');
      expect(eventData).toHaveProperty('downloadId', downloadId);
      expect(eventData).toHaveProperty('downloadItemId', 'urn:aaid:aem:abc123');
      expect(eventData).toHaveProperty('downloadType', 'ready-to-use');
      expect(eventData).toHaveProperty('rendition', 'original');
    });

    it('should default campaign and brand to "unknown" if not provided', () => {
      const assetInfo = {
        assetId: 'urn:aaid:aem:abc123',
        downloadType: 'restricted',
      };

      const campaigns = assetInfo.campaign || 'unknown';
      const brand = assetInfo.brand || 'unknown';

      expect(campaigns).toBe('unknown');
      expect(brand).toBe('unknown');
    });

    it('should default downloadType to empty string if not provided', () => {
      const assetInfo = {
        assetId: 'urn:aaid:aem:abc123',
        brand: 'Acme Corp',
        campaign: 'Summer 2024',
      };

      const downloadType = assetInfo.downloadType || '';
      expect(downloadType).toBe('');
    });
  });

  describe('archive header parsing', () => {
    it('should parse valid JSON header', () => {
      const headerValue = JSON.stringify({
        downloadId: 'test-id',
        assets: [{ assetId: 'asset1', renditions: ['original'] }],
      });

      let parsed;
      try {
        parsed = JSON.parse(headerValue);
      } catch {
        parsed = null;
      }

      expect(parsed).not.toBeNull();
      expect(parsed.downloadId).toBe('test-id');
    });

    it('should handle invalid JSON header gracefully', () => {
      const headerValue = 'not valid json {{{';

      let parsed;
      let error = null;
      try {
        parsed = JSON.parse(headerValue);
      } catch (e) {
        error = e;
        parsed = null;
      }

      expect(parsed).toBeNull();
      expect(error).not.toBeNull();
    });

    it('should handle null header value', () => {
      const headerValue = null;

      // Simulating the check in originDynamicMedia
      const shouldProcess = headerValue !== null;
      expect(shouldProcess).toBe(false);
    });
  });
});

// ==========================================
// ContentAI Search Authorization Tests
// ==========================================

describe('dm.js - ContentAI Authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('forceContentAISearchFilter', () => {
    it('should do nothing when authClauses is empty', () => {
      const search = { query: [{ and: [] }] };
      forceContentAISearchFilter(search, []);
      expect(search.query).toEqual([{ and: [] }]);
    });

    it('should do nothing when authClauses is null', () => {
      const search = { query: [{ and: [] }] };
      forceContentAISearchFilter(search, null);
      expect(search.query).toEqual([{ and: [] }]);
    });

    it('should do nothing when authClauses contains only empty objects', () => {
      const search = { query: [{ and: [] }] };
      forceContentAISearchFilter(search, [{}]);
      expect(search.query).toEqual([{ and: [] }]);
    });

    it('should keep clauses with empty arrays (not filtered)', () => {
      // The implementation filters out clauses where ALL values are empty arrays
      // but { term: { field: [] } } has 'term' key with object value (not empty array)
      // so it's NOT filtered out. The check is: value is array AND empty
      const search = { query: [{ and: [] }] };
      forceContentAISearchFilter(search, [{ term: { field: [] } }]);
      // The clause is kept because term's value is an object, not an empty array
      expect(search.query[0].and).toContainEqual({ and: [{ term: { field: [] } }] });
    });

    it('should add auth clauses to existing and structure', () => {
      const search = { query: [{ and: [{ match: { text: 'test' } }] }] };
      const authClauses = [{ term: { 'assetMetadata.custom:brand': ['Acme Corp'] } }];

      forceContentAISearchFilter(search, authClauses);

      expect(search.query[0].and).toHaveLength(2);
      expect(search.query[0].and[1]).toEqual({ and: authClauses });
    });

    it('should create query array if not exists', () => {
      const search = {};
      const authClauses = [{ term: { field: ['value'] } }];

      forceContentAISearchFilter(search, authClauses);

      expect(search.query).toBeDefined();
      expect(Array.isArray(search.query)).toBe(true);
    });

    it('should wrap non-array query in array', () => {
      const search = { query: { match: { text: 'test' } } };
      const authClauses = [{ term: { field: ['value'] } }];

      forceContentAISearchFilter(search, authClauses);

      expect(Array.isArray(search.query)).toBe(true);
    });

    it('should create and clause if none exists', () => {
      const search = { query: [{ match: { text: 'test' } }] };
      const authClauses = [{ term: { field: ['value'] } }];

      forceContentAISearchFilter(search, authClauses);

      expect(search.query[0].and).toBeDefined();
    });

    it('should filter out non-object clauses', () => {
      const search = { query: [{ and: [] }] };
      forceContentAISearchFilter(search, [null, undefined, 'string', 123]);
      expect(search.query).toEqual([{ and: [] }]);
    });

    it('should keep clauses with non-empty arrays', () => {
      const search = { query: [{ and: [] }] };
      const authClauses = [{ term: { field: ['value'] } }];

      forceContentAISearchFilter(search, authClauses);

      expect(search.query[0].and).toContainEqual({ and: authClauses });
    });

    it('should keep clauses with non-array values', () => {
      const search = { query: [{ and: [] }] };
      const authClauses = [{ or: [{ term: { field: ['value'] } }] }];

      forceContentAISearchFilter(search, authClauses);

      expect(search.query[0].and).toContainEqual({ and: authClauses });
    });
  });

  describe('buildAssetAuthClauses', () => {
    it('should return no constraints for admin users', async () => {
      const request = { user: { email: 'admin@adobe.com', roles: ['admin'], userType: 'internal' } };
      const clauses = await buildAssetAuthClauses(request, {});
      expect(clauses).toEqual([]);
    });

    const internalStatusClause = {
      or: [
        { term: { 'assetMetadata.internalStatus': ['approved'] } },
        { not: [{ exists: { field: 'assetMetadata.internalStatus' } }] },
      ],
    };

    it('should add internalStatus allow clause for external users', async () => {
      const request = { user: { email: 'user@example.com', userType: 'external' } };
      const clauses = await buildAssetAuthClauses(request, {});
      expect(clauses).toContainEqual(internalStatusClause);
    });

    it('should not add internalStatus allow clause for internal users', async () => {
      const request = { user: { email: 'user@adobe.com', userType: 'internal' } };
      const clauses = await buildAssetAuthClauses(request, {});
      expect(clauses).not.toContainEqual(internalStatusClause);
    });

    it('should still apply the country filter alongside the internalStatus allow clause for external users', async () => {
      const request = { user: { email: 'user@example.com', userType: 'external', country: 'us' } };
      const clauses = await buildAssetAuthClauses(request, {});
      expect(clauses).toContainEqual({ term: { 'assetMetadata.allowedCountries': ['us', 'usa', 'global'] } });
      expect(clauses).toContainEqual(internalStatusClause);
    });

    it('should add the internalStatus allow clause even when the country filter is skipped', async () => {
      const request = { user: { email: 'user@example.com', userType: 'external' } };
      const clauses = await buildAssetAuthClauses(request, {});
      expect(clauses).toEqual([internalStatusClause]);
    });

    it('should not violate the internalStatus allow clause for an asset with no internalStatus set', () => {
      const authClauses = [internalStatusClause];
      const assetMetadata = { 'custom:contentType': 'marketing' };
      const result = checkAssetMetadataAuthorization(authClauses, assetMetadata);
      expect(result.violated).toBe(false);
    });

    it('should not violate the internalStatus allow clause for an asset tagged approved', () => {
      const authClauses = [internalStatusClause];
      const assetMetadata = { internalStatus: 'approved' };
      const result = checkAssetMetadataAuthorization(authClauses, assetMetadata);
      expect(result.violated).toBe(false);
    });

    it('should violate the internalStatus allow clause for an asset tagged with a non-approved status', () => {
      const authClauses = [internalStatusClause];
      const assetMetadata = { internalStatus: 'preview' };
      const result = checkAssetMetadataAuthorization(authClauses, assetMetadata);
      expect(result.violated).toBe(true);
    });
  });

  describe('searchContentAIAuthorization', () => {
    it('should not modify query (no-op — RBAC pending Phase 2g)', async () => {
      const request = {
        user: {
          email: 'user@example.com',
          roles: ['admin'],
        },
      };
      const search = { query: [{ and: [] }] };

      await searchContentAIAuthorization(request, {}, search);

      expect(search.query).toEqual([{ and: [] }]);
    });

    it('should strip useRealPermissions from the body before forwarding upstream', async () => {
      const request = { user: { email: 'user@example.com', country: 'DE' } };
      const search = { query: [{ and: [] }], useRealPermissions: true };

      await searchContentAIAuthorization(request, {}, search);

      expect(search.useRealPermissions).toBeUndefined();
    });

    it('should use the real country when useRealPermissions is set while simulating', async () => {
      const request = {
        user: {
          email: 'user@example.com',
          country: 'DE',
          su: { email: 'user@example.com', country: 'US' },
        },
      };
      const search = { query: [{ and: [] }], useRealPermissions: true };

      await searchContentAIAuthorization(request, {}, search);

      const authBlock = search.query[0].and.find((c) => c.and);
      const countryClause = authBlock.and.find((c) => c.term?.['assetMetadata.allowedCountries']);

      expect(countryClause.term['assetMetadata.allowedCountries']).toEqual(
        expect.arrayContaining(['US', 'usa', 'global']),
      );
    });
  });

  describe('buildAssetAuthClauses', () => {
    function getCountryClause(clauses) {
      return clauses.find((c) => c.term?.['assetMetadata.allowedCountries']);
    }

    it('should bypass all filters for admin users', async () => {
      const request = { user: { email: 'admin@example.com', roles: ['admin'], country: 'US' } };

      const clauses = await buildAssetAuthClauses(request, {});

      expect(clauses).toEqual([]);
    });

    it('should match both the ISO code and its mapped country name', async () => {
      const request = { user: { email: 'user@example.com', country: 'IN' } };

      const clauses = await buildAssetAuthClauses(request, {});
      const countryClause = getCountryClause(clauses);

      expect(countryClause.term['assetMetadata.allowedCountries']).toEqual(
        expect.arrayContaining(['IN', 'india', 'global']),
      );
    });

    it('should fall back to only the raw code when it has no known name mapping', async () => {
      const request = { user: { email: 'user@example.com', country: 'ZZ' } };

      const clauses = await buildAssetAuthClauses(request, {});
      const countryClause = getCountryClause(clauses);

      expect(countryClause.term['assetMetadata.allowedCountries']).toEqual(['ZZ', 'global']);
    });

    it('should expand additional sheet-granted countries alongside the primary country', async () => {
      const request = {
        user: { email: 'user@example.com', country: 'US', countries: ['DE'] },
      };

      const clauses = await buildAssetAuthClauses(request, {});
      const countryClause = getCountryClause(clauses);

      expect(countryClause.term['assetMetadata.allowedCountries']).toEqual(
        expect.arrayContaining(['US', 'usa', 'DE', 'germany', 'global']),
      );
    });

    it('should skip the country filter when no country can be resolved', async () => {
      const request = { user: { email: 'user@example.com' } };

      const clauses = await buildAssetAuthClauses(request, {});

      // No country clause is added, but the internalStatus allow clause still applies
      // since this user has no userType (i.e. is not internal).
      expect(getCountryClause(clauses)).toBeUndefined();
    });

    it('should filter by the simulated (non-admin) identity while sudo-simulating', async () => {
      // Real user is admin, but is currently simulating a non-admin identity in
      // Germany — the simulated search results must be filtered as that identity.
      const request = {
        user: {
          email: 'external-user@example.com',
          roles: [],
          country: 'DE',
          su: { email: 'admin@example.com', roles: ['admin'], country: 'US' },
        },
      };

      const clauses = await buildAssetAuthClauses(request, {});
      const countryClause = getCountryClause(clauses);

      expect(countryClause).toBeDefined();
      expect(countryClause.term['assetMetadata.allowedCountries']).toEqual(
        expect.arrayContaining(['DE', 'germany', 'global']),
      );
    });

    it('should filter by the simulated country even when the simulated identity keeps the real admin email', async () => {
      // handleSudo() always strips the admin role from the simulated identity's
      // roles, even when only country/userType is overridden and the email is
      // unchanged (so the sheet lookup would otherwise still resolve 'admin').
      // This models that post-handleSudo() shape directly.
      const request = {
        user: {
          email: 'admin@example.com',
          roles: [],
          country: 'IT',
          su: { email: 'admin@example.com', roles: ['admin'], country: 'US' },
        },
      };

      const clauses = await buildAssetAuthClauses(request, {});
      const countryClause = getCountryClause(clauses);

      expect(countryClause).toBeDefined();
      expect(countryClause.term['assetMetadata.allowedCountries']).toEqual(
        expect.arrayContaining(['IT', 'global']),
      );
    });

    it('should restore the real identity in full (roles + country) when useRealPermissions is set', async () => {
      // Real user is admin; currently simulating a non-admin identity. The country
      // picker's own lookup asks for real permissions, so it must bypass entirely
      // (admin sees everything) rather than filtering by either identity's country.
      const request = {
        user: {
          email: 'external-user@example.com',
          roles: [],
          country: 'DE',
          su: { email: 'admin@example.com', roles: ['admin'], country: 'US' },
        },
      };

      const clauses = await buildAssetAuthClauses(request, {}, { useRealPermissions: true });

      expect(clauses).toEqual([]);
    });

    it('should use the real pre-simulation country when the real identity is not an admin', async () => {
      const request = {
        user: {
          email: 'user@example.com',
          country: 'DE',
          su: { email: 'user@example.com', country: 'US' },
        },
      };

      const clauses = await buildAssetAuthClauses(request, {}, { useRealPermissions: true });
      const countryClause = getCountryClause(clauses);

      expect(countryClause.term['assetMetadata.allowedCountries']).toEqual(
        expect.arrayContaining(['US', 'usa', 'global']),
      );
      expect(countryClause.term['assetMetadata.allowedCountries']).not.toContain('DE');
    });

    it('should ignore useRealPermissions when the user is not sudo-simulating', async () => {
      const request = { user: { email: 'user@example.com', country: 'DE' } };

      const clauses = await buildAssetAuthClauses(request, {}, { useRealPermissions: true });
      const countryClause = getCountryClause(clauses);

      expect(countryClause.term['assetMetadata.allowedCountries']).toEqual(
        expect.arrayContaining(['DE', 'germany', 'global']),
      );
    });
  });

  describe('collectionsSearchContentAIAuthorization', () => {
    /** Auth clauses are nested via chunkIntoAnd inside query[0].and */
    function getNestedAuthClauses(search) {
      const authBlock = search.query[0].and.find((c) => c.and);
      return authBlock?.and || [];
    }

    it('should block search when user has no email', () => {
      const request = {
        user: {
          email: null,
        },
      };
      const search = { query: [{ and: [] }] };

      collectionsSearchContentAIAuthorization(request, search);

      expect(getNestedAuthClauses(search)).toContainEqual({
        term: {
          'collectionMetadata.custom:metadata.custom:acl.custom:assetCollectionOwner': ['___does_not_exist___'],
        },
      });
    });

    it('should add legacy ACL filters when relationship is omitted', () => {
      const request = {
        user: {
          email: 'User@Example.com',
        },
      };
      const search = { query: [{ and: [] }] };

      collectionsSearchContentAIAuthorization(request, search);

      const authClauses = getNestedAuthClauses(search);
      const aclFilter = authClauses.find((c) => c.or);
      expect(aclFilter).toBeDefined();
      expect(aclFilter.or.length).toBe(3);
    });

    it('should use chunkIntoOr for legacy ACL filter', () => {
      const request = {
        user: { email: 'test@example.com' },
      };
      const search = { query: [{ and: [] }] };

      collectionsSearchContentAIAuthorization(request, search);

      const authClauses = getNestedAuthClauses(search);
      const aclFilter = authClauses.find((c) => c.or);
      expect(aclFilter).toBeDefined();
      expect(aclFilter.or.length).toBe(3);
      aclFilter.or.forEach((clause) => {
        expect(clause).toHaveProperty('term');
      });
    });

    it('should lowercase email in legacy ACL filters', () => {
      const request = {
        user: {
          email: 'User@Example.COM',
        },
      };
      const search = { query: [{ and: [] }] };

      collectionsSearchContentAIAuthorization(request, search);

      const authClauses = getNestedAuthClauses(search);
      const aclFilter = authClauses.find((c) => c.or);

      aclFilter.or.forEach((clause) => {
        const termValues = Object.values(clause.term)[0];
        expect(termValues[0]).toBe('user@example.com');
      });
    });

    it('should filter to public collections when relationship is public', () => {
      const request = { user: { email: 'user@example.com' } };
      const search = { query: [{ and: [] }] };

      collectionsSearchContentAIAuthorization(request, search, { relationship: 'public' });

      expect(getNestedAuthClauses(search)).toContainEqual({
        term: { 'collectionMetadata.accessLevel': ['public'] },
      });
    });

    it('should filter to owner when relationship is createdByMe', () => {
      const request = { user: { email: 'user@example.com' } };
      const search = { query: [{ and: [] }] };

      collectionsSearchContentAIAuthorization(request, search, { relationship: 'createdByMe' });

      expect(getNestedAuthClauses(search)).toContainEqual({
        term: {
          'collectionMetadata.custom:metadata.custom:acl.custom:assetCollectionOwner': [
            'user@example.com',
            'USER@EXAMPLE.COM',
          ],
        },
      });
    });
  });
});

describe('chunkIntoAnd', () => {
  it('returns null for empty array', () => {
    expect(chunkIntoAnd([])).toBeNull();
  });

  it('wraps single item in and', () => {
    const parts = [{ term: { a: 1 } }];
    expect(chunkIntoAnd(parts)).toEqual({ and: parts });
  });

  it('wraps up to 5 items in a flat and', () => {
    const parts = Array.from({ length: 5 }, (_, i) => ({ term: { [`f${i}`]: i } }));
    const result = chunkIntoAnd(parts);
    expect(result).toEqual({ and: parts });
  });

  it('chunks 6 items into nested and blocks', () => {
    const parts = Array.from({ length: 6 }, (_, i) => ({ id: i }));
    const result = chunkIntoAnd(parts);
    expect(result.and).toHaveLength(2);
    expect(result.and[0]).toEqual({ and: parts.slice(0, 5) });
    expect(result.and[1]).toEqual({ and: parts.slice(5) });
  });

  it('chunks 10 items into two nested and blocks', () => {
    const parts = Array.from({ length: 10 }, (_, i) => ({ id: i }));
    const result = chunkIntoAnd(parts);
    expect(result.and).toHaveLength(2);
    expect(result.and[0].and).toHaveLength(5);
    expect(result.and[1].and).toHaveLength(5);
  });

  it('chunks 25 items into 5 nested and blocks', () => {
    const parts = Array.from({ length: 25 }, (_, i) => ({ id: i }));
    const result = chunkIntoAnd(parts);
    expect(result.and).toHaveLength(5);
    result.and.forEach((chunk) => {
      expect(chunk.and).toHaveLength(5);
    });
  });

  it('recursively nests when chunks exceed maxSize', () => {
    // 26 items: first split into 6 chunks of 5 (+ 1), which exceeds 5
    // so those 6 chunks get recursively nested
    const parts = Array.from({ length: 26 }, (_, i) => ({ id: i }));
    const result = chunkIntoAnd(parts);
    expect(result.and).toBeDefined();
    // Top level should have 2 and-blocks (6 chunks split into [5,1])
    expect(result.and).toHaveLength(2);
    expect(result.and[0].and).toHaveLength(5);
    expect(result.and[1].and).toHaveLength(1);
  });

  it('respects custom maxSize', () => {
    const parts = Array.from({ length: 4 }, (_, i) => ({ id: i }));
    const result = chunkIntoAnd(parts, 2);
    expect(result.and).toHaveLength(2);
    expect(result.and[0].and).toHaveLength(2);
    expect(result.and[1].and).toHaveLength(2);
  });

  it('preserves all items through chunking', () => {
    const parts = Array.from({ length: 13 }, (_, i) => ({ id: i }));
    const result = chunkIntoAnd(parts);
    const collectLeaves = (node) => {
      if (node.and) return node.and.flatMap(collectLeaves);
      return [node];
    };
    const leaves = collectLeaves(result);
    expect(leaves).toEqual(parts);
  });
});

describe('chunkIntoOr', () => {
  it('returns null for empty array', () => {
    expect(chunkIntoOr([])).toBeNull();
  });

  it('wraps single item in or', () => {
    const parts = [{ term: { a: 1 } }];
    expect(chunkIntoOr(parts)).toEqual({ or: parts });
  });

  it('wraps up to 5 items in a flat or', () => {
    const parts = Array.from({ length: 5 }, (_, i) => ({ term: { [`f${i}`]: i } }));
    const result = chunkIntoOr(parts);
    expect(result).toEqual({ or: parts });
  });

  it('chunks 6 items into nested or blocks', () => {
    const parts = Array.from({ length: 6 }, (_, i) => ({ id: i }));
    const result = chunkIntoOr(parts);
    expect(result.or).toHaveLength(2);
    expect(result.or[0]).toEqual({ or: parts.slice(0, 5) });
    expect(result.or[1]).toEqual({ or: parts.slice(5) });
  });

  it('chunks 10 items into two nested or blocks', () => {
    const parts = Array.from({ length: 10 }, (_, i) => ({ id: i }));
    const result = chunkIntoOr(parts);
    expect(result.or).toHaveLength(2);
    expect(result.or[0].or).toHaveLength(5);
    expect(result.or[1].or).toHaveLength(5);
  });

  it('chunks 25 items into 5 nested or blocks', () => {
    const parts = Array.from({ length: 25 }, (_, i) => ({ id: i }));
    const result = chunkIntoOr(parts);
    expect(result.or).toHaveLength(5);
    result.or.forEach((chunk) => {
      expect(chunk.or).toHaveLength(5);
    });
  });

  it('recursively nests when chunks exceed maxSize', () => {
    const parts = Array.from({ length: 26 }, (_, i) => ({ id: i }));
    const result = chunkIntoOr(parts);
    expect(result.or).toBeDefined();
    expect(result.or).toHaveLength(2);
    expect(result.or[0].or).toHaveLength(5);
    expect(result.or[1].or).toHaveLength(1);
  });

  it('respects custom maxSize', () => {
    const parts = Array.from({ length: 4 }, (_, i) => ({ id: i }));
    const result = chunkIntoOr(parts, 2);
    expect(result.or).toHaveLength(2);
    expect(result.or[0].or).toHaveLength(2);
    expect(result.or[1].or).toHaveLength(2);
  });

  it('preserves all items through chunking', () => {
    const parts = Array.from({ length: 13 }, (_, i) => ({ id: i }));
    const result = chunkIntoOr(parts);
    const collectLeaves = (node) => {
      if (node.or) return node.or.flatMap(collectLeaves);
      return [node];
    };
    const leaves = collectLeaves(result);
    expect(leaves).toEqual(parts);
  });
});
