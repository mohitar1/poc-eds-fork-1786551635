/**
 * Content Optimization Agent (COA) API Client
 * Requests AI-generated image renditions via the Worker-proxied COA endpoint.
 */

import makeRequest from './api-client.js';

export const COA_MAX_ASSETS = 20;

export const COA_SCHEMAS = {
  IMAGE: 'https://ns.adobe.com/experience/dx-agent/data-schema/image',
  GENERAL_TEXT: 'https://ns.adobe.com/experience/dx-agent/data-schema/general-text-response',
};

/**
 * @param {string} userPrompt
 * @param {{id: string, name: string}[]} assets
 * @returns {Promise<{parts: Array}>}
 */
export async function generateRenditions(userPrompt, assets) {
  return makeRequest({
    url: '/adobe/coa/generate',
    method: 'POST',
    data: { userPrompt, assets },
  });
}
