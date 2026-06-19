import { describe, it, expect } from 'vitest';
import { collectEvidence } from '../src/collect.js';
import { ExtensionMissingError, HostMissingError, TimeoutError } from '../src/errors.js';
import { FakeWindow } from './fake-window.js';

const FAST = { timeoutMs: 50 } as const;

describe('collectEvidence', () => {
  it('returns the evidence blob on the happy path', async () => {
    const win = new FakeWindow({
      extensionPresent: true,
      hostPresent: true,
      evidence: { quote: 'q1', eventLog: 'el' },
    });
    const blob = await collectEvidence('nonce-abc', { ...FAST, win, challengeId: 'ch1' });
    expect(blob).toEqual({ quote: 'q1', eventLog: 'el' });
  });

  it('throws ExtensionMissingError when the extension never responds', async () => {
    const win = new FakeWindow({ extensionPresent: false });
    await expect(collectEvidence('nonce-abc', { ...FAST, win })).rejects.toBeInstanceOf(
      ExtensionMissingError,
    );
  });

  it('throws HostMissingError when extension is present but host is disconnected', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: false });
    await expect(collectEvidence('nonce-abc', { ...FAST, win })).rejects.toBeInstanceOf(
      HostMissingError,
    );
  });

  it('maps a fully silent collect to ExtensionMissingError', async () => {
    // A silent extension can't be distinguished from a missing one, so a
    // collect that never answers maps to ExtensionMissingError by design.
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true, collectHangs: true });
    await expect(collectEvidence('nonce-abc', { ...FAST, win })).rejects.toBeInstanceOf(
      ExtensionMissingError,
    );
  });

  it('classifies an explicit "timed out" host error as TimeoutError', async () => {
    const win = new FakeWindow({
      extensionPresent: true,
      hostPresent: false,
      hostError: 'Request timed out',
    });
    await expect(collectEvidence('nonce-abc', { ...FAST, win })).rejects.toBeInstanceOf(
      TimeoutError,
    );
  });

  it('rejects an empty nonce with a TypeError', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true });
    await expect(collectEvidence('', { ...FAST, win })).rejects.toBeInstanceOf(TypeError);
  });
});
