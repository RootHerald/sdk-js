import { describe, it, expect, vi } from 'vitest';
import { attest } from '../src/attest.js';
import {
  AbiMismatchError,
  AskUnsupportedError,
  ExtensionMissingError,
  HostMissingError,
  KeyUnloadableError,
  NotEnrolledError,
  TimeoutError,
} from '../src/errors.js';
import { FakeWindow } from './fake-window.js';

const FAST = { timeoutMs: 50 } as const;
const CHALLENGE = 'rhc1.bm9uY2U.eyJhc2siOlsiaWRlbnRpdHkiXX0';
const AK = 'cmhhMQEB...ak';

describe('attest', () => {
  it('posts an `attest` message carrying the challenge string verbatim and the AK blob', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true });
    await attest(CHALLENGE, { ...FAST, win, ak: AK });
    expect(win.requests).toHaveLength(1);
    expect(win.requests[0]).toEqual({
      action: 'attest',
      challenge: CHALLENGE,
      akBlob: AK,
      keyChallenge: undefined,
      keyBlob: undefined,
      data: undefined,
    });
  });

  it('returns { evidence } on the happy path and nothing else', async () => {
    const win = new FakeWindow({
      extensionPresent: true,
      hostPresent: true,
      evidence: { quote: 'q1', logs: { srtm: 'el' } },
    });
    const out = await attest(CHALLENGE, { ...FAST, win, ak: AK });
    expect(out).toEqual({ evidence: { quote: 'q1', logs: { srtm: 'el' } } });
    expect('key' in out).toBe(false);
  });

  it('hands evidence to relay.verify and returns its result when a relay is given', async () => {
    const win = new FakeWindow({
      extensionPresent: true,
      hostPresent: true,
      evidence: { quote: 'q2' },
    });
    const verify = vi.fn(async () => ({ pass: true }));
    const result = await attest(CHALLENGE, { ...FAST, win, ak: AK, relay: { verify } });
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify.mock.calls[0]).toEqual([{ quote: 'q2' }]);
    expect(result).toEqual({ pass: true });
  });

  it('refuses a host that reports another ABI major', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true, abi: '7.0' });
    await expect(attest(CHALLENGE, { ...FAST, win, ak: AK })).rejects.toBeInstanceOf(AbiMismatchError);
  });

  it('throws ExtensionMissingError when the extension never responds', async () => {
    const win = new FakeWindow({ extensionPresent: false });
    await expect(attest(CHALLENGE, { ...FAST, win, ak: AK })).rejects.toBeInstanceOf(ExtensionMissingError);
  });

  it('throws HostMissingError when extension is present but host is disconnected', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: false });
    await expect(attest(CHALLENGE, { ...FAST, win, ak: AK })).rejects.toBeInstanceOf(HostMissingError);
  });

  it('maps a silent attest from a present extension to TimeoutError, not ExtensionMissingError', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true, attestHangs: true });
    const err = await attest(CHALLENGE, { ...FAST, win, ak: AK }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TimeoutError);
    expect(err).not.toBeInstanceOf(ExtensionMissingError);
    // The timeout was disambiguated by a ping the extension answered.
    expect(win.requests.map((r) => r.action)).toEqual(['attest', 'ping']);
  });

  it('classifies the extension\'s own "timed out" as TimeoutError', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: false, hostError: 'Request timed out' });
    await expect(attest(CHALLENGE, { ...FAST, win, ak: AK })).rejects.toBeInstanceOf(TimeoutError);
  });

  it.each([
    ['rh:6:no enrollment in progress', NotEnrolledError],
    ['rh:13:ask "posture" is not supported on this platform', AskUnsupportedError],
    ['rh:14:the AK blob could not be loaded', KeyUnloadableError],
    ['rh:abi_mismatch:host speaks ABI 7.0', AbiMismatchError],
    ['rh:unknown_action:unknown action "attest"', AbiMismatchError],
  ])('maps host token %s to %s', async (hostError, ErrClass) => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: false, hostError });
    const err = await attest(CHALLENGE, { ...FAST, win, ak: AK }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ErrClass);
    expect((err as Error).message).toBe(hostError.slice(hostError.indexOf(':', 3) + 1));
  });

  it('throws HostMissingError when the host reports success without evidence', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true, attestNoEvidence: true });
    await expect(attest(CHALLENGE, { ...FAST, win, ak: AK })).rejects.toBeInstanceOf(HostMissingError);
  });

  it('rejects a challenge that is not an rhc1 string with a TypeError, before posting', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true });
    await expect(attest('', { ...FAST, win, ak: AK })).rejects.toBeInstanceOf(TypeError);
    await expect(attest('bm9uY2U=', { ...FAST, win, ak: AK })).rejects.toBeInstanceOf(TypeError);
    await expect(attest('rhk1c.x.y', { ...FAST, win, ak: AK })).rejects.toBeInstanceOf(TypeError);
    expect(win.requests).toHaveLength(0);
  });

  it('rejects a missing or empty AK blob with a TypeError, before posting', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true });
    await expect(attest(CHALLENGE, { ...FAST, win, ak: '' })).rejects.toBeInstanceOf(TypeError);
    // @ts-expect-error intentionally omitting ak
    await expect(attest(CHALLENGE, { ...FAST, win })).rejects.toBeInstanceOf(TypeError);
    expect(win.requests).toHaveLength(0);
  });
});
