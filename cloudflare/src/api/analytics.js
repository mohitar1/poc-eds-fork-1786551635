/**
 * Analytics API endpoints
 * Tracks user events using CloudFlare Analytics Engine
 */

import { error, json } from 'itty-router';
import config from '../config.js';
import { stripAssetUrn, TOP_ASSETS_LIMIT, TOP_CAMPAIGNS_LIMIT } from '../util/constants.js';

// Analytics constants
const UNKNOWN_VALUE = 'unknown';
const PERCENTAGE_MULTIPLIER = 100;
const FILTER_DEFAULT_VALUE = 'all';

// =============================================================================
// VALID FILTER VALUES (for input sanitization)
// =============================================================================
const VALID_ROLES = ['all', 'associate', 'agency', 'partner'];
const VALID_SEARCH_TYPES = ['all', 'assets', 'products', 'templates'];
const VALID_SEARCH_TERMS = ['all', 'empty', 'non-empty'];
const VALID_REGIONS = ['all', 'AFR', 'ASP', 'EME', 'EU', 'GCM', 'INSWA', 'JSK', 'LA', 'NA'];

// =============================================================================
// ROLE MAPPINGS (match frontend analytics-constants.js)
// =============================================================================
// Map primary roles to all their underlying role values (including aliases)
const ROLE_MAPPINGS = {
  associate: ['associate', 'employee', 'contingent-worker'],
  agency: ['agency'],
  partner: ['partner'],
};

// =============================================================================
// REGION TO COUNTRIES MAPPING (for search filters)
// =============================================================================
// Maps region codes to arrays of country codes for SQL IN clause
const REGION_TO_COUNTRIES = {
  AFR: ['ZA', 'NG', 'KE', 'EG', 'MA', 'GH', 'TZ', 'UG', 'ET', 'DZ'],
  ASP: ['AU', 'NZ', 'SG', 'MY', 'TH', 'VN', 'PH', 'ID', 'HK', 'TW'],
  EME: ['RU', 'TR', 'SA', 'AE', 'PK', 'UA', 'KZ', 'QA', 'KW', 'BH'],
  EU: [
    'GB',
    'DE',
    'FR',
    'IT',
    'ES',
    'NL',
    'BE',
    'CH',
    'AT',
    'SE',
    'NO',
    'DK',
    'FI',
    'PL',
    'PT',
    'IE',
    'GR',
    'CZ',
    'RO',
    'HU',
  ],
  GCM: ['CN', 'MN'],
  INSWA: ['IN', 'BD', 'LK', 'NP', 'AF'],
  JSK: ['JP', 'KR'],
  LA: [
    'MX',
    'BR',
    'AR',
    'CO',
    'CL',
    'PE',
    'EC',
    'VE',
    'GT',
    'CU',
    'BO',
    'DO',
    'HN',
    'PY',
    'SV',
    'NI',
    'CR',
    'PA',
    'UY',
  ],
  NA: ['US', 'CA'],
};

/**
 * Build SQL filter conditions for search report queries
 * @param {Object} filters - Filter parameters
 * @param {string} filters.role - Role filter (e.g., 'agency', 'partner', 'associate')
 * @param {string} filters.searchType - Search type filter (e.g., 'assets', 'products', 'templates')
 * @param {string} filters.searchTerm - Search term filter ('empty' or 'non-empty')
 * @param {string} filters.region - Region filter (e.g., 'NA', 'EU', 'LA')
 * @returns {string} SQL WHERE conditions to append (empty string if no filters)
 */
function buildSearchFilterConditions(filters) {
  if (!filters) return '';

  const conditions = [];

  // Role filter (blob5 contains comma-separated roles)
  // Input validation: only allow whitelisted values
  if (filters.role && filters.role !== FILTER_DEFAULT_VALUE) {
    if (!VALID_ROLES.includes(filters.role)) {
      throw new Error(`Invalid role filter: ${filters.role}`);
    }
    // Safe to use after validation
    // Get all role values that map to this primary role (e.g., 'associate' -> ['associate', 'employee', 'contingent-worker'])
    const roleValues = ROLE_MAPPINGS[filters.role] || [filters.role];
    // Build OR conditions for all mapped role values
    const roleConditions = roleValues.map((r) => `blob5 LIKE '%${r}%'`).join(' OR ');
    conditions.push(`(${roleConditions})`);
  }

  // Search type filter (blob7 = searchType)
  // Input validation: only allow whitelisted values
  if (filters.searchType && filters.searchType !== FILTER_DEFAULT_VALUE) {
    if (!VALID_SEARCH_TYPES.includes(filters.searchType)) {
      throw new Error(`Invalid searchType filter: ${filters.searchType}`);
    }
    // Safe to use after validation
    conditions.push(`blob7 = '${filters.searchType}'`);
  }

  // Search term filter (blob6 = searchTerm)
  // Input validation: only allow whitelisted values
  if (filters.searchTerm && filters.searchTerm !== FILTER_DEFAULT_VALUE) {
    if (!VALID_SEARCH_TERMS.includes(filters.searchTerm)) {
      throw new Error(`Invalid searchTerm filter: ${filters.searchTerm}`);
    }
    if (filters.searchTerm === 'empty') {
      conditions.push(`(blob6 = '' OR blob6 IS NULL)`);
    } else if (filters.searchTerm === 'non-empty') {
      conditions.push(`blob6 != ''`);
    }
  }

  // Region filter (blob2 = country code)
  // Input validation: only allow whitelisted values
  if (filters.region && filters.region !== FILTER_DEFAULT_VALUE) {
    if (!VALID_REGIONS.includes(filters.region)) {
      throw new Error(`Invalid region filter: ${filters.region}`);
    }
    const countryCodes = REGION_TO_COUNTRIES[filters.region];
    if (countryCodes && countryCodes.length > 0) {
      // Build IN clause with validated region (country codes are hardcoded, not user input)
      const quotedCodes = countryCodes.map((c) => `'${c}'`).join(', ');
      conditions.push(`blob2 IN (${quotedCodes})`);
    }
  }

  return conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '';
}

/**
 * Build SQL filter conditions for download report queries
 * @param {Object} filters - Filter parameters
 * @param {string} filters.role - Role filter (e.g., 'agency', 'partner', 'associate')
 * @param {string} filters.region - Region filter (e.g., 'NA', 'EU', 'LA')
 * @returns {string} SQL WHERE conditions to append (empty string if no filters)
 */
function buildDownloadFilterConditions(filters) {
  if (!filters) return '';

  const conditions = [];

  // Role filter (blob5 contains comma-separated roles)
  // Input validation: only allow whitelisted values
  if (filters.role && filters.role !== FILTER_DEFAULT_VALUE) {
    if (!VALID_ROLES.includes(filters.role)) {
      throw new Error(`Invalid role filter: ${filters.role}`);
    }
    // Safe to use after validation
    // Get all role values that map to this primary role
    const roleValues = ROLE_MAPPINGS[filters.role] || [filters.role];
    // Build OR conditions for all mapped role values
    const roleConditions = roleValues.map((r) => `blob5 LIKE '%${r}%'`).join(' OR ');
    conditions.push(`(${roleConditions})`);
  }

  // Region filter (blob2 = country code)
  // Input validation: only allow whitelisted values
  if (filters.region && filters.region !== FILTER_DEFAULT_VALUE) {
    if (!VALID_REGIONS.includes(filters.region)) {
      throw new Error(`Invalid region filter: ${filters.region}`);
    }
    const countryCodes = REGION_TO_COUNTRIES[filters.region];
    if (countryCodes && countryCodes.length > 0) {
      // Build IN clause with validated region (country codes are hardcoded, not user input)
      const quotedCodes = countryCodes.map((c) => `'${c}'`).join(', ');
      conditions.push(`blob2 IN (${quotedCodes})`);
    }
  }

  return conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '';
}

/**
 * Main Analytics API handler - routes to appropriate endpoint
 */
export async function analyticsApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  console.info('==========================================');
  console.info('[Analytics API] 📨 REQUEST RECEIVED');
  console.info('[Analytics API] Method:', request.method);
  console.info('[Analytics API] Path:', path);
  console.info('[Analytics API] URL:', url.toString());
  console.info('[Analytics API] Analytics Engine Configured:');
  console.info('[Analytics API]   - Dataset: spark_analytics (from wrangler.toml)');
  console.info('[Analytics API]   - Binding: SPARK_ANALYTICS_ENGINE');
  console.info('[Analytics API]   - Available:', !!env.SPARK_ANALYTICS_ENGINE);
  console.info('==========================================');

  if (path.endsWith('/report-metrics')) {
    console.info('[Analytics API] 📊 Routing to REPORT METRICS handler');
    return getReportMetrics(request, env);
  }

  if (path.endsWith('/raw-downloads')) {
    console.info('[Analytics API] 📥 Routing to RAW DOWNLOADS handler');
    return getRawDownloads(request, env);
  }

  // Unknown endpoint
  console.warn('[Analytics API] ⚠️  Unknown endpoint:', path);
  return error(404, {
    success: false,
    error: 'Unknown analytics endpoint. Available endpoints: /report-metrics, /raw-downloads',
  });
}

/**
 * GET /api/analytics/report-metrics
 * Returns pre-defined report metrics (server-side queries - not manipulable by client)
 * Query params:
 *   - year: Year to filter (default: current year)
 *   - month: Optional month (1-12) for month-specific data
 */
