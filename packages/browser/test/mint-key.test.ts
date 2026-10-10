import { describe, it, expect } from 'vitest';
import { mintKey } from '../src/mint-key.js';
import {
  AbiMismatchError,
  AskUnsupportedError,
  ExtensionMissingError,
  HostMissingError,
  KeyUnloadableError,
  TimeoutError,
} from '../src/errors.js';
import { DEFAULT_KEY_BLOB, FakeWindow } from './fake-window.js';

const FAST = { timeoutMs: 50 } as const;
const KEY_CHALLENGE = 'rhk1c.bm9uY2U.eyJwdXJwb3NlIjoic2lnbiJ9';
const AK = 'cmhhMQEB...ak';

describe('mintKey', () => {
  it('posts a `mint-key` message carrying the key challenge verbatim and the AK blob', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true });
    await mintKey(KEY_CHALLENGE, { ...FAST, win, ak: AK });
    expect(win.requests).toHaveLength(1);
    expect(win.requests[0]).toEqual({
      action: 'mint-key',
      keyChallenge: KEY_CHALLENGE,
      akBlob: AK,
      challenge: undefined,
      keyBlob: undefined,
      data: undefined,
    });
  });

  it('returns { certification, key } from the host', async () => {
    const win = new FakeWindow({
      extensionPresent: true,
      hostPresent: true,
      certification: { publicArea: 'cHVi', attest: 'YXR0', signature: 'c2ln' },
      keyBlob: 'cmhrMQIB...k',
    });
    const out = await mintKey(KEY_CHALLENGE, { ...FAST, win, ak: AK });
    expect(out).toEqual({
      certification: { publicArea: 'cHVi', attest: 'YXR0', signature: 'c2ln' },
      key: 'cmhrMQIB...k',
    });
  });

  it('passes a macOS certification through untouched', async () => {
    const mac = { platform: 'macos' as const, publicKey: 'cGs', signature: 'c2ln' };
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true, certification: mac });
    const out = await mintKey(KEY_CHALLENGE, { ...FAST, win, ak: AK });
    expect(out.certification).toEqual(mac);
    expect(out.key).toBe(DEFAULT_KEY_BLOB);
  });

  it('refuses a host that reports another ABI major', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true, abi: '7.0' });
    await expect(mintKey(KEY_CHALLENGE, { ...FAST, win, ak: AK })).rejects.toBeInstanceOf(AbiMismatchError);
  });

  it('throws ExtensionMissingError when the extension never responds', async () => {
    const win = new FakeWindow({ extensionPresent: false });
    await expect(mintKey(KEY_CHALLENGE, { ...FAST, win, ak: AK })).rejects.toBeInstanceOf(ExtensionMissingError);
  });

  it('throws HostMissingError when the host is disconnected', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: false });
    await expect(mintKey(KEY_CHALLENGE, { ...FAST, win, ak: AK })).rejects.toBeInstanceOf(HostMissingError);
  });

  it('maps a silent mint-key from a present extension to TimeoutError', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true, mintKeyHangs: true });
    await expect(mintKey(KEY_CHALLENGE, { ...FAST, win, ak: AK })).rejects.toBeInstanceOf(TimeoutError);
  });

  it.each([
    ['rh:13:this host cannot mint a decrypt key', AskUnsupportedError],
    ['rh:14:the AK blob could not be loaded', KeyUnloadableError],
    ['rh:abi_mismatch:host speaks ABI 7.0', AbiMismatchError],
    ['rh:unknown_action:unknown action "mint-key"', AbiMismatchError],
  ])('maps host token %s to %s', async (hostError, ErrClass) => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: false, hostError });
    await expect(mintKey(KEY_CHALLENGE, { ...FAST, win, ak: AK })).rejects.toBeInstanceOf(ErrClass);
  });

  it('throws HostMissingError when the host reports success without a certification or key', async () => {
    const noCert = new FakeWindow({ extensionPresent: true, hostPresent: true, mintKeyNoCertification: true });
    await expect(mintKey(KEY_CHALLENGE, { ...FAST, win: noCert, ak: AK })).rejects.toBeInstanceOf(HostMissingError);
    const noKey = new FakeWindow({ extensionPresent: true, hostPresent: true, mintKeyNoKey: true });
    await expect(mintKey(KEY_CHALLENGE, { ...FAST, win: noKey, ak: AK })).rejects.toBeInstanceOf(HostMissingError);
  });

  it('rejects a key challenge that is not an rhk1c string, or a missing AK, before posting', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true });
    await expect(mintKey('', { ...FAST, win, ak: AK })).rejects.toBeInstanceOf(TypeError);
    await expect(mintKey('rhc1.x.y', { ...FAST, win, ak: AK })).rejects.toBeInstanceOf(TypeError);
    await expect(mintKey(KEY_CHALLENGE, { ...FAST, win, ak: '' })).rejects.toBeInstanceOf(TypeError);
    expect(win.requests).toHaveLength(0);
  });
});
