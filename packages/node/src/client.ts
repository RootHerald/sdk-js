/**
 * RootHerald server-side client — the Background-Check (server -> server) path.
 *
 * The customer's dumb client collects an opaque evidence blob (no keys, no
 * RootHerald contact) and hands it to the customer's own server. The server
 * uses this client, authenticated with its `rh_sk_` secret key, to:
 *   1. mint a relay-friendly nonce  (`issueChallenge`)
 *   2. submit the evidence for appraisal and get a verdict  (`attest`)
 *
 * Network calls use the built-in global `fetch` (Node 18+) — no HTTP library.
 */

import type {
  AttestationVerdict,
  ChallengeResponse,
  EvidenceBlob,
  MobileAppVerifyRequest,
  RequestedDisclosureClass,
  VerifyAttestationRequest,
  VerifyAttestationResponse,
} from "@rootherald/contracts";
import { RootHeraldError } from "@rootherald/contracts";
import {
  ChallengeError,
  InvalidEvidenceError,
  InvalidSecretKeyError,
  QuotaExceededError,
  RootHeraldApiError,
  UnknownPolicyError,
} from "@rootherald/contracts/server";
import type {
  EnrollActivationChallenge,
  EnrollActivationResponse,
  EnrollRequestBlob,
  RelayActivateResponse,
  RelayEnrollResult,
} from "@rootherald/contracts/server";

/** Production RootHerald API base URL. */
const DEFAULT_BASE_URL = "https://rootherald.io";

/** RootHerald API keys are `rh_sk_`-prefixed secret keys, used server-side as a Bearer token. */
const SECRET_KEY_PREFIX = "rh_sk_";

/**
 * Reject a base URL that would put the `rh_sk_` secret on the wire in the clear.
 *
 * The secret rides in an Authorization header on every request and is
 * full-privilege, so an `http://` or scheme-less base URL hands it to anyone on
 * the path. A typo is enough, and nothing downstream notices, because the
 * request itself still succeeds.
 *
 * Loopback is excepted so the local docker stack keeps working over http.
 */
function requireSecureBaseUrl(baseUrl: string): string {
  const trimmed = String(baseUrl).replace(/\/+$/, "");

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new RootHeraldError(
      `baseUrl must be an absolute https URL (got ${JSON.stringify(trimmed)})`,
      "INVALID_BASE_URL",
    );
  }

  const isLoopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]" ||
    url.hostname === "::1";

  if (url.protocol === "https:" || isLoopback) return trimmed;

  throw new RootHeraldError(
    `baseUrl must use https (got ${JSON.stringify(trimmed)})`,
    "INVALID_BASE_URL",
  );
}

/** Options for constructing a {@link RootHerald} server client. */
export interface RootHeraldClientOptions {
  /**
   * Your RootHerald **secret** key (`rh_sk_…`). Required. Used server-side as a
   * Bearer token; any value not starting with `rh_sk_` is rejected.
   */
  secretKey: string;
  /** API base URL. Default: the production RootHerald API. */
  baseUrl?: string;
  /**
   * Custom fetch implementation, primarily for testing. Defaults to the global
   * `fetch` (Node 18+).
   */
  fetch?: typeof fetch;
}

/** Options for {@link RootHeraldClient.issueChallenge}. */
export interface IssueChallengeOptions {
  /** Optional advisory hint identifying the device. */
  deviceHint?: string;
}

/** Options for {@link RootHeraldClient.attest}. */
export interface AttestOptions {
  /** The single-use challenge id from {@link RootHeraldClient.issueChallenge}. */
  challengeId: string;
  /**
   * Caller-named policy: a tenant-owned policy id/name or a
   * `rootherald:builtin:*` name. Unknown/foreign names fail closed (422).
   */
  policy?: string;
  /**
   * Optional disclosure ceiling to request for this appraisal
   * (`"verdict" | "pseudonymous" | "derived" | "full"`). Omitted => the
   * resolved policy's default disclosure applies.
   */
  requestedDisclosureClass?: RequestedDisclosureClass;
}

/**
 * Verdict plus the response top-level fields, as returned by
 * {@link RootHeraldClient.verify}. `assuranceClaimsMet` and `enrollmentRequired` are
 * surfaced verbatim from the server response so callers can gate capabilities
 * and drive the enroll-on-miss flow (they are NOT part of the nested verdict).
 */
export type AttestResult = AttestationVerdict & {
  /**
   * The assurance claims the device satisfied for the resolved policy. Absent
   * when the server returns none.
   */
  assuranceClaimsMet?: string[];
  /**
   * `true` when the device is not enrolled and the caller should drive the
   * enroll / re-attestation flow before trusting the verdict.
   */
  enrollmentRequired?: boolean;
};

