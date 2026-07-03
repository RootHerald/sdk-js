/**
 * @rootherald/browser — the page-side RootHerald SDK (Client ABI 3.0).
 *
 * Orchestrates the KEYLESS client flow over the page <-> extension <-> native-host
 * bridge and hands opaque blobs to the EMBEDDER. The three client verbs:
 *
 *   - `enroll(relay)`  — one-time device-key bootstrap; the two network legs are
 *                        relayed by the embedder's backend (see {@link enroll}).
 *   - `attest(nonce)`  — per-attestation fresh TPM quote -> opaque evidence blob.
 *   - PreCheck         — `getClientStatus` / detect helpers: local readiness
 *                        SIGNALS, never a verdict.
 *
 * BOUNDARY: this package is KEYLESS. The browser holds NO RootHerald key
 * (neither `rh_sk_` nor `rh_pk_`) and opens NO socket to RootHerald. Every action
 * is a local TPM operation; opaque blobs cross the bridge and are relayed to/from
 * RootHerald by the EMBEDDER's backend (a server SDK such as @rootherald/node,
 * which holds `rh_sk_`). No secret, no verdict, no RootHerald network call ever
 * happens in the browser.
 */

export {
  attest,
  collectEvidence,
  type AttestOptions,
  type AttestWithRelayOptions,
  type AttestRelay,
  type CollectOptions,
} from './collect.js';
export {
  enroll,
  type EnrollRelay,
  type EnrollOptions,
  type EnrollResult,
} from './enroll.js';
export {
  getClientStatus,
  detectOs,
  detectBrowser,
  hostSupportedOn,
  pingExtension,
  probeHost,
  type ClientStatus,
  type DetectOptions,
  type OsName,
  type BrowserName,
  type ExtensionState,
  type HostState,
} from './detect.js';
export {
  onClientStatusChange,
  type WatchOptions,
  type Unsubscribe,
} from './watch.js';
export {
  RootHeraldBrowserError,
  ExtensionMissingError,
  HostMissingError,
  NotEnrolledError,
  TimeoutError,
} from './errors.js';
export {
  ROOTHERALD_EXTENSION_ID,
  ROOTHERALD_NATIVE_HOST_NAME,
  REQUEST_TYPE,
  RESPONSE_TYPE,
  ACTION_PING,
  ACTION_COLLECT,
  ACTION_STATUS,
  ACTION_ENROLL_BEGIN,
  ACTION_ENROLL_COMPLETE,
  type RootHeraldAction,
  type RootHeraldRequestMessage,
  type RootHeraldResponseMessage,
} from './constants.js';

// Re-export the contract blob shapes the browser orchestrates with, for embedder
// convenience. These are the opaque blobs that cross the bridge / get relayed;
// the browser never inspects a verdict — that lives only on the backend.
export type {
  EvidenceBlob,
  EnrollRequestBlob,
  EnrollActivationChallenge,
  EnrollActivationResponse,
} from '@rootherald/contracts';
// The relay outcome shapes the embedder's backend (@rootherald/node) returns to
// the `enroll(relay)` callbacks. Type-only; sourced from the server subpath.
export type {
  RelayEnrollResult,
  RelayActivateResponse,
} from '@rootherald/contracts/server';
