import config from '../config.js';

/**
 * Process array fields in an object by splitting comma-separated strings
 * @param {Object} obj - The object to process
 * @param {string[]} arrays - Array field names to process
 */
export function handleArrays(obj, arrays) {
  arrays?.forEach((array) => {
    if (obj[array]) {
      obj[array] = obj[array].split(',').map((item) => item.trim());
    } else {
      obj[array] = [];
    }
  });
}

/**
 * Convert array of rows to a map keyed by a specific field
 * @param {Object[]} rows - Array of row objects
 * @param {Object} options - Conversion options
 * @param {string} options.key - Field name to use as map key
 * @param {string} [options.value] - If provided, use this field as the value instead of the whole row
 * @param {string[]} [options.arrays] - Array fields to process
 * @returns {Object} Map of key -> row/value
 */
export function convertToMap(rows, options) {
  rows = rows || [];
  return rows.reduce((map, row) => {
    const key = row[options.key];
    if (options.value) {
      map[key] = row[options.value];
    } else {
      map[key] = { ...row };
      handleArrays(map[key], options.arrays);
    }
    return map;
  }, {});
}

/**
 * Process array fields in each row
 * @param {Object[]} rows - Array of row objects
 * @param {Object} options - Conversion options
 * @param {string[]} [options.arrays] - Array fields to process
 * @returns {Object[]} Processed rows
 */
export function convertRows(rows, options) {
  rows = rows || [];
  rows.forEach((row) => {
    handleArrays(row, options.arrays);
  });
  return rows;
}

/**
 * Fetch a JSON sheet from the Helix (EDS) origin.
 * @param {Request|null} request - Cloudflare request object (null in scheduled/cron context)
 * @param {Object} env - Cloudflare environment bindings
 * @param {string} path - Sheet path (e.g. '/config/access/application')
 * @param {Object} [options] - Fetch options
 * @returns {Promise<Object>} Parsed sheet data
 */
export async function fetchHelixSheet(request, env, path, options) {
  const helixOrigin = request?.helixOrigin || env.HELIX_ORIGIN;
  let url = `${helixOrigin}${path}`;
  if (!url.endsWith('.json')) {
    url += '.json';
  }
  if (options?.params) {
    url += `?${new URLSearchParams(options.params).toString()}`;
  }

  const headers = {
    'accept-encoding': 'br, gzip',
  };

  if (env.HELIX_ORIGIN_AUTHENTICATION) {
    headers.authorization = `token ${await env.HELIX_ORIGIN_AUTHENTICATION.get()}`;
  }

  const pushInvalidation = config.HELIX_PUSH_INVALIDATION !== 'disabled';
  if (pushInvalidation) {
    headers['x-push-invalidation'] = 'enabled';
  }

  const fetchOptions = {
    headers,
  };

  if (pushInvalidation) {
    fetchOptions.cf = {
      // cf doesn't cache html by default: need to override the default behavior
      cacheEverything: true,
    };
  } else {
    // disable caching if no push invalidation is happening
    // e.g. when using workers.dev directly without a domain/zone
    fetchOptions.cache = 'no-store';
  }

  // console.log('>>>', 'GET', url, headers);

  const response = await fetch(url, fetchOptions);

  // console.log('<<<', response.status, 'GET', url, Object.fromEntries(response.headers.entries()));

  if (!response.ok) {
    console.error('Failed to fetch spreadsheet:', response.status, response.statusText);
    return;
  }

  const json = await response.json();

  // convert to simpler objects
  if (options?.mergeSheets) {
    const opts = options.mergeSheets;
    const names = json[':names'];
    const sheets = names ? names.map((n) => json[n]?.data).filter(Boolean) : [json.data].filter(Boolean);

    if (opts.key) {
      const merged = {};
      sheets.forEach((data) => {
        const map = convertToMap(data, opts);
        Object.entries(map).forEach(([k, v]) => {
          if (merged[k]) {
            merged[k] = opts.merge(merged[k], v);
          } else {
            merged[k] = v;
          }
        });
      });
      return merged;
    }
    return sheets.reduce((all, data) => all.concat(convertRows(data, opts)), []);
  } else if (options?.sheets) {
    return Object.fromEntries(
      Object.entries(options.sheets).map(([name, opt]) => {
        const sheet = json[name];
        if (sheet) {
          if (opt?.key) {
            return [name, convertToMap(sheet.data, opt)];
          } else {
            return [name, convertRows(sheet.data, opt)];
          }
        } else {
          return [name, []];
        }
      }),
    );
  } else if (options?.sheet) {
    if (options.sheet.key) {
      return convertToMap(json.data, options.sheet);
    } else {
      return convertRows(json.data, options.sheet);
    }
  }

  // without options return the raw json
  return json;
}
