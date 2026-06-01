/**
 * Native module typing for the Root Herald RN bridge.
 *
 * We deliberately use the legacy NativeModule pattern (NativeModules.RootHeraldRN)
 * rather than a generated TurboModule spec because:
 *
 *   1. The package supports RN 0.72+ — the New Architecture only became
 *      the default in 0.76 and many real-world apps haven't migrated yet.
 *   2. The surface is tiny (two async methods) and codegen would add
 *      significant build complexity for no runtime benefit.
 *   3. Moving to a TurboModuleRegistry-based spec later is a pure additive
 *      change — call sites stay identical.
 *
 * Both promise-returning methods reject with a {@link RootHeraldError}-shaped
 * object: `{ code: 'E_...', message: '...' }`. Codes are normalized below.
 */

import { NativeModules, Platform } from 'react-native';

export interface NativeRootHeraldSpec {
  /**
   * Constructs a native RootHeraldClient and returns an opaque handle (string).
   * The handle is later passed to {@link verify} to identify the instance.
   */
  create(apiKey: string, endpoint: string): Promise<string>;

  /**
   * Optional — propagates an application identifier to the native client.
   * Older bridge builds may not implement this; we no-op on absence.
   */
  setApplicationId?(handle: string, applicationId: string): Promise<void>;

  /** Toggles the mock-TPM mode on the native client. */
  setMockTpm?(handle: string, enabled: boolean): Promise<void>;

  /** Runs an attestation and returns a normalized result. */
  verify(
    handle: string,
    action: string,
  ): Promise<{
    verdict: 'allow' | 'warn' | 'deny';
    deviceId: string;
    tpmClass: string;
    posture: string;
    reason: string;
  }>;

  /** Releases the native client referenced by `handle`. */
  destroy?(handle: string): Promise<void>;
}

const LINKING_ERROR =
  `The package '@rootherald/react-native' doesn't seem to be linked. Make sure: \n\n` +
  Platform.select({ ios: "- You have run 'pod install'\n", default: '' }) +
  '- You rebuilt the app after installing the package\n' +
  '- You are not using Expo managed workflow (use a development build instead)\n';

/**
 * Resolves the native module, throwing a helpful error if linking is missing.
 * Exported as a function (not a constant) so the error is only raised when
 * the SDK is actually used — importing the package in a test or web build
 * should not crash.
 */
export function getNativeModule(): NativeRootHeraldSpec {
  const m = (NativeModules as Record<string, NativeRootHeraldSpec | undefined>).RootHeraldRN;
  if (!m) {
    throw new Error(LINKING_ERROR);
  }
  return m;
}
