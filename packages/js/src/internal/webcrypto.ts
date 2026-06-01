/**
 * Thin wrappers around Web Crypto primitives.
 * Uses the global `crypto` object (browser + Node 19+/jsdom).
 */

/** Returns `byteLength` cryptographically-random bytes. */
export function randomBytes(byteLength: number): Uint8Array {
  const buf = new Uint8Array(byteLength);
  crypto.getRandomValues(buf);
  return buf;
}

/** SHA-256 digest of `data`. */
export async function sha256(data: BufferSource): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', data);
}
