/**
 * End-to-end client flow test with a fully mocked backend.
 *
 * Stubs:
 *   - fetch (discovery doc, JWKS, token exchange)
 *   - window.location.assign (navigation)
 *   - window.location.href / search (callback URL)
 */

import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import { createLocalJWKSet } from 'jose';
import { getFixtures, type TestFixtures } from './fixtures/jwks.js';
import { RootHeraldSdkClient } from '../src/client.js';
import { resolveConfig } from '../src/config.js';
import { MemoryCache } from '../src/storage.js';
import { _clearJwksCache } from '../src/tokens.js';
import { RootHeraldError } from '@rootherald/contracts';

const ISSUER = 'http://localhost:5000';
const CLIENT_ID = 'test-client';
const REDIRECT_URI = 'http://localhost:3000/callback';

let fixtures: TestFixtures;

beforeAll(async () => {
  fixtures = await getFixtures();
});

afterEach(() => {
  vi.restoreAllMocks();
  _clearJwksCache();
});

function makeClient(cache = new MemoryCache(), clientSecret?: string): RootHeraldSdkClient {
  const config = resolveConfig({
    issuer: ISSUER,
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    cacheLocation: 'custom',
    customCache: cache,
    clientSecret,
  });

  // Inject hardcoded endpoints — skip discovery in unit tests
  const endpoints = {
    authorization_endpoint: `${ISSUER}/api/v1/oauth/authorize`,
    token_endpoint: `${ISSUER}/api/v1/token`,
    jwks_uri: `${ISSUER}/api/v1/.well-known/jwks.json`,
    issuer: ISSUER,
  };

  const client = new RootHeraldSdkClient(config, endpoints);
  // Inject local JWKS resolver to avoid real HTTP calls in tests.
  // Set lazily — fixtures need to be loaded first (via beforeAll).
  Object.defineProperty(client, '_jwksResolver', {
    get: () => fixtures ? createLocalJWKSet(fixtures.publicJwks) : undefined,
    configurable: true,
  });
  return client;
}

