import { describe, it, expect, vi } from 'vitest';
import { setUp, type SetUpRelay } from '../src/set-up.js';
import { AbiMismatchError, NotAttestedError } from '../src/errors.js';
import { DEFAULT_AK_BLOB, DEFAULT_KEY_BLOB, FakeWindow } from './fake-window.js';

const FAST = { timeoutMs: 50 } as const;
const CHALLENGE = 'rhc1.bm9uY2U.eyJhc2siOlsiaWRlbnRpdHkiXX0';
const KEY_CHALLENGE = 'rhk1c.a2V5bm9uY2U.eyJwdXJwb3NlIjoic2lnbiJ9';

function makeRelay(pass = true) {
  return {
    enroll: vi.fn(async () => ({ challenge: { enrollmentId: 'enr-1', credentialBlob: 'c', encryptedSecret: 's' } })),
    activate: vi.fn(async () => undefined),
    challenge: vi.fn(async () => ({ nonce: 'bm9uY2U', challenge: CHALLENGE })),
    verify: vi.fn(async () => ({ pass, session: 'tok' })),
    keyChallenge: vi.fn(async () => ({ nonce: 'a2V5bm9uY2U', keyChallenge: KEY_CHALLENGE })),
    certify: vi.fn(async () => undefined),
  } satisfies SetUpRelay<{ pass: boolean; session: string }>;
}

describe('setUp', () => {
  it('chains enroll -> challenge -> attest -> verify -> keyChallenge -> mintKey -> certify', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true, evidence: { quote: 'q' } });
    const relay = makeRelay();

    const out = await setUp(relay, { ...FAST, win, purpose: 'sign' });

    expect(out).toEqual({ ak: DEFAULT_AK_BLOB, key: DEFAULT_KEY_BLOB, verified: { pass: true, session: 'tok' } });
    expect(win.requests.map((r) => r.action)).toEqual([
      'enroll-begin',
      'enroll-complete',
      'attest',
      'mint-key',
    ]);
    // The attest and the mint both ran under the AK the enrollment produced.
    expect(win.requests[2]).toMatchObject({ challenge: CHALLENGE, akBlob: DEFAULT_AK_BLOB });
    expect(win.requests[3]).toMatchObject({ keyChallenge: KEY_CHALLENGE, akBlob: DEFAULT_AK_BLOB });
    // Each backend leg got the nonce its challenge came with.
    expect(relay.verify).toHaveBeenCalledWith('bm9uY2U', { quote: 'q' });
    expect(relay.keyChallenge).toHaveBeenCalledWith('sign');
    expect(relay.certify).toHaveBeenCalledWith('a2V5bm9uY2U', {
      publicArea: 'key-pub-b64',
      attest: 'certify-attest-b64',
      signature: 'ak-sig-b64',
    });
  });

  it('stops with NotAttestedError when the backend reports the attest did not pass; nothing is minted', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true });
    const relay = makeRelay(false);
    await expect(setUp(relay, { ...FAST, win, purpose: 'sign' })).rejects.toBeInstanceOf(NotAttestedError);
    expect(relay.activate).toHaveBeenCalledTimes(1);
    expect(relay.keyChallenge).not.toHaveBeenCalled();
    expect(win.requests.map((r) => r.action)).toEqual(['enroll-begin', 'enroll-complete', 'attest']);
  });

  it('fails at enroll-begin on a 7.0 host, before any backend call', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true, abi: '7.0' });
    const relay = makeRelay();
    await expect(setUp(relay, { ...FAST, win, purpose: 'sign' })).rejects.toBeInstanceOf(AbiMismatchError);
    expect(relay.enroll).not.toHaveBeenCalled();
    expect(relay.challenge).not.toHaveBeenCalled();
  });

  it('rejects an incomplete relay or an unknown purpose with a TypeError, before posting', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true });
    const { certify: _omitted, ...partial } = makeRelay();
    await expect(setUp(partial as never, { ...FAST, win, purpose: 'sign' })).rejects.toBeInstanceOf(TypeError);
    await expect(setUp(makeRelay(), { ...FAST, win, purpose: 'wrap' as never })).rejects.toBeInstanceOf(TypeError);
    expect(win.requests).toHaveLength(0);
  });
});
