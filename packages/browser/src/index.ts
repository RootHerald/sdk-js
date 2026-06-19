/**
 * @rootherald/browser — the page-side RootHerald SDK.
 *
 * Brokers device-evidence collection through the RootHerald browser extension
 * (which drives the local native host) and exposes cold-start client detection
 * so a UI can guide a first-time visitor through installing the extension + the
 * native host. Keyless and offline w.r.t. RootHerald: the page hands the
 * evidence blob to the CUSTOMER's server, which relays it server->server with
 * its `rh_sk_` secret. The verdict comes from the server SDK, not here.
 */

export { collectEvidence, type CollectOptions } from './collect.js';
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
} from './errors.js';
export {
  ROOTHERALD_EXTENSION_ID,
  ROOTHERALD_NATIVE_HOST_NAME,
  REQUEST_TYPE,
  RESPONSE_TYPE,
  ACTION_PING,
  ACTION_COLLECT,
  ACTION_STATUS,
  type RootHeraldRequestMessage,
  type RootHeraldResponseMessage,
} from './constants.js';

// Re-export verdict/evidence types from contracts for convenience: the browser
// SDK only collects; the verdict is produced by the server SDK.
export type { EvidenceBlob, AttestationVerdict, Verdict } from '@rootherald/contracts';
