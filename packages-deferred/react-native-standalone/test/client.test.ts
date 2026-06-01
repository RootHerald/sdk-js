/**
 * Tests for the JS-side RootHeraldClient wrapper. The native bridge is
 * stubbed via the mock at test/__mocks__/react-native.ts.
 */

import { RootHeraldClient } from '../src/client';
import { RootHeraldError } from '../src/types';
import { __setMockNative, __resetMockNative } from './__mocks__/react-native';

describe('RootHeraldClient', () => {
  afterEach(() => {
    __resetMockNative();
  });

  it('throws when constructed without an apiKey', () => {
    expect(() => new RootHeraldClient({ apiKey: '' })).toThrow(RootHeraldError);
  });

  it('lazily creates a native handle on first verify and reuses it', async () => {
    const create = jest.fn().mockResolvedValue('handle-1');
    const verify = jest.fn().mockResolvedValue({
      verdict: 'allow',
      deviceId: 'dev-1',
      tpmClass: 'tpm20-firmware',
      posture: '{"backing":"tpm"}',
      reason: 'ok',
    });
    __setMockNative({ create, verify });

    const c = new RootHeraldClient({ apiKey: 'pub_test', endpoint: 'https://e.example' });
    expect(c._getHandleForTesting()).toBeNull();

    const r1 = await c.verify('signup');
    expect(r1.verdict).toBe('allow');
    expect(r1.deviceId).toBe('dev-1');
    expect(c._getHandleForTesting()).toBe('handle-1');

    const r2 = await c.verify('login');
    expect(r2.verdict).toBe('allow');

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith('pub_test', 'https://e.example');
    expect(verify).toHaveBeenCalledTimes(2);
    expect(verify).toHaveBeenNthCalledWith(1, 'handle-1', 'signup');
    expect(verify).toHaveBeenNthCalledWith(2, 'handle-1', 'login');
  });

  it('normalizes unknown verdict strings to "deny"', async () => {
    const create = jest.fn().mockResolvedValue('h');
    const verify = jest.fn().mockResolvedValue({
      verdict: 'maybe',
      deviceId: 'd',
      tpmClass: '',
      posture: '{}',
      reason: '',
    });
    __setMockNative({ create, verify });

    const c = new RootHeraldClient({ apiKey: 'k' });
    const r = await c.verify('x');
    expect(r.verdict).toBe('deny');
  });

  it('wraps native bridge errors in RootHeraldError', async () => {
    const create = jest.fn().mockResolvedValue('h');
    const verify = jest.fn().mockRejectedValue({ code: 'E_NETWORK', message: 'offline' });
    __setMockNative({ create, verify });

    const c = new RootHeraldClient({ apiKey: 'k' });
    await expect(c.verify('signup')).rejects.toMatchObject({
      name: 'RootHeraldError',
      code: 'E_NETWORK',
      message: 'offline',
    });
  });

  it('rejects an aborted verify before calling native', async () => {
    const create = jest.fn().mockResolvedValue('h');
    const verify = jest.fn();
    __setMockNative({ create, verify });

    const c = new RootHeraldClient({ apiKey: 'k' });
    // Force handle creation first so signal abort short-circuits before verify.
    const ac = new AbortController();
    ac.abort();
    await expect(c.verify('signup', { signal: ac.signal })).rejects.toMatchObject({
      code: 'E_ABORTED',
    });
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects when abort fires mid-flight', async () => {
    const create = jest.fn().mockResolvedValue('h');
    let resolveVerify: ((v: unknown) => void) | undefined;
    const verify = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveVerify = resolve;
        }),
    );
    __setMockNative({ create, verify });

    const c = new RootHeraldClient({ apiKey: 'k' });
    const ac = new AbortController();
    const p = c.verify('signup', { signal: ac.signal });
    // Allow ensureHandle() to settle so verify is in flight.
    await Promise.resolve();
    await Promise.resolve();
    ac.abort();
    await expect(p).rejects.toMatchObject({ code: 'E_ABORTED' });

    // Cleanup the dangling native promise so the test doesn't hold a timer.
    resolveVerify?.({
      verdict: 'allow',
      deviceId: '',
      tpmClass: '',
      posture: '{}',
      reason: 'ok',
    });
  });

  it('throws when called without a native module bound', async () => {
    __resetMockNative();
    const c = new RootHeraldClient({ apiKey: 'k' });
    await expect(c.verify('signup')).rejects.toThrow(/doesn't seem to be linked/);
  });

  it('rejects empty action', async () => {
    __setMockNative({ create: jest.fn().mockResolvedValue('h'), verify: jest.fn() });
    const c = new RootHeraldClient({ apiKey: 'k' });
    await expect(c.verify('')).rejects.toMatchObject({ code: 'E_INVALID_ACTION' });
  });
});
