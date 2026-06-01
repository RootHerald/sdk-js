/**
 * Base64url helpers (RFC 4648 §5, no padding).
 * No dependency on jose here — these operate on raw ArrayBuffers/Uint8Arrays.
 */

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Encodes a Uint8Array (or ArrayBuffer) as a base64url string. */
export function encodeBase64Url(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let result = '';
  let i = 0;
  const len = bytes.length;

  while (i < len) {
    const b0 = bytes[i++]!;
    const b1 = i < len ? bytes[i++]! : 0;
    const b2 = i < len ? bytes[i++]! : 0;

    result += CHARS[b0 >> 2]!;
    result += CHARS[((b0 & 0x3) << 4) | (b1 >> 4)]!;
    result += CHARS[((b1 & 0xf) << 2) | (b2 >> 6)]!;
    result += CHARS[b2 & 0x3f]!;
  }

  // Strip padding characters that may have been included for trailing bytes
  const padLen = (3 - (len % 3)) % 3;
  return result.slice(0, result.length - padLen);
}

/** Decodes a base64url string to a Uint8Array. */
export function decodeBase64Url(input: string): Uint8Array {
  // Re-pad to standard base64
  const padded = input + '==='.slice((input.length + 3) % 4);
  const b64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
