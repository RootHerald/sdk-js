/**
 * PKCE (RFC 7636) and OAuth state/nonce generation.
 * All randomness comes from Web Crypto; no Node.js crypto module.
 */

import { encodeBase64Url } from './internal/base64url.js';
import { randomBytes, sha256 } from './internal/webcrypto.js';

/**
 * Generates a PKCE code_verifier: 64 random bytes, base64url-encoded.
 * The resulting string is 86 characters long, within RFC 7636's 43–128 char range.
 */
export function generateCodeVerifier(): string {
  return encodeBase64Url(randomBytes(64));
}

/**
 * Derives the code_challenge from a code_verifier using S256 method.
 * Returns base64url(SHA-256(ASCII(code_verifier))).
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoded = new TextEncoder().encode(verifier);
  const digest = await sha256(encoded);
  return encodeBase64Url(digest);
}

/** Generates a 32-byte cryptographically-random state value, base64url-encoded. */
export function generateState(): string {
  return encodeBase64Url(randomBytes(32));
}

/** Generates a 32-byte cryptographically-random nonce, base64url-encoded. */
export function generateNonce(): string {
  return encodeBase64Url(randomBytes(32));
}
