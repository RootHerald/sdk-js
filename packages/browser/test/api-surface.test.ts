/**
 * The public surface of the package entry. `respond` was replaced by `attest`
 * and `mintKey` with wire 8.0, with no runtime shim: a page that still calls
 * it gets a TypeScript error at build time (pinned by the `@ts-expect-error`
 * below, which `tsconfig.test.json` checks) and `undefined` at run time.
 */
import { describe, it, expect } from 'vitest';
import * as sdk from '../src/index.js';

describe('public API', () => {
  it('exports the client verbs', () => {
    expect(typeof sdk.enroll).toBe('function');
    expect(typeof sdk.attest).toBe('function');
    expect(typeof sdk.mintKey).toBe('function');
    expect(typeof sdk.sign).toBe('function');
    expect(typeof sdk.setUp).toBe('function');
    expect(typeof sdk.getPosture).toBe('function');
    expect(typeof sdk.getClientStatus).toBe('function');
    expect(typeof sdk.onClientStatusChange).toBe('function');
    expect(typeof sdk.parseHostError).toBe('function');
    expect(typeof sdk.abiMajor).toBe('function');
  });

  it('exports the action constants', () => {
    expect(sdk.ACTION_ATTEST).toBe('attest');
    expect(sdk.ACTION_MINT_KEY).toBe('mint-key');
    expect(sdk.ACTION_SIGN).toBe('sign');
    expect(sdk.ACTION_POSTURE).toBe('posture');
    expect(sdk.ACTION_STATUS).toBe('status');
    expect(sdk.HOST_ABI_MAJOR).toBe(8);
    expect('ACTION_RESPOND' in sdk).toBe(false);
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
      sdk.NotAttestedError,
    ]) {
      expect(typeof E).toBe('function');
    }
    expect(new sdk.NotEnrolledError()).toBeInstanceOf(sdk.HostError);
    expect(new sdk.AbiMismatchError()).toBeInstanceOf(sdk.RootHeraldBrowserError);
    expect(new sdk.NotAttestedError()).toBeInstanceOf(sdk.RootHeraldBrowserError);
    expect(new sdk.NotAttestedError()).not.toBeInstanceOf(sdk.HostError);
  });

  it('has no respond and no collectEvidence, at runtime or in the types', () => {
    expect('respond' in sdk).toBe(false);
    expect('collectEvidence' in sdk).toBe(false);
    // @ts-expect-error respond was replaced by attest / mintKey; there is no runtime shim either
    expect(sdk.respond).toBeUndefined();
    // @ts-expect-error collectEvidence never existed here
    expect(sdk.collectEvidence).toBeUndefined();
  });
});