async function getReportMetrics(request, env) {
  if (request.method !== 'GET') {
    return error(405, { success: false, error: 'Method not allowed' });
  }

  try {
    const url = new URL(request.url);
    const metricType = url.searchParams.get('type');
    const currentYear = new Date().getFullYear();
    const year = parseInt(url.searchParams.get('year'), 10) || currentYear;
    const month = url.searchParams.get('month') ? parseInt(url.searchParams.get('month'), 10) : null;

    // Check if API token is configured
    if (!env.ANALYTICS_API_TOKEN) {
      console.error('[Analytics API] Analytics API token not configured');
      return error(500, {
        success: false,
        error: 'Analytics API token not configured',
      });
    }

    const accountId = config.ANALYTICS_ACCOUNT_ID;
    const apiToken = await env.ANALYTICS_API_TOKEN.get();

    // Build date range for the query
    let startDate;
    let endDate;

    // Check if custom startDate/endDate are provided (for individual metric queries)
    const customStartDate = url.searchParams.get('startDate');
    const customEndDate = url.searchParams.get('endDate');

    // Parse search report filters
    const searchFilters = {
      role: url.searchParams.get('role') || FILTER_DEFAULT_VALUE,
      searchType: url.searchParams.get('searchType') || FILTER_DEFAULT_VALUE,
      searchTerm: url.searchParams.get('searchTerm') || FILTER_DEFAULT_VALUE,
      region: url.searchParams.get('region') || FILTER_DEFAULT_VALUE,
    };

    // Parse download report filters (subset of search filters)
    const downloadFilters = {
      role: url.searchParams.get('role') || FILTER_DEFAULT_VALUE,
      region: url.searchParams.get('region') || FILTER_DEFAULT_VALUE,
    };

    if (customStartDate && customEndDate) {
      startDate = customStartDate;
      endDate = customEndDate;
    } else if (month) {
      // Specific month
      startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      // Last day of month
      const lastDay = new Date(year, month, 0).getDate();
      endDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
    } else {
      // Full year
      startDate = `${year}-01-01`;
      endDate = `${year}-12-31`;
    }

    // If a specific metric type is requested, return just that metric
    if (metricType) {
      console.info('[Analytics API] Single metric request:', {
        type: metricType,
        startDate,
        endDate,
      });

      // Special handling for searchDistributionByResultSize (requires multiple queries)
      if (metricType === 'searchDistributionByResultSize') {
        const timestampFilter = `timestamp >= toDateTime('${startDate} 00:00:00') AND timestamp <= toDateTime('${endDate} 23:59:59')`;
        const filterConditions = buildSearchFilterConditions(searchFilters);

        // Define bucket queries
        const bucketQueries = [
          { bucket: '0 results', condition: '(double1 = 0 OR double1 IS NULL)' },
          { bucket: '1-10 results', condition: 'double1 > 0 AND double1 <= 10' },
          { bucket: '11-50 results', condition: 'double1 > 10 AND double1 <= 50' },
          { bucket: '51-100 results', condition: 'double1 > 50 AND double1 <= 100' },
          { bucket: '101-500 results', condition: 'double1 > 100 AND double1 <= 500' },
          { bucket: '501-1000 results', condition: 'double1 > 500 AND double1 <= 1000' },
          { bucket: '1001-10000 results', condition: 'double1 > 1000 AND double1 <= 10000' },
          { bucket: '10001-100000 results', condition: 'double1 > 10000 AND double1 <= 100000' },
          { bucket: '100000+ results', condition: 'double1 > 100000' },
        ];

        // Execute all bucket queries in parallel
        const results = await Promise.all(
          bucketQueries.map(async ({ bucket, condition }) => {
            const query = `SELECT COUNT() as searches FROM spark_analytics WHERE index1 = 'search' AND ${timestampFilter} AND ${condition}${filterConditions}`;
            const result = await executeReportQuery(accountId, apiToken, query);
            return {
              bucket,
              searches: result.data?.[0]?.searches || 0,
            };
          }),
        );

        return json({
          success: true,
          type: metricType,
          data: results,
        });
      }

      const result = await executeReportQuery(
        accountId,
        apiToken,
        buildReportMetricQuery(metricType, startDate, endDate, searchFilters),
      );

      return json({
        success: true,
        type: metricType,
        data: result.data || [],
      });
    }

    // Otherwise, return full downloads report metrics

    console.info('[Analytics API] Date range:', { startDate, endDate });
    console.info(
      '[Analytics API] Timestamp filter will be:',
      `timestamp >= toDateTime('${startDate} 00:00:00') AND timestamp <= toDateTime('${endDate} 23:59:59')`,
    );

    // Execute all queries in parallel for efficiency
    const [
      uniqueUsersResult,
      uniqueDownloadersResult,
      firstTimeUsersResult,
      firstTimeDownloadersResult,
      downloadsByMonthResult,
      downloadersByRoleResult,
      downloadsByRoleResult,
      downloadersByGeoResult,
      assetDownloadsByGeoResult,
      templateDownloadsByGeoResult,
      firstTimeByOUResult,
      topCampaignsResult,
      topAssetsResult,
      userActivityByMonthResult,
      firstTimeUsersByMonthResult,
    ] = await Promise.all([
      executeReportQuery(accountId, apiToken, buildReportMetricQuery('uniqueUsers', startDate, endDate)),
      executeReportQuery(
        accountId,
        apiToken,
        buildReportMetricQuery('uniqueDownloaders', startDate, endDate, downloadFilters),
      ),
      executeReportQuery(accountId, apiToken, buildReportMetricQuery('firstTimeUsers', startDate, endDate)),
      executeReportQuery(
        accountId,
        apiToken,
        buildReportMetricQuery('firstTimeDownloaders', startDate, endDate, downloadFilters),
      ),
      executeReportQuery(
        accountId,
        apiToken,
        buildReportMetricQuery('downloadsByMonth', startDate, endDate, downloadFilters),
      ),
      executeReportQuery(
        accountId,
        apiToken,
        buildReportMetricQuery('downloadersByRole', startDate, endDate, downloadFilters),
      ),
      executeReportQuery(
        accountId,
        apiToken,
        buildReportMetricQuery('downloadsByRole', startDate, endDate, downloadFilters),
      ),
      executeReportQuery(
        accountId,
        apiToken,
        buildReportMetricQuery('downloadersByGeo', startDate, endDate, downloadFilters),
      ),
      executeReportQuery(
        accountId,
        apiToken,
        buildReportMetricQuery('assetDownloadsByGeo', startDate, endDate, downloadFilters),
      ),
      executeReportQuery(
        accountId,
        apiToken,
        buildReportMetricQuery('templateDownloadsByGeo', startDate, endDate, downloadFilters),
      ),
      executeReportQuery(
        accountId,
        apiToken,
        buildReportMetricQuery('firstTimeDownloadersByOU', startDate, endDate, downloadFilters),
      ),
      executeReportQuery(
        accountId,
        apiToken,
        buildReportMetricQuery('topCampaigns', startDate, endDate, downloadFilters),
      ),
      executeReportQuery(accountId, apiToken, buildReportMetricQuery('topAssets', startDate, endDate, downloadFilters)),
      executeReportQuery(accountId, apiToken, buildReportMetricQuery('userActivityByMonth', startDate, endDate)),
      executeReportQuery(accountId, apiToken, buildReportMetricQuery('firstTimeUsersByMonth', startDate, endDate)),
    ]);

    // Extract values from results (parse as integers since SQL may return strings)
    const uniqueUsers = parseInt(uniqueUsersResult.data?.[0]?.unique_count, 10) || 0;
    const uniqueDownloaders = parseInt(uniqueDownloadersResult.data?.[0]?.unique_count, 10) || 0;
    const firstTimeUsers = parseInt(firstTimeUsersResult.data?.[0]?.first_time_count, 10) || 0;
    const firstTimeDownloaders = parseInt(firstTimeDownloadersResult.data?.[0]?.first_time_count, 10) || 0;

    // Log raw query results for debugging
    console.info(
      '[Analytics API] Raw downloadsByMonth query result:',
      JSON.stringify(downloadsByMonthResult.data || []),
    );
    console.info('[Analytics API] Raw uniqueDownloaders result:', JSON.stringify(uniqueDownloadersResult.data || []));

    // Process chart data
    const downloadsByMonth = processDownloadsByMonth(downloadsByMonthResult.data || [], year);
    const downloadersByRole = processRoleData(downloadersByRoleResult.data || [], 'downloaders');
    const downloadsByRole = processRoleData(downloadsByRoleResult.data || [], 'downloads');

    // Process geo data for the geography table
    const geoData = processGeoData(
      downloadersByGeoResult.data || [],
      assetDownloadsByGeoResult.data || [],
      templateDownloadsByGeoResult.data || [],
    );

    // Process first-time downloaders by OU
    const firstTimeDownloadersByOU = processFirstTimeDownloadersByOU(firstTimeByOUResult.data || [], year);

    // Process top campaigns
    const topCampaigns = processTopCampaigns(topCampaignsResult.data || []);

    // Process top assets
    const topAssets = processTopAssets(topAssetsResult.data || []);

    // Process user activity by month
    const userActivityByMonth = processUserActivityByMonth(
      userActivityByMonthResult.data || [],
      firstTimeUsersByMonthResult.data || [],
      year,
    );

    console.info('[Analytics API] Report metrics calculated:', {
      uniqueUsers,
      uniqueDownloaders,
      firstTimeUsers,
      firstTimeDownloaders,
      downloadsByMonthCount: downloadsByMonth.length,
      downloadersByRoleCount: downloadersByRole.length,
      downloadsByRoleCount: downloadsByRole.length,
      geoCount: geoData.geos.length,
      firstTimeByOUCount: firstTimeDownloadersByOU.length,
      topCampaignsCount: topCampaigns.length,
      topAssetsCount: topAssets.length,
      userActivityByMonthCount: userActivityByMonth.length,
      year,
      month: month || 'full year',
    });

    return json({
      success: true,
      year,
      month: month || null,
      dateRange: { startDate, endDate },
      metrics: {
        uniqueUsers,
        uniqueDownloaders,
        firstTimeUsers,
        firstTimeDownloaders,
      },
      charts: {
        downloadsByMonth,
        downloadersByRole,
        downloadsByRole,
      },
      geoData,
      firstTimeDownloadersByOU,
      topCampaigns,
      topAssets,
      userActivityByMonth,
    });
  } catch (err) {
    console.error('[Analytics API] Error getting report metrics:', err.message, err.stack);
    return error(500, {
      success: false,
      error: err.message || 'Failed to get report metrics',
    });
  }
}

/**
 * Build SQL query for specific report metrics
 *
 * New blob structure (no custom timestamp):
 *   blob1: userId (WHO - user ID)
 *   blob2: country
 *   blob3: employeeType
 *   blob4: company
 *   blob5: roles
 *   blob6: event-specific (searchTerm for search, resourceType for download)
 *   blob7: searchType (search) or campaigns (download)
 *   blob8: brand (download only)
 *   timestamp: native Analytics Engine timestamp
 *
 * @param {string} metricType - Metric type to query
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @param {Object} filters - Optional search filters (role, searchType, searchTerm, region)
 */