/**
 * Server-side RootHerald client for the Background-Check flow.
 *
 * @example
 * ```ts
 * const rh = new RootHeraldClient({ secretKey: process.env.RH_SECRET_KEY! });
 * const { challengeId, nonce } = await rh.issueChallenge();
 * // relay `nonce` to the client; client quotes over it and returns `evidence`
 * const verdict = await rh.verify(evidence, { challengeId, policy: "default" });
 * if (verdict.device.verdict === "pass") { ... }
 * ```
 */
export class RootHeraldClient {
  private readonly secretKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: RootHeraldClientOptions) {
    const key = options?.secretKey;
    if (!key || typeof key !== "string") {
      throw new RootHeraldError(
        "RootHerald requires a `secretKey` (rh_sk_…)",
        "MISSING_SECRET_KEY",
      );
    }
    if (!key.startsWith(SECRET_KEY_PREFIX)) {
      throw new RootHeraldError(
        "RootHerald secret key must start with rh_sk_",
        "INVALID_SECRET_KEY_FORMAT",
      );
    }
    this.secretKey = key;
    this.baseUrl = requireSecureBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);

    const f = options.fetch ?? globalThis.fetch;
    if (typeof f !== "function") {
      throw new RootHeraldError(
        "global fetch is not available; use Node 18+ or pass a `fetch` implementation",
        "NO_FETCH",
      );
    }
    // Bind to preserve `this` when calling the global fetch.
    this.fetchImpl = options.fetch ? f : f.bind(globalThis);
  }

  /**
   * `POST /api/v1/attest/challenge` — mints a fresh, relay-friendly nonce
   * (freshness / anti-replay). Relay `nonce` to the client; the client quotes
   * over it, then submit the resulting evidence with {@link verify} using the
   * returned `challengeId`.
   */
  async issueChallenge(opts?: IssueChallengeOptions): Promise<ChallengeResponse> {
    const body: { deviceHint?: string } = {};
    if (opts?.deviceHint !== undefined) body.deviceHint = opts.deviceHint;

    const data = await this.post<ChallengeResponse>(
      "/api/v1/attest/challenge",
      body,
    );
    if (
      typeof data?.challengeId !== "string" ||
      typeof data?.nonce !== "string" ||
      typeof data?.expiresAt !== "string"
    ) {
      throw new RootHeraldApiError(
        "challenge response missing challengeId/nonce/expiresAt",
        "INVALID_RESPONSE",
        200,
      );
    }
    return {
      challengeId: data.challengeId,
      nonce: data.nonce,
      expiresAt: data.expiresAt,
    };
  }

  /**
   * `POST /api/v1/attest/verify` — submits the opaque evidence blob for
   * server-side appraisal and returns the verdict. The verdict is computed by
   * RootHerald and returned here, to the customer's backend — it NEVER travels
   * through the client, which holds no key and gets no verdict.
   *
   * An un-enrolled / failing device is NOT an error — it returns a normal
   * verdict with a `fail` (or `warn`) result. Only protocol/auth/quota problems
   * raise a typed {@link RootHeraldApiError}.
   *
   * @param evidence  Opaque blob from the client collector; passed through verbatim.
   */
  async verify(evidence: EvidenceBlob, opts: AttestOptions): Promise<AttestResult> {
    if (!opts || typeof opts.challengeId !== "string" || !opts.challengeId) {
      throw new RootHeraldError(
        "verify() requires `challengeId` (from issueChallenge)",
        "MISSING_CHALLENGE_ID",
      );
    }

    const body: VerifyAttestationRequest = {
      challengeId: opts.challengeId,
      evidence,
    };
    if (opts.policy !== undefined) body.policy = opts.policy;
    if (opts.requestedDisclosureClass !== undefined) {
      body.requestedDisclosureClass = opts.requestedDisclosureClass;
    }

    const data = await this.post<VerifyAttestationResponse>(
      "/api/v1/attest/verify",
      body,
    );
    if (!data || typeof data !== "object" || !("verdict" in data)) {
      throw new RootHeraldApiError(
        "verify response missing `verdict`",
        "INVALID_RESPONSE",
        200,
      );
    }
    const result = normalizeVerdictDates(data.verdict as AttestResult);
    // Surface the response top-level fields the server sends alongside the
    // verdict — customers gate capabilities on `assuranceClaimsMet` and drive
    // the enroll-on-miss flow on `enrollmentRequired`. These live at the
    // response root, NOT inside `verdict`.
    if (Array.isArray(data.assuranceClaimsMet)) {
      result.assuranceClaimsMet = data.assuranceClaimsMet;
    }
    if (typeof data.enrollmentRequired === "boolean") {
      result.enrollmentRequired = data.enrollmentRequired;
    }
    return result;
  }

  /**
   * Handle the POST the RootHerald companion app makes to your registered mobile
   * `appVerifyUrl` (the mobile-bridge flow, for browser-only customers). The app
   * sends `{ challengeId, evidence: { iosAttestation: {...} } }`; this validates
   * that shape and brokers the metered `verify()` with your `rh_sk_` — exactly
   * like desktop. Store the returned verdict keyed by `challengeId` so the page
   * that reopens can poll it.
   *
   * ```ts
   * // POST /api/rootherald/app-verify  (your registered appVerifyUrl)
   * const result = await rh.verifyMobileEvidence(req.body);
   * await store.put(req.body.challengeId, result);
   * res.json({ ok: true });
   * ```
   */
  async verifyMobileEvidence(
    body: MobileAppVerifyRequest,
    opts?: Pick<AttestOptions, "policy">,
  ): Promise<AttestResult> {
    if (!body || typeof body.challengeId !== "string" || !body.challengeId) {
      throw new RootHeraldError(
        "verifyMobileEvidence() requires a body with `challengeId`",
        "MISSING_CHALLENGE_ID",
      );
    }
    if (
      !body.evidence?.iosAttestation ||
      typeof body.evidence.iosAttestation.attestationObject !== "string" ||
      typeof body.evidence.iosAttestation.keyId !== "string"
    ) {
      throw new InvalidEvidenceError(
        "verifyMobileEvidence() body is missing evidence.iosAttestation.{attestationObject,keyId}",
      );
    }
    const attestOpts: AttestOptions = { challengeId: body.challengeId };
    if (opts?.policy !== undefined) attestOpts.policy = opts.policy;
    return this.verify(body.evidence, attestOpts);
  }

  /**
   * Enroll relay — leg 1. `POST /api/v1/attest/enroll`.
   *
   * Relays the client's `EnrollBegin()` blob to RootHerald with the `rh_sk_`
   * secret and returns the challenge to hand back to the client's
   * `EnrollComplete`, whose result goes to {@link relayActivate}.
   *
   * `deviceId` is this tenant's alias for the device, not a global identifier.
   *
   * The client never holds the `rh_sk_` key and never talks to RootHerald; this
   * backend helper is the only thing that does.
   */
  async relayEnroll(enrollRequestBlob: EnrollRequestBlob): Promise<RelayEnrollResult> {
    if (
      !enrollRequestBlob ||
      typeof enrollRequestBlob.ekPublicKey !== "string" ||
      typeof enrollRequestBlob.akPublicArea !== "string"
    ) {
      throw new RootHeraldError(
        "relayEnroll() requires an enroll request blob with `ekPublicKey` and `akPublicArea`",
        "INVALID_ENROLL_BLOB",
      );
    }

    const res = await this.rawPost("/api/v1/attest/enroll", enrollRequestBlob);

    if (!res.ok) {
      throw await toApiError(res);
    }

    const data = await parseJson<EnrollActivationChallenge>(res);
    if (
      !data ||
      typeof data.deviceId !== "string" ||
      typeof data.credentialBlob !== "string" ||
      typeof data.encryptedSecret !== "string"
    ) {
      throw new RootHeraldApiError(
        "enroll response missing deviceId/credentialBlob/encryptedSecret",
        "INVALID_RESPONSE",
        res.status,
      );
    }
    return { deviceId: data.deviceId, challenge: data };
  }

  /**
   * Enroll relay — leg 2. `POST /api/v1/attest/activate`.
   *
   * Relays the client's `EnrollComplete()` blob (the decrypted credential
   * secret) to RootHerald, completing the EK→AK credential-activation handshake.
   * Call this only when {@link relayEnroll} returned `alreadyEnrolled: false`.
   *
   * Returns the terminal `{ deviceId, status?, enrolledAt? }` body; `deviceId`
   * is the load-bearing field the backend maps to its user.
   */
  async relayActivate(
    activationResponse: EnrollActivationResponse,
  ): Promise<RelayActivateResponse> {
    if (
      !activationResponse ||
      typeof activationResponse.deviceId !== "string" ||
      !activationResponse.deviceId ||
      typeof activationResponse.decryptedSecret !== "string"
    ) {
      throw new RootHeraldError(
        "relayActivate() requires an activation response with `deviceId` and `decryptedSecret`",
        "INVALID_ACTIVATION_BLOB",
      );
    }

    const data = await this.post<RelayActivateResponse>(
      "/api/v1/attest/activate",
      activationResponse,
    );
    if (!data || typeof data.deviceId !== "string") {
      throw new RootHeraldApiError(
        "activate response missing `deviceId`",
        "INVALID_RESPONSE",
        200,
      );
    }
    const result: RelayActivateResponse = { deviceId: data.deviceId };
    if (typeof data.status === "string") result.status = data.status;
    if (typeof data.enrolledAt === "string") result.enrolledAt = data.enrolledAt;
    return result;
  }

  /**
   * Issues an authenticated JSON POST, returning the raw {@link Response}. Maps
   * only transport failures to a `NETWORK_ERROR`; status interpretation is left
   * to the caller (used by relay legs that must inspect specific statuses such
   * as the enroll `409`).
   */
  private async rawPost(path: string, body: unknown): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new RootHeraldError(`network request failed: ${msg}`, "NETWORK_ERROR", err);
    }
  }

  /** Issues an authenticated JSON POST and maps non-2xx responses to typed errors. */
  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await this.rawPost(path, body);
    if (!res.ok) {
      throw await toApiError(res);
    }
    return parseJson<T>(res);
  }
}

