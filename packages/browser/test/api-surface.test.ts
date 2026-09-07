/**
 * The public surface of the package entry. `attest` was removed with the
 * host's `collect` action, with no runtime shim: a page that still calls it
 * gets a TypeScript error at build time (pinned by the `@ts-expect-error`
 * below, which `tsconfig.test.json` checks) and `undefined` at run time.
 */
import { describe, it, expect } from 'vitest';
import * as sdk from '../src/index.js';

describe('public API', () => {
  it('exports the client verbs', () => {
    expect(typeof sdk.respond).toBe('function');
    expect(typeof sdk.sign).toBe('function');
    expect(typeof sdk.getPosture).toBe('function');
    expect(typeof sdk.enroll).toBe('function');
    expect(typeof sdk.getClientStatus).toBe('function');
    expect(typeof sdk.onClientStatusChange).toBe('function');
    expect(typeof sdk.parseHostError).toBe('function');
  });

  it('exports the action constants', () => {
    expect(sdk.ACTION_RESPOND).toBe('respond');
    expect(sdk.ACTION_SIGN).toBe('sign');
    expect(sdk.ACTION_POSTURE).toBe('posture');
    expect(sdk.ACTION_STATUS).toBe('status');
    expect('ACTION_COLLECT' in sdk).toBe(false);
  });

  it('exports the error classes', () => {
    for (const E of [
      sdk.RootHeraldBrowserError,
      sdk.ExtensionMissingError,
      sdk.HostMissingError,
      sdk.TimeoutError,
      sdk.HostError,
      sdk.NotEnrolledError,
      sdk.AskUnsupportedError,
      sdk.KeyUnloadableError,
      sdk.AbiMismatchError,
    ]) {
      expect(typeof E).toBe('function');
    }
    expect(new sdk.NotEnrolledError()).toBeInstanceOf(sdk.HostError);
    expect(new sdk.AbiMismatchError()).toBeInstanceOf(sdk.RootHeraldBrowserError);
  });

  it('has no attest and no collectEvidence, at runtime or in the types', () => {
    expect('attest' in sdk).toBe(false);
    expect('collectEvidence' in sdk).toBe(false);
    // @ts-expect-error attest was removed; there is no runtime shim either
    expect(sdk.attest).toBeUndefined();
    // @ts-expect-error collectEvidence never existed here
    expect(sdk.collectEvidence).toBeUndefined();
  });
});
