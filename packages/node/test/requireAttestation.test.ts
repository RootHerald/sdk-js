import { describe, it, expect, beforeAll, vi } from 'vitest';
import { createLocalJWKSet } from 'jose';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getFixtures, type TestFixtures } from './fixtures/jwks.js';
import { requireAttestation } from '../src/requireAttestation.js';
import { acrRank, acrMeets } from '../src/acrRank.js';
import {
  RootHeraldError,
  InsufficientAssuranceError,
  StaleAttestationError,
  InsufficientAcrError,
  AuthenticationTooOldError,
} from '@rootherald/contracts';

let fixtures: TestFixtures;

beforeAll(async () => {
  fixtures = await getFixtures();
});

// ---- Minimal fake request / response helpers ----

function makeFakeReq(authHeader?: string): IncomingMessage {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
    method: 'GET',
  } as unknown as IncomingMessage;
}

interface FakeRes {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
  ended: boolean;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

function makeFakeRes(): ServerResponse & FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    body: '',
    headers: {},
    ended: false,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(body?: string) {
      this.ended = true;
      if (body) this.body = body;
    },
  };
  return res as unknown as ServerResponse & FakeRes;
}

// ---- acrRank / acrMeets unit tests ----

describe('acrRank', () => {
  it('returns correct rank for each URN in order', () => {
    expect(acrRank('urn:rootherald:device:any')).toBe(0);
    expect(acrRank('urn:rootherald:device:high')).toBe(1);
    expect(acrRank('urn:rootherald:user:1fa')).toBe(2);
    expect(acrRank('urn:rootherald:user:2fa')).toBe(3);
    expect(acrRank('urn:rootherald:user:phr')).toBe(4);
    expect(acrRank('urn:rootherald:user:phrh')).toBe(5);
    expect(acrRank('urn:rootherald:user:phrh:fresh')).toBe(6);
  });

  it('returns -1 for an unknown URN', () => {
    expect(acrRank('urn:unknown:value')).toBe(-1);
    expect(acrRank('')).toBe(-1);
  });
});

describe('acrMeets', () => {
  it('returns true when session ACR rank >= required rank', () => {
    expect(acrMeets('urn:rootherald:user:phr', ['urn:rootherald:user:phr'])).toBe(true);
    expect(acrMeets('urn:rootherald:user:phrh', ['urn:rootherald:user:phr'])).toBe(true);
    expect(acrMeets('urn:rootherald:user:phrh:fresh', ['urn:rootherald:user:phr'])).toBe(true);
  });

  it('returns false when session ACR rank < required rank', () => {
    expect(acrMeets('urn:rootherald:user:1fa', ['urn:rootherald:user:phr'])).toBe(false);
    expect(acrMeets('urn:rootherald:device:any', ['urn:rootherald:user:2fa'])).toBe(false);
  });

  it('returns false for unknown session ACR', () => {
    expect(acrMeets('urn:unknown', ['urn:rootherald:user:phr'])).toBe(false);
  });

  it('uses the lowest-ranked required URN when multiple are given', () => {
    // session=2fa, required=[phr, 2fa] → min required rank is 2fa(3), session is 2fa(3) → true
    expect(
      acrMeets('urn:rootherald:user:2fa', [
        'urn:rootherald:user:phr',
        'urn:rootherald:user:2fa',
      ]),
    ).toBe(true);
  });
});

// ---- requireAttestation middleware tests ----