/** Parses a JSON response body, mapping a parse failure to a typed API error. */
async function parseJson<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new RootHeraldApiError(
      `failed to parse JSON response: ${msg}`,
      "INVALID_RESPONSE",
      res.status,
      undefined,
      err,
    );
  }
}

/**
 * Reads a response body as a plain object, unknown-safely. Returns `{}` for a
 * non-object or unparseable body so callers can probe individual fields without
 * throwing on an empty/odd body.
 */
async function readJsonObject(res: Response): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await res.json();
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return {};
}

/**
 * Robustly coerce a server-supplied timestamp into a `Date`.
 *
 * The RootHerald API serializes .NET `DateTimeOffset` values as ISO-8601
 * STRINGS (e.g. `"2026-06-28T12:34:56Z"`), not as JS `Date` objects or epoch
 * numbers. A naive `value as Date` cast leaves a string at runtime, so any
 * consumer calling `.getTime()` on `verdict.expiresAt` throws
 * `getTime is not a function`. This accepts a string (ISO-8601), a number
 * (epoch milliseconds), or an existing `Date`, and always returns a `Date`.
 * Epoch SECONDS from the JWT path are handled in verify.ts (`* 1000`); the
 * JSON body uses ISO strings, which `new Date(string)` parses directly.
 */
