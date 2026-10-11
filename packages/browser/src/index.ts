/**
 * @rootherald/browser — the page-side RootHerald SDK (Client ABI 8.0).
 *
 * Orchestrates the KEYLESS client flow over the page <-> extension <-> native-host
 * bridge and hands opaque blobs to the EMBEDDER. The client verbs:
 *
 *   - `enroll(relay)`                  — enroll this installation; the two network legs are
 *                                        relayed by the embedder's backend. Resolves `{ ak }`,
 *                                        the AK blob the page keeps.
 *   - `attest(challenge, { ak })`      — answer a backend-issued challenge: a fresh TPM quote
 *                                        under the AK, plus the event log when asked
 *                                        -> opaque evidence blob.
 *   - `mintKey(keyChallenge, { ak })`  — mint a device-bound key certified by the AK
 *                                        -> `{ certification, key }`; the page keeps `key`.
 *   - `sign(key, data)`                — sign with a minted key; the private half stays
 *                                        in the TPM.
 *   - `setUp(relay, { purpose })`      — enroll → attest → mint, chained.
 *   - PreCheck                         — `getClientStatus` / `getPosture` / detect helpers:
 *                                        local readiness SIGNALS, never a verdict.
 *
 * BOUNDARY: this package is KEYLESS. The browser holds NO RootHerald key
 * and opens NO socket to RootHerald. Every action is a local TPM operation;
 * opaque blobs cross the bridge and are relayed to/from RootHerald by the
 * EMBEDDER's backend (a server SDK such as @rootherald/node, which holds
 * `rh_sk_`). No secret, no verdict, no RootHerald network call ever happens
 * in the browser.
 *
 * This package drives RootHerald's own extension and native host, which are
 * reference and test tools; it is not published to npm.
 */

export {
  attest,
  type AttestOptions,
  type AttestWithRelayOptions,
  type AttestRelay,
  type AttestResult,
} from './attest.js';
export {
  mintKey,
  type MintKeyOptions,
  type MintKeyResult,
} from './mint-key.js';
export {
  sign,
  type SignAlg,
  type SignOptions,
  type SignResult,
} from './sign.js';
export {
  setUp,
  type SetUpOptions,
  type SetUpRelay,
  type SetUpResult,
} from './set-up.js';
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
  NotAttestedError,
} from './errors.js';
export {
  parseHostError,
  abiMajor,
  type HostErrorToken,
} from './host-error.js';
export {
  ROOTHERALD_EXTENSION_ID,
  ROOTHERALD_NATIVE_HOST_NAME,
  HOST_ABI_MAJOR,
  REQUEST_TYPE,
  RESPONSE_TYPE,
  ACTION_PING,
  ACTION_ATTEST,
  ACTION_MINT_KEY,
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
  AkBlob,
  Ask,
  EvidenceBlob,
  KeyBlob,
  KeyCertification,
  KeyPurpose,
  EnrollRequestBlob,
  EnrollActivationChallenge,
  EnrollActivationResponse,
} from '@rootherald/contracts';
// The relay outcome shapes the embedder's backend (@rootherald/node) returns to
// the `enroll(relay)` callbacks. Type-only; sourced from the server subpath.
export type {
  RelayEnrollResponse,
  RelayEnrollResult,
  RelayActivateResponse,
} from '@rootherald/contracts/server';
