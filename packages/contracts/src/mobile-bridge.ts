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
 * The bridge routes by the nonce inside the challenge; the challenge row
 * supplies the tenant. Nothing on the link or in a body names one.
 */

import type { AppAttestEnrollRequestBlob } from "./enroll.js";

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
   * The bridge appends `?nonce=<handle>` so the page knows which result to poll.
   */
  returnUrl: string;
  /** ISO timestamp of the last update (server-set). */
  updatedAt?: string;
}

/**
 * The body the RootHerald bridge forwards to the customer's registered enroll
 * URL. The customer's backend hands `enrollment` to
 * {@link RootHeraldClient.relayEnroll} verbatim.
 */
export interface MobileAppEnrollRequest {
  /** The challenge handle the app enrolled against ({@link ChallengeResponse.nonce}). */
  nonce: string;
  /** The iOS enroll body, as the app's SDK emitted it. */
  enrollment: AppAttestEnrollRequestBlob;
}

/**
 * The body the RootHerald bridge forwards to the customer's registered
 * `appVerifyUrl` (identical shape to the desktop evidence blob's iOS branch).
 * The customer's backend hands this to {@link RootHeraldClient.verifyMobileEvidence}.
 */
export interface MobileAppVerifyRequest {
  /** The challenge handle the app answered ({@link ChallengeResponse.nonce}). */
  nonce: string;
  evidence: {
    iosAttestation: {
      /** base64 CBOR App Attest assertion over SHA-256 of the nonce. */
      assertion: string;
      /** base64 App Attest key id; the server locates the device by it. */
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
  /**
   * The relayed challenge string, exactly as `ChallengeResponse.challenge`
   * (`rhc1.<nonce>.<ask>`). The app signs over this string and the server
   * appraises against the ask it carries, so it must be passed verbatim.
   */
  challenge: string;
}

/**
 * Build the Universal Link that opens the RootHerald companion app:
 * `<bridgeBaseUrl>/try/attest?challenge=`. It carries only the challenge —
 * **no customer URLs**. The app collects App Attest evidence and POSTs it to the
 * fixed bridge endpoint (`<bridgeBaseUrl>/evidence`); the bridge forwards it to
 * your server-side-registered backend, which brokers the metered verify with
 * your key. Because the app only ever posts to RootHerald, a page can't
 * redirect the evidence elsewhere.
 *
 * The page **must render the returned link in a real `<a href>` the user taps** —
 * iOS only fires a Universal Link on a genuine tap, never a redirect or JS nav.
 *
 * ```ts
 * anchorEl.href = buildMobileAttestLink({
 *   bridgeBaseUrl: "https://bridge.rootherald.io",
 *   challenge,
 * });
 * ```
 */
export function buildMobileAttestLink(opts: BuildMobileAttestLinkOptions): string {
  const base = opts.bridgeBaseUrl.replace(/\/+$/, "");
  const params = new URLSearchParams({ challenge: opts.challenge });
  return `${base}/try/attest?${params.toString()}`;
}
