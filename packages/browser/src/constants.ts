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
 * Action: first-time device enrollment. Drives the native host's single
 * elevated-TBS enroll (one "Establish hardware key" UAC) device↔RootHerald, and
 * returns the enrolled `deviceId`. The whole ceremony — create AK,
 * TPM2_ActivateCredential, evict to a persistent handle — happens in the host;
 * the page never relays TPM blobs. (Replaced the PCP-only `enroll-collect` /
 * `enroll-activate` page-relay split once raw-TBS activation was proven under
 * elevation.) `serverUrl` is the RootHerald endpoint the host enrolls against
 * (optional; the host falls back to its configured default).
 */
export const ACTION_ENROLL = 'enroll' as const;

/** A request envelope the page posts via `window.postMessage`. */
export interface RootHeraldRequestMessage {
  type: typeof REQUEST_TYPE;
  requestId: string;
  action:
    | typeof ACTION_PING
    | typeof ACTION_COLLECT
    | typeof ACTION_STATUS
    | typeof ACTION_ENROLL;
  nonce?: string;
  challengeId?: string;
  /** RootHerald endpoint for the `enroll` action's device↔RootHerald round-trip. */
  serverUrl?: string;
}

/** A response envelope the extension posts back via `window.postMessage`. */
export interface RootHeraldResponseMessage {
  type: typeof RESPONSE_TYPE;
  requestId: string;
  success?: boolean;
  data?: Record<string, unknown>;
  error?: string;
}
