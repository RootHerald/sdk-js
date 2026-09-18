/**
 * RootHerald server-side client — the Background-Check (server -> server) path.
 *
 * The customer's dumb client collects an opaque evidence blob (no keys, no
 * RootHerald contact) and hands it to the customer's own server. The server
 * uses this client, authenticated with its `rh_sk_` secret key, to:
 *   1. mint a challenge that carries the ask  (`issueChallenge`)
 *   2. submit the evidence for appraisal and get a verdict  (`verify`)
 *
 * Network calls use the built-in global `fetch` (Node 18+) — no HTTP library.
 */

import type {
  Ask,
  AttestationVerdict,
  CertifiedKey,
  ChallengeRequest,
  ChallengeResponse,
  EvidenceBlob,
  MobileAppEnrollRequest,
  MobileAppVerifyRequest,
  RequestedDisclosureClass,
  Verdict,
  VerifyAttestationRequest,
  VerifyAttestationResponse,
} from "@rootherald/contracts";
import { RootHeraldError } from "@rootherald/contracts";
import {
  ActivationRefusedError,
  AdmissionRefusedError,
  ChallengeError,
  InvalidEvidenceError,
  InvalidSecretKeyError,
  QuotaExceededError,
  RateLimitedError,
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

/** Default per-request HTTP timeout, the same in every RootHerald server SDK. */
const DEFAULT_TIMEOUT_MS = 30_000;

/** The verdict values the server emits at `verdict.device.verdict`. */
const VERDICTS: readonly Verdict[] = ["pass", "warn", "fail"];

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

/** Options for constructing a {@link RootHeraldClient}. */
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
  /**
   * Per-request HTTP timeout in milliseconds. Default: 30 000. A request that
   * exceeds it fails with a `NETWORK_ERROR`.
   */
  timeoutMs?: number;
}

/** Options for {@link RootHeraldClient.issueChallenge}. */
export interface IssueChallengeOptions {
  /** Optional advisory hint identifying the device. */
  deviceHint?: string;
  /**
   * What the device is asked to prove. Omitted => `["identity", "posture"]`.
   * Fixed on the challenge; `verify` appraises against it.
   */
  ask?: Ask[];
  /**
   * What the certified key will be used for. Read only when `ask` contains
   * `"key"`. `"sign"` is the only purpose today.
   */
  keyPurpose?: "sign";
}

/** Options for {@link RootHeraldClient.verify}. */
export interface AttestOptions {
  /** The challenge handle from {@link RootHeraldClient.issueChallenge}. */
  nonce: string;
  /**
   * Optional disclosure ceiling to request for this appraisal
   * (`"verdict" | "pseudonymous" | "derived" | "full"`). Omitted => the
   * resolved policy's default disclosure applies.
   */
  requestedDisclosureClass?: RequestedDisclosureClass;
}

/**
 * The certified signing key as {@link RootHeraldClient.verify} returns it:
 * the wire {@link CertifiedKey} with `certifiedAt` parsed to a `Date`, the
 * same treatment the verdict's own timestamps get.
 */
export type AttestResultKey = Omit<CertifiedKey, "certifiedAt"> & {
  /** When the key was certified. */
  certifiedAt: Date;
};

/**
 * Verdict plus the response top-level fields, as returned by
 * {@link RootHeraldClient.verify}. `assuranceClaimsMet`, `enrollmentRequired`
 * and `key` are surfaced from the response root so callers can gate
 * capabilities, drive the enroll-on-miss flow, and keep the certified key
 * (they are NOT part of the nested verdict).
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
  /**
   * The TPM-resident signing key the appraisal certified. Present only when
   * the challenge asked for `"key"` and the verdict passed. Verify later
   * signatures from it with {@link verifyKeySignature}.
   */
  key?: AttestResultKey;
};

