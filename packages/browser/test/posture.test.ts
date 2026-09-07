import { describe, it, expect } from 'vitest';
import { getPosture } from '../src/posture.js';
import { ExtensionMissingError, HostMissingError, NotEnrolledError } from '../src/errors.js';
import { FakeWindow } from './fake-window.js';

const FAST = { timeoutMs: 50 } as const;

describe('getPosture', () => {
  it('posts a `posture` message and returns the host signals verbatim', async () => {
    const win = new FakeWindow({
      extensionPresent: true,
      hostPresent: true,
      posture: { abi: '6.0', host: '1.4.0', enrolled: false, secureBoot: true },
    });
    const out = await getPosture({ ...FAST, win });
    expect(win.requests[0]).toMatchObject({ action: 'posture' });
    expect(out).toEqual({ abi: '6.0', host: '1.4.0', enrolled: false, secureBoot: true });
    expect(out.abi).toBe('6.0');
  });

  it('throws ExtensionMissingError when the extension never responds', async () => {
    const win = new FakeWindow({ extensionPresent: false });
    await expect(getPosture({ ...FAST, win })).rejects.toBeInstanceOf(ExtensionMissingError);
  });

  it('throws HostMissingError when the host is disconnected', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: false });
    await expect(getPosture({ ...FAST, win })).rejects.toBeInstanceOf(HostMissingError);
  });

  it('surfaces a host token like the other verbs', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: false, hostError: 'rh:6:not enrolled' });
    await expect(getPosture({ ...FAST, win })).rejects.toBeInstanceOf(NotEnrolledError);
  });
});