describe('requireAttestation middleware', () => {
  it('happy path: valid Bearer token, sets req.attestation and calls next()', async () => {
    const token = await fixtures.signToken({
      iss: 'https://rootherald.example.com',
      aud: 'my-client',
      sub: 'user-1',
    });

    const req = makeFakeReq(`Bearer ${token}`);
    const res = makeFakeRes();
    const next = vi.fn();

    const middleware = requireAttestation({
      issuer: 'https://rootherald.example.com',
      audience: 'my-client',
      _jwks: createLocalJWKSet(fixtures.publicJwks),
    });

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith(); // no error arg
    expect((req as Record<string, unknown>)['attestation']).toBeDefined();
    expect(res.ended).toBe(false); // response not written on success
  });

  it('no token: responds 401 and calls next(err)', async () => {
    const req = makeFakeReq(); // no Authorization header
    const res = makeFakeRes();
    const next = vi.fn();

    const middleware = requireAttestation({
      issuer: 'https://rootherald.example.com',
      _jwks: createLocalJWKSet(fixtures.publicJwks),
    });

    await middleware(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.ended).toBe(true);
    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]![0]).toBeInstanceOf(RootHeraldError);
    expect((next.mock.calls[0]![0] as RootHeraldError).code).toBe('UNAUTHENTICATED');
  });

  it('invalid token: responds 401 and calls next(err)', async () => {
    const req = makeFakeReq('Bearer totally.invalid.jwt');
    const res = makeFakeRes();
    const next = vi.fn();

    const middleware = requireAttestation({
      issuer: 'https://rootherald.example.com',
      audience: 'my-client',
      _jwks: createLocalJWKSet(fixtures.publicJwks),
    });

    await middleware(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.ended).toBe(true);
    expect(next).toHaveBeenCalledOnce();
    const err = next.mock.calls[0]![0] as RootHeraldError;
    expect(err).toBeInstanceOf(RootHeraldError);
  });

  it('valid token but below minLevel: responds 403 with InsufficientAssuranceError (legacy)', async () => {
    const token = await fixtures.signToken({
      iss: 'https://rootherald.example.com',
      aud: 'my-client',
      sub: 'user-1',
      assurance_level: 'reduced', // below "high"
    });

    const req = makeFakeReq(`Bearer ${token}`);
    const res = makeFakeRes();
    const next = vi.fn();

    const middleware = requireAttestation({
      issuer: 'https://rootherald.example.com',
      audience: 'my-client',
      minLevel: 'high',
      _jwks: createLocalJWKSet(fixtures.publicJwks),
    });

    await middleware(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.ended).toBe(true);
    expect(next.mock.calls[0]![0]).toBeInstanceOf(InsufficientAssuranceError);
  });

  it('calls onError hook when token verification fails', async () => {
    const req = makeFakeReq('Bearer bad.token.here');
    const res = makeFakeRes();
    const next = vi.fn();
    const onError = vi.fn();

    const middleware = requireAttestation({
      issuer: 'https://rootherald.example.com',
      _jwks: createLocalJWKSet(fixtures.publicJwks),
      onError,
    });

    await middleware(req, res, next);

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(Error);
  });

  // ---- ACR enforcement tests ----

  it('insufficient ACR: responds 401 with RFC 9470 WWW-Authenticate step-up challenge', async () => {
    const token = await fixtures.signToken({
      iss: 'https://rootherald.example.com',
      aud: 'my-client',
      sub: 'user-1',
      acr: 'urn:rootherald:user:1fa', // below required phr
    });

    const req = makeFakeReq(`Bearer ${token}`);
    const res = makeFakeRes();
    const next = vi.fn();

    const middleware = requireAttestation({
      issuer: 'https://rootherald.example.com',
      audience: 'my-client',
      acrValues: ['urn:rootherald:user:phr'],
      _jwks: createLocalJWKSet(fixtures.publicJwks),
    });

    await middleware(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.ended).toBe(true);
    const wwwAuth = res.headers['WWW-Authenticate'];
    expect(wwwAuth).toBeDefined();
    expect(wwwAuth).toContain('insufficient_user_authentication');
    expect(wwwAuth).toContain('acr_values="urn:rootherald:user:phr"');

    const body = JSON.parse(res.body);
    expect(body.error).toBe('insufficient_user_authentication');
    expect(body.acr_values).toEqual(['urn:rootherald:user:phr']);

    const err = next.mock.calls[0]![0];
    expect(err).toBeInstanceOf(InsufficientAcrError);
  });

  it('sufficient ACR (exact match): passes through', async () => {
    const token = await fixtures.signToken({
      iss: 'https://rootherald.example.com',
      aud: 'my-client',
      sub: 'user-1',
      acr: 'urn:rootherald:user:phr',
    });

    const req = makeFakeReq(`Bearer ${token}`);
    const res = makeFakeRes();
    const next = vi.fn();

    const middleware = requireAttestation({
      issuer: 'https://rootherald.example.com',
      audience: 'my-client',
      acrValues: ['urn:rootherald:user:phr'],
      _jwks: createLocalJWKSet(fixtures.publicJwks),
    });

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledWith(); // no error
    expect(res.ended).toBe(false);
  });

  it('higher-rank ACR than required: passes through', async () => {
    const token = await fixtures.signToken({
      iss: 'https://rootherald.example.com',
      aud: 'my-client',
      sub: 'user-1',
      acr: 'urn:rootherald:user:phrh', // higher rank than phr
    });

    const req = makeFakeReq(`Bearer ${token}`);
    const res = makeFakeRes();
    const next = vi.fn();

    const middleware = requireAttestation({
      issuer: 'https://rootherald.example.com',
      audience: 'my-client',
      acrValues: ['urn:rootherald:user:phr'],
      _jwks: createLocalJWKSet(fixtures.publicJwks),
    });

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledWith(); // no error
    expect(res.ended).toBe(false);
  });

  // ---- auth_time freshness tests ----

  it('stale auth_time: responds 401 with RFC 9470 WWW-Authenticate challenge including max_age', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await fixtures.signToken({
      iss: 'https://rootherald.example.com',
      aud: 'my-client',
      sub: 'user-1',
      auth_time: now - 120, // 120s ago
    });

    const req = makeFakeReq(`Bearer ${token}`);
    const res = makeFakeRes();
    const next = vi.fn();

    const middleware = requireAttestation({
      issuer: 'https://rootherald.example.com',
      audience: 'my-client',
      maxAgeSeconds: 60,
      _jwks: createLocalJWKSet(fixtures.publicJwks),
    });

    await middleware(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.ended).toBe(true);
    const wwwAuth = res.headers['WWW-Authenticate'];
    expect(wwwAuth).toBeDefined();
    expect(wwwAuth).toContain('insufficient_user_authentication');
    expect(wwwAuth).toContain('max_age="60"');

    const body = JSON.parse(res.body);
    expect(body.error).toBe('insufficient_user_authentication');
    expect(body.max_age).toBe(60);

    const err = next.mock.calls[0]![0];
    expect(err).toBeInstanceOf(AuthenticationTooOldError);
  });

  it('fresh auth_time within maxAgeSeconds: passes through', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await fixtures.signToken({
      iss: 'https://rootherald.example.com',
      aud: 'my-client',
      sub: 'user-1',
      auth_time: now - 30, // 30s ago
    });

    const req = makeFakeReq(`Bearer ${token}`);
    const res = makeFakeRes();
    const next = vi.fn();

    const middleware = requireAttestation({
      issuer: 'https://rootherald.example.com',
      audience: 'my-client',
      maxAgeSeconds: 60,
      _jwks: createLocalJWKSet(fixtures.publicJwks),
    });

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledWith(); // no error
    expect(res.ended).toBe(false);
  });

  it('both acrValues and maxAgeSeconds set — acr_values and max_age appear in WWW-Authenticate when ACR fails', async () => {
    const token = await fixtures.signToken({
      iss: 'https://rootherald.example.com',
      aud: 'my-client',
      sub: 'user-1',
      acr: 'urn:rootherald:user:1fa', // insufficient
      auth_time: Math.floor(Date.now() / 1000) - 30,
    });

    const req = makeFakeReq(`Bearer ${token}`);
    const res = makeFakeRes();
    const next = vi.fn();

    const middleware = requireAttestation({
      issuer: 'https://rootherald.example.com',
      audience: 'my-client',
      acrValues: ['urn:rootherald:user:phr'],
      maxAgeSeconds: 60,
      _jwks: createLocalJWKSet(fixtures.publicJwks),
    });

    await middleware(req, res, next);

    expect(res.statusCode).toBe(401);
    const wwwAuth = res.headers['WWW-Authenticate'];
    expect(wwwAuth).toContain('acr_values="urn:rootherald:user:phr"');
    expect(wwwAuth).toContain('max_age="60"');
  });
});