/**
 * Server-side RootHerald client for the Background-Check flow.
 *
 * @example
 * ```ts
 * const rh = new RootHeraldClient({ secretKey: process.env.RH_SECRET_KEY! });
 * const { nonce, challenge } = await rh.issueChallenge({ ask: ["identity"] });
 * // relay `challenge` to the client; it responds with `evidence`
 * const result = await rh.verify(evidence, { nonce });
 * if (result.device.verdict === "pass") { ... }
 * ```
 */
export class RootHeraldClient {
  private readonly secretKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

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
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

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
   * `POST /api/v1/attest/challenge` — mints a single-use challenge that
   * carries the ask. Relay the `challenge` string to the client verbatim; it
   * responds with an evidence blob, which you submit with {@link verify} under
   * the returned `nonce`.
   */
  async issueChallenge(opts?: IssueChallengeOptions): Promise<ChallengeResponse> {
    const body: ChallengeRequest = {};
    if (opts?.deviceHint !== undefined) body.deviceHint = opts.deviceHint;
    if (opts?.ask !== undefined) body.ask = opts.ask;
    if (opts?.keyPurpose !== undefined) body.keyPurpose = opts.keyPurpose;

    const data = await this.post<ChallengeResponse>(
      "/api/v1/attest/challenge",
      body,
    );
    if (
      typeof data?.nonce !== "string" ||
      typeof data?.expiresAt !== "string" ||
      typeof data?.challenge !== "string"
    ) {
      throw new RootHeraldApiError(
        "challenge response missing nonce/expiresAt/challenge",
        "INVALID_RESPONSE",
        200,
      );
    }
    return {
      nonce: data.nonce,
      expiresAt: data.expiresAt,
      challenge: data.challenge,
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
   * @param evidence  Opaque blob from the client; passed through verbatim.
   */
  async verify(evidence: EvidenceBlob, opts: AttestOptions): Promise<AttestResult> {
    if (!opts || typeof opts.nonce !== "string" || !opts.nonce) {
      throw new RootHeraldError(
        "verify() requires `nonce` (from issueChallenge)",
        "MISSING_NONCE",
      );
    }

    const body: VerifyAttestationRequest = {
      nonce: opts.nonce,
      evidence,
    };
    if (opts.requestedDisclosureClass !== undefined) {
      body.requestedDisclosureClass = opts.requestedDisclosureClass;
    }

    const data = await this.post<VerifyAttestationResponse>(
      "/api/v1/attest/verify",
      body,
    );
    if (!data || typeof data !== "object" || !isObject(data.verdict)) {
      throw new RootHeraldApiError(
        "verify response missing `verdict`",
        "INVALID_RESPONSE",
        200,
      );
    }
    const deviceVerdict = isObject(data.verdict.device) ? data.verdict.device.verdict : undefined;
    if (!VERDICTS.includes(deviceVerdict as Verdict)) {
      throw new RootHeraldApiError(
        `verify response \`verdict.device.verdict\` is not one of ${VERDICTS.join("/")} (got ${JSON.stringify(deviceVerdict)})`,
        "INVALID_RESPONSE",
        200,
      );
    }
    const result = normalizeVerdictDates(data.verdict as AttestResult);
    // Surface the response top-level fields the server sends alongside the
    // verdict. These live at the response root, NOT inside `verdict`; a
    // same-named field inside the verdict is never read, and is removed so it
    // cannot pose as the root one.
    if (Array.isArray(data.assuranceClaimsMet)) {
      result.assuranceClaimsMet = data.assuranceClaimsMet;
    } else {
      delete result.assuranceClaimsMet;
    }
    if (typeof data.enrollmentRequired === "boolean") {
      result.enrollmentRequired = data.enrollmentRequired;
    } else {
      delete result.enrollmentRequired;
    }
    const key = toCertifiedKey(data.key);
    if (key) {
      result.key = key;
    } else {
      delete result.key;
    }
    return result;
  }

  /**
   * Handle the POST the RootHerald bridge makes to your registered mobile
   * `appVerifyUrl` (the mobile-bridge flow, for browser-only customers). The
   * body is `{ nonce, evidence: { iosAttestation: { assertion, keyId } } }`;
   * this validates that shape and brokers the metered `verify()` with your
   * `rh_sk_` — exactly like desktop. Store the returned verdict keyed by
   * `nonce`; the page the app reopens receives it as `?nonce=` and polls for
   * the result.
   *
   * ```ts
   * // POST /api/rootherald/app-verify  (your registered appVerifyUrl)
   * const result = await rh.verifyMobileEvidence(req.body);
   * await store.put(req.body.nonce, result);
   * res.json({ ok: true });
   * ```
   */
  async verifyMobileEvidence(body: MobileAppVerifyRequest): Promise<AttestResult> {
    if (!body || typeof body.nonce !== "string" || !body.nonce) {
      throw new RootHeraldError(
        "verifyMobileEvidence() requires a body with `nonce`",
        "MISSING_NONCE",
      );
    }
    if (
      !body.evidence?.iosAttestation ||
      typeof body.evidence.iosAttestation.assertion !== "string" ||
      typeof body.evidence.iosAttestation.keyId !== "string"
    ) {
      throw new InvalidEvidenceError(
        "verifyMobileEvidence() body is missing evidence.iosAttestation.{assertion,keyId}",
      );
    }
    return this.verify(body.evidence, { nonce: body.nonce });
  }

  /**
   * Handle the POST the RootHerald bridge makes to your registered mobile
   * enroll URL. The body is `{ nonce, enrollment }`, where `enrollment` is the
   * app's iOS enroll blob and carries the same nonce inside it; the two must
   * agree, or the body was not assembled by the bridge from one challenge.
   * Relays `enrollment` with {@link relayEnroll}; an iOS enrollment is one leg,
   * so the returned `challenge` is `{}` and there is nothing to activate.
   */
  async relayMobileEnrollment(body: MobileAppEnrollRequest): Promise<RelayEnrollResult> {
    if (!body || typeof body.nonce !== "string" || !body.nonce) {
      throw new RootHeraldError(
        "relayMobileEnrollment() requires a body with `nonce`",
        "MISSING_NONCE",
      );
    }
    if (!isWellFormedEnrollBlob(body.enrollment) || body.enrollment.platform !== "ios") {
      throw new RootHeraldError(
        "relayMobileEnrollment() requires `enrollment` to be an iOS enroll blob with `iosKeyId`, `iosAttestationObject` and `nonce`",
        "INVALID_ENROLL_BLOB",
      );
    }
    if (body.enrollment.nonce !== body.nonce) {
      throw new RootHeraldError(
        "relayMobileEnrollment() body `nonce` does not match `enrollment.nonce`",
        "NONCE_MISMATCH",
      );
    }
    return this.relayEnroll(body.enrollment);
  }

  /**
   * Enroll relay — leg 1. `POST /api/v1/attest/enroll`.
   *
   * Relays the client's `EnrollBegin()` blob to RootHerald with the `rh_sk_`
   * secret, verbatim, and returns the 201 body to hand back to the client's
   * `EnrollComplete`, whose result goes to {@link relayActivate}. An iOS blob
   * has nothing to activate; its 201 is `{}`.
   *
   * Every enroll returns a challenge, including for a device already known:
   * re-enrollment is how a device rotates its attestation key. The device's
   * alias is returned by {@link relayActivate}, not here.
   *
   * The client never holds the `rh_sk_` key and never talks to RootHerald; this
   * backend helper is the only thing that does.
   */
  async relayEnroll(enrollRequestBlob: EnrollRequestBlob): Promise<RelayEnrollResult> {
    if (!isWellFormedEnrollBlob(enrollRequestBlob)) {
      throw new RootHeraldError(
        "relayEnroll() requires an enroll request blob with `ekPublicKey` and `akPublicArea`, or an iOS blob with `iosKeyId`, `iosAttestationObject` and `nonce`",
        "INVALID_ENROLL_BLOB",
      );
    }

    const data = await this.post<Record<string, unknown>>(
      "/api/v1/attest/enroll",
      enrollRequestBlob,
    );
    if (!data || typeof data !== "object") {
      throw new RootHeraldApiError("enroll response is not an object", "INVALID_RESPONSE", 201);
    }
    if (enrollRequestBlob.platform === "ios" && !("enrollmentId" in data)) {
      return { challenge: {} };
    }
    if (
      typeof data.enrollmentId !== "string" ||
      !(
        (typeof data.credentialBlob === "string" && typeof data.encryptedSecret === "string") ||
        typeof data.challengeNonce === "string"
      )
    ) {
      throw new RootHeraldApiError(
        "enroll response missing enrollmentId with credentialBlob/encryptedSecret or challengeNonce",
        "INVALID_RESPONSE",
        201,
      );
    }
    return { challenge: data as unknown as EnrollActivationChallenge };
  }

  /**
   * Enroll relay — leg 2. `POST /api/v1/attest/activate`.
   *
   * Relays the client's `EnrollComplete()` blob (the released credential
   * secret, or the enclave signature) to RootHerald, completing the
   * credential-activation handshake.
   *
   * Returns the terminal `{ deviceId, status?, enrolledAt? }` body; `deviceId`
   * is this tenant's alias for the device, the field the backend maps to its
   * user. It stays on the backend and is never relayed to the device.
   */
  async relayActivate(
    activationResponse: EnrollActivationResponse,
  ): Promise<RelayActivateResponse> {
    if (
      !activationResponse ||
      typeof activationResponse.enrollmentId !== "string" ||
      !activationResponse.enrollmentId ||
      !(
        typeof activationResponse.decryptedSecret === "string" ||
        typeof activationResponse.signature === "string"
      )
    ) {
      throw new RootHeraldError(
        "relayActivate() requires an activation response with `enrollmentId` and `decryptedSecret` or `signature`",
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

  /** Issues an authenticated JSON POST and maps non-2xx responses to typed errors. */
  private async post<T>(path: string, body: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new RootHeraldError(`network request failed: ${msg}`, "NETWORK_ERROR", err);
    }
    if (!res.ok) {
      throw await toApiError(res);
    }
    return parseJson<T>(res);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The per-platform enroll body has the fields the server binds for that platform. */
function isWellFormedEnrollBlob(blob: EnrollRequestBlob): boolean {
  if (!blob || typeof blob !== "object") return false;
  if (blob.platform === "ios") {
    return (
      typeof blob.iosKeyId === "string" &&
      typeof blob.iosAttestationObject === "string" &&
      typeof blob.nonce === "string"
    );
  }
  return typeof blob.ekPublicKey === "string" && typeof blob.akPublicArea === "string";
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
 * Parse a server-supplied timestamp into a valid `Date`, or `undefined`.
 *
 * The RootHerald API serializes .NET `DateTimeOffset` values as ISO-8601
 * STRINGS (e.g. `"2026-06-28T12:34:56Z"`); an epoch-millisecond number or an
 * existing `Date` is accepted too. Anything else, and anything that parses to
 * an Invalid Date, is `undefined` so the caller can refuse it.
 */
function toDate(value: unknown): Date | undefined {
  let date: Date;
  if (value instanceof Date) date = value;
  else if (typeof value === "string" || typeof value === "number") date = new Date(value);
  else return undefined;
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** As {@link toDate}, refusing the response when the field is not a timestamp. */
function requireDate(value: unknown, field: string): Date {
  const date = toDate(value);
  if (!date) {
    throw new RootHeraldApiError(
      `verify response \`${field}\` is not a timestamp (got ${JSON.stringify(value)})`,
      "INVALID_RESPONSE",
      200,
    );
  }
  return date;
}

/**
 * Normalize the date-typed fields on a verdict parsed from the JSON `/verify`
 * response. The API sends these as ISO-8601 strings; the SDK's typed surface
 * promises `Date` objects, so we convert in place.
 */
function normalizeVerdictDates(result: AttestResult): AttestResult {
  result.authTime = requireDate(result.authTime as unknown, "verdict.authTime");
  result.expiresAt = requireDate(result.expiresAt as unknown, "verdict.expiresAt");
  result.device.attestedAt = requireDate(
    result.device.attestedAt as unknown,
    "verdict.device.attestedAt",
  );
  return result;
}

/**
 * Read the response-root `key` block. Anything that is not a well-formed
 * P-256 certified key is dropped rather than surfaced half-parsed: a caller
 * that then calls `verifyKeySignature` with it would silently get `false`.
 */
function toCertifiedKey(value: unknown): AttestResultKey | undefined {
  if (!value || typeof value !== "object") return undefined;
  const k = value as Record<string, unknown>;
  const jwk = k.jwk as Record<string, unknown> | undefined;
  const certifiedAt = toDate(k.certifiedAt);
  if (
    typeof k.keyId !== "string" ||
    !jwk ||
    typeof jwk !== "object" ||
    jwk.kty !== "EC" ||
    jwk.crv !== "P-256" ||
    typeof jwk.x !== "string" ||
    typeof jwk.y !== "string" ||
    k.purpose !== "sign" ||
    !certifiedAt
  ) {
    return undefined;
  }
  const key: AttestResultKey = {
    keyId: k.keyId,
    jwk: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y },
    purpose: "sign",
    certifiedAt,
  };
  if (typeof k.authPolicy === "string") key.authPolicy = k.authPolicy;
  return key;
}

interface ErrorBody {
  errorCode?: string;
  message?: string;
  retryAfterSeconds?: number;
}

/** Parses an error response body, unknown-safely, and returns its `error`/`message`. */
async function readErrorBody(res: Response): Promise<ErrorBody> {
  try {
    const parsed: unknown = await res.json();
    if (parsed && typeof parsed === "object") {
      const rec = parsed as Record<string, unknown>;
      const errorCode = typeof rec.error === "string" ? rec.error : undefined;
      const message =
        typeof rec.message === "string"
          ? rec.message
          : typeof rec.detail === "string"
            ? rec.detail
            : typeof rec.error_description === "string"
              ? rec.error_description
              : undefined;
      const retryAfterSeconds =
        typeof rec.retryAfterSeconds === "number" ? rec.retryAfterSeconds : undefined;
      return { errorCode, message, retryAfterSeconds };
    }
  } catch {
    // Non-JSON or empty body — fall through to status-based mapping.
  }
  return {};
}

/** The `Retry-After` header as whole seconds, when present and numeric. */
function retryAfterHeader(res: Response): number | undefined {
  const raw = res.headers.get("Retry-After");
  if (raw === null) return undefined;
  const seconds = Number.parseInt(raw, 10);
  return Number.isFinite(seconds) ? seconds : undefined;
}

/**
 * Maps a non-2xx response to the matching typed error. Where one status
 * carries two refusals, the body's `error` code (or a header) tells them
 * apart; a code no class covers stays a generic {@link RootHeraldApiError}
 * with the code preserved.
 */
async function toApiError(res: Response): Promise<RootHeraldError> {
  const { errorCode, message, retryAfterSeconds } = await readErrorBody(res);
  switch (res.status) {
    case 401:
      return errorCode === "activation_refused"
        ? new ActivationRefusedError(message, errorCode)
        : new InvalidSecretKeyError(message, errorCode);
    case 422:
      switch (errorCode) {
        case "admission_refused":
          return new AdmissionRefusedError(message, errorCode);
        case "unknown_policy":
        case undefined:
          return new UnknownPolicyError(message, errorCode);
        default:
          break;
      }
      break;
    case 409:
      return new ChallengeError(message, errorCode);
    case 400:
      return new InvalidEvidenceError(message, errorCode);
    case 429:
      return errorCode === "quota_exceeded" || res.headers.has("X-RootHerald-Quota")
        ? new QuotaExceededError(message, errorCode)
        : new RateLimitedError(message, errorCode, retryAfterHeader(res) ?? retryAfterSeconds);
    default:
      break;
  }
  return new RootHeraldApiError(
    message ?? `RootHerald API error (${res.status})`,
    "API_ERROR",
    res.status,
    errorCode,
  );
}
