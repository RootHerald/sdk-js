/**
 * @rootherald/browser — the page-side RootHerald SDK (Client ABI 6.0).
 *
 * Orchestrates the KEYLESS client flow over the page <-> extension <-> native-host
 * bridge and hands opaque blobs to the EMBEDDER. The client verbs:
 *
 *   - `enroll(relay)`        — one-time device-key bootstrap; the two network legs
 *                              are relayed by the embedder's backend (see {@link enroll}).
 *   - `respond(challenge)`   — answer a backend-issued challenge: fresh TPM quote,
 *                              event log, key certification, whatever its ask says
 *                              -> opaque evidence blob (+ a `KeyBlob` on a key ask).
 *   - `sign(key, data)`      — sign with a certified key; the private half stays
 *                              in the TPM.
 *   - PreCheck               — `getClientStatus` / `getPosture` / detect helpers:
 *                              local readiness SIGNALS, never a verdict.
 *
 * BOUNDARY: this package is KEYLESS. The browser holds NO RootHerald key
 * and opens NO socket to RootHerald. Every action
 * is a local TPM operation; opaque blobs cross the bridge and are relayed to/from
 * RootHerald by the EMBEDDER's backend (a server SDK such as @rootherald/node,
 * which holds `rh_sk_`). No secret, no verdict, no RootHerald network call ever
 * happens in the browser.
 */

export {
  respond,
  type RespondOptions,
  type RespondWithRelayOptions,
  type RespondRelay,
  type RespondResult,
} from './respond.js';
export {
  sign,
  type SignOptions,
  type SignResult,
} from './sign.js';
export {
  getPosture,
  type PostureOptions,
  type DevicePosture,
} from './posture.js';
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
  TimeoutError,
  HostError,
  NotEnrolledError,
  AskUnsupportedError,
  KeyUnloadableError,
  AbiMismatchError,
} from './errors.js';
export {
  parseHostError,
  type HostErrorToken,
} from './host-error.js';
export {
  ROOTHERALD_EXTENSION_ID,
  ROOTHERALD_NATIVE_HOST_NAME,
  REQUEST_TYPE,
  RESPONSE_TYPE,
  ACTION_PING,
  ACTION_RESPOND,
  ACTION_SIGN,
  ACTION_STATUS,
  ACTION_POSTURE,
  ACTION_ENROLL_BEGIN,
  ACTION_ENROLL_COMPLETE,
  type RootHeraldAction,
  type RootHeraldRequestMessage,
  type RootHeraldResponseMessage,
  type RootHeraldResponseData,
} from './constants.js';

// Re-export the contract blob shapes the browser orchestrates with, for embedder
// convenience. These are the opaque blobs that cross the bridge / get relayed;
// the browser never inspects a verdict — that lives only on the backend.
export type {
  Ask,
  EvidenceBlob,
  KeyBlob,
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
