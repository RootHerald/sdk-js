/**
 * Stable identifiers and message shapes for the page <-> extension wire.
 *
 * These mirror the Client ABI 8.0 protocol implemented by the RootHerald
 * browser extension (content-script / service-worker) and the native host. The
 * page is the initiator; the extension never broadcasts unsolicited, so a site
 * that does not use RootHerald cannot fingerprint the extension.
 *
 * KEYLESS BOUNDARY: every action below is a LOCAL TPM operation on the user's
 * machine. The page holds no RootHerald key and opens no RootHerald socket. The
 * network legs are relayed by the EMBEDDER's backend (`/api/v1/attest/*` and
 * `/api/v1/keys/*`, via a server SDK such as @rootherald/node); the page only
 * moves opaque @rootherald/contracts blobs across the page<->extension<->host
 * bridge, and keeps the AK blob and key blobs the host hands back.
 */

import type { AkBlob, KeyBlob, KeyCertification } from '@rootherald/contracts';
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

/** The client ABI major this package speaks; a host reporting another is refused. */
export const HOST_ABI_MAJOR = 8;

/** postMessage `type` for page -> extension requests. */
export const REQUEST_TYPE = 'rootherald-request' as const;
/** postMessage `type` for extension -> page responses. */
export const RESPONSE_TYPE = 'rootherald-response' as const;

/** Action: lightweight "are you installed?" probe (no native host contact). */
export const ACTION_PING = 'ping' as const;
/**
 * Action: answer a backend-issued challenge (host `Attest`). Takes the `rhc1.`
 * challenge string verbatim and the installation's `akBlob`, quotes what the
 * ask says under the AK, and returns the opaque `evidence` blob.
 */
export const ACTION_ATTEST = 'attest' as const;
/**
 * Action: mint a key (host `MintKey`). Takes the `rhk1c.` key challenge string
 * verbatim and the installation's `akBlob`, creates a new key under the TPM's
 * storage parent and has the AK certify it over the nonce; returns the
 * `certification` for the backend to relay and the `keyBlob` the page keeps.
 */
export const ACTION_MINT_KEY = 'mint-key' as const;
/**
 * Action: sign with a minted key (host `LoadKey` / `Sign` / `CloseKey`).
 * Takes the `keyBlob` from an earlier `mint-key` and the base64url `data`
 * to sign; the host hashes it. Returns `{ alg, signature }`. The private half never
 * leaves the TPM.
 */
export const ACTION_SIGN = 'sign' as const;
/** Action: local device readiness signals (no network): platform, TPM, capabilities, ABI. */
export const ACTION_STATUS = 'status' as const;
/** Action: richer local posture signals (host `CollectPosture`; no network). */
export const ACTION_POSTURE = 'posture' as const;
/**
 * Action: enroll leg 1 — the host's `EnrollBegin`. Creates this installation's
 * AK under the TPM's storage parent and returns the opaque `enrollBody`
 * ({@link import('@rootherald/contracts').EnrollRequestBlob}) for the
 * embedder's backend to relay to `/api/v1/attest/enroll`, plus the wrapped
 * `akBlob` the page keeps. No payload in.
 */
export const ACTION_ENROLL_BEGIN = 'enroll-begin' as const;
/**
 * Action: enroll leg 2 — the host's `EnrollComplete`. Takes the 201 body
 * ({@link import('@rootherald/contracts').EnrollActivationChallenge}) the backend
 * relayed back from `/api/v1/attest/enroll` and the `akBlob` from
 * {@link ACTION_ENROLL_BEGIN}, runs `TPM2_ActivateCredential` (the one leg
 * that needs elevation on Windows), and returns an opaque `activationBlob`
 * ({@link import('@rootherald/contracts').EnrollActivationResponse}) for the
 * backend to relay to `/api/v1/attest/activate`.
 */
export const ACTION_ENROLL_COMPLETE = 'enroll-complete' as const;

/** Any page -> extension action. */
export type RootHeraldAction =
  | typeof ACTION_PING
  | typeof ACTION_ATTEST
  | typeof ACTION_MINT_KEY
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
   * The challenge. For `attest`, the backend-issued `rhc1.` string; for
   * `enroll-complete`, the enroll relay's 201 body, verbatim.
   */
  challenge?: string | RelayEnrollResponse;
  /** The backend-issued `rhk1c.` string, for `mint-key`. */
  keyChallenge?: string;
  /** The installation's wrapped AK, for `enroll-complete`, `attest` and `mint-key`. */
  akBlob?: AkBlob;
  /** The wrapped signing key, for `sign`. */
  keyBlob?: KeyBlob;
  /** base64url of the bytes to sign, for `sign`. The host hashes them. */
  data?: string;
}

/** The `data` of a successful response, keyed by the action that produced it. */
export interface RootHeraldResponseData {
  /** `ping`: the extension is installed. */
  extensionInstalled?: boolean;
  /** `attest`: the opaque evidence blob for the backend's verify leg. */
  evidence?: unknown;
  /** `mint-key`: the certification for the backend's certify leg. */
  certification?: KeyCertification;
  /** `mint-key`: the wrapped key the page keeps. */
  keyBlob?: KeyBlob;
  /** `enroll-begin`: the wrapped AK the page keeps. */
  akBlob?: AkBlob;
  /** `sign`: the signature algorithm, from the key: `ES256` or `RS256`. */
  alg?: string;
  /** `sign`: base64url signature over SHA-256 of `data`. */
  signature?: string;
  /** `enroll-begin`: the opaque enroll request for the backend to relay. */
  enrollBody?: unknown;
  /** `enroll-complete`: the opaque activation blob for the backend to relay. */
  activationBlob?: unknown;
  /** Every host answer: the host's client ABI version, `"<major>.<minor>"`. */
  abi?: string;
  /** `status` / `posture`: the host's own version. */
  host?: string;
  /** `status`: the host's platform name. */
  platform?: string;
  /** `status`: whether a TPM is reachable. */
  hasTpm?: boolean;
  /** `status` / `posture`: bitmask of what the TPM supports (bit 1 ECC AK, bit 2 RSA AK). */
  capabilities?: number;
  /** `status` / `posture` signals are host-defined beyond those above. */
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