describe('loginWithRedirect', () => {
  it('redirects to the authorization endpoint with PKCE params', async () => {
    const assignSpy = vi.fn();
    vi.stubGlobal('window', { location: { assign: assignSpy, href: 'http://localhost:3000/' } });

    const client = makeClient();
    await client.loginWithRedirect();

    expect(assignSpy).toHaveBeenCalledOnce();
    const url = new URL(assignSpy.mock.calls[0][0] as string);

    expect(url.origin + url.pathname).toBe(`${ISSUER}/api/v1/oauth/authorize`);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('passes prompt param when provided', async () => {
    const assignSpy = vi.fn();
    vi.stubGlobal('window', { location: { assign: assignSpy, href: 'http://localhost:3000/' } });

    const client = makeClient();
    await client.loginWithRedirect({ prompt: 'login' });

    const url = new URL(assignSpy.mock.calls[0][0] as string);
    expect(url.searchParams.get('prompt')).toBe('login');
  });

  it('appends acr_values to URL when acrValues provided (non-essential)', async () => {
    const assignSpy = vi.fn();
    vi.stubGlobal('window', { location: { assign: assignSpy, href: 'http://localhost:3000/' } });

    const client = makeClient();
    await client.loginWithRedirect({
      acrValues: ['urn:rootherald:user:phr', 'urn:rootherald:user:2fa'],
    });

    const url = new URL(assignSpy.mock.calls[0][0] as string);
    expect(url.searchParams.get('acr_values')).toBe(
      'urn:rootherald:user:phr urn:rootherald:user:2fa',
    );
    expect(url.searchParams.has('claims')).toBe(false);
  });

  it('uses claims param when essential=true', async () => {
    const assignSpy = vi.fn();
    vi.stubGlobal('window', { location: { assign: assignSpy, href: 'http://localhost:3000/' } });

    const client = makeClient();
    await client.loginWithRedirect({
      acrValues: ['urn:rootherald:user:phrh'],
      essential: true,
    });

    const url = new URL(assignSpy.mock.calls[0][0] as string);
    expect(url.searchParams.has('acr_values')).toBe(false);
    const claimsRaw = url.searchParams.get('claims');
    expect(claimsRaw).toBeTruthy();
    const claims = JSON.parse(claimsRaw!);
    expect(claims.id_token.acr.essential).toBe(true);
    expect(claims.id_token.acr.values).toContain('urn:rootherald:user:phrh');
  });

  it('appends max_age when maxAge provided', async () => {
    const assignSpy = vi.fn();
    vi.stubGlobal('window', { location: { assign: assignSpy, href: 'http://localhost:3000/' } });

    const client = makeClient();
    await client.loginWithRedirect({ maxAge: 3600 });

    const url = new URL(assignSpy.mock.calls[0][0] as string);
    expect(url.searchParams.get('max_age')).toBe('3600');
  });
});

describe('handleRedirectCallback', () => {
  it('full flow: exchanges code → verifies JWT → returns verdict', async () => {
    const cache = new MemoryCache();
    const client = makeClient(cache);

    // Pre-populate PKCE state in cache
    const state = 'test-state-value';
    const verifier = 'test-verifier-value-padded-to-43-chars-minimum!!';
    await cache.set('rootherald:pkce:state', state);
    await cache.set('rootherald:pkce:verifier', verifier);

    // Sign a real JWT
    const token = await fixtures.signToken({
      iss: ISSUER,
      aud: CLIENT_ID,
      sub: 'user-uuid-1',
    });

    const tokenBody = JSON.stringify({ access_token: token, token_type: 'Bearer', expires_in: 300 });

    // Stub fetch — only the token endpoint is needed; JWKS is resolved via
    // the injected createLocalJWKSet resolver (avoiding real HTTP to jose's remote JWKS).
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/token')) {
          return Promise.resolve(
            new Response(tokenBody, { status: 200, headers: { 'Content-Type': 'application/json' } }),
          );
        }
        return Promise.reject(new Error(`Unexpected fetch: ${urlStr}`));
      }),
    );

    const callbackUrl = `${REDIRECT_URI}?code=auth-code-123&state=${state}`;
    const verdict = await client.handleRedirectCallback(callbackUrl);

    // New composite shape
    expect(verdict.acr).toBe('urn:rootherald:user:phrh');
    expect(verdict.amr).toContain('pwd');
    expect(verdict.device.ueid).toBe('device-uuid-1234');
    expect(verdict.device.earStatus).toBe('affirming');
    expect(verdict.userId).toBe('user-uuid-1');
    // Legacy mirrors
    expect(verdict.verdict).toBe('pass');
    expect(verdict.assuranceLevel).toBe('high');
    expect(verdict.deviceId).toBe('device-uuid-1234');

    // PKCE keys cleared
    expect(await cache.get('rootherald:pkce:state')).toBeNull();
    expect(await cache.get('rootherald:pkce:verifier')).toBeNull();

    // Verdict cached
    expect(await cache.get('rootherald:verdict')).not.toBeNull();
    expect(await cache.get('rootherald:token')).toBe(token);
  });

  it('throws STATE_MISMATCH when state does not match', async () => {
    const cache = new MemoryCache();
    const client = makeClient(cache);

    await cache.set('rootherald:pkce:state', 'correct-state');
    await cache.set('rootherald:pkce:verifier', 'verifier');

    const callbackUrl = `${REDIRECT_URI}?code=code&state=wrong-state`;

    await expect(client.handleRedirectCallback(callbackUrl)).rejects.toMatchObject({
      code: 'STATE_MISMATCH',
    });
  });

  it('throws OAUTH_ERROR when OAuth error param is present', async () => {
    const client = makeClient();

    const callbackUrl = `${REDIRECT_URI}?error=access_denied&error_description=User+denied`;

    await expect(client.handleRedirectCallback(callbackUrl)).rejects.toMatchObject({
      code: 'OAUTH_ERROR',
    });
  });

  it('includes client_secret in token exchange POST body when set', async () => {
    const SECRET = 'my-test-secret';
    const cache = new MemoryCache();
    const client = makeClient(cache, SECRET);

    const state = 'test-state-secret';
    const verifier = 'test-verifier-value-padded-to-43-chars-minimum!!';
    await cache.set('rootherald:pkce:state', state);
    await cache.set('rootherald:pkce:verifier', verifier);

    const token = await fixtures.signToken({
      iss: ISSUER,
      aud: CLIENT_ID,
      sub: 'user-uuid-secret',
    });

    let capturedBody = '';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string | URL, init?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes('/token')) {
          capturedBody = init?.body?.toString() ?? '';
          const tokenBody = JSON.stringify({ access_token: token, token_type: 'Bearer', expires_in: 300 });
          return Promise.resolve(
            new Response(tokenBody, { status: 200, headers: { 'Content-Type': 'application/json' } }),
          );
        }
        return Promise.reject(new Error(`Unexpected fetch: ${urlStr}`));
      }),
    );

    const callbackUrl = `${REDIRECT_URI}?code=auth-code-secret&state=${state}`;
    await client.handleRedirectCallback(callbackUrl);

    const params = new URLSearchParams(capturedBody);
    expect(params.get('client_secret')).toBe(SECRET);
  });
});

