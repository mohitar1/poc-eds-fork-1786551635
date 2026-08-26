/**
 * Cross-page COA (Content Optimization Agent) State
 * sessionStorage-backed — no BroadcastChannel, single-tab flow only.
 *
 * Navigating from /search to /renditions is a real full-page load (this app
 * has no client-side router), which kills any in-flight fetch started on the
 * page before navigation. So the search bar does NOT call generateRenditions()
 * itself — it only stores the prompt/assets as `coaPendingRequest` and
 * navigates. The renditions page reads `coaPendingRequest` on load and issues
 * the actual generate call itself, so the fetch's lifetime matches the page
 * that will render its result.
 */

const STORAGE_KEY = 'coa-state';

const state = {
  coaIsLoading: false,
  coaResult: null,
  coaError: null,
  coaRequestId: null,
  coaPendingRequest: null,
};

const listeners = new Set();

function readFromStorage() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeToStorage() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // sessionStorage unavailable (e.g. private mode) — silently ignore
  }
}

const stored = readFromStorage();
if (stored) {
  Object.assign(state, stored);
}

export function getCoaState() {
  return state;
}

export function subscribeCoaState(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setCoaState(updates) {
  const prevState = { ...state };
  Object.assign(state, updates);
  writeToStorage();

  listeners.forEach((listener) => {
    try {
      listener(state, prevState, updates);
    } catch (e) {
      console.error('COA state listener error:', e);
    }
  });
}

/**
 * Clears the result/error/loading state AND the request id — this is what
 * makes any still-in-flight `generateRenditions()` resolution for the
 * request being cleared get silently discarded once it lands (see the
 * requestId check in search-bar.js's resolve/reject handler).
 */
export function clearCoaResult() {
  setCoaState({
    coaIsLoading: false,
    coaResult: null,
    coaError: null,
    coaRequestId: null,
    coaPendingRequest: null,
  });
}
