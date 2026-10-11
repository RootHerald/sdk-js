import { describe, it, expect } from 'vitest';
import { decrypt, fromBase64Url } from '../src/decrypt.js';
import {
  AbiMismatchError,
  DecryptFailedError,
  ExtensionMissingError,
  HostMissingError,
  InvalidArgumentError,
  KeyUnloadableError,
  TimeoutError,
} from '../src/errors.js';
import { FakeWindow } from './fake-window.js';

const FAST = { timeoutMs: 50 } as const;
const KEY = 'cmhrMQIB...';
// What encryptToDevice makes for an EC key: header..iv.ciphertext.tag.
const JWE = 'eyJhbGciOiJFQ0RILUVTIiwiZW5jIjoiQTI1NkdDTSJ9..AAAAAAAAAAAAAAAA.c2VjcmV0.dGFnMTIzNDU2Nzg5MDEy';

describe('decrypt', () => {
  it('posts a `decrypt` message with the key blob and the envelope, under exactly those names', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true });
    await decrypt(JWE, { ...FAST, win, key: KEY });
    expect(win.requests).toHaveLength(1);
    expect(win.requests[0]).toEqual({
      action: 'decrypt',
      keyBlob: KEY,
      jwe: JWE,
      challenge: undefined,
      keyChallenge: undefined,
      akBlob: undefined,
      data: undefined,
    });
  });

  it('returns the plaintext bytes decoded from the host base64url', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true, plaintext: '-__-' });
    const { plaintext } = await decrypt(JWE, { ...FAST, win, key: KEY });
    expect(plaintext).toEqual(new Uint8Array([0xfb, 0xff, 0xfe]));
  });

  it('returns UTF-8 text as bytes the page decodes', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true, plaintext: 'aMOpbGxv' });
    const { plaintext } = await decrypt(JWE, { ...FAST, win, key: KEY });
    expect(new TextDecoder().decode(plaintext)).toBe('héllo');
  });

  it('returns an empty plaintext', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true, plaintext: '' });
    const { plaintext } = await decrypt(JWE, { ...FAST, win, key: KEY });
    expect(plaintext).toHaveLength(0);
  });

  it('accepts an envelope with an RSA encrypted-key segment', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true });
    const rsa = 'eyJhbGciOiJSU0EtT0FFUC0yNTYiLCJlbmMiOiJBMjU2R0NNIn0.d3JhcHBlZA.AAAAAAAAAAAAAAAA.c2VjcmV0.dGFn';
    await decrypt(rsa, { ...FAST, win, key: KEY });
    expect(win.requests[0]!.jwe).toBe(rsa);
  });

  it('refuses a host that reports another ABI major', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true, abi: '7.0' });
    await expect(decrypt(JWE, { ...FAST, win, key: KEY })).rejects.toBeInstanceOf(AbiMismatchError);
  });

  it('throws HostMissingError when the host reports success without a plaintext', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true, decryptNoPlaintext: true });
    await expect(decrypt(JWE, { ...FAST, win, key: KEY })).rejects.toBeInstanceOf(HostMissingError);
  });

  it('throws HostMissingError when the plaintext is not base64url', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true, plaintext: 'not base64!' });
    await expect(decrypt(JWE, { ...FAST, win, key: KEY })).rejects.toBeInstanceOf(HostMissingError);
  });

  it('throws ExtensionMissingError when the extension never responds', async () => {
    const win = new FakeWindow({ extensionPresent: false });
    await expect(decrypt(JWE, { ...FAST, win, key: KEY })).rejects.toBeInstanceOf(ExtensionMissingError);
  });

  it('maps a silent decrypt from a present extension to TimeoutError', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true, decryptHangs: true });
    await expect(decrypt(JWE, { ...FAST, win, key: KEY })).rejects.toBeInstanceOf(TimeoutError);
  });

  it('throws HostMissingError when the host is disconnected', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: false });
    await expect(decrypt(JWE, { ...FAST, win, key: KEY })).rejects.toBeInstanceOf(HostMissingError);
  });

  it.each([
    ['rh:18:envelope did not open', DecryptFailedError],
    ['rh:1:key is a sign key', InvalidArgumentError],
    ['rh:14:key blob could not be loaded', KeyUnloadableError],
    ['rh:abi_mismatch:host speaks ABI 7.0', AbiMismatchError],
    ['rh:unknown_action:unknown action "decrypt"', AbiMismatchError],
    ['Request timed out', TimeoutError],
  ])('maps %s to %s', async (hostError, ErrClass) => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: false, hostError });
    await expect(decrypt(JWE, { ...FAST, win, key: KEY })).rejects.toBeInstanceOf(ErrClass);
  });

  it('carries the host codes on the named errors', () => {
    expect(new DecryptFailedError().code).toBe('18');
    expect(new InvalidArgumentError().code).toBe('1');
  });

  it('rejects a bad envelope or key with a TypeError, before posting', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true });
    await expect(decrypt('', { ...FAST, win, key: KEY })).rejects.toBeInstanceOf(TypeError);
    await expect(decrypt('not.a.jwe', { ...FAST, win, key: KEY })).rejects.toBeInstanceOf(TypeError);
    await expect(decrypt('a.b.c.d.e.f', { ...FAST, win, key: KEY })).rejects.toBeInstanceOf(TypeError);
    await expect(decrypt('a=.b.c.d.e', { ...FAST, win, key: KEY })).rejects.toBeInstanceOf(TypeError);
    await expect(decrypt(42 as unknown as string, { ...FAST, win, key: KEY })).rejects.toBeInstanceOf(TypeError);
    await expect(decrypt(JWE, { ...FAST, win, key: '' })).rejects.toBeInstanceOf(TypeError);
    expect(win.requests).toHaveLength(0);
  });
});

describe('fromBase64Url', () => {
  it('decodes unpadded base64url and tolerates padding and the standard alphabet', () => {
    expect(fromBase64Url('')).toEqual(new Uint8Array([]));
    expect(fromBase64Url('Zg')).toEqual(new Uint8Array([0x66]));
    expect(fromBase64Url('Zm8')).toEqual(new Uint8Array([0x66, 0x6f]));
    expect(fromBase64Url('Zm9v')).toEqual(new Uint8Array([0x66, 0x6f, 0x6f]));
    expect(fromBase64Url('_-8')).toEqual(new Uint8Array([0xff, 0xef]));
    expect(fromBase64Url('/+8=')).toEqual(new Uint8Array([0xff, 0xef]));
  });

  it('refuses anything outside the alphabet', () => {
    expect(fromBase64Url('a b')).toBeUndefined();
    expect(fromBase64Url('a=b')).toBeUndefined();
  });
});
