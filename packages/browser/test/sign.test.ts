import { describe, it, expect } from 'vitest';
import { sign, toBase64Url } from '../src/sign.js';
import {
  AbiMismatchError,
  ExtensionMissingError,
  HostMissingError,
  KeyUnloadableError,
  TimeoutError,
} from '../src/errors.js';
import { FakeWindow } from './fake-window.js';

const FAST = { timeoutMs: 50 } as const;
const KEY = 'cmhrMQEA...';

describe('sign', () => {
  it('posts a `sign` message with the key blob and base64url data', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true });
    await sign(KEY, new Uint8Array([0xfb, 0xff, 0xfe]), { ...FAST, win });
    expect(win.requests).toHaveLength(1);
    // 0xfb 0xff 0xfe is "+//+" in base64; base64url turns it into "-__-".
    expect(win.requests[0]).toEqual({ action: 'sign', challenge: undefined, keyBlob: KEY, data: '-__-' });
  });

  it('encodes a string as UTF-8 before base64url', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true });
    await sign(KEY, 'héllo', { ...FAST, win });
    expect(win.requests[0]!.data).toBe(toBase64Url(new TextEncoder().encode('héllo')));
    expect(win.requests[0]!.data).toBe('aMOpbGxv');
  });

  it('returns { alg, signature } from the host', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true, signature: 'c2lnbmF0dXJl' });
    const out = await sign(KEY, 'data', { ...FAST, win });
    expect(out).toEqual({ alg: 'ES256', signature: 'c2lnbmF0dXJl' });
  });

  it('defaults alg to ES256 when the host omits it', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true, alg: null });
    const out = await sign(KEY, 'data', { ...FAST, win });
    expect(out.alg).toBe('ES256');
  });

  it('refuses an unexpected alg', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true, alg: 'RS256' });
    await expect(sign(KEY, 'data', { ...FAST, win })).rejects.toBeInstanceOf(HostMissingError);
  });

  it('throws HostMissingError when the host reports success without a signature', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true, signNoSignature: true });
    await expect(sign(KEY, 'data', { ...FAST, win })).rejects.toBeInstanceOf(HostMissingError);
  });

  it('throws ExtensionMissingError when the extension never responds', async () => {
    const win = new FakeWindow({ extensionPresent: false });
    await expect(sign(KEY, 'data', { ...FAST, win })).rejects.toBeInstanceOf(ExtensionMissingError);
  });

  it('maps a fully silent sign to ExtensionMissingError', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true, signHangs: true });
    await expect(sign(KEY, 'data', { ...FAST, win })).rejects.toBeInstanceOf(ExtensionMissingError);
  });

  it('throws HostMissingError when the host is disconnected', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: false });
    await expect(sign(KEY, 'data', { ...FAST, win })).rejects.toBeInstanceOf(HostMissingError);
  });

  it.each([
    ['rh:14:key blob could not be loaded', KeyUnloadableError],
    ['rh:abi_mismatch:host speaks ABI 5.0', AbiMismatchError],
    ['Request timed out', TimeoutError],
  ])('maps %s to %s', async (hostError, ErrClass) => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: false, hostError });
    await expect(sign(KEY, 'data', { ...FAST, win })).rejects.toBeInstanceOf(ErrClass);
  });

  it('rejects a bad key or data with a TypeError, before posting', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true });
    await expect(sign('', 'data', { ...FAST, win })).rejects.toBeInstanceOf(TypeError);
    await expect(sign(KEY, 42 as unknown as string, { ...FAST, win })).rejects.toBeInstanceOf(TypeError);
    expect(win.requests).toHaveLength(0);
  });
});

describe('toBase64Url', () => {
  it('produces unpadded base64url', () => {
    expect(toBase64Url(new Uint8Array([]))).toBe('');
    expect(toBase64Url(new Uint8Array([0x66]))).toBe('Zg');
    expect(toBase64Url(new Uint8Array([0x66, 0x6f]))).toBe('Zm8');
    expect(toBase64Url(new Uint8Array([0x66, 0x6f, 0x6f]))).toBe('Zm9v');
    expect(toBase64Url(new Uint8Array([0xff, 0xef]))).toBe('_-8');
  });
});
