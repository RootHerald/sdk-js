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

/** What {@link resolveBridgeDeepLink} needs to ask the bridge for a deep link. */
export interface ResolveBridgeDeepLinkOptions {
  /** The RootHerald bridge base URL, e.g. `https://bridge.rootherald.io`. */
  bridgeBaseUrl: string;
  /** The customer's tenant slug / public handle (as registered with RootHerald). */
  tenant: string;
  /** The single-use challenge id the customer's backend already minted. */
  challengeId: string;
  /** The challenge nonce (as returned alongside `challengeId`). */
  nonce: string;
  /** Override `fetch` (defaults to the global). Handy for tests / non-browser hosts. */
  fetch?: typeof fetch;
  /** Optional AbortSignal to cancel the request. */
  signal?: AbortSignal;
}

/**
 * Browser/mobile helper: ask the RootHerald bridge for the companion-app deep
 * link to render as a tap target. Zero-dependency and isomorphic (uses the
 * global `fetch`). The page **must render the returned `deepLink` in a real
 * `<a href>` the user taps** — iOS only fires a Universal Link on a genuine tap,
 * never a redirect or JS navigation.
 *
 * The bridge resolves `tenant` to that tenant's server-side-registered verify/
 * return URLs; the page never supplies a destination, so this can't be abused as
 * an open redirect.
 *
 * ```ts
 * const { deepLink } = await resolveBridgeDeepLink({
 *   bridgeBaseUrl: "https://bridge.rootherald.io",
 *   tenant: "acme",
 *   challengeId, nonce,
 * });
 * anchorEl.href = deepLink; // user taps → Root Herald app opens
 * ```
 */
export async function resolveBridgeDeepLink(
  opts: ResolveBridgeDeepLinkOptions,
): Promise<{ deepLink: string }> {
  const doFetch = opts.fetch ?? globalThis.fetch;
  if (typeof doFetch !== "function") {
    throw new Error("resolveBridgeDeepLink: no fetch available; pass opts.fetch");
  }
  const base = opts.bridgeBaseUrl.replace(/\/+$/, "");
  const url =
    `${base}/link?tenant=${encodeURIComponent(opts.tenant)}` +
    `&challengeId=${encodeURIComponent(opts.challengeId)}` +
    `&nonce=${encodeURIComponent(opts.nonce)}`;

  const res = await doFetch(url, { method: "GET", signal: opts.signal });
  if (!res.ok) {
    throw new Error(`resolveBridgeDeepLink: bridge returned HTTP ${res.status}`);
  }
  const body = (await res.json()) as { deepLink?: unknown };
  if (typeof body?.deepLink !== "string") {
    throw new Error("resolveBridgeDeepLink: bridge response missing deepLink");
  }
  return { deepLink: body.deepLink };
}
