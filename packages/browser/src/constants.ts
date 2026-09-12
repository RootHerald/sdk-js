/**
 * Stable identifiers and message shapes for the page <-> extension wire.
 *
 * These mirror the Client ABI 7.0 protocol implemented by the RootHerald
 * browser extension (content-script / service-worker) and the native host. The
 * page is the initiator; the extension never broadcasts unsolicited, so a site
 * that does not use RootHerald cannot fingerprint the extension.
 *
 * KEYLESS BOUNDARY: every action below is a LOCAL TPM operation on the user's
 * machine. The page holds no RootHerald key and opens no RootHerald socket. The
 * network legs are relayed by the EMBEDDER's backend (`/api/v1/attest/*`, via
 * a server SDK such as @rootherald/node); the page only moves opaque
 * @rootherald/contracts blobs across the page<->extension<->host bridge.
 */

import type { KeyBlob } from '@rootherald/contracts';
import type { RelayEnrollResponse } from '@rootherald/contracts/server';

/**
 * Deterministic Chrome/Edge extension id, derived from the committed manifest
 * `key`. Stable across builds, so a page can target the extension by id via
 * `externally_connectable`. (Firefox uses the content-script postMessage
 * bridge instead — it has no stable externally_connectable id.)
 */
export const ROOTHERALD_EXTENSION_ID = 'aailkamjlhedocihiogjgnmambbjhlnj';

/** Native messaging host name the extension connects to (informational). */
export const ROOTHERALD_NATIVE_HOST_NAME = 'com.rootherald.native';

/** postMessage `type` for page -> extension requests. */
export const REQUEST_TYPE = 'rootherald-request' as const;
/** postMessage `type` for extension -> page responses. */
export const RESPONSE_TYPE = 'rootherald-response' as const;

/** Action: lightweight "are you installed?" probe (no native host contact). */
export const ACTION_PING = 'ping' as const;
/**
 * Action: respond to a backend-issued challenge (host `Respond`). Takes the
 * `rhc1.` challenge string verbatim, does what its ask says (quote, event log,
 * key certification), and returns the opaque `evidence` blob — plus a
 * `keyBlob` when the ask included `"key"`.
 */
export const ACTION_RESPOND = 'respond' as const;
/**
 * Action: sign with a certified key (host `LoadKey` / `Sign` / `CloseKey`).
 * Takes the `keyBlob` from an earlier `respond` and the base64url `data` to
 * sign; returns `{ alg, signature }`. The private half never leaves the TPM.
 */
export const ACTION_SIGN = 'sign' as const;
/** Action: local device readiness signals (host `GetDeviceInfo`; no network). */
export const ACTION_STATUS = 'status' as const;
/** Action: richer local posture signals (host `CollectPosture`; no network). */
export const ACTION_POSTURE = 'posture' as const;
/**
 * Action: enroll leg 1 — the host's `EnrollBegin`. Runs the local TPM half (gen
 * AK, gather EK material) and returns an opaque `enrollRequestBlob`
 * ({@link import('@rootherald/contracts').EnrollRequestBlob}) for the embedder's
 * backend to relay to `/api/v1/attest/enroll`. No payload in.
 */
export const ACTION_ENROLL_BEGIN = 'enroll-begin' as const;
/**
 * Action: enroll leg 2 — the host's `EnrollComplete`. Takes the 201 body
 * ({@link import('@rootherald/contracts').EnrollActivationChallenge}) the backend
 * relayed back from `/api/v1/attest/enroll`, runs `TPM2_ActivateCredential` in the SAME resident
 * elevated worker started by {@link ACTION_ENROLL_BEGIN}, and returns an opaque
 * `activationBlob`
 * ({@link import('@rootherald/contracts').EnrollActivationResponse}) for the
 * backend to relay to `/api/v1/attest/activate`.
 */
export const ACTION_ENROLL_COMPLETE = 'enroll-complete' as const;

/** Any page -> extension action. */
export type RootHeraldAction =
  | typeof ACTION_PING
  | typeof ACTION_RESPOND
  | typeof ACTION_SIGN
  | typeof ACTION_STATUS
  | typeof ACTION_POSTURE
  | typeof ACTION_ENROLL_BEGIN
  | typeof ACTION_ENROLL_COMPLETE;

/** A request envelope the page posts via `window.postMessage`. */
export interface RootHeraldRequestMessage {
  type: typeof REQUEST_TYPE;
  requestId: string;
  action: RootHeraldAction;
  /**
   * The challenge. For `respond`, the backend-issued `rhc1.` string; for
   * `enroll-complete`, the enroll relay's 201 body, verbatim.
   */
  challenge?: string | RelayEnrollResponse;
  /** The wrapped signing key for `respond` (to reuse) and `sign`. */
  keyBlob?: KeyBlob;
  /** base64url of the bytes to sign, for `sign`. */
  data?: string;
}

/** The `data` of a successful response, keyed by the action that produced it. */
export interface RootHeraldResponseData {
  /** `ping`: the extension is installed. */
  extensionInstalled?: boolean;
  /** `respond`: the opaque evidence blob for the backend's verify leg. */
  evidence?: unknown;
  /** `respond` (ask included `"key"`): the wrapped key the page keeps. */
  keyBlob?: KeyBlob;
  /** `sign`: the signature algorithm; `ES256` today. */
  alg?: string;
  /** `sign`: base64url signature over `data`. */
  signature?: string;
  /** `enroll-begin`: the opaque enroll request for the backend to relay. */
  enrollRequestBlob?: unknown;
  /** `enroll-complete`: the opaque activation blob for the backend to relay. */
  activationBlob?: unknown;
  /** `status` / `posture`: the host's client ABI version. */
  abi?: string;
  /** `status` / `posture`: the host's own version. */
  host?: string;
  /** `status` / `posture` signals are host-defined beyond the two above. */
  [key: string]: unknown;
}

/** A response envelope the extension posts back via `window.postMessage`. */
export interface RootHeraldResponseMessage {
  type: typeof RESPONSE_TYPE;
  requestId: string;
  success?: boolean;
  data?: RootHeraldResponseData;
  /**
   * On failure. A host-originated error is `rh:<code>:<text>`; see
   * `host-error.ts` for the codes. Anything else came from the extension.
   */
  error?: string;
}
