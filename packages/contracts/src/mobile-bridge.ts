/**
 * Mobile attestation bridge contract.
 *
 * Lets a browser-only customer require RootHerald of MOBILE users (where App
 * Attest is only reachable from a native app, not the browser). The customer's
 * page hands off to the RootHerald bridge (`bridge.rootherald.io`), which opens
 * the companion app and forwards it to the customer's REGISTERED backend URLs.
 * The bridge only opens the app — evidence still flows app → customer backend →
 * RootHerald verify (metered on the customer's `rh_sk_`), exactly as desktop.
 *
 * See docs/mobile-bridge-orchestration-plan.md for the full architecture.
 */

/**
 * Per-tenant mobile configuration, registered in the dashboard. The bridge looks
 * this up server-side (by tenant) so a page can never point the app at an
 * arbitrary endpoint — the app is only ever handed a registered URL.
 */
export interface TenantMobileConfig {
  /**
   * Absolute https URL the companion app POSTs App Attest evidence to — the
   * customer's own backend endpoint that brokers `rh.verify()` with their key.
   */
  appVerifyUrl: string;
  /**
   * Absolute https URL the app reopens in Safari after posting evidence — the
   * customer page that then polls their own result endpoint for the verdict.
   */
  returnUrl: string;
  /** ISO timestamp of the last update (server-set). */
  updatedAt?: string;
}

/**
 * Query params the customer's page sends to the bridge to start a mobile
 * attestation. The bridge resolves `tenant` to that tenant's
 * {@link TenantMobileConfig}; the page never supplies destination URLs.
 * `GET https://bridge.rootherald.io/attest?tenant=<id>&challengeId=<id>`
 */
export interface BridgeAttestQuery {
  /** The customer's tenant id / public tenant handle. */
  tenant: string;
  /** The single-use challenge id the customer's backend already minted via RootHerald. */
  challengeId: string;
}

/**
 * The Universal Link the bridge builds and opens (the companion app parses it).
 * `verify` and `return` are the tenant's REGISTERED urls — not caller-supplied.
 * `https://bridge.rootherald.io/attest?challengeId=…&nonce=…&verify=…&return=…`
 */
export interface BridgeDeepLinkParams {
  challengeId: string;
  /** Standard-base64 challenge nonce for the app's App Attest client. */
  nonce: string;
  /** The registered app-verify url (base64url) — where the app POSTs evidence. */
  verify: string;
  /** The registered return url (base64url) — where the app reopens Safari. */
  return: string;
}

/**
 * The body the companion app POSTs to the customer's registered `appVerifyUrl`.
 * Identical shape to the desktop evidence blob's iOS branch.
 */
export interface MobileAppVerifyRequest {
  challengeId: string;
  evidence: {
    iosAttestation: {
      /** base64 CBOR App Attest attestation object. */
      attestationObject: string;
      /** base64 App Attest key id. */
      keyId: string;
    };
  };
}
