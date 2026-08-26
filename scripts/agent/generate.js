/**
 * Metadata generation (plan §2.7) — the AI value-add.
 *
 * The generator is a pluggable function `({ assetId, repoName, hints, renditionBytes })
 * => rawFields`. Two are provided:
 *   - createDryRunGenerator(): deterministic, network-free; used for --dry-run and tests.
 *   - createVisionGenerator({ invokeModel }): wraps a caller-supplied vision/LLM call.
 *
 * A real vision model requires operator credentials at run time and cannot be exercised
 * from this environment, so `invokeModel` is injected rather than hard-wired.
 */

function humanizeName(repoName) {
  if (!repoName || typeof repoName !== 'string') return 'Asset';
  const base = repoName.replace(/\.[a-z0-9]+$/i, '');
  const words = base.split(/[-_\s]+/).filter(Boolean);
  if (words.length === 0) return 'Asset';
  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function tokensFromName(repoName) {
  if (!repoName || typeof repoName !== 'string') return [];
  const base = repoName.replace(/\.[a-z0-9]+$/i, '');
  return base.split(/[-_\s]+/).map((t) => t.toLowerCase()).filter((t) => t.length > 2);
}

/**
 * Deterministic, offline generator. Produces a stable preview from the asset's file name
 * and any keyword hints — enough to review the enrichment shape before a live run.
 */
export function createDryRunGenerator() {
  return async function dryRunGenerate({ repoName, hints = {} }) {
    const title = humanizeName(repoName);
    const nameTokens = tokensFromName(repoName);
    const hintKeywords = Array.isArray(hints.machineKeywords) ? hints.machineKeywords : [];
    const keywords = [...nameTokens, ...hintKeywords].map((k) => String(k).toLowerCase());
    return {
      title,
      description: `${title} — auto-generated preview description for demo enrichment.`,
      keywords,
      productCategory: nameTokens.find((t) => t) || null,
      campaign: null,
      channel: null,
    };
  };
}

/**
 * Wrap a caller-supplied model invocation. `invokeModel(input) => rawFields|JSON string`.
 * The controller passes rendition bytes + grounding hints; this normalizes the return
 * into a plain object (parsing/repairing a JSON string if the model returns text).
 */
export function createVisionGenerator({ invokeModel }) {
  if (typeof invokeModel !== 'function') {
    throw new Error('createVisionGenerator: an invokeModel(input) function is required');
  }
  return async function visionGenerate(input) {
    const result = await invokeModel(input);
    if (result && typeof result === 'object') return result;
    if (typeof result === 'string') {
      try {
        return JSON.parse(result);
      } catch {
        // Try to salvage a JSON object embedded in a larger text response.
        const match = result.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]);
        throw new Error('vision model returned unparseable output');
      }
    }
    throw new Error('vision model returned no usable output');
  };
}