function buildReportMetricQuery(metricType, startDate, endDate, filters = {}) {
  const startDateTime = `toDateTime('${startDate} 00:00:00')`;
  const endDateTime = `toDateTime('${endDate} 23:59:59')`;
  const timestampFilter = `timestamp >= ${startDateTime} AND timestamp <= ${endDateTime}`;

  // Build filter conditions for search-related queries
  const searchFilterConditions = buildSearchFilterConditions(filters);

  switch (metricType) {
    case 'uniqueUsers':
      // Unique users = distinct userId from any user events (login, search, download) in date range
      // Counts across all event types for more accurate and resilient user counting
      return `SELECT COUNT(DISTINCT blob1) as unique_count FROM spark_analytics WHERE index1 IN ('login', 'search', 'download') AND blob1 IS NOT NULL AND blob1 != '' AND ${timestampFilter}`;

    case 'uniqueDownloaders': {
      // Unique downloaders = distinct userId from download events in date range
      const downloadFilterConditions = buildDownloadFilterConditions(filters);
      return `SELECT COUNT(DISTINCT blob1) as unique_count FROM spark_analytics WHERE index1 = 'download' AND ${timestampFilter}${downloadFilterConditions}`;
    }

    case 'firstTimeUsers':
      // First time users = users whose FIRST EVER login falls within the date range
      return `SELECT COUNT() as first_time_count FROM (SELECT blob1, MIN(timestamp) as first_login FROM spark_analytics WHERE index1 = 'login' GROUP BY blob1 HAVING MIN(timestamp) >= ${startDateTime} AND MIN(timestamp) <= ${endDateTime})`;

    case 'firstTimeDownloaders': {
      // First time downloaders = users whose FIRST EVER download falls within the date range
      const downloadFilterConditions = buildDownloadFilterConditions(filters);
      return `SELECT COUNT() as first_time_count FROM (SELECT blob1, MIN(timestamp) as first_download FROM spark_analytics WHERE index1 = 'download'${downloadFilterConditions} GROUP BY blob1 HAVING MIN(timestamp) >= ${startDateTime} AND MIN(timestamp) <= ${endDateTime})`;
    }

    case 'uniqueUsersByMonth':
      // Unique users grouped by month (counts across all event types)
      return `SELECT formatDateTime(timestamp, '%Y-%m') as month, COUNT(DISTINCT blob1) as users FROM spark_analytics WHERE index1 IN ('login', 'search', 'download') AND blob1 IS NOT NULL AND blob1 != '' AND ${timestampFilter} GROUP BY month ORDER BY month`;

    case 'loginsByMonth':
      // Count login events grouped by month
      return `SELECT formatDateTime(timestamp, '%Y-%m') as month, COUNT() as logins FROM spark_analytics WHERE index1 = 'login' AND ${timestampFilter} GROUP BY month ORDER BY month`;

    case 'uniqueUsersByRole':
      // Unique users grouped by role (blob5 = roles, counts across all event types)
      return `SELECT blob5 as role, COUNT(DISTINCT blob1) as users FROM spark_analytics WHERE index1 IN ('login', 'search', 'download') AND blob1 IS NOT NULL AND blob1 != '' AND ${timestampFilter} GROUP BY role ORDER BY users DESC`;

    case 'loginsByRole':
      // Count logins grouped by role (blob5 = roles)
      return `SELECT blob5 as role, COUNT() as logins FROM spark_analytics WHERE index1 = 'login' AND ${timestampFilter} GROUP BY role ORDER BY logins DESC`;

    case 'uniqueUsersByGeo':
      // Unique users grouped by country/geography (blob2 = country, counts across all event types)
      return `SELECT blob2 as geo, COUNT(DISTINCT blob1) as users FROM spark_analytics WHERE index1 IN ('login', 'search', 'download') AND blob1 IS NOT NULL AND blob1 != '' AND ${timestampFilter} GROUP BY geo ORDER BY users DESC`;

    case 'loginsByGeo':
      // Count logins grouped by country/geography (blob2 = country)
      return `SELECT blob2 as geo, COUNT() as logins FROM spark_analytics WHERE index1 = 'login' AND ${timestampFilter} GROUP BY geo ORDER BY logins DESC`;

    case 'uniqueSearchers':
      // Unique users who performed searches
      return `SELECT COUNT(DISTINCT blob1) as unique_count FROM spark_analytics WHERE index1 = 'search' AND ${timestampFilter}${searchFilterConditions}`;

    case 'firstTimeSearchers':
      // First-time searchers (users whose first search is within date range)
      // Note: filters applied to inner query for consistency
      return `SELECT COUNT() as first_time_count FROM (SELECT blob1, MIN(timestamp) as first_search FROM spark_analytics WHERE index1 = 'search'${searchFilterConditions} GROUP BY blob1 HAVING MIN(timestamp) >= ${startDateTime} AND MIN(timestamp) <= ${endDateTime})`;

    case 'uniqueSearchersByMonth':
      // Unique searchers grouped by month
      return `SELECT formatDateTime(timestamp, '%Y-%m') as month, COUNT(DISTINCT blob1) as users FROM spark_analytics WHERE index1 = 'search' AND ${timestampFilter}${searchFilterConditions} GROUP BY month ORDER BY month`;

    case 'searchesByMonth':
      // Count search events grouped by month and search type (blob7 = searchType)
      return `SELECT formatDateTime(timestamp, '%Y-%m') as month, blob7 as searchType, COUNT() as searches FROM spark_analytics WHERE index1 = 'search' AND ${timestampFilter}${searchFilterConditions} GROUP BY month, searchType ORDER BY month`;

    case 'uniqueSearchersByRole':
      // Unique searchers grouped by role (blob5 = roles)
      return `SELECT blob5 as role, COUNT(DISTINCT blob1) as users FROM spark_analytics WHERE index1 = 'search' AND ${timestampFilter}${searchFilterConditions} GROUP BY role ORDER BY users DESC`;

    case 'searchesByRole':
      // Count searches grouped by role (blob5 = roles)
      return `SELECT blob5 as role, COUNT() as searches FROM spark_analytics WHERE index1 = 'search' AND ${timestampFilter}${searchFilterConditions} GROUP BY role ORDER BY searches DESC`;

    case 'uniqueSearchersByGeo':
      // Unique searchers grouped by country/geography (blob2 = country)
      return `SELECT blob2 as geo, COUNT(DISTINCT blob1) as users FROM spark_analytics WHERE index1 = 'search' AND ${timestampFilter}${searchFilterConditions} GROUP BY geo ORDER BY users DESC`;

    case 'searchesByGeo':
      // Count searches grouped by country/geography (blob2 = country)
      return `SELECT blob2 as geo, COUNT() as searches FROM spark_analytics WHERE index1 = 'search' AND ${timestampFilter}${searchFilterConditions} GROUP BY geo ORDER BY searches DESC`;

    case 'searchesByGeoAndType':
      // Count searches grouped by country/geography and search type (blob2 = country, blob7 = searchType)
      return `SELECT blob2 as geo, blob7 as searchType, COUNT() as searches FROM spark_analytics WHERE index1 = 'search' AND ${timestampFilter}${searchFilterConditions} GROUP BY geo, searchType ORDER BY searches DESC`;

    case 'searchDistributionByType':
      // Distribution of searches by search type (blob7 = searchType)
      return `SELECT blob7 as searchType, COUNT() as searches FROM spark_analytics WHERE index1 = 'search' AND ${timestampFilter}${searchFilterConditions} GROUP BY searchType ORDER BY searches DESC`;

    case 'searchDistributionByResultSize':
      // This metric is handled specially with multiple queries (see getReportMetrics)
      // Returning a placeholder query here to satisfy the function signature
      return `SELECT 'placeholder' as bucket, 0 as searches FROM spark_analytics LIMIT 0`;

    case 'topSearches':
      /**
       * Query top searches by search term and type
       * blob6 = searchTerm, blob7 = searchType for search events
       * blob1 = userId (for unique searchers)
       */
      return `SELECT 
        blob6 as searchTerm,
        blob7 as searchType,
        COUNT(DISTINCT blob1) as uniqueSearchers,
        COUNT() as totalSearches
      FROM spark_analytics 
      WHERE index1 = 'search' 
        AND blob6 != '' 
        AND ${timestampFilter}${searchFilterConditions}
      GROUP BY searchTerm, searchType
      ORDER BY totalSearches DESC
      LIMIT ${TOP_SEARCHES_LIMIT}`;

    case 'topZeroResultSearches':
      /**
       * Query top searches that returned 0 results, grouped by term and type
       * blob6 = searchTerm, blob7 = searchType for search events
       * double1 = resultCount (NULL or 0 means no results)
       * blob1 = userId (for unique searchers)
       */
      return `SELECT 
        blob6 as searchTerm,
        blob7 as searchType,
        COUNT(DISTINCT blob1) as uniqueSearchers,
        COUNT() as totalSearches
      FROM spark_analytics 
      WHERE index1 = 'search' 
        AND blob6 != '' 
        AND (double1 = 0 OR double1 IS NULL)
        AND ${timestampFilter}${searchFilterConditions}
      GROUP BY searchTerm, searchType
      ORDER BY totalSearches DESC
      LIMIT ${TOP_SEARCHES_LIMIT}`;

    case 'downloadsByMonth': {
      // Downloads by month and resource type (blob6 = resourceType for downloads)
      // COUNT() - each event = 1 download (new schema)
      const downloadFilterConditions = buildDownloadFilterConditions(filters);
      return `SELECT formatDateTime(timestamp, '%Y-%m') as month, blob6 as resource_type, COUNT() as downloads FROM spark_analytics WHERE index1 = 'download' AND ${timestampFilter}${downloadFilterConditions} GROUP BY month, resource_type ORDER BY month`;
    }

    case 'downloadersByRole': {
      // Unique downloaders by role (blob5 = roles, blob1 = userId)
      const downloadFilterConditions = buildDownloadFilterConditions(filters);
      return `SELECT blob5 as role, COUNT(DISTINCT blob1) as downloaders FROM spark_analytics WHERE index1 = 'download' AND ${timestampFilter}${downloadFilterConditions} GROUP BY role ORDER BY downloaders DESC`;
    }

    case 'downloadsByRole': {
      // Total downloads by role (blob5 = roles)
      // COUNT() - each event = 1 download (new schema)
      const downloadFilterConditions = buildDownloadFilterConditions(filters);
      return `SELECT blob5 as role, COUNT() as downloads FROM spark_analytics WHERE index1 = 'download' AND ${timestampFilter}${downloadFilterConditions} GROUP BY role ORDER BY downloads DESC`;
    }

    case 'downloadersByGeo': {
      // Unique downloaders by country/geo (blob2 = country, blob1 = userId)
      const downloadFilterConditions = buildDownloadFilterConditions(filters);
      return `SELECT blob2 as geo, COUNT(DISTINCT blob1) as downloaders FROM spark_analytics WHERE index1 = 'download' AND ${timestampFilter}${downloadFilterConditions} GROUP BY geo ORDER BY downloaders DESC`;
    }

    case 'assetDownloadsByGeo': {
      // Asset downloads by geo (blob6 = resourceType, blob2 = country)
      // COUNT() - each event = 1 download (new schema)
      const downloadFilterConditions = buildDownloadFilterConditions(filters);
      return `SELECT blob2 as geo, COUNT() as downloads FROM spark_analytics WHERE index1 = 'download' AND blob6 = 'asset' AND ${timestampFilter}${downloadFilterConditions} GROUP BY geo ORDER BY downloads DESC`;
    }

    case 'templateDownloadsByGeo': {
      // Template downloads by geo (blob6 = resourceType, blob2 = country)
      // COUNT() - each event = 1 download (new schema)
      const downloadFilterConditions = buildDownloadFilterConditions(filters);
      return `SELECT blob2 as geo, COUNT() as downloads FROM spark_analytics WHERE index1 = 'download' AND blob6 = 'template' AND ${timestampFilter}${downloadFilterConditions} GROUP BY geo ORDER BY downloads DESC`;
    }

    case 'firstTimeDownloadersByOU': {
      // First-time downloaders grouped by month and country
      // blob1 = userId, blob2 = country
      // argMin(blob2, timestamp) gets the country from the row with minimum timestamp
      const downloadFilterConditions = buildDownloadFilterConditions(filters);
      return `SELECT formatDateTime(first_ts, '%Y-%m') as month, country, COUNT() as count FROM (SELECT blob1, MIN(timestamp) as first_ts, argMin(blob2, timestamp) as country FROM spark_analytics WHERE index1 = 'download'${downloadFilterConditions} GROUP BY blob1 HAVING MIN(timestamp) >= ${startDateTime} AND MIN(timestamp) <= ${endDateTime}) GROUP BY month, country ORDER BY month`;
    }

    case 'topCampaigns': {
      /**
       * Query raw download data for top campaigns analysis
       *
       * Fetches individual download events with campaign metadata.
       * Data is aggregated in JavaScript (processTopCampaigns) to calculate:
       * - Unique operating units (OUs) per campaign
       * - Unique downloaders per campaign
       * - Total assets + templates downloaded per campaign
       * - Total downloads (sum of download counts)
       *
       * Using raw data fetch + JS aggregation because Analytics Engine SQL
       * has limited support for complex aggregations (no ANY(), limited CASE WHEN).
       *
       * Schema:
       * - blob1: user userId
       * - blob2: user country (OU)
       * - blob6: resourceType ('asset' or 'template')
       * - blob7: campaign name
       * - blob8: brand name
       * - double1: download count
       */
      const downloadFilterConditions = buildDownloadFilterConditions(filters);
      return `SELECT 
        blob7 as campaign, 
        blob8 as brand,
        blob1 as userId,
        blob2 as country,
        blob6 as resourceType,
        double1 as downloadCount
      FROM spark_analytics 
      WHERE index1 = 'download' AND blob7 != '' AND ${timestampFilter}${downloadFilterConditions}`;
    }

    case 'topAssets': {
      /**
       * Query raw download data for top assets analysis
       *
       * Fetches individual download events with asset metadata.
       * Data is aggregated in JavaScript (processTopAssets) to calculate:
       * - Unique operating units (OUs) per asset
       * - Unique downloaders per asset
       * - Total downloads per asset
       *
       * Using raw data fetch + JS aggregation because Analytics Engine SQL
       * has limited support for complex aggregations.
       *
       * Schema:
       * - blob1: user userId (for unique downloader count)
       * - blob2: user country (OU)
       * - blob7: campaign name
       * - blob8: brand name
       * - blob10: downloadItemId (asset ID)
       * - double1: download count (always 1 in new schema)
       */
      const downloadFilterConditions = buildDownloadFilterConditions(filters);
      return `SELECT 
        blob10 as assetId, 
        blob7 as campaign,
        blob8 as brand,
        blob1 as userId,
        blob2 as country,
        double1 as downloadCount
      FROM spark_analytics 
      WHERE index1 = 'download' AND blob10 != '' AND ${timestampFilter}${downloadFilterConditions}`;
    }

    case 'userActivityByMonth':
      /**
       * Query user activity metrics by month
       *
       * Returns counts of unique users grouped by event type:
       * - 'login' events (unique visitors)
       * - 'search' events (unique searchers)
       * - 'download' events (unique downloaders)
       *
       * Each event type is counted separately per month, allowing calculation
       * of engagement percentages (searchers/visitors, downloaders/visitors).
       *
       * Schema:
       * - blob1: user userId (for distinct count)
       * - index1: event type ('login', 'search', 'download')
       * - timestamp: event timestamp
       */
      return `SELECT 
        formatDateTime(timestamp, '%Y-%m') as month,
        index1 as eventType,
        COUNT(DISTINCT blob1) as uniqueUsers
      FROM spark_analytics 
      WHERE index1 IN ('login', 'search', 'download') AND ${timestampFilter}
      GROUP BY month, eventType 
      ORDER BY month`;

    case 'uniqueVisitorsByMonth':
      /**
       * Query total unique visitors by month (across ALL event types)
       *
       * Returns the distinct count of users who performed ANY activity (login, search, download)
       * in each month. This is different from userActivityByMonth which breaks down by event type.
       *
       * Used for the "Unique Visitors" column in User Activity table.
       *
       * Schema:
       * - blob1: user userId (for distinct count)
       * - index1: event type ('login', 'search', 'download')
       * - timestamp: event timestamp
       */
      return `SELECT 
        formatDateTime(timestamp, '%Y-%m') as month,
        COUNT(DISTINCT blob1) as uniqueVisitors
      FROM spark_analytics 
      WHERE index1 IN ('login', 'search', 'download') AND blob1 IS NOT NULL AND blob1 != '' AND ${timestampFilter}
      GROUP BY month 
      ORDER BY month`;

    case 'firstTimeUsersByMonth':
      /**
       * Query registered new users by month
       *
       * Counts users whose FIRST EVER login event occurred in each month.
       * This differs from unique visitors (who may have logged in before).
       *
       * Uses a subquery to:
       * 1. Find each user's MIN(timestamp) across ALL time
       * 2. Filter for first logins within the date range
       * 3. Group by month to count new registrations
       *
       * This represents true "registered new users" for User Activity report.
       *
       * Schema:
       * - blob1: user userId (unique identifier)
       * - index1: event type ('login')
       * - timestamp: event timestamp
       */
      return `SELECT 
        formatDateTime(first_ts, '%Y-%m') as month,
        COUNT() as count
      FROM (
        SELECT blob1, MIN(timestamp) as first_ts 
        FROM spark_analytics 
        WHERE index1 = 'login' 
        GROUP BY blob1 
        HAVING MIN(timestamp) >= ${startDateTime} AND MIN(timestamp) <= ${endDateTime}
      )
      GROUP BY month 
      ORDER BY month`;

    default:
      throw new Error(`Unknown metric type: ${metricType}`);
  }
}

