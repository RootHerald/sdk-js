import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryCache, LocalStorageCache, SessionStorageCache } from '../src/storage.js';

// ---- MemoryCache ----

describe('MemoryCache', () => {
  it('set and get', async () => {
    const c = new MemoryCache();
    await c.set('k', 'v');
    expect(await c.get('k')).toBe('v');
  });

  it('returns null for missing key', async () => {
    const c = new MemoryCache();
    expect(await c.get('missing')).toBeNull();
  });

  it('delete removes the entry', async () => {
    const c = new MemoryCache();
    await c.set('k', 'v');
    await c.delete('k');
    expect(await c.get('k')).toBeNull();
  });

  it('clear removes all entries', async () => {
    const c = new MemoryCache();
    await c.set('a', '1');
    await c.set('b', '2');
    await c.clear();
    expect(await c.get('a')).toBeNull();
    expect(await c.get('b')).toBeNull();
  });

  it('TTL expiry: entry is gone after TTL elapses', async () => {
    vi.useFakeTimers();
    const c = new MemoryCache();
    await c.set('k', 'v', 1); // 1 second TTL
    expect(await c.get('k')).toBe('v');
    vi.advanceTimersByTime(1001);
    expect(await c.get('k')).toBeNull();
    vi.useRealTimers();
  });

  it('re-setting an entry resets its TTL timer', async () => {
    vi.useFakeTimers();
    const c = new MemoryCache();
    await c.set('k', 'v1', 1);
    vi.advanceTimersByTime(500);
    await c.set('k', 'v2', 2); // reset timer
    vi.advanceTimersByTime(1200); // would have expired under original timer
    expect(await c.get('k')).toBe('v2'); // still alive
    vi.useRealTimers();
  });
});

// ---- LocalStorageCache ----

describe('LocalStorageCache', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('set and get', async () => {
    const c = new LocalStorageCache();
    await c.set('k', 'hello');
    expect(await c.get('k')).toBe('hello');
  });

  it('survives across instances (simulating page reload)', async () => {
    const c1 = new LocalStorageCache();
    await c1.set('k', 'persistent');

    const c2 = new LocalStorageCache();
    expect(await c2.get('k')).toBe('persistent');
  });

  it('delete removes the entry', async () => {
    const c = new LocalStorageCache();
    await c.set('k', 'v');
    await c.delete('k');
    expect(await c.get('k')).toBeNull();
  });

  it('clear removes all entries', async () => {
    const c = new LocalStorageCache();
    await c.set('a', '1');
    await c.set('b', '2');
    await c.clear();
    expect(await c.get('a')).toBeNull();
    expect(await c.get('b')).toBeNull();
  });

  it('TTL expiry: expired entry returns null', async () => {
    const c = new LocalStorageCache();
    // Set TTL of 1 second in the past by manipulating exp directly
    const expiredEntry = JSON.stringify({ value: 'old', exp: Date.now() - 1 });
    localStorage.setItem('expired', expiredEntry);
    expect(await c.get('expired')).toBeNull();
    // Item should have been cleaned up
    expect(localStorage.getItem('expired')).toBeNull();
  });
});

// ---- SessionStorageCache ----

describe('SessionStorageCache', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('set and get', async () => {
    const c = new SessionStorageCache();
    await c.set('k', 'hello');
    expect(await c.get('k')).toBe('hello');
  });

  it('survives across instances within the same session', async () => {
    const c1 = new SessionStorageCache();
    await c1.set('k', 'session-val');

    const c2 = new SessionStorageCache();
    expect(await c2.get('k')).toBe('session-val');
  });

  it('delete removes the entry', async () => {
    const c = new SessionStorageCache();
    await c.set('k', 'v');
    await c.delete('k');
    expect(await c.get('k')).toBeNull();
  });

  it('clear removes all entries', async () => {
    const c = new SessionStorageCache();
    await c.set('a', '1');
    await c.set('b', '2');
    await c.clear();
    expect(await c.get('a')).toBeNull();
    expect(await c.get('b')).toBeNull();
  });

  it('TTL expiry: expired entry returns null', async () => {
    const c = new SessionStorageCache();
    const expiredEntry = JSON.stringify({ value: 'old', exp: Date.now() - 1 });
    sessionStorage.setItem('expired', expiredEntry);
    expect(await c.get('expired')).toBeNull();
  });
});
