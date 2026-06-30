import { describe, it, expect } from 'vitest';
import { enroll } from '../src/enroll.js';
import { ExtensionMissingError, HostMissingError, TimeoutError } from '../src/errors.js';
import { FakeWindow } from './fake-window.js';

const FAST = { timeoutMs: 50 } as const;

describe('enroll', () => {
  it('returns the enrolled deviceId on the happy path', async () => {
    const win = new FakeWindow({
      extensionPresent: true,
      hostPresent: true,
      deviceId: 'dev-abc',
    });
    const res = await enroll({ ...FAST, win });
    expect(res).toEqual({ deviceId: 'dev-abc' });
  });

  it('forwards serverUrl to the host', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true });
    await enroll({ ...FAST, win, serverUrl: 'http://localhost:8080' });
    expect(win.lastEnrollServerUrl).toBe('http://localhost:8080');
  });

  it('throws ExtensionMissingError when the extension never responds', async () => {
    const win = new FakeWindow({ extensionPresent: false });
    await expect(enroll({ ...FAST, win })).rejects.toBeInstanceOf(
      ExtensionMissingError,
    );
  });

  it('throws HostMissingError when extension is present but host is disconnected', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: false });
    await expect(enroll({ ...FAST, win })).rejects.toBeInstanceOf(
      HostMissingError,
    );
  });

  it('maps a fully silent enroll to ExtensionMissingError', async () => {
    const win = new FakeWindow({
      extensionPresent: true,
      hostPresent: true,
      enrollHangs: true,
    });
    await expect(enroll({ ...FAST, win })).rejects.toBeInstanceOf(
      ExtensionMissingError,
    );
  });

  it('classifies an explicit "timed out" host error as TimeoutError', async () => {
    const win = new FakeWindow({
      extensionPresent: true,
      hostPresent: false,
      hostError: 'Request timed out',
    });
    await expect(enroll({ ...FAST, win })).rejects.toBeInstanceOf(TimeoutError);
  });

  it('throws HostMissingError when the host reports success but no deviceId', async () => {
    const win = new FakeWindow({
      extensionPresent: true,
      hostPresent: true,
      deviceId: '',
    });
    await expect(enroll({ ...FAST, win })).rejects.toBeInstanceOf(HostMissingError);
  });
});