/**
 * Normalize month key to YYYY-MM format
 * Handles various possible formats from Analytics Engine SQL:
 * - "2026-01" (formatDateTime %Y-%m)
 * - "2026-01-01" or "2026-01-01 00:00:00" (toStartOfMonth)
 * - "2026-1" (missing leading zero)
 * @param {string} monthValue - Month value from SQL query
 * @returns {string} Normalized month key in YYYY-MM format
 */
function normalizeMonthKey(monthValue) {
  if (!monthValue) return null;

  // Convert to string and trim
  const str = String(monthValue).trim();

  // Try to extract YYYY-MM from various formats
  // Match patterns like "2026-01", "2026-1", "2026-01-01", "2026-01-01 00:00:00"
  const match = str.match(/^(\d{4})-(\d{1,2})/);
  if (match) {
    const yearPart = match[1];
    const monthPart = match[2].padStart(2, '0');
    return `${yearPart}-${monthPart}`;
  }

  // If no match, return original value
  return str;
}

/**
 * Process downloads by month data into chart format
 * @param {Array} data - Raw query data
 * @param {number} year - Year for the report
 * @returns {Array} Formatted data for monthly chart
 */
function processDownloadsByMonth(data, year) {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Initialize all months with zero values
  const monthlyData = {};
  monthNames.forEach((name, index) => {
    const monthKey = `${year}-${String(index + 1).padStart(2, '0')}`;
    monthlyData[monthKey] = { month: name, assetCount: 0, templateCount: 0 };
  });

  // Log raw data for debugging
  console.info('[processDownloadsByMonth] Raw data from query:', JSON.stringify(data));
  console.info('[processDownloadsByMonth] Expected year:', year);
  console.info('[processDownloadsByMonth] Available month keys:', Object.keys(monthlyData));

  // Fill in data from query results
  data.forEach((row) => {
    // Normalize the month key to ensure consistent YYYY-MM format
    const rawMonth = row.month;
    const monthKey = normalizeMonthKey(rawMonth);

    console.info('[processDownloadsByMonth] Processing row:', {
      rawMonth,
      normalizedMonthKey: monthKey,
      resourceType: row.resource_type,
      downloads: row.downloads,
      matchesExpected: !!monthlyData[monthKey],
    });

    if (monthlyData[monthKey]) {
      const resourceType = (row.resource_type || '').toLowerCase();
      const downloads = parseInt(row.downloads, 10) || 0;
      if (resourceType === 'asset') {
        monthlyData[monthKey].assetCount = downloads;
      } else if (resourceType === 'template') {
        monthlyData[monthKey].templateCount = downloads;
      }
    } else {
      console.warn('[processDownloadsByMonth] Month key not found in expected range:', {
        rawMonth,
        normalizedMonthKey: monthKey,
        expectedYear: year,
      });
    }
  });

  // Log final result
  const result = monthNames.map((_name, index) => {
    const monthKey = `${year}-${String(index + 1).padStart(2, '0')}`;
    return monthlyData[monthKey];
  });
  console.info('[processDownloadsByMonth] Final result:', JSON.stringify(result));

  // Convert to array in month order
  return result;
}

/**
 * Country to Region mapping
 * Maps country codes AND country names to region codes used in the report
 */
