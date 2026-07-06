/**
 * RootHerald server-side client — the Background-Check (server -> server) path.
 *
 * The customer's dumb client collects an opaque evidence blob (no keys, no
 * RootHerald contact) and hands it to the customer's own server. The server
 * uses this client, authenticated with its `rh_sk_` secret key, to:
 *   1. mint a relay-friendly nonce  (`createChallenge`)
 *   2. submit the evidence for appraisal and get a verdict  (`attest`)
 *
 * This is ADDITIVE. The offline/badge-tier path — `verifyAttestationToken`
 * and `requireAttestation` — is unchanged. The optional `token` returned by
 * `attest({ returnToken: true })` is itself verifiable with
 * `verifyAttestationToken`.
 *
 * Network calls use the built-in global `fetch` (Node 18+) — no HTTP library.
 */

import type {
  AttestationVerdict,
  ChallengeResponse,
  EvidenceBlob,
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
const DEFAULT_BASE_URL = "https://api.rootherald.io";

/** Secret keys are `rh_sk_`-prefixed; publishable keys (`rh_pk_`) must never be used here. */
const SECRET_KEY_PREFIX = "rh_sk_";

/** Options for constructing a {@link RootHerald} server client. */
export interface RootHeraldClientOptions {
  /**
   * Your RootHerald **secret** key (`rh_sk_…`). Required. A publishable key
   * (`rh_pk_…`) is rejected — it must never be used server-side.
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

/** Options for {@link RootHerald.createChallenge}. */
export interface CreateChallengeOptions {
  /** Optional advisory hint identifying the device. */
  deviceHint?: string;
}

/** Options for {@link RootHerald.attest}. */
export interface AttestOptions {
  /** The single-use challenge id from {@link RootHerald.createChallenge}. */
  challengeId: string;
  /**
   * Caller-named policy: a tenant-owned policy id/name or a
   * `rootherald:builtin:*` name. Unknown/foreign names fail closed (422).
   */
  policy?: string;
  /** Opt-in signed EAT (JWT) output. Default false. */
  returnToken?: boolean;
}

/**
 * Verdict plus the response top-level fields, as returned by
 * {@link RootHerald.verify}. `assuranceClaimsMet` and `enrollmentRequired` are
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
  /** The optional signed EAT (JWT), present only when `returnToken: true`. */
  token?: string;
};

/**
 * Server-side RootHerald client for the Background-Check flow.
 *
 * @example
 * ```ts
 * const rh = new RootHerald({ secretKey: process.env.RH_SECRET_KEY! });
 * const { challengeId, nonce } = await rh.createChallenge();
 * // relay `nonce` to the client; client quotes over it and returns `evidence`
 * const verdict = await rh.attest(evidence, { challengeId, policy: "default" });
 * if (verdict.device.verdict === "pass") { ... }
 * ```
 */
export class RootHerald {
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
        "RootHerald `secretKey` must be a secret key (rh_sk_…); a publishable key must never be used server-side",
        "INVALID_SECRET_KEY_FORMAT",
      );
    }
    this.secretKey = key;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");

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
   * `POST /api/v1/attestations/challenge` — mints a fresh, relay-friendly nonce
   * (freshness / anti-replay). Relay `nonce` to the client; the client quotes
   * over it, then submit the resulting evidence with {@link verify} using the
   * returned `challengeId`.
   */
  async issueChallenge(opts?: CreateChallengeOptions): Promise<ChallengeResponse> {
    const body: { deviceHint?: string } = {};
    if (opts?.deviceHint !== undefined) body.deviceHint = opts.deviceHint;

    const data = await this.post<ChallengeResponse>(
      "/api/v1/attestations/challenge",
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
   * `POST /api/v1/attestations/verify` — submits the opaque evidence blob for
   * server-side appraisal and returns the verdict (plus an optional signed EAT
   * when `returnToken: true`). The verdict is computed by RootHerald and
   * returned here, to the customer's backend — it NEVER travels through the
   * client, which holds no key and gets no verdict.
   *
   * An un-enrolled / failing device is NOT an error — it returns a normal
   * verdict with a `fail` (or `warn`) result. Only protocol/auth/quota problems
   * raise a typed {@link RootHeraldApiError}.
   *
   * The optional `token` is itself verifiable with `verifyAttestationToken`.
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
    if (opts.returnToken !== undefined) body.returnToken = opts.returnToken;

    const data = await this.post<VerifyAttestationResponse>(
      "/api/v1/attestations/verify",
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
    if (typeof data.token === "string") result.token = data.token;
    return result;
  }

  /**
   * Enroll relay — leg 1. `POST /api/v1/devices/enroll`.
   *
   * Relays the client's `EnrollBegin()` blob to RootHerald with the `rh_sk_`
   * secret and resolves the asymmetric response (see {@link RelayEnrollResult}):
   *
   *   - **`201`** — a fresh enroll; returns `{ deviceId, challenge, alreadyEnrolled: false }`.
   *     Hand `challenge` to the client's `EnrollComplete`, then relay the result
   *     to {@link relayActivate}.
   *   - **`409`** — the device is already enrolled; returns
   *     `{ deviceId, alreadyEnrolled: true }` (no challenge). SKIP the activate
   *     leg — the device is already bound; just use `deviceId`.
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

    const res = await this.rawPost("/api/v1/devices/enroll", enrollRequestBlob);

    // 409 = already enrolled: the body carries only `deviceId`. Resolve it and
    // signal "skip activate" instead of treating it as an error.
    if (res.status === 409) {
      const body = await readJsonObject(res);
      const deviceId = typeof body.deviceId === "string" ? body.deviceId : undefined;
      if (!deviceId) {
        throw new RootHeraldApiError(
          "already-enrolled (409) response missing `deviceId`",
          "INVALID_RESPONSE",
          409,
        );
      }
      return { deviceId, alreadyEnrolled: true };
    }

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
    return { deviceId: data.deviceId, challenge: data, alreadyEnrolled: false };
  }

  /**
   * Enroll relay — leg 2. `POST /api/v1/devices/activate`.
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
      "/api/v1/devices/activate",
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
   * @deprecated Renamed to {@link issueChallenge} for the ABI 2.0 backend
   * contract. Retained as a thin alias for backwards compatibility.
   */
  async createChallenge(opts?: CreateChallengeOptions): Promise<ChallengeResponse> {
    return this.issueChallenge(opts);
  }

  /**
   * @deprecated Renamed to {@link verify} for the ABI 2.0 backend contract.
   * Retained as a thin alias for backwards compatibility.
   */
  async attest(evidence: EvidenceBlob, opts: AttestOptions): Promise<AttestResult> {
    return this.verify(evidence, opts);
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
