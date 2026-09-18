import { describe, it, expect, vi } from 'vitest';
import { respond } from '../src/respond.js';
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

describe('respond', () => {
  it('posts a `respond` message carrying the challenge string verbatim', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true });
    await respond(CHALLENGE, { ...FAST, win });
    expect(win.requests).toHaveLength(1);
    expect(win.requests[0]).toMatchObject({ action: 'respond', challenge: CHALLENGE });
    expect(win.requests[0]!.keyBlob).toBeUndefined();
    expect(win.requests[0]!.data).toBeUndefined();
  });

  it('returns { evidence } on the happy path, with no key when the host sent none', async () => {
    const win = new FakeWindow({
      extensionPresent: true,
      hostPresent: true,
      evidence: { quote: 'q1', eventLog: 'el' },
    });
    const out = await respond(CHALLENGE, { ...FAST, win });
    expect(out).toEqual({ evidence: { quote: 'q1', eventLog: 'el' } });
    expect('key' in out).toBe(false);
  });

  it('returns the key blob alongside the evidence on a key ask', async () => {
    const win = new FakeWindow({
      extensionPresent: true,
      hostPresent: true,
      evidence: { quote: 'q1' },
      keyBlob: 'cmhrMQEA...',
    });
    const out = await respond(CHALLENGE, { ...FAST, win });
    expect(out).toEqual({ evidence: { quote: 'q1' }, key: 'cmhrMQEA...' });
  });

  it('forwards an existing key blob as `keyBlob` when opts.key is given', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true });
    await respond(CHALLENGE, { ...FAST, win, key: 'cmhrMQEA...' });
    expect(win.requests[0]).toMatchObject({ action: 'respond', challenge: CHALLENGE, keyBlob: 'cmhrMQEA...' });
  });

  it('hands evidence and key to relay.verify and returns its result when a relay is given', async () => {
    const win = new FakeWindow({
      extensionPresent: true,
      hostPresent: true,
      evidence: { quote: 'q2' },
      keyBlob: 'kb',
    });
    const verify = vi.fn(async () => ({ verdict: 'pass' as const }));
    const result = await respond(CHALLENGE, { ...FAST, win, relay: { verify } });
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify.mock.calls[0]).toEqual([{ quote: 'q2' }, 'kb']);
    expect(result).toEqual({ verdict: 'pass' });
  });

  it('throws ExtensionMissingError when the extension never responds', async () => {
    const win = new FakeWindow({ extensionPresent: false });
    await expect(respond(CHALLENGE, { ...FAST, win })).rejects.toBeInstanceOf(ExtensionMissingError);
  });

  it('throws HostMissingError when extension is present but host is disconnected', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: false });
    await expect(respond(CHALLENGE, { ...FAST, win })).rejects.toBeInstanceOf(HostMissingError);
  });

  it('maps a silent respond from a present extension to TimeoutError, not ExtensionMissingError', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true, respondHangs: true });
    const err = await respond(CHALLENGE, { ...FAST, win }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TimeoutError);
    expect(err).not.toBeInstanceOf(ExtensionMissingError);
    // The timeout was disambiguated by a ping the extension answered.
    expect(win.requests.map((r) => r.action)).toEqual(['respond', 'ping']);
  });

  it('classifies the extension\'s own "timed out" as TimeoutError', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: false, hostError: 'Request timed out' });
    await expect(respond(CHALLENGE, { ...FAST, win })).rejects.toBeInstanceOf(TimeoutError);
  });

  it.each([
    ['rh:6:device not enrolled', NotEnrolledError],
    ['rh:13:ask "key" is not supported on this TPM', AskUnsupportedError],
    ['rh:14:key blob could not be loaded', KeyUnloadableError],
    ['rh:abi_mismatch:host speaks ABI 5.0', AbiMismatchError],
    ['rh:unknown_action:unknown action "respond"', AbiMismatchError],
  ])('maps host token %s to %s', async (hostError, ErrClass) => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: false, hostError });
    const err = await respond(CHALLENGE, { ...FAST, win }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ErrClass);
    expect((err as Error).message).toBe(hostError.slice(hostError.indexOf(':', 3) + 1));
  });

  it('throws HostMissingError when the host reports success without evidence', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true, respondNoEvidence: true });
    await expect(respond(CHALLENGE, { ...FAST, win })).rejects.toBeInstanceOf(HostMissingError);
  });

  it('rejects a challenge that is not an rhc1 string with a TypeError, before posting', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true });
    await expect(respond('', { ...FAST, win })).rejects.toBeInstanceOf(TypeError);
    await expect(respond('bm9uY2U=', { ...FAST, win })).rejects.toBeInstanceOf(TypeError);
    expect(win.requests).toHaveLength(0);
  });
});
