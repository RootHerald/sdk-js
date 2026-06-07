import { describe, it, expect } from 'vitest';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  generateNonce,
} from '../src/pkce.js';
import { encodeBase64Url } from '../src/internal/base64url.js';
import { sha256 } from '../src/internal/webcrypto.js';

const BASE64URL_RE = /^[A-Za-z0-9\-_]+$/;

describe('generateCodeVerifier', () => {
  it('produces a base64url string', () => {
    const v = generateCodeVerifier();
    expect(BASE64URL_RE.test(v)).toBe(true);
  });

  it('length is within RFC 7636 range (43–128 chars)', () => {
    const v = generateCodeVerifier();
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(v.length).toBeLessThanOrEqual(128);
  });

  it('two consecutive calls differ', () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
  });
});

describe('generateCodeChallenge', () => {
  it('is deterministic for the same verifier', async () => {
    const v = generateCodeVerifier();
    const c1 = await generateCodeChallenge(v);
    const c2 = await generateCodeChallenge(v);
    expect(c1).toBe(c2);
  });

  it('matches base64url(SHA-256(verifier))', async () => {
    const v = generateCodeVerifier();
    const challenge = await generateCodeChallenge(v);

    const digest = await sha256(new TextEncoder().encode(v));
    const expected = encodeBase64Url(digest);

    expect(challenge).toBe(expected);
  });

  it('produces a base64url string', async () => {
    const v = generateCodeVerifier();
    const c = await generateCodeChallenge(v);
    expect(BASE64URL_RE.test(c)).toBe(true);
  });

  it('different verifiers produce different challenges', async () => {
    const v1 = generateCodeVerifier();
    const v2 = generateCodeVerifier();
    expect(await generateCodeChallenge(v1)).not.toBe(await generateCodeChallenge(v2));
  });
});

describe('generateState', () => {
  it('produces a base64url string', () => {
    expect(BASE64URL_RE.test(generateState())).toBe(true);
  });

  it('two consecutive calls differ', () => {
    expect(generateState()).not.toBe(generateState());
  });
});

describe('generateNonce', () => {
  it('produces a base64url string', () => {
    expect(BASE64URL_RE.test(generateNonce())).toBe(true);
  });

  it('two consecutive calls differ', () => {
    expect(generateNonce()).not.toBe(generateNonce());
  });
});