const COUNTRY_TO_REGION = {
  // Africa (AFR) - codes and names
  ZA: 'AFR',
  NG: 'AFR',
  KE: 'AFR',
  EG: 'AFR',
  MA: 'AFR',
  GH: 'AFR',
  TZ: 'AFR',
  UG: 'AFR',
  ET: 'AFR',
  DZ: 'AFR',
  'SOUTH AFRICA': 'AFR',
  NIGERIA: 'AFR',
  KENYA: 'AFR',
  EGYPT: 'AFR',
  MOROCCO: 'AFR',
  GHANA: 'AFR',
  // Asia Pacific (ASP)
  AU: 'ASP',
  NZ: 'ASP',
  SG: 'ASP',
  MY: 'ASP',
  TH: 'ASP',
  VN: 'ASP',
  PH: 'ASP',
  ID: 'ASP',
  HK: 'ASP',
  TW: 'ASP',
  AUSTRALIA: 'ASP',
  'NEW ZEALAND': 'ASP',
  SINGAPORE: 'ASP',
  MALAYSIA: 'ASP',
  THAILAND: 'ASP',
  VIETNAM: 'ASP',
  PHILIPPINES: 'ASP',
  INDONESIA: 'ASP',
  'HONG KONG': 'ASP',
  TAIWAN: 'ASP',
  // Eurasia & Middle East (EME)
  RU: 'EME',
  TR: 'EME',
  SA: 'EME',
  AE: 'EME',
  PK: 'EME',
  UA: 'EME',
  KZ: 'EME',
  QA: 'EME',
  KW: 'EME',
  BH: 'EME',
  RUSSIA: 'EME',
  TURKEY: 'EME',
  'SAUDI ARABIA': 'EME',
  UAE: 'EME',
  'UNITED ARAB EMIRATES': 'EME',
  PAKISTAN: 'EME',
  UKRAINE: 'EME',
  // Europe (EU)
  GB: 'EU',
  DE: 'EU',
  FR: 'EU',
  IT: 'EU',
  ES: 'EU',
  NL: 'EU',
  BE: 'EU',
  CH: 'EU',
  AT: 'EU',
  SE: 'EU',
  NO: 'EU',
  DK: 'EU',
  FI: 'EU',
  PL: 'EU',
  PT: 'EU',
  IE: 'EU',
  GR: 'EU',
  CZ: 'EU',
  RO: 'EU',
  HU: 'EU',
  'UNITED KINGDOM': 'EU',
  UK: 'EU',
  GERMANY: 'EU',
  FRANCE: 'EU',
  ITALY: 'EU',
  SPAIN: 'EU',
  NETHERLANDS: 'EU',
  BELGIUM: 'EU',
  SWITZERLAND: 'EU',
  AUSTRIA: 'EU',
  SWEDEN: 'EU',
  NORWAY: 'EU',
  DENMARK: 'EU',
  FINLAND: 'EU',
  POLAND: 'EU',
  PORTUGAL: 'EU',
  IRELAND: 'EU',
  GREECE: 'EU',
  // Greater China & Mongolia (GCM)
  CN: 'GCM',
  MN: 'GCM',
  CHINA: 'GCM',
  MONGOLIA: 'GCM',
  // India, South West Asia (INSWA)
  IN: 'INSWA',
  BD: 'INSWA',
  LK: 'INSWA',
  NP: 'INSWA',
  AF: 'INSWA',
  INDIA: 'INSWA',
  BANGLADESH: 'INSWA',
  'SRI LANKA': 'INSWA',
  NEPAL: 'INSWA',
  AFGHANISTAN: 'INSWA',
  // Japan & South Korea (JSK)
  JP: 'JSK',
  KR: 'JSK',
  JAPAN: 'JSK',
  'SOUTH KOREA': 'JSK',
  KOREA: 'JSK',
  // Latin America (LA)
  BR: 'LA',
  MX: 'LA',
  AR: 'LA',
  CO: 'LA',
  CL: 'LA',
  PE: 'LA',
  VE: 'LA',
  EC: 'LA',
  GT: 'LA',
  CU: 'LA',
  DO: 'LA',
  HN: 'LA',
  PA: 'LA',
  CR: 'LA',
  PR: 'LA',
  UY: 'LA',
  PY: 'LA',
  BO: 'LA',
  SV: 'LA',
  NI: 'LA',
  BRAZIL: 'LA',
  MEXICO: 'LA',
  ARGENTINA: 'LA',
  COLOMBIA: 'LA',
  CHILE: 'LA',
  PERU: 'LA',
  VENEZUELA: 'LA',
  ECUADOR: 'LA',
  // North America (NA)
  US: 'NA',
  CA: 'NA',
  USA: 'NA',
  'UNITED STATES': 'NA',
  CANADA: 'NA',
};

const GEO_CODES = ['AFR', 'ASP', 'EME', 'EU', 'GCM', 'INSWA', 'JSK', 'LA', 'NA'];

/**
 * Process geo data into table format
 * @param {Array} downloadersData - Downloaders by geo
 * @param {Array} assetsData - Asset downloads by geo
 * @param {Array} templatesData - Template downloads by geo
 * @returns {Object} Formatted data for geo table
 */
function processGeoData(downloadersData, assetsData, templatesData) {
  // Initialize region data
  const regionData = {};
  GEO_CODES.forEach((code) => {
    regionData[code] = {
      downloaders: 0,
      assetDownloads: 0,
      templateDownloads: 0,
    };
  });

  // Helper to get region from country code
  const getRegion = (countryCode) => {
    const code = (countryCode || '').toUpperCase();
    return COUNTRY_TO_REGION[code] || null;
  };

  // Aggregate downloaders by region
  downloadersData.forEach((row) => {
    const region = getRegion(row.geo);
    if (region && regionData[region]) {
      regionData[region].downloaders += parseInt(row.downloaders, 10) || 0;
    }
  });

  // Aggregate asset downloads by region
  assetsData.forEach((row) => {
    const region = getRegion(row.geo);
    if (region && regionData[region]) {
      regionData[region].assetDownloads += parseInt(row.downloads, 10) || 0;
    }
  });

  // Aggregate template downloads by region
  templatesData.forEach((row) => {
    const region = getRegion(row.geo);
    if (region && regionData[region]) {
      regionData[region].templateDownloads += parseInt(row.downloads, 10) || 0;
    }
  });

  // Build the output structure matching what the frontend expects
  const geos = [...GEO_CODES, 'TOTAL'];

  // Calculate totals
  let totalDownloaders = 0;
  let totalAssets = 0;
  let totalTemplates = 0;

  GEO_CODES.forEach((code) => {
    totalDownloaders += regionData[code].downloaders;
    totalAssets += regionData[code].assetDownloads;
    totalTemplates += regionData[code].templateDownloads;
  });

  // Build metrics array
  const metrics = [
    {
      label: '# of Downloaders',
      values: [...GEO_CODES.map((code) => regionData[code].downloaders), totalDownloaders],
    },
    {
      label: '# of Asset Downloads',
      values: [...GEO_CODES.map((code) => regionData[code].assetDownloads), totalAssets],
    },
    {
      label: '# of Template Downloads',
      values: [...GEO_CODES.map((code) => regionData[code].templateDownloads), totalTemplates],
    },
    {
      label: 'Total Downloads',
      values: [
        ...GEO_CODES.map((code) => regionData[code].assetDownloads + regionData[code].templateDownloads),
        totalAssets + totalTemplates,
      ],
    },
  ];

  return { geos, metrics };
}

/**
 * OU codes for first-time downloaders table (uses EURO not EU)
 */
const OU_CODES = ['AFR', 'ASP', 'EME', 'EURO', 'GCM', 'INSWA', 'JSK', 'LA', 'NA'];

/**
 * Country to OU mapping (same as COUNTRY_TO_REGION but maps EU->EURO)
 */
const COUNTRY_TO_OU = {};
Object.keys(COUNTRY_TO_REGION).forEach((key) => {
  COUNTRY_TO_OU[key] = COUNTRY_TO_REGION[key] === 'EU' ? 'EURO' : COUNTRY_TO_REGION[key];
});

/**
 * Process first-time downloaders by OU data
 * @param {Array} data - Raw query data [{month, country, count}]
 * @param {number} year - Year for the report
 * @returns {Array} Formatted data for OU table
 */
function processFirstTimeDownloadersByOU(data, year) {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Initialize all months with zero values for each OU
  const monthlyData = {};
  monthNames.forEach((name, index) => {
    const monthKey = `${year}-${String(index + 1).padStart(2, '0')}`;
    monthlyData[monthKey] = { month: name };
    OU_CODES.forEach((ou) => {
      monthlyData[monthKey][ou] = 0;
    });
  });

  // Helper to get OU from country
  const getOU = (countryCode) => {
    const code = (countryCode || '').toUpperCase();
    return COUNTRY_TO_OU[code] || null;
  };

  // Aggregate by month and OU
  data.forEach((row) => {
    const monthKey = row.month;
    const ou = getOU(row.country);
    if (monthlyData[monthKey] && ou) {
      monthlyData[monthKey][ou] += parseInt(row.count, 10) || 0;
    }
  });

  // Convert to array in month order
  return monthNames.map((_name, index) => {
    const monthKey = `${year}-${String(index + 1).padStart(2, '0')}`;
    return monthlyData[monthKey];
  });
}

// =============================================================================
// ROLE CONFIGURATION (Duplicated from scripts/analytics/analytics-constants.js)
// =============================================================================
// NOTE: This role configuration is intentionally duplicated here because the
// Cloudflare Worker cannot import from the frontend scripts directory.
// If you update role mappings, aliases, or colors, you MUST update BOTH:
//   1. scripts/analytics/analytics-constants.js (frontend)
//   2. This file (cloudflare/src/api/analytics.js)
// =============================================================================

/**
 * Map of known primary role values (lowercase) to display names
 */
const ROLE_DISPLAY_NAMES = {
  associate: 'Associate',
  agency: 'Agency',
  partner: 'Partner',
};

/**
 * Map of role aliases to their primary role
 * These roles should be treated as their mapped primary role
 */
const ROLE_ALIASES = {
  employee: 'associate',
  'contingent-worker': 'associate',
};

/**
 * List of known role display names in display order
 */
const KNOWN_ROLES = ['Associate', 'Agency', 'Partner'];

/**
 * Resolve a raw role string to a known display name
 * Handles direct matches, aliases, and comma-separated roles
 * @param {string} rawRole - Raw role string from API
 * @returns {string|null} Display name if resolved, null if should go to "Other"
 */
function resolveRole(rawRole) {
  const role = (rawRole || '').toLowerCase().trim();
  if (!role) return null;

  // 1. Check for direct match with known roles
  if (ROLE_DISPLAY_NAMES[role]) {
    return ROLE_DISPLAY_NAMES[role];
  }

  // 2. Check for alias match (e.g., 'employee' -> 'Associate')
  if (ROLE_ALIASES[role]) {
    return ROLE_DISPLAY_NAMES[ROLE_ALIASES[role]];
  }

  // 3. Handle comma-separated roles (e.g., 'contingent-worker,admin')
  if (role.includes(',')) {
    const parts = role.split(',').map((p) => p.trim());
    const matchedPart = parts.find((part) => ROLE_DISPLAY_NAMES[part] || ROLE_ALIASES[part]);

    if (matchedPart) {
      return ROLE_DISPLAY_NAMES[matchedPart] || ROLE_DISPLAY_NAMES[ROLE_ALIASES[matchedPart]];
    }
  }

  // 4. No match found - will be bucketed into "Other"
  return null;
}

/**
 * Process role data into chart format
 * Maps known roles to display names and buckets unmapped roles into "Other"
 * @param {Array} data - Raw query data
 * @param {string} valueField - 'downloaders' or 'downloads'
 * @returns {Array} Formatted data for pie chart
 */
function processRoleData(data, valueField) {
  // Initialize with all roles at 0 (including Other for unmapped roles)
  const roleData = {
    Associate: 0,
    Agency: 0,
    Partner: 0,
    Other: 0,
  };

  // Fill in data from query results
  data.forEach((row) => {
    const value = parseInt(row[valueField], 10) || 0;
    if (value <= 0) return;

    const displayName = resolveRole(row.role);
    if (displayName) {
      roleData[displayName] += value;
    } else if (row.role) {
      // Unresolved role goes to Other
      roleData.Other += value;
    }
  });

  // Convert to array format expected by charts
  // Only include roles that have values
  const result = [];
  KNOWN_ROLES.forEach((roleName) => {
    if (roleData[roleName] > 0) {
      result.push({ type: roleName, count: roleData[roleName] });
    }
  });
  if (roleData.Other > 0) {
    result.push({ type: 'Other', count: roleData.Other });
  }

  return result;
}

