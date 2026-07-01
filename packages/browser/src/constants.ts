/**
 * Stable identifiers and message shapes for the page <-> extension wire.
 *
 * These mirror the Client ABI 3.0 native-chain protocol implemented by the
 * RootHerald browser extension (WP5 content-script.ts / service-worker.ts) and
 * the native host (WP6). The page is the initiator; the extension never
 * broadcasts unsolicited, so a site that does not use RootHerald cannot
 * fingerprint the extension.
 *
 * KEYLESS BOUNDARY: every action below is a LOCAL TPM operation on the user's
 * machine. The page holds no RootHerald key and opens no RootHerald socket. The
 * enroll handshake's two network legs are relayed by the EMBEDDER's backend (see
 * `enroll.ts`); the page only moves opaque @rootherald/contracts blobs across
 * the page<->extension<->host bridge.
 */

import type { EnrollActivationChallenge } from '@rootherald/contracts';

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
/** Action: collect a fresh evidence blob over the backend-issued nonce (host CollectEvidence). */
export const ACTION_COLLECT = 'collect' as const;
/** Action: local device readiness/posture signals (host CollectPosture; no network). */
export const ACTION_STATUS = 'status' as const;
/**
 * Action: enroll leg 1 — the host's `EnrollBegin`. Runs the local TPM half (gen
 * AK, gather EK material) and returns an opaque `enrollRequestBlob`
 * ({@link import('@rootherald/contracts').EnrollRequestBlob}) for the embedder's
 * backend to relay to RootHerald's `/devices/enroll`. No payload in.
 */
export const ACTION_ENROLL_BEGIN = 'enroll-begin' as const;
/**
 * Action: enroll leg 2 — the host's `EnrollComplete`. Takes the
 * {@link EnrollActivationChallenge} the backend relayed back from
 * `/devices/enroll`, runs `TPM2_ActivateCredential` in the SAME resident
 * elevated worker started by {@link ACTION_ENROLL_BEGIN}, and returns an opaque
 * `activationBlob`
 * ({@link import('@rootherald/contracts').EnrollActivationResponse}) for the
 * backend to relay to RootHerald's `/devices/activate`.
 */
export const ACTION_ENROLL_COMPLETE = 'enroll-complete' as const;

/** Any page -> extension action. */
export type RootHeraldAction =
  | typeof ACTION_PING
  | typeof ACTION_COLLECT
  | typeof ACTION_STATUS
  | typeof ACTION_ENROLL_BEGIN
  | typeof ACTION_ENROLL_COMPLETE;

/** A request envelope the page posts via `window.postMessage`. */
export interface RootHeraldRequestMessage {
  type: typeof REQUEST_TYPE;
  requestId: string;
  action: RootHeraldAction;
  /** Backend-issued nonce for the `collect` action. */
  nonce?: string;
  /** Correlation id from the customer's `/challenge` response; echoed back. */
  challengeId?: string;
  /** The MakeCredential challenge for the `enroll-complete` action. */
  challenge?: EnrollActivationChallenge;
}

/** A response envelope the extension posts back via `window.postMessage`. */
export interface RootHeraldResponseMessage {
  type: typeof RESPONSE_TYPE;
  requestId: string;
  success?: boolean;
  data?: Record<string, unknown>;
  error?: string;
}
