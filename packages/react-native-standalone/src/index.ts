/**
 * @rootherald/react-native — React Native bindings for Root Herald.
 *
 * The public surface is intentionally minimal:
 *   - RootHeraldClient   — JS class wrapping the native bridge
 *   - useVerifyDevice    — React hook for triggering & observing verify()
 *   - useDevicePosture   — Helper hook for parsing posture JSON
 *   - getOrCreateSharedClient — App-level singleton helper
 *   - RootHeraldError    — Typed error subclass thrown by the SDK
 *   - All TypeScript types
 */

export { RootHeraldClient } from './client.js';
export { useVerifyDevice, useDevicePosture, getOrCreateSharedClient } from './hooks.js';
export { RootHeraldError } from './types.js';
export type {
  Verdict,
  VerifyResult,
  RootHeraldOptions,
  UseVerifyDeviceOptions,
  UseVerifyDeviceResult,
} from './types.js';