describe('getVerdict', () => {
  it('returns null when no verdict in cache', async () => {
    const client = makeClient();
    expect(await client.getVerdict()).toBeNull();
  });

  it('returns null for an expired verdict', async () => {
    const cache = new MemoryCache();
    const client = makeClient(cache);

    const expiredVerdict = {
      acr: 'urn:rootherald:user:phrh',
      amr: ['pwd'],
      authTime: new Date(Date.now() - 600_000).toISOString(),
      verdict: 'pass',
      assuranceLevel: 'high',
      attestationType: 'tpm20',
      deviceId: 'dev-1',
      userId: 'user-1',
      expiresAt: new Date(Date.now() - 1).toISOString(), // expired
      requestedAcrValues: [],
      device: {
        ueid: 'dev-1',
        earStatus: 'affirming',
        verdict: 'pass',
        attestationType: 'tpm20',
        attestedAt: new Date(Date.now() - 600_000).toISOString(),
      },
      raw: {},
    };
    await cache.set('rootherald:verdict', JSON.stringify(expiredVerdict));

    expect(await client.getVerdict()).toBeNull();
  });
});

describe('getToken', () => {
  it('returns null when no token cached', async () => {
    const client = makeClient();
    expect(await client.getToken()).toBeNull();
  });
});

describe('isVerified', () => {
  it('returns false when no verdict', async () => {
    const client = makeClient();
    expect(await client.isVerified()).toBe(false);
  });

  it('throws InsufficientAssuranceError when level is below minLevel (legacy)', async () => {
    const cache = new MemoryCache();
    const client = makeClient(cache);

    const futureExpiry = new Date(Date.now() + 300_000);
    const verdict = {
      acr: 'urn:rootherald:user:1fa',
      amr: ['pwd'],
      authTime: new Date().toISOString(),
      verdict: 'pass',
      assuranceLevel: 'reduced',
      attestationType: 'tpm20',
      deviceId: 'dev-1',
      userId: 'user-1',
      expiresAt: futureExpiry.toISOString(),
      requestedAcrValues: [],
      device: {
        ueid: 'dev-1',
        earStatus: 'warning',
        verdict: 'pass',
        attestationType: 'tpm20',
        attestedAt: new Date().toISOString(),
      },
      raw: {},
    };
    await cache.set('rootherald:verdict', JSON.stringify(verdict));

    // minLevel still throws InsufficientAssuranceError for back-compat
    await expect(client.isVerified({ minLevel: 'high' })).rejects.toMatchObject({
      code: 'INSUFFICIENT_ASSURANCE',
    });
  });

  it('throws InsufficientAcrError when acr is below minAcr', async () => {
    const cache = new MemoryCache();
    const client = makeClient(cache);

    const futureExpiry = new Date(Date.now() + 300_000);
    const verdict = {
      acr: 'urn:rootherald:user:1fa',
      amr: ['pwd'],
      authTime: new Date().toISOString(),
      verdict: 'pass',
      assuranceLevel: 'reduced',
      attestationType: 'tpm20',
      deviceId: 'dev-1',
      userId: 'user-1',
      expiresAt: futureExpiry.toISOString(),
      requestedAcrValues: [],
      device: {
        ueid: 'dev-1',
        earStatus: 'warning',
        verdict: 'pass',
        attestationType: 'tpm20',
        attestedAt: new Date().toISOString(),
      },
      raw: {},
    };
    await cache.set('rootherald:verdict', JSON.stringify(verdict));

    await expect(
      client.isVerified({ minAcr: 'urn:rootherald:user:phrh' }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_ACR' });
  });

  it('throws AuthenticationTooOldError when authTime exceeds maxAgeSeconds', async () => {
    const cache = new MemoryCache();
    const client = makeClient(cache);

    const verdict = {
      acr: 'urn:rootherald:user:phrh',
      amr: ['pwd', 'hwk'],
      authTime: new Date(Date.now() - 600_000).toISOString(), // 10 min ago
      verdict: 'pass',
      assuranceLevel: 'high',
      attestationType: 'tpm20',
      deviceId: 'dev-1',
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      requestedAcrValues: [],
      device: {
        ueid: 'dev-1',
        earStatus: 'affirming',
        verdict: 'pass',
        attestationType: 'tpm20',
        attestedAt: new Date(Date.now() - 600_000).toISOString(),
      },
      raw: {},
    };
    await cache.set('rootherald:verdict', JSON.stringify(verdict));

    await expect(client.isVerified({ maxAgeSeconds: 60 })).rejects.toMatchObject({
      code: 'AUTH_TOO_OLD',
    });
  });
});

describe('logout', () => {
  it('clears the cache', async () => {
    const cache = new MemoryCache();
    const client = makeClient(cache);

    await cache.set('rootherald:verdict', '{}');
    await cache.set('rootherald:token', 'some.jwt');

    vi.stubGlobal('window', { location: { assign: vi.fn() } });
    await client.logout();

    expect(await cache.get('rootherald:verdict')).toBeNull();
    expect(await cache.get('rootherald:token')).toBeNull();
  });

  it('redirects to returnTo when provided', async () => {
    const assignSpy = vi.fn();
    vi.stubGlobal('window', { location: { assign: assignSpy } });

    const client = makeClient();
    await client.logout({ returnTo: 'https://example.com/' });

    expect(assignSpy).toHaveBeenCalledWith('https://example.com/');
  });

  it('does not call location.assign without returnTo', async () => {
    const assignSpy = vi.fn();
    vi.stubGlobal('window', { location: { assign: assignSpy } });

    const client = makeClient();
    await client.logout();

    expect(assignSpy).not.toHaveBeenCalled();
  });
});

describe('createClient factory', () => {
  it('initializes and discovers endpoints', async () => {
    const discoveryDoc = {
      authorization_endpoint: `${ISSUER}/api/v1/oauth/authorize`,
      token_endpoint: `${ISSUER}/api/v1/token`,
      jwks_uri: `${ISSUER}/api/v1/.well-known/jwks.json`,
      issuer: ISSUER,
    };

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify(discoveryDoc), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const { createClient } = await import('../src/client.js');
    const client = await createClient({
      issuer: ISSUER,
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
    });

    expect(client).toBeInstanceOf(RootHeraldSdkClient);
  });
});
