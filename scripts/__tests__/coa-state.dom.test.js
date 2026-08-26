import {
  beforeEach, describe, expect, it, vi,
} from 'vitest';

describe('coa-state.js', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.resetModules();
  });

  it('starts with an empty state when sessionStorage is empty', async () => {
    const { getCoaState } = await import('../coa-state.js');
    expect(getCoaState()).toEqual({
      coaIsLoading: false,
      coaResult: null,
      coaError: null,
      coaRequestId: null,
      coaPendingRequest: null,
    });
  });

  it('persists updates to sessionStorage and rehydrates on reimport', async () => {
    const { setCoaState } = await import('../coa-state.js');
    setCoaState({ coaIsLoading: true, coaRequestId: 'req-1' });

    vi.resetModules();
    const { getCoaState: getCoaStateAgain } = await import('../coa-state.js');
    expect(getCoaStateAgain().coaIsLoading).toBe(true);
    expect(getCoaStateAgain().coaRequestId).toBe('req-1');
  });

  it('notifies subscribers on setCoaState', async () => {
    const { setCoaState, subscribeCoaState } = await import('../coa-state.js');
    const listener = vi.fn();
    subscribeCoaState(listener);

    setCoaState({ coaIsLoading: true });

    expect(listener).toHaveBeenCalledTimes(1);
    const [currentState, prevState, updates] = listener.mock.calls[0];
    expect(currentState.coaIsLoading).toBe(true);
    expect(prevState.coaIsLoading).toBe(false);
    expect(updates).toEqual({ coaIsLoading: true });
  });

  it('unsubscribe stops further notifications', async () => {
    const { setCoaState, subscribeCoaState } = await import('../coa-state.js');
    const listener = vi.fn();
    const unsubscribe = subscribeCoaState(listener);
    unsubscribe();

    setCoaState({ coaIsLoading: true });

    expect(listener).not.toHaveBeenCalled();
  });

  describe('staleness guard (via coaRequestId)', () => {
    it('clearCoaResult nulls coaRequestId so a late-resolving request can detect staleness', async () => {
      const { setCoaState, getCoaState, clearCoaResult } = await import('../coa-state.js');

      setCoaState({ coaIsLoading: true, coaRequestId: 'req-1' });
      // Simulate the request being cleared (e.g. dismissing the error dialog)
      // before the original fetch for req-1 resolves.
      clearCoaResult();

      expect(getCoaState().coaRequestId).toBeNull();

      // The late resolution handler in search-bar.js checks
      // getCoaState().coaRequestId !== requestId before applying its result.
      const requestIdAtDispatchTime = 'req-1';
      const isStale = getCoaState().coaRequestId !== requestIdAtDispatchTime;
      expect(isStale).toBe(true);
    });

    it('a newer request overwrites coaRequestId, marking the older in-flight request stale', async () => {
      const { setCoaState, getCoaState } = await import('../coa-state.js');

      setCoaState({ coaIsLoading: true, coaRequestId: 'req-1' });
      const requestIdAtDispatchTime = 'req-1';

      // A second generate request is fired before the first resolves.
      setCoaState({ coaIsLoading: true, coaRequestId: 'req-2' });

      const isStale = getCoaState().coaRequestId !== requestIdAtDispatchTime;
      expect(isStale).toBe(true);
      expect(getCoaState().coaRequestId).toBe('req-2');
    });

    it('the current request is not considered stale when it resolves', async () => {
      const { setCoaState, getCoaState } = await import('../coa-state.js');

      setCoaState({ coaIsLoading: true, coaRequestId: 'req-1' });
      const requestIdAtDispatchTime = 'req-1';

      const isStale = getCoaState().coaRequestId !== requestIdAtDispatchTime;
      expect(isStale).toBe(false);
    });
  });

  it('clearCoaResult resets loading/result/error/requestId together', async () => {
    const { setCoaState, getCoaState, clearCoaResult } = await import('../coa-state.js');

    setCoaState({
      coaIsLoading: false,
      coaResult: { parts: [] },
      coaError: 'some error',
      coaRequestId: 'req-1',
    });

    clearCoaResult();

    expect(getCoaState()).toEqual({
      coaIsLoading: false,
      coaResult: null,
      coaError: null,
      coaRequestId: null,
      coaPendingRequest: null,
    });
  });
});
