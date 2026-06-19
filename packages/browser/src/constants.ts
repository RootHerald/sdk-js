/**
 * Stable identifiers and message shapes for the page <-> extension wire.
 *
 * These mirror the WP7 Background-Check contract implemented by the RootHerald
 * browser extension (content-script.ts / service-worker.ts). The page is the
 * initiator; the extension never broadcasts unsolicited, so a site that does
 * not use RootHerald cannot fingerprint the extension.
 */

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
/** Action: collect a fresh evidence blob over the server nonce. */
export const ACTION_COLLECT = 'collect' as const;
/** Action: local device readiness (drives a native-host round-trip, no network). */
export const ACTION_STATUS = 'status' as const;
/**
 * Action: round 1 of first-time device enrollment. Drives a native-host
 * round-trip (no network) and returns the `enrollRequest` body the page relays
 * to the customer proxy's POST /api/v1/devices/enroll.
 */
export const ACTION_ENROLL_COLLECT = 'enroll-collect' as const;
/**
 * Action: round 2 of first-time device enrollment. Given the server's
 * MakeCredential `challenge`, drives a keyless native-host activate and returns
 * the `activateRequest` body the page relays to POST /api/v1/devices/activate.
 */
export const ACTION_ENROLL_ACTIVATE = 'enroll-activate' as const;

/** A request envelope the page posts via `window.postMessage`. */
export interface RootHeraldRequestMessage {
  type: typeof REQUEST_TYPE;
  requestId: string;
  action:
    | typeof ACTION_PING
    | typeof ACTION_COLLECT
    | typeof ACTION_STATUS
    | typeof ACTION_ENROLL_COLLECT
    | typeof ACTION_ENROLL_ACTIVATE;
  nonce?: string;
  challengeId?: string;
  /** MakeCredential blob from /enroll, forwarded verbatim on `enroll-activate`. */
  challenge?: unknown;
}

/** A response envelope the extension posts back via `window.postMessage`. */
export interface RootHeraldResponseMessage {
  type: typeof RESPONSE_TYPE;
  requestId: string;
  success?: boolean;
  data?: Record<string, unknown>;
  error?: string;
}