function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    return new Date(value);
  }
  // Undefined/null/object: produce an Invalid Date rather than throwing, so a
  // malformed timestamp degrades gracefully instead of crashing `attest()`.
  return new Date(NaN);
}

/**
 * Normalize the date-typed fields on a verdict parsed from the JSON `/verify`
 * response. The API sends these as ISO-8601 strings; the SDK's typed surface
 * promises `Date` objects, so we convert in place.
 */
function normalizeVerdictDates(result: AttestResult): AttestResult {
  result.authTime = toDate(result.authTime as unknown);
  result.expiresAt = toDate(result.expiresAt as unknown);
  if (result.device) {
    result.device.attestedAt = toDate(result.device.attestedAt as unknown);
  }
  return result;
}

/** Parses an error response body, unknown-safely, and returns its `error`/`message`. */
async function readErrorBody(res: Response): Promise<{ errorCode?: string; message?: string }> {
  try {
    const parsed: unknown = await res.json();
    if (parsed && typeof parsed === "object") {
      const rec = parsed as Record<string, unknown>;
      const errorCode = typeof rec.error === "string" ? rec.error : undefined;
      const message =
        typeof rec.message === "string"
          ? rec.message
          : typeof rec.error_description === "string"
            ? rec.error_description
            : undefined;
      return { errorCode, message };
    }
  } catch {
    // Non-JSON or empty body — fall through to status-based mapping.
  }
  return {};
}

/** Maps a non-2xx response to the matching typed error. */
async function toApiError(res: Response): Promise<RootHeraldError> {
  const { errorCode, message } = await readErrorBody(res);
  switch (res.status) {
    case 401:
      return new InvalidSecretKeyError(message, errorCode);
    case 422:
      return new UnknownPolicyError(message, errorCode);
    case 409:
      return new ChallengeError(message, errorCode);
    case 400:
      return new InvalidEvidenceError(message, errorCode);
    case 429:
      return new QuotaExceededError(message, errorCode);
    default:
      return new RootHeraldApiError(
        message ?? `RootHerald API error (${res.status})`,
        "API_ERROR",
        res.status,
        errorCode,
      );
  }
}
