import { describe, it, expect, vi } from 'vitest';
import { enroll, type EnrollRelay } from '../src/enroll.js';
import { ExtensionMissingError, HostMissingError, TimeoutError } from '../src/errors.js';
import { FakeWindow } from './fake-window.js';
import type {
  EnrollActivationChallenge,
  EnrollRequestBlob,
  EnrollActivationResponse,
} from '@rootherald/contracts';
import type { RelayEnrollResult } from '@rootherald/contracts/server';

const FAST = { timeoutMs: 50 } as const;

const CHALLENGE: EnrollActivationChallenge = {
  deviceId: 'dev-fresh',
  credentialBlob: 'cred-b64',
  encryptedSecret: 'enc-b64',
};

/** A relay whose `enroll` leg resolves to `result`; tracks both calls. */
function makeRelay(result: RelayEnrollResult): EnrollRelay & {
  enroll: ReturnType<typeof vi.fn>;
  activate: ReturnType<typeof vi.fn>;
} {
  return {
    enroll: vi.fn(async (_blob: EnrollRequestBlob) => result),
    activate: vi.fn(async (_blob: EnrollActivationResponse) => ({
      deviceId: result.deviceId,
    })),
  };
}

describe('enroll (keyless, backend-relayed)', () => {
  it('fresh enroll: begin -> relay.enroll -> complete -> relay.activate', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true });
    const relay = makeRelay({
      alreadyEnrolled: false,
      deviceId: 'dev-fresh',
      challenge: CHALLENGE,
    });

    const res = await enroll(relay, { ...FAST, win });

    expect(res).toEqual({ deviceId: 'dev-fresh', alreadyEnrolled: false });
    // relay.enroll got the opaque enrollRequestBlob the host produced.
    expect(relay.enroll).toHaveBeenCalledTimes(1);
    expect(relay.enroll.mock.calls[0][0]).toMatchObject({
      ekPublicKey: expect.any(String),
      akPublicArea: expect.any(String),
    });
    // The challenge was forwarded to the host's enroll-complete leg.
    expect(win.lastChallenge).toEqual(CHALLENGE);
    // relay.activate got the activation blob the host produced.
    expect(relay.activate).toHaveBeenCalledTimes(1);
    expect(relay.activate.mock.calls[0][0]).toMatchObject({
      deviceId: 'device-1',
      decryptedSecret: expect.any(String),
    });
  });

  it('already-enrolled: 409 branch skips complete + activate', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true });
    const relay = makeRelay({ alreadyEnrolled: true, deviceId: 'dev-known' });

    const res = await enroll(relay, { ...FAST, win });

    expect(res).toEqual({ deviceId: 'dev-known', alreadyEnrolled: true });
    expect(relay.enroll).toHaveBeenCalledTimes(1);
    // No second TPM leg, no activate relay.
    expect(relay.activate).not.toHaveBeenCalled();
    expect(win.lastChallenge).toBeUndefined();
  });

  it('throws ExtensionMissingError when the extension never responds', async () => {
    const win = new FakeWindow({ extensionPresent: false });
    const relay = makeRelay({ alreadyEnrolled: true, deviceId: 'x' });
    await expect(enroll(relay, { ...FAST, win })).rejects.toBeInstanceOf(
      ExtensionMissingError,
    );
    expect(relay.enroll).not.toHaveBeenCalled();
  });

  it('throws HostMissingError when extension is present but host is disconnected', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: false });
    const relay = makeRelay({ alreadyEnrolled: true, deviceId: 'x' });
    await expect(enroll(relay, { ...FAST, win })).rejects.toBeInstanceOf(
      HostMissingError,
    );
  });

  it('maps a fully silent enroll-begin to ExtensionMissingError', async () => {
    const win = new FakeWindow({
      extensionPresent: true,
      hostPresent: true,
      enrollBeginHangs: true,
    });
    const relay = makeRelay({ alreadyEnrolled: true, deviceId: 'x' });
    await expect(enroll(relay, { ...FAST, win })).rejects.toBeInstanceOf(
      ExtensionMissingError,
    );
  });

  it('classifies an explicit "timed out" host error as TimeoutError', async () => {
    const win = new FakeWindow({
      extensionPresent: true,
      hostPresent: false,
      hostError: 'Request timed out',
    });
    const relay = makeRelay({ alreadyEnrolled: true, deviceId: 'x' });
    await expect(enroll(relay, { ...FAST, win })).rejects.toBeInstanceOf(TimeoutError);
  });

  it('throws HostMissingError when enroll-begin succeeds but returns no blob', async () => {
    const win = new FakeWindow({
      extensionPresent: true,
      hostPresent: true,
      enrollBeginNoBlob: true,
    });
    const relay = makeRelay({ alreadyEnrolled: true, deviceId: 'x' });
    await expect(enroll(relay, { ...FAST, win })).rejects.toBeInstanceOf(
      HostMissingError,
    );
    expect(relay.enroll).not.toHaveBeenCalled();
  });

  it('throws HostMissingError when enroll-complete succeeds but returns no blob', async () => {
    const win = new FakeWindow({
      extensionPresent: true,
      hostPresent: true,
      enrollCompleteNoBlob: true,
    });
    const relay = makeRelay({
      alreadyEnrolled: false,
      deviceId: 'dev-fresh',
      challenge: CHALLENGE,
    });
    await expect(enroll(relay, { ...FAST, win })).rejects.toBeInstanceOf(
      HostMissingError,
    );
    expect(relay.activate).not.toHaveBeenCalled();
  });

  it('propagates a relay.enroll backend rejection', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true });
    const relay: EnrollRelay = {
      enroll: vi.fn(async () => {
        throw new Error('backend 500');
      }),
      activate: vi.fn(),
    };
    await expect(enroll(relay, { ...FAST, win })).rejects.toThrow('backend 500');
  });

  it('throws a TypeError when no relay is provided', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true });
    // @ts-expect-error intentionally omitting the required relay
    await expect(enroll(undefined, { ...FAST, win })).rejects.toBeInstanceOf(TypeError);
  });
});