/**
 * Process top campaigns data - aggregate raw download events by campaign
 * @param {Array} data - Raw query data from topCampaigns query (individual download events)
 * @returns {Array} Formatted campaigns data matching historical format (top 10)
 */
function processTopCampaigns(data) {
  const campaignMap = {};

  // Aggregate data by campaign
  data.forEach((row) => {
    const campaignName = row.campaign || UNKNOWN_VALUE;

    if (!campaignMap[campaignName]) {
      campaignMap[campaignName] = {
        name: campaignName,
        brand: row.brand || UNKNOWN_VALUE,
        countries: new Set(),
        downloaders: new Set(),
        assetsTemplates: new Set(),
        totalDownloads: 0,
      };
    }

    const campaign = campaignMap[campaignName];

    // Track unique countries (OUs)
    if (row.country) {
      campaign.countries.add(row.country);
    }

    // Track unique downloaders
    if (row.email) {
      campaign.downloaders.add(row.email);
    }

    // Track unique asset+template downloads by user
    if (row.email && row.resourceType && (row.resourceType === 'asset' || row.resourceType === 'template')) {
      campaign.assetsTemplates.add(`${row.email}-${row.resourceType}`);
    }

    // Sum total downloads
    campaign.totalDownloads += parseFloat(row.downloadCount) || 0;
  });

  // Convert to array and format for UI
  const campaigns = Object.values(campaignMap).map((campaign) => ({
    name: campaign.name,
    brand: campaign.brand,
    ousWithDownload: campaign.countries.size,
    downloaders: campaign.downloaders.size,
    assetsTemplatesDownloaded: campaign.assetsTemplates.size,
    totalDownloads: Math.round(campaign.totalDownloads),
  }));

  // Sort by totalDownloads DESC and return top 10
  return campaigns.sort((a, b) => b.totalDownloads - a.totalDownloads).slice(0, TOP_CAMPAIGNS_LIMIT);
}

/**
 * Process top assets data - aggregate raw download events by asset ID
 * @param {Array} data - Raw query data from topAssets query (individual download events)
 * @returns {Array} Formatted assets data (top 10 by download count)
 */
function processTopAssets(data) {
  const assetMap = {};

  // Aggregate data by asset ID
  data.forEach((row) => {
    const assetId = row.assetId || UNKNOWN_VALUE;

    // Skip unknown/empty asset IDs
    if (assetId === UNKNOWN_VALUE || assetId === '') {
      return;
    }

    if (!assetMap[assetId]) {
      assetMap[assetId] = {
        assetId,
        brand: row.brand || UNKNOWN_VALUE,
        campaign: row.campaign || UNKNOWN_VALUE,
        countries: new Set(),
        downloaders: new Set(),
        totalDownloads: 0,
      };
    }

    const asset = assetMap[assetId];

    // Track unique countries (OUs)
    if (row.country) {
      asset.countries.add(row.country);
    }

    // Track unique downloaders
    if (row.email) {
      asset.downloaders.add(row.email);
    }

    // Sum total downloads (each event = 1 download in new schema)
    asset.totalDownloads += parseFloat(row.downloadCount) || 1;
  });

  // Convert to array and format for UI
  const assets = Object.values(assetMap).map((asset) => ({
    assetId: asset.assetId,
    brand: asset.brand,
    campaign: asset.campaign,
    ousWithDownload: asset.countries.size,
    downloaders: asset.downloaders.size,
    totalDownloads: Math.round(asset.totalDownloads),
  }));

  // Sort by totalDownloads DESC and return top 10
  return assets.sort((a, b) => b.totalDownloads - a.totalDownloads).slice(0, TOP_ASSETS_LIMIT);
}

/**
 * Process user activity data by month
 * Transforms raw data into monthly user activity with percentages
 * @param {Array} data - Raw query data with month, eventType, uniqueUsers
 * @param {Array} firstTimeUsersData - First-time users data by month
 * @param {number} year - Year for the report
 * @returns {Array} Formatted data for user activity table
 */
function processUserActivityByMonth(data, firstTimeUsersData, year) {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Initialize all months
  const monthlyActivity = {};
  monthNames.forEach((name, index) => {
    const monthKey = `${year}-${String(index + 1).padStart(2, '0')}`;
    monthlyActivity[monthKey] = {
      month: name,
      registeredNewUsers: 0,
      uniqueVisitors: 0,
      uniqueSearchers: 0,
      uniqueDownloaders: 0,
    };
  });

  // Fill in activity data (visitors, searchers, downloaders)
  data.forEach((row) => {
    const monthKey = row.month; // e.g., "2025-01"
    if (monthlyActivity[monthKey]) {
      const count = parseInt(row.uniqueUsers, 10) || 0;
      const eventType = row.eventType;

      if (eventType === 'login') {
        monthlyActivity[monthKey].uniqueVisitors = count;
      } else if (eventType === 'search') {
        monthlyActivity[monthKey].uniqueSearchers = count;
      } else if (eventType === 'download') {
        monthlyActivity[monthKey].uniqueDownloaders = count;
      }
    }
  });

  // Fill in first-time users (registered new users) data
  firstTimeUsersData.forEach((row) => {
    const monthKey = row.month; // e.g., "2025-01"
    if (monthlyActivity[monthKey]) {
      monthlyActivity[monthKey].registeredNewUsers = parseInt(row.count, 10) || 0;
    }
  });

  // Convert to array and calculate percentages
  return monthNames.map((_name, index) => {
    const monthKey = `${year}-${String(index + 1).padStart(2, '0')}`;
    const activity = monthlyActivity[monthKey];

    // Calculate percentages
    const searchersPct =
      activity.uniqueVisitors > 0
        ? Math.round((activity.uniqueSearchers / activity.uniqueVisitors) * PERCENTAGE_MULTIPLIER)
        : 0;
    const downloadersPct =
      activity.uniqueVisitors > 0
        ? Math.round((activity.uniqueDownloaders / activity.uniqueVisitors) * PERCENTAGE_MULTIPLIER)
        : 0;

    return {
      month: activity.month,
      registeredNewUsers: activity.registeredNewUsers,
      uniqueVisitors: activity.uniqueVisitors,
      uniqueSearchers: activity.uniqueSearchers,
      searchersPct,
      uniqueDownloaders: activity.uniqueDownloaders,
      downloadersPct,
    };
  });
}

/**
 * Execute a report query against CloudFlare Analytics Engine SQL API
 * @param {string} accountId - CloudFlare account ID
 * @param {string} apiToken - CloudFlare API token
 * @param {string} sql - SQL query to execute
 */
