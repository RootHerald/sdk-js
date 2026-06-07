/**
 * TokenCache implementations.
 * MemoryCache is the default; LocalStorageCache and SessionStorageCache
 * are opt-in for applications that need cross-tab/session persistence.
 *
 * Security note: Tokens stored in localStorage/sessionStorage are
 * accessible to any JavaScript on the page (XSS risk). Use MemoryCache
 * unless you have a specific reason to persist tokens.
 */

import type { TokenCache } from '@rootherald/contracts';

// ---- MemoryCache ----

interface CacheEntry {
  value: string;
  timer?: ReturnType<typeof setTimeout>;
}

export class MemoryCache implements TokenCache {
  private readonly _store = new Map<string, CacheEntry>();

  async get(key: string): Promise<string | null> {
    return this._store.get(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const existing = this._store.get(key);
    if (existing?.timer !== undefined) {
      clearTimeout(existing.timer);
    }

    const entry: CacheEntry = { value };
    if (ttlSeconds !== undefined && ttlSeconds > 0) {
      entry.timer = setTimeout(() => {
        this._store.delete(key);
      }, ttlSeconds * 1000);
      // Don't block process/tab unload on the timer
      if (typeof entry.timer === 'object' && entry.timer !== null && 'unref' in entry.timer) {
        // Node.js timer — unref so it doesn't keep the process alive in tests
        (entry.timer as { unref(): void }).unref();
      }
    }

    this._store.set(key, entry);
  }

  async delete(key: string): Promise<void> {
    const existing = this._store.get(key);
    if (existing?.timer !== undefined) {
      clearTimeout(existing.timer);
    }
    this._store.delete(key);
  }

  async clear(): Promise<void> {
    for (const entry of this._store.values()) {
      if (entry.timer !== undefined) {
        clearTimeout(entry.timer);
      }
    }
    this._store.clear();
  }
}

// ---- Shared helpers for Web Storage caches ----

interface StoredEntry {
  value: string;
  /** Unix milliseconds at which this entry expires, or undefined for no expiry. */
  exp?: number;
}

function readEntry(storage: Storage, key: string): string | null {
  const raw = storage.getItem(key);
  if (raw === null) return null;

  let entry: StoredEntry;
  try {
    entry = JSON.parse(raw) as StoredEntry;
  } catch {
    // Malformed entry — treat as absent
    storage.removeItem(key);
    return null;
  }

  if (entry.exp !== undefined && Date.now() >= entry.exp) {
    storage.removeItem(key);
    return null;
  }

  return entry.value;
}

function writeEntry(
  storage: Storage,
  key: string,
  value: string,
  ttlSeconds?: number,
): void {
  const entry: StoredEntry = { value };
  if (ttlSeconds !== undefined && ttlSeconds > 0) {
    entry.exp = Date.now() + ttlSeconds * 1000;
  }
  storage.setItem(key, JSON.stringify(entry));
}

// ---- LocalStorageCache ----

export class LocalStorageCache implements TokenCache {
  async get(key: string): Promise<string | null> {
    return readEntry(localStorage, key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    writeEntry(localStorage, key, value, ttlSeconds);
  }

  async delete(key: string): Promise<void> {
    localStorage.removeItem(key);
  }

  async clear(): Promise<void> {
    localStorage.clear();
  }
}

// ---- SessionStorageCache ----

export class SessionStorageCache implements TokenCache {
  async get(key: string): Promise<string | null> {
    return readEntry(sessionStorage, key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    writeEntry(sessionStorage, key, value, ttlSeconds);
  }

  async delete(key: string): Promise<void> {
    sessionStorage.removeItem(key);
  }

  async clear(): Promise<void> {
    sessionStorage.clear();
  }
}

// ---- Factory ----

export function createCache(
  location: 'memory' | 'localStorage' | 'sessionStorage' | 'custom',
  customCache?: TokenCache,
): TokenCache {
  switch (location) {
    case 'memory':
      return new MemoryCache();
    case 'localStorage':
      return new LocalStorageCache();
    case 'sessionStorage':
      return new SessionStorageCache();
    case 'custom':
      if (customCache === undefined) {
        throw new Error(
          'cacheLocation "custom" requires a customCache implementation',
        );
      }
      return customCache;
  }
}
