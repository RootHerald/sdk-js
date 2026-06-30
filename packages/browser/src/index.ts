/**
 * @rootherald/browser — the page-side RootHerald SDK.
 *
 * Brokers device-evidence collection through the RootHerald browser extension
 * (which drives the local native host) and exposes cold-start client detection
 * so a UI can guide a first-time visitor through installing the extension + the
 * native host.
 *
 * BOUNDARY: this package is KEYLESS. The `rh_sk_` secret and the act of
 * verification live ONLY in the customer's BACKEND (a server SDK such as
 * @rootherald/node) — never in this browser package and never in page code.
 * Here the page only collects an opaque evidence blob and hands it to the
 * customer's server, which relays it server->server to RootHerald with its
 * `rh_sk_` secret and returns the verdict. No secret, no verdict, no RootHerald
 * network call happens in the browser.
 */

export { collectEvidence, type CollectOptions } from './collect.js';
export {
  enroll,
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
} from './errors.js';
export {
  ROOTHERALD_EXTENSION_ID,
  ROOTHERALD_NATIVE_HOST_NAME,
  REQUEST_TYPE,
  RESPONSE_TYPE,
  ACTION_PING,
  ACTION_COLLECT,
  ACTION_STATUS,
  ACTION_ENROLL,
  type RootHeraldRequestMessage,
  type RootHeraldResponseMessage,
} from './constants.js';

// Re-export verdict/evidence types from contracts for convenience: the browser
// SDK only collects; the verdict is produced by the server SDK.
export type { EvidenceBlob, AttestationVerdict, Verdict } from '@rootherald/contracts';
