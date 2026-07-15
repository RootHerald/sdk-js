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
 * The body the RootHerald bridge forwards to the customer's registered
 * `appVerifyUrl` (identical shape to the desktop evidence blob's iOS branch).
 * The customer's backend hands this to {@link RootHerald.verifyMobileEvidence}.
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

/** Inputs to {@link buildMobileAttestLink}. */
export interface BuildMobileAttestLinkOptions {
  /**
   * The RootHerald bridge base URL, e.g. `https://bridge.rootherald.io`. This is
   * the host the companion app opens from AND posts evidence to — it must be a
   * DIFFERENT host than the page (iOS won't hand a same-host link to an app).
   */
  bridgeBaseUrl: string;
  /** The customer's tenant slug / public handle (as registered with RootHerald). */
  tenant: string;
  /** The single-use challenge id the customer's backend already minted. */
  challengeId: string;
  /** The challenge nonce (as returned alongside `challengeId`). */
  nonce: string;
}

/**
 * Build the Universal Link that opens the RootHerald companion app. It carries
 * only the tenant + challenge — **no customer URLs**. The app collects App Attest
 * evidence and POSTs it to the fixed bridge endpoint (`<bridgeBaseUrl>/evidence`);
 * the bridge forwards it to your server-side-registered backend, which brokers the
 * metered verify with your key. Because the app only ever posts to RootHerald, a
 * page can't redirect the evidence elsewhere.
 *
 * The page **must render the returned link in a real `<a href>` the user taps** —
 * iOS only fires a Universal Link on a genuine tap, never a redirect or JS nav.
 *
 * ```ts
 * anchorEl.href = buildMobileAttestLink({
 *   bridgeBaseUrl: "https://bridge.rootherald.io",
 *   tenant: "acme",
 *   challengeId, nonce,
 * });
 * ```
 */
export function buildMobileAttestLink(opts: BuildMobileAttestLinkOptions): string {
  const base = opts.bridgeBaseUrl.replace(/\/+$/, "");
  const params = new URLSearchParams({
    tenant: opts.tenant,
    challengeId: opts.challengeId,
    nonce: opts.nonce,
  });
  return `${base}/try/attest?${params.toString()}`;
}
