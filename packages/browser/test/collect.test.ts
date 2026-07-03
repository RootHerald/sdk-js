import { describe, it, expect, vi } from 'vitest';
import { attest, collectEvidence } from '../src/collect.js';
import {
  ExtensionMissingError,
  HostMissingError,
  NotEnrolledError,
  TimeoutError,
} from '../src/errors.js';
import { FakeWindow } from './fake-window.js';

const FAST = { timeoutMs: 50 } as const;

describe('attest', () => {
  it('returns the evidence blob on the happy path', async () => {
    const win = new FakeWindow({
      extensionPresent: true,
      hostPresent: true,
      evidence: { quote: 'q1', eventLog: 'el' },
    });
    const blob = await attest('nonce-abc', { ...FAST, win, challengeId: 'ch1' });
    expect(blob).toEqual({ quote: 'q1', eventLog: 'el' });
  });

  it('hands the blob to relay.verify and returns its result when a relay is given', async () => {
    const win = new FakeWindow({
      extensionPresent: true,
      hostPresent: true,
      evidence: { quote: 'q2' },
    });
    const verify = vi.fn(async () => ({ verdict: 'pass' as const }));
    const result = await attest('nonce-xyz', { ...FAST, win, relay: { verify } });
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify.mock.calls[0][0]).toEqual({ quote: 'q2' });
    expect(result).toEqual({ verdict: 'pass' });
  });

  it('throws ExtensionMissingError when the extension never responds', async () => {
    const win = new FakeWindow({ extensionPresent: false });
    await expect(attest('nonce-abc', { ...FAST, win })).rejects.toBeInstanceOf(
      ExtensionMissingError,
    );
  });

  it('throws HostMissingError when extension is present but host is disconnected', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: false });
    await expect(attest('nonce-abc', { ...FAST, win })).rejects.toBeInstanceOf(
      HostMissingError,
    );
  });

  it('maps a fully silent collect to ExtensionMissingError', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true, collectHangs: true });
    await expect(attest('nonce-abc', { ...FAST, win })).rejects.toBeInstanceOf(
      ExtensionMissingError,
    );
  });

  it('classifies an explicit "timed out" host error as TimeoutError', async () => {
    const win = new FakeWindow({
      extensionPresent: true,
      hostPresent: false,
      hostError: 'Request timed out',
    });
    await expect(attest('nonce-abc', { ...FAST, win })).rejects.toBeInstanceOf(
      TimeoutError,
    );
  });

  it('classifies a host "not enrolled" error as NotEnrolledError (attest-first cue)', async () => {
    const win = new FakeWindow({
      extensionPresent: true,
      hostPresent: false,
      hostError: 'Device not enrolled — run enroll first',
    });
    await expect(attest('nonce-abc', { ...FAST, win })).rejects.toBeInstanceOf(
      NotEnrolledError,
    );
  });

  it('rejects an empty nonce with a TypeError', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true });
    await expect(attest('', { ...FAST, win })).rejects.toBeInstanceOf(TypeError);
  });
});

describe('collectEvidence (deprecated alias)', () => {
  it('still resolves with the evidence blob', async () => {
    const win = new FakeWindow({
      extensionPresent: true,
      hostPresent: true,
      evidence: { quote: 'q1', eventLog: 'el' },
    });
    const blob = await collectEvidence('nonce-abc', { ...FAST, win, challengeId: 'ch1' });
    expect(blob).toEqual({ quote: 'q1', eventLog: 'el' });
  });
});
