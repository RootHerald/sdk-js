import { describe, it, expect, vi } from 'vitest';
import { enroll, type EnrollRelay } from '../src/enroll.js';
import { AbiMismatchError, ExtensionMissingError, HostMissingError, TimeoutError } from '../src/errors.js';
import { DEFAULT_AK_BLOB, FakeWindow } from './fake-window.js';
import type {
  EnrollActivationChallenge,
  EnrollRequestBlob,
  EnrollActivationResponse,
} from '@rootherald/contracts';
import type { RelayEnrollResult } from '@rootherald/contracts/server';

const FAST = { timeoutMs: 50 } as const;

const CHALLENGE: EnrollActivationChallenge = {
  enrollmentId: 'enr-fresh',
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
    activate: vi.fn(async (_blob: EnrollActivationResponse) => undefined),
  };
}

describe('enroll (keyless, backend-relayed)', () => {
  it('fresh enroll: begin -> relay.enroll -> complete -> relay.activate, resolving the AK blob', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true });
    const relay = makeRelay({ challenge: CHALLENGE });

    const res = await enroll(relay, { ...FAST, win });

    // The page keeps the AK blob and learns nothing else about the device.
    expect(res).toEqual({ ak: DEFAULT_AK_BLOB });
    // relay.enroll got the nested 8.0 enrollBody the host produced.
    expect(relay.enroll).toHaveBeenCalledTimes(1);
    expect(relay.enroll.mock.calls[0][0]).toMatchObject({
      ekPublicKey: expect.any(String),
      attestationKey: {
        publicArea: expect.any(String),
        parentPublicArea: expect.any(String),
        qualifiedName: expect.any(String),
      },
    });
    // The 201 body and the AK blob were forwarded to the host's enroll-complete leg.
    expect(win.lastChallenge).toEqual(CHALLENGE);
    expect(win.requests[1]).toMatchObject({ action: 'enroll-complete', akBlob: DEFAULT_AK_BLOB });
    // relay.activate got the activation blob the host produced.
    expect(relay.activate).toHaveBeenCalledTimes(1);
    expect(relay.activate.mock.calls[0][0]).toMatchObject({
      enrollmentId: 'enr-1',
      decryptedSecret: expect.any(String),
    });
  });

  it('returns the AK blob even when relay.activate returns the backend body', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true, akBlob: 'ak-2' });
    const relay: EnrollRelay = {
      enroll: vi.fn(async () => ({ challenge: CHALLENGE })),
      activate: vi.fn(async () => ({ deviceId: 'tenant-alias', status: 'enrolled' })),
    };
    await expect(enroll(relay, { ...FAST, win })).resolves.toEqual({ ak: 'ak-2' });
  });

  it('refuses a 7.0 host at enroll-begin, before anything is relayed', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true, abi: '7.0' });
    const relay = makeRelay({ challenge: CHALLENGE });
    await expect(enroll(relay, { ...FAST, win })).rejects.toBeInstanceOf(AbiMismatchError);
    expect(relay.enroll).not.toHaveBeenCalled();
    expect(win.requests.map((r) => r.action)).toEqual(['enroll-begin']);
  });

  it('refuses a host that reports no ABI at enroll-begin', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true, abi: null });
    const relay = makeRelay({ challenge: CHALLENGE });
    await expect(enroll(relay, { ...FAST, win })).rejects.toBeInstanceOf(AbiMismatchError);
    expect(relay.enroll).not.toHaveBeenCalled();
  });

  it('accepts any 8.x host', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true, abi: '8.1' });
    const relay = makeRelay({ challenge: CHALLENGE });
    await expect(enroll(relay, { ...FAST, win })).resolves.toEqual({ ak: DEFAULT_AK_BLOB });
  });

  it('throws ExtensionMissingError when the extension never responds', async () => {
    const win = new FakeWindow({ extensionPresent: false });
    const relay = makeRelay({ challenge: CHALLENGE });
    await expect(enroll(relay, { ...FAST, win })).rejects.toBeInstanceOf(
      ExtensionMissingError,
    );
    expect(relay.enroll).not.toHaveBeenCalled();
  });

  it('throws HostMissingError when extension is present but host is disconnected', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: false });
    const relay = makeRelay({ challenge: CHALLENGE });
    await expect(enroll(relay, { ...FAST, win })).rejects.toBeInstanceOf(
      HostMissingError,
    );
  });

  it('maps a silent enroll-begin from a present extension to TimeoutError', async () => {
    const win = new FakeWindow({
      extensionPresent: true,
      hostPresent: true,
      enrollBeginHangs: true,
    });
    const relay = makeRelay({ challenge: CHALLENGE });
    await expect(enroll(relay, { ...FAST, win })).rejects.toBeInstanceOf(TimeoutError);
    expect(relay.enroll).not.toHaveBeenCalled();
  });

  it('maps a silent enroll-complete from a present extension to TimeoutError', async () => {
    const win = new FakeWindow({
      extensionPresent: true,
      hostPresent: true,
      enrollCompleteHangs: true,
    });
    const relay = makeRelay({ challenge: CHALLENGE });
    await expect(enroll(relay, { ...FAST, win })).rejects.toBeInstanceOf(TimeoutError);
    expect(relay.activate).not.toHaveBeenCalled();
  });

  it('maps a host abi_mismatch token to AbiMismatchError', async () => {
    const win = new FakeWindow({
      extensionPresent: true,
      hostPresent: false,
      hostError: 'rh:abi_mismatch:host speaks ABI 7.0',
    });
    const relay = makeRelay({ challenge: CHALLENGE });
    await expect(enroll(relay, { ...FAST, win })).rejects.toBeInstanceOf(AbiMismatchError);
  });

  it('classifies an explicit "timed out" host error as TimeoutError', async () => {
    const win = new FakeWindow({
      extensionPresent: true,
      hostPresent: false,
      hostError: 'Request timed out',
    });
    const relay = makeRelay({ challenge: CHALLENGE });
    await expect(enroll(relay, { ...FAST, win })).rejects.toBeInstanceOf(TimeoutError);
  });

  it('throws HostMissingError when enroll-begin succeeds but returns no blob', async () => {
    const win = new FakeWindow({
      extensionPresent: true,
      hostPresent: true,
      enrollBeginNoBlob: true,
    });
    const relay = makeRelay({ challenge: CHALLENGE });
    await expect(enroll(relay, { ...FAST, win })).rejects.toBeInstanceOf(
      HostMissingError,
    );
    expect(relay.enroll).not.toHaveBeenCalled();
  });

  it('throws HostMissingError when enroll-begin succeeds but returns no akBlob, before relaying', async () => {
    const win = new FakeWindow({
      extensionPresent: true,
      hostPresent: true,
      enrollBeginNoAk: true,
    });
    const relay = makeRelay({ challenge: CHALLENGE });
    await expect(enroll(relay, { ...FAST, win })).rejects.toBeInstanceOf(
      HostMissingError,
    );
    expect(relay.enroll).not.toHaveBeenCalled();
    expect(relay.activate).not.toHaveBeenCalled();
  });

  it('throws HostMissingError when enroll-complete succeeds but returns no blob', async () => {
    const win = new FakeWindow({
      extensionPresent: true,
      hostPresent: true,
      enrollCompleteNoBlob: true,
    });
    const relay = makeRelay({ challenge: CHALLENGE });
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
