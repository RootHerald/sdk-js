import { describe, it, expect } from 'vitest';
import { enrollCollect, enrollActivate } from '../src/enroll.js';
import { ExtensionMissingError, HostMissingError, TimeoutError } from '../src/errors.js';
import { FakeWindow } from './fake-window.js';

const FAST = { timeoutMs: 50 } as const;

describe('enrollCollect', () => {
  it('returns the enrollRequest blob on the happy path', async () => {
    const win = new FakeWindow({
      extensionPresent: true,
      hostPresent: true,
      enrollRequest: { ekPub: 'ek-1', akPub: 'ak-1' },
    });
    const req = await enrollCollect({ ...FAST, win });
    expect(req).toEqual({ ekPub: 'ek-1', akPub: 'ak-1' });
  });

  it('throws ExtensionMissingError when the extension never responds', async () => {
    const win = new FakeWindow({ extensionPresent: false });
    await expect(enrollCollect({ ...FAST, win })).rejects.toBeInstanceOf(
      ExtensionMissingError,
    );
  });

  it('throws HostMissingError when extension is present but host is disconnected', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: false });
    await expect(enrollCollect({ ...FAST, win })).rejects.toBeInstanceOf(
      HostMissingError,
    );
  });

  it('maps a fully silent enroll-collect to ExtensionMissingError', async () => {
    const win = new FakeWindow({
      extensionPresent: true,
      hostPresent: true,
      enrollCollectHangs: true,
    });
    await expect(enrollCollect({ ...FAST, win })).rejects.toBeInstanceOf(
      ExtensionMissingError,
    );
  });

  it('classifies an explicit "timed out" host error as TimeoutError', async () => {
    const win = new FakeWindow({
      extensionPresent: true,
      hostPresent: false,
      hostError: 'Request timed out',
    });
    await expect(enrollCollect({ ...FAST, win })).rejects.toBeInstanceOf(TimeoutError);
  });

  it('passes an opaque enrollRequest through verbatim', async () => {
    // The blob is opaque; the SDK must not reshape it. Use a string to prove
    // non-object blobs survive the round-trip unchanged.
    const win = new FakeWindow({
      extensionPresent: true,
      hostPresent: true,
      enrollRequest: 'raw-base64-blob',
    });
    const req = await enrollCollect({ ...FAST, win });
    expect(req).toBe('raw-base64-blob');
  });
});

describe('enrollActivate', () => {
  it('sends the challenge and returns the activateRequest blob', async () => {
    const win = new FakeWindow({
      extensionPresent: true,
      hostPresent: true,
      activateRequest: { secret: 'unsealed-1' },
    });
    const challenge = { credBlob: 'mc-blob', encSecret: 'enc' };
    const req = await enrollActivate(challenge, { ...FAST, win });
    expect(req).toEqual({ secret: 'unsealed-1' });
    expect(win.lastActivateChallenge).toEqual(challenge);
  });

  it('throws ExtensionMissingError when the extension never responds', async () => {
    const win = new FakeWindow({ extensionPresent: false });
    await expect(enrollActivate({ credBlob: 'x' }, { ...FAST, win })).rejects.toBeInstanceOf(
      ExtensionMissingError,
    );
  });

  it('throws HostMissingError when extension is present but host is disconnected', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: false });
    await expect(enrollActivate({ credBlob: 'x' }, { ...FAST, win })).rejects.toBeInstanceOf(
      HostMissingError,
    );
  });

  it('maps a fully silent enroll-activate to ExtensionMissingError', async () => {
    const win = new FakeWindow({
      extensionPresent: true,
      hostPresent: true,
      enrollActivateHangs: true,
    });
    await expect(enrollActivate({ credBlob: 'x' }, { ...FAST, win })).rejects.toBeInstanceOf(
      ExtensionMissingError,
    );
  });

  it('classifies an explicit "timed out" host error as TimeoutError', async () => {
    const win = new FakeWindow({
      extensionPresent: true,
      hostPresent: false,
      hostError: 'Request timed out',
    });
    await expect(enrollActivate({ credBlob: 'x' }, { ...FAST, win })).rejects.toBeInstanceOf(
      TimeoutError,
    );
  });

  it('rejects a missing challenge with a TypeError', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true });
    await expect(enrollActivate(undefined, { ...FAST, win })).rejects.toBeInstanceOf(TypeError);
    await expect(enrollActivate(null, { ...FAST, win })).rejects.toBeInstanceOf(TypeError);
  });
});