async function executeReportQuery(accountId, apiToken, sql) {
  console.info('[Analytics API] Executing report query:', sql);

  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Bearer ${apiToken}`,
    },
    body: sql,
  });

  const responseText = await response.text();

  let result;
  try {
    result = JSON.parse(responseText);
  } catch {
    result = { data: [], meta: {} };
  }

  if (!response.ok) {
    console.error('[Analytics API] Report query error:', response.status, result.errors || responseText);
    const errorMessage = result.errors?.[0]?.message || responseText || `HTTP ${response.status}`;
    throw new Error(errorMessage);
  }

  console.info('[Analytics API] Report query result:', { rowCount: result.data?.length || 0 });

  return result;
}

// =============================================================================
// RAW DOWNLOADS CSV EXPORT
// =============================================================================

/**
 * Permission required to access raw downloads export
 */
const PERMISSION_ADMIN_REPORTS = 'admin-reports';
const TOP_SEARCHES_LIMIT = 20;

/**
 * Maximum rows to return for raw downloads export
 */
const RAW_DOWNLOADS_MAX_ROWS = 10000;

/**
 * Escape a value for CSV output
 * Wraps in quotes and escapes internal quotes
 *
 * @param {*} value - Value to escape
 * @returns {string} CSV-safe string
 */
function escapeCSV(value) {
  const str = String(value ?? '');
  // If contains comma, quote, or newline, wrap in quotes and escape internal quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * GET /api/analytics/raw-downloads
 * Export raw download events as CSV
 * Requires admin-reports permission
 *
 * Query params:
 *   - year: Year to filter (required)
 *   - month: Optional month (1-12) for month-specific data
 *
 * Response: CSV file with download events
 */
async function getRawDownloads(request, env) {
  if (request.method !== 'GET') {
    return error(405, { success: false, error: 'Method not allowed' });
  }

  // Permission check - require admin-reports
  if (!request.user?.permissions?.includes(PERMISSION_ADMIN_REPORTS)) {
    console.warn('[Analytics API] Raw downloads access denied - missing admin-reports permission');
    return error(403, {
      success: false,
      error: `${PERMISSION_ADMIN_REPORTS} permission required`,
      message: 'You do not have permission to export raw download data',
    });
  }

  try {
    const url = new URL(request.url);
    const currentYear = new Date().getFullYear();
    const year = parseInt(url.searchParams.get('year'), 10) || currentYear;
    const month = url.searchParams.get('month') ? parseInt(url.searchParams.get('month'), 10) : null;

    // Check if API token is configured
    if (!env.ANALYTICS_API_TOKEN) {
      console.error('[Analytics API] Analytics API token not configured');
      return error(500, {
        success: false,
        error: 'Analytics API token not configured',
      });
    }

    const accountId = config.ANALYTICS_ACCOUNT_ID;
    const apiToken = await env.ANALYTICS_API_TOKEN.get();

    // Build date range for the query
    let startDate;
    let endDate;

    if (month) {
      // Specific month
      startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      endDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
    } else {
      // Full year
      startDate = `${year}-01-01`;
      endDate = `${year}-12-31`;
    }

    console.info('[Analytics API] Raw downloads export request:', {
      year,
      month: month || 'full year',
      startDate,
      endDate,
      user: request.user?.userId,
    });

    // Build and execute query for raw download events
    // Note: blob1 is now userId (was email), blob9-12 are new enhanced tracking fields
    const startDateTime = `toDateTime('${startDate} 00:00:00')`;
    const endDateTime = `toDateTime('${endDate} 23:59:59')`;

    const sql = `
      SELECT 
        timestamp,
        blob1 as userId,
        blob2 as country,
        blob3 as employeeType,
        blob4 as company,
        blob5 as roles,
        blob6 as resourceType,
        blob7 as campaign,
        blob8 as brand,
        blob9 as downloadId,
        blob10 as downloadItemId,
        blob11 as downloadType,
        blob12 as rendition,
        blob13 as publicationId
      FROM spark_analytics 
      WHERE index1 = 'download' 
        AND timestamp >= ${startDateTime} 
        AND timestamp <= ${endDateTime}
      ORDER BY timestamp DESC
      LIMIT ${RAW_DOWNLOADS_MAX_ROWS}
    `;

    const result = await executeReportQuery(accountId, apiToken, sql);
    const rows = result.data || [];

    console.info('[Analytics API] Raw downloads query returned:', {
      rowCount: rows.length,
      truncated: rows.length >= RAW_DOWNLOADS_MAX_ROWS,
    });

    // Build CSV content
    // Note: userId replaces email (not PII, no masking needed)
    const headers = [
      'Date/Time',
      'User ID',
      'Country',
      'Employee Type',
      'Company',
      'Role',
      'Download ID',
      'Resource Type',
      'Asset ID',
      'Template ID',
      'Publication ID',
      'Campaign',
      'Brand',
      'Download Type',
      'Rendition',
    ];

    const csvRows = rows.map((row) => {
      const isTemplate = row.resourceType === 'template';
      return [
        escapeCSV(row.timestamp),
        escapeCSV(row.userId),
        escapeCSV(row.country),
        escapeCSV(row.employeeType),
        escapeCSV(row.company),
        escapeCSV(row.roles),
        escapeCSV(row.downloadId), // Download ID
        escapeCSV(row.resourceType), // Resource Type
        escapeCSV(isTemplate ? '' : stripAssetUrn(row.downloadItemId)), // Asset ID
        escapeCSV(isTemplate ? stripAssetUrn(row.downloadItemId) : ''), // Template ID
        escapeCSV(stripAssetUrn(row.publicationId)), // Publication ID
        escapeCSV(row.campaign), // Campaign
        escapeCSV(row.brand), // Brand
        escapeCSV(row.downloadType), // Download Type
        escapeCSV(row.rendition), // Rendition
      ].join(',');
    });

    const csvContent = [headers.join(','), ...csvRows].join('\n');

    // Generate filename based on date range
    const filename = month
      ? `downloads-raw-${year}-${String(month).padStart(2, '0')}.csv`
      : `downloads-raw-${year}.csv`;

    // Return CSV response
    return new Response(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Total-Rows': String(rows.length),
        'X-Truncated': String(rows.length >= RAW_DOWNLOADS_MAX_ROWS),
      },
    });
  } catch (err) {
    console.error('[Analytics API] Error getting raw downloads:', err.message, err.stack);
    return error(500, {
      success: false,
      error: err.message || 'Failed to export raw downloads',
    });
  }
}

// =============================================================================
// ANALYTICS ENGINE WRITE
// =============================================================================

/**
 * Write event to Analytics Engine
 *
 * @param {Object} analyticsEngine - Analytics Engine binding (env.SPARK_ANALYTICS_ENGINE)
 * @param {string} eventType - 'login', 'search', or 'download'
 * @param {Object} data - Event data to write
 * @param {Object} [env] - Optional Cloudflare env (for DEBUG_ANALYTICS flag)
 *
 * Consistent blob structure across all events:
 *   blob1: userId (WHO - user ID)
 *   blob2: country
 *   blob3: employeeType
 *   blob4: company
 *   blob5: roles
 *   blob6: event-specific (searchTerm for search, resourceType for download)
 *   blob7: event-specific (searchType for search, campaigns for download)
 *   blob8: event-specific (brand for download)
 *   blob9: downloadId (download only - session grouping)
 *   blob10: downloadItemId (download only - asset ID / base template ID)
 *   blob11: downloadType (download only - ready-to-use/restricted)
 *   blob12: rendition (download only - rendition name)
 *   blob13: publicationId (download only - customized/derived template ID, empty for non-customized)
 *   double1: event-specific (resultCount for search; removed for download - each event = 1)
 *   index1: eventType
 *   timestamp: native Analytics Engine timestamp (WHEN)
 */
export async function writeAnalyticsEvent(analyticsEngine, eventType, data, env) {
  const debug = env?.DEBUG_ANALYTICS;

  if (debug) {
    console.info('[Analytics Engine] 📝 Preparing to write event...');
    console.info('[Analytics Engine] Event type:', eventType);
    console.info('[Analytics Engine] Timestamp: native (current time)');
  }

  // Common blobs for all events (WHO + context)
  // Note: userId replaces email as user identifier for privacy
  const commonBlobs = [
    data.userId, // blob1 - WHO (user ID)
    data.country, // blob2
    data.employeeType, // blob3
    data.company, // blob4
    data.roles.join(','), // blob5
  ];

  let dataPoint;

  switch (eventType) {
    case 'login':
      dataPoint = {
        blobs: commonBlobs,
        indexes: [eventType],
      };
      if (debug) {
        console.info('[Analytics Engine] 🔐 LOGIN EVENT');
      }
      break;

    case 'search':
      dataPoint = {
        blobs: [...commonBlobs, data.searchTerm, data.searchType || 'unknown'], // blob6 = searchTerm, blob7 = searchType
        doubles: [data.resultCount], // double1 = resultCount
        indexes: [eventType],
      };
      if (debug) {
        console.info(
          '[Analytics Engine] 🔍 SEARCH EVENT - searchTerm:',
          data.searchTerm,
          'searchType:',
          data.searchType,
          'resultCount:',
          data.resultCount,
        );
      }
      break;

    case 'download':
      // Enhanced download tracking with new fields (blob9-13)
      // Each event = 1 download (no count/double1 needed)
      dataPoint = {
        blobs: [
          ...commonBlobs, // blob1-5
          data.resourceType, // blob6 - asset/template
          data.campaigns, // blob7 - campaign name
          data.brand, // blob8 - brand name
          data.downloadId || '', // blob9 - session grouping UUID
          data.downloadItemId || '', // blob10 - asset ID (base template for customized)
          data.downloadType || '', // blob11 - ready-to-use/restricted
          data.rendition || '', // blob12 - rendition name
          data.publicationId || '', // blob13 - customized/derived template ID
        ],
        indexes: [eventType],
      };
      if (debug) {
        console.info(
          '[Analytics Engine] 📥 DOWNLOAD EVENT - resourceType:',
          data.resourceType,
          'campaigns:',
          data.campaigns,
          'brand:',
          data.brand,
          'downloadId:',
          data.downloadId,
          'itemId:',
          data.downloadItemId,
          'pubId:',
          data.publicationId,
          'type:',
          data.downloadType,
          'rendition:',
          data.rendition,
        );
      }
      break;

    default:
      console.error('[Analytics Engine] ❌ Unknown event type:', eventType);
      throw new Error(`Unknown event type: ${eventType}`);
  }

  if (debug) {
    console.info('[Analytics Engine] Data point:', JSON.stringify(dataPoint));
  }

  try {
    analyticsEngine.writeDataPoint(dataPoint);
    if (debug) {
      console.info('[Analytics Engine] ✅ writeDataPoint() called successfully');
    }
  } catch (err) {
    console.error('[Analytics Engine] ❌ writeDataPoint() error:', err.message);
    throw err;
  }
}

// =============================================================================
// SEARCH METRICS API — D1-backed (replaces Analytics Engine for searches)
// =============================================================================

const SEARCH_TOP_LIMIT = 20;

/** Allowed characters for asset market filter values (assetMetadata.allowedCountries) */
const MARKET_TOKEN_PATTERN = /^[A-Za-z0-9 _-]{1,64}$/;

/**
 * Validate a market filter token from the report UI.
 * @param {string} value
 * @returns {boolean}
 */
function isValidMarketToken(value) {
  return typeof value === 'string' && MARKET_TOKEN_PATTERN.test(value);
}

/**
 * Date-only conditions for market discovery queries (no market filter applied).
 * @param {string} startDate
 * @param {string} endDate
 * @returns {{ whereClause: string, bindings: string[] }}
 */
function buildSearchDateConditions(startDate, endDate) {
  return {
    whereClause: 'se.occurred_at >= ? AND se.occurred_at <= ?',
    bindings: [`${startDate}T00:00:00.000Z`, `${endDate}T23:59:59.999Z`],
  };
}

/**
 * Role, search type, term, and market filters for search_events (alias `se`).
 * Does not include the occurred_at date range.
 */
function appendSearchAttributeFilters(conditions, bindings, filters = {}) {
  if (filters.role && filters.role !== FILTER_DEFAULT_VALUE) {
    if (!VALID_ROLES.includes(filters.role)) throw new Error(`Invalid role filter: ${filters.role}`);
    const roleValues = ROLE_MAPPINGS[filters.role] || [filters.role];
    const roleClauses = roleValues.map(() => `se.user_role = ?`).join(' OR ');
    conditions.push(`(${roleClauses})`);
    bindings.push(...roleValues);
  }

  if (filters.searchType && filters.searchType !== FILTER_DEFAULT_VALUE) {
    if (!VALID_SEARCH_TYPES.includes(filters.searchType))
      throw new Error(`Invalid searchType filter: ${filters.searchType}`);
    conditions.push(`se.search_type = ?`);
    bindings.push(filters.searchType);
  }

  if (filters.searchTerm && filters.searchTerm !== FILTER_DEFAULT_VALUE) {
    if (!VALID_SEARCH_TERMS.includes(filters.searchTerm))
      throw new Error(`Invalid searchTerm filter: ${filters.searchTerm}`);
    if (filters.searchTerm === 'empty') {
      conditions.push(`(se.search_term = '' OR se.search_term IS NULL)`);
    } else {
      conditions.push(`se.search_term != ''`);
    }
  }

  if (filters.region && filters.region !== FILTER_DEFAULT_VALUE) {
    if (!isValidMarketToken(filters.region)) throw new Error(`Invalid region filter: ${filters.region}`);
    conditions.push(
      `EXISTS (SELECT 1 FROM search_event_markets sem WHERE sem.event_id = se.id AND sem.market = ?)`,
    );
    bindings.push(filters.region);
  }
}

/**
 * Build D1 WHERE clause params for search_events queries (alias `se`).
 * Returns { whereClause, bindings } where bindings are positional (? placeholders).
 */
function buildSearchD1Conditions(startDate, endDate, filters = {}) {
  const conditions = [`se.occurred_at >= ?`, `se.occurred_at <= ?`];
  const bindings = [`${startDate}T00:00:00.000Z`, `${endDate}T23:59:59.999Z`];
  appendSearchAttributeFilters(conditions, bindings, filters);
  return { whereClause: conditions.join(' AND '), bindings };
}

/** Attribute filters only (no date range), for first-time user subqueries. */
function buildSearchAttributeConditions(filters = {}) {
  const conditions = [];
  const bindings = [];
  appendSearchAttributeFilters(conditions, bindings, filters);
  return {
    whereClause: conditions.length ? conditions.join(' AND ') : '1=1',
    bindings,
  };
}

/**
 * GET /api/analytics/search-metrics
 * All search report metrics served from the SEARCH_EVENTS D1 database.
 */
export async function searchMetricsApi(request, env) {
  if (request.method !== 'GET') return error(405, { success: false, error: 'Method not allowed' });

  const db = env.SEARCH_EVENTS;
  if (!db) return error(500, { success: false, error: 'SEARCH_EVENTS D1 binding not configured' });

  try {
    const url = new URL(request.url);
    const metricType = url.searchParams.get('type');

    const currentYear = new Date().getFullYear();
    const year = parseInt(url.searchParams.get('year'), 10) || currentYear;
    const month = url.searchParams.get('month') ? parseInt(url.searchParams.get('month'), 10) : null;
    const customStart = url.searchParams.get('startDate');
    const customEnd = url.searchParams.get('endDate');

    let startDate;
    let endDate;
    if (customStart && customEnd) {
      startDate = customStart;
      endDate = customEnd;
    } else if (month) {
      startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      endDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
    } else {
      startDate = `${year}-01-01`;
      endDate = `${year}-12-31`;
    }

    const filters = {
      role: url.searchParams.get('role') || FILTER_DEFAULT_VALUE,
      searchType: url.searchParams.get('searchType') || FILTER_DEFAULT_VALUE,
      searchTerm: url.searchParams.get('searchTerm') || FILTER_DEFAULT_VALUE,
      region: url.searchParams.get('region') || FILTER_DEFAULT_VALUE,
    };

    if (!metricType) {
      return error(400, { success: false, error: 'Missing required parameter: type' });
    }

    const data = await executeSearchMetric(db, metricType, startDate, endDate, filters, year);
    return json({ success: true, type: metricType, data });
  } catch (err) {
    console.error('[Search Metrics] Error:', err.message);
    return error(500, { success: false, error: err.message || 'Failed to get search metrics' });
  }
}

async function executeSearchMetric(db, metricType, startDate, endDate, filters, _year) {
  const { whereClause, bindings } = buildSearchD1Conditions(startDate, endDate, filters);
  const startTs = `${startDate}T00:00:00.000Z`;
  const endTs = `${endDate}T23:59:59.999Z`;

  switch (metricType) {
    case 'totalSearches': {
      const row = await db
        .prepare(`SELECT COUNT(*) as total FROM search_events se WHERE ${whereClause}`)
        .bind(...bindings)
        .first();
      return [{ total: row?.total ?? 0 }];
    }

    case 'uniqueSearchers': {
      const row = await db
        .prepare(`SELECT COUNT(DISTINCT se.user_id) as unique_count FROM search_events se WHERE ${whereClause}`)
        .bind(...bindings)
        .first();
      return [{ unique_count: row?.unique_count ?? 0 }];
    }

    case 'firstTimeSearchers': {
      const { whereClause: attrWhere, bindings: attrBindings } = buildSearchAttributeConditions(filters);
      const row = await db
        .prepare(
          `SELECT COUNT(*) as first_time_count FROM (
          SELECT se.user_id
          FROM search_events se
          WHERE ${attrWhere}
          GROUP BY se.user_id
          HAVING MIN(se.occurred_at) >= ? AND MIN(se.occurred_at) <= ?
        )`,
        )
        .bind(...attrBindings, startTs, endTs)
        .first();
      return [{ first_time_count: row?.first_time_count ?? 0 }];
    }

    case 'uniqueSearchersByMonth': {
      const rows = await db
        .prepare(
          `SELECT strftime('%Y-%m', se.occurred_at) as month, COUNT(DISTINCT se.user_id) as users
         FROM search_events se WHERE ${whereClause}
         GROUP BY month ORDER BY month`,
        )
        .bind(...bindings)
        .all();
      return rows.results || [];
    }

    case 'searchesByMonth': {
      const rows = await db
        .prepare(
          `SELECT strftime('%Y-%m', se.occurred_at) as month, se.search_type as searchType, COUNT(*) as searches
         FROM search_events se WHERE ${whereClause}
         GROUP BY month, searchType ORDER BY month`,
        )
        .bind(...bindings)
        .all();
      return rows.results || [];
    }

    case 'uniqueSearchersByRole': {
      const rows = await db
        .prepare(
          `SELECT se.user_role as role, COUNT(DISTINCT se.user_id) as users
         FROM search_events se WHERE ${whereClause}
         GROUP BY role ORDER BY users DESC`,
        )
        .bind(...bindings)
        .all();
      return rows.results || [];
    }

    case 'searchesByRole': {
      const rows = await db
        .prepare(
          `SELECT se.user_role as role, COUNT(*) as searches
         FROM search_events se WHERE ${whereClause}
         GROUP BY role ORDER BY searches DESC`,
        )
        .bind(...bindings)
        .all();
      return rows.results || [];
    }

    case 'distinctMarkets': {
      const { whereClause: dateWhere, bindings: dateBindings } = buildSearchDateConditions(startDate, endDate);
      const rows = await db
        .prepare(
          `SELECT DISTINCT sem.market as market
         FROM search_event_markets sem
         INNER JOIN search_events se ON se.id = sem.event_id
         WHERE ${dateWhere}
         ORDER BY sem.market ASC`,
        )
        .bind(...dateBindings)
        .all();
      return rows.results || [];
    }

    case 'uniqueSearchersByMarket': {
      const rows = await db
        .prepare(
          `SELECT sem.market as market, COUNT(DISTINCT se.user_id) as users
         FROM search_events se
         INNER JOIN search_event_markets sem ON sem.event_id = se.id
         WHERE ${whereClause}
         GROUP BY sem.market ORDER BY users DESC`,
        )
        .bind(...bindings)
        .all();
      return rows.results || [];
    }

    case 'searchesByMarket': {
      const rows = await db
        .prepare(
          `SELECT sem.market as market, COUNT(*) as searches
         FROM search_events se
         INNER JOIN search_event_markets sem ON sem.event_id = se.id
         WHERE ${whereClause}
         GROUP BY sem.market ORDER BY searches DESC`,
        )
        .bind(...bindings)
        .all();
      return rows.results || [];
    }

    case 'searchesByMarketAndType': {
      const rows = await db
        .prepare(
          `SELECT sem.market as market, se.search_type as searchType, COUNT(*) as searches
         FROM search_events se
         INNER JOIN search_event_markets sem ON sem.event_id = se.id
         WHERE ${whereClause}
         GROUP BY sem.market, searchType ORDER BY searches DESC`,
        )
        .bind(...bindings)
        .all();
      return rows.results || [];
    }

    case 'searchDistributionByType': {
      const rows = await db
        .prepare(
          `SELECT se.search_type as searchType, COUNT(*) as searches
         FROM search_events se WHERE ${whereClause}
         GROUP BY searchType ORDER BY searches DESC`,
        )
        .bind(...bindings)
        .all();
      return rows.results || [];
    }

    case 'searchDistributionByResultSize': {
      const buckets = [
        { bucket: '0 results', condition: '(se.result_count = 0 OR se.result_count IS NULL)' },
        { bucket: '1-10 results', condition: 'se.result_count > 0 AND se.result_count <= 10' },
        { bucket: '11-50 results', condition: 'se.result_count > 10 AND se.result_count <= 50' },
        { bucket: '51-100 results', condition: 'se.result_count > 50 AND se.result_count <= 100' },
        { bucket: '101-500 results', condition: 'se.result_count > 100 AND se.result_count <= 500' },
        { bucket: '501-1000 results', condition: 'se.result_count > 500 AND se.result_count <= 1000' },
        { bucket: '1001-10000 results', condition: 'se.result_count > 1000 AND se.result_count <= 10000' },
        { bucket: '10001-100000 results', condition: 'se.result_count > 10000 AND se.result_count <= 100000' },
        { bucket: '100000+ results', condition: 'se.result_count > 100000' },
      ];
      const results = await Promise.all(
        buckets.map(async ({ bucket, condition }) => {
          const row = await db
            .prepare(`SELECT COUNT(*) as searches FROM search_events se WHERE ${whereClause} AND ${condition}`)
            .bind(...bindings)
            .first();
          return { bucket, searches: row?.searches ?? 0 };
        }),
      );
      return results;
    }

    case 'topSearches': {
      const rows = await db
        .prepare(
          `SELECT se.search_term as searchTerm, se.search_type as searchType,
                COUNT(DISTINCT se.user_id) as uniqueSearchers, COUNT(*) as totalSearches
         FROM search_events se WHERE ${whereClause} AND se.search_term != ''
         GROUP BY searchTerm, searchType
         ORDER BY totalSearches DESC LIMIT ${SEARCH_TOP_LIMIT}`,
        )
        .bind(...bindings)
        .all();
      return rows.results || [];
    }

    case 'topZeroResultSearches': {
      const rows = await db
        .prepare(
          `SELECT se.search_term as searchTerm, se.search_type as searchType,
                COUNT(DISTINCT se.user_id) as uniqueSearchers, COUNT(*) as totalSearches
         FROM search_events se WHERE ${whereClause} AND se.search_term != ''
                              AND (se.result_count = 0 OR se.result_count IS NULL)
         GROUP BY searchTerm, searchType
         ORDER BY totalSearches DESC LIMIT ${SEARCH_TOP_LIMIT}`,
        )
        .bind(...bindings)
        .all();
      return rows.results || [];
    }

    default:
      throw new Error(`Unknown search metric type: ${metricType}`);
  }
}

/**
 * Write a search event to the SEARCH_EVENTS D1 table.
 * Called fire-and-forget from analytics-helper.js.
 */
export async function writeSearchEvent(db, data) {
  const markets = Array.isArray(data.assetMarkets)
    ? [...new Set(data.assetMarkets.map((m) => String(m).trim()).filter(Boolean))].slice(0, 20)
    : [];
  const occurredAt = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO search_events (user_id, user_email, user_country, user_role, search_term, search_type, result_count, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      data.userId || '',
      data.userEmail || null,
      data.country || null,
      data.roles?.[0] || null,
      (data.searchTerm || '').substring(0, 200),
      data.searchType || 'all',
      data.resultCount ?? null,
      occurredAt,
    )
    .run();

  if (markets.length === 0) return;

  const row = await db.prepare('SELECT last_insert_rowid() as id').first();
  const eventId = row?.id;
  if (!eventId) {
    console.error('[Search Metrics] Failed to resolve event id after insert — market rows skipped');
    return;
  }

  try {
    await db.batch(
      markets.map((market) =>
        db.prepare('INSERT OR IGNORE INTO search_event_markets (event_id, market) VALUES (?, ?)').bind(eventId, market),
      ),
    );
  } catch (err) {
    console.error('[Search Metrics] Failed to write search_event_markets:', err);
  }
}

export { buildSearchD1Conditions, isValidMarketToken, MARKET_TOKEN_PATTERN };
