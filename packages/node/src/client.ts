/**
 * RootHerald server-side client — the Background-Check (server -> server) path.
 *
 * The customer's client does local TPM work and hands the customer's own
 * server opaque blobs (no keys, no RootHerald contact). The server uses this
 * client, authenticated with its `rh_sk_` secret key, to drive three
 * ceremonies of two legs each:
 *
 *   enroll     relayEnroll / relayActivate         the installation's AK is bound to its EK
 *   mint a key issueKeyChallenge / certifyKey      the AK certifies a new sign or decrypt key
 *   attest     issueChallenge / verify              the AK quotes what the challenge asked
 *
 * Network calls use the built-in global `fetch` (Node 18+) — no HTTP library.
 */

import type {
  Ask,
  AttestationVerdict,
  CertifiedKey,
  CertifiedKeyJwk,
  CertifyKeyRequest,
  ChallengeRequest,
  ChallengeResponse,
  EvidenceBlob,
  ExpectedBinding,
  KeyAlg,
  KeyCertification,
  KeyChallengeRequest,
  KeyChallengeResponse,
  KeyFormat,
  KeyPurpose,
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
  InvalidAskError,
  InvalidEvidenceError,
  InvalidSecretKeyError,
  QuotaExceededError,
  RateLimitedError,
  RootHeraldApiError,
  UnknownPolicyError,
  type RefusingBudget,
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

const KEY_PURPOSES: readonly KeyPurpose[] = ["sign", "decrypt"];
const KEY_FORMATS: readonly KeyFormat[] = ["jwe", "apple-ecies"];
const EC_ALGS: readonly KeyAlg[] = ["ES256", "ECDH-ES"];
const RSA_ALGS: readonly KeyAlg[] = ["RS256", "RSA-OAEP-256"];

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
  /**
   * What the device is asked to prove. Omitted => `["identity", "posture"]`.
   * Fixed on the challenge; `verify` appraises against it.
   */
  ask?: Ask[];
  /**
   * The `keyId` of a key you certified. Only the installation holding that
   * key can pass; any other answers a failing verdict with reason
   * `expected_device_mismatch`. An unknown id is `422 expected_unknown`.
   */
  expectedKey?: string;
  /**
   * Aliases (`verdict.device.ueid`) you enrolled. Only one of them can pass;
   * any other device answers a failing verdict with reason
   * `expected_device_mismatch`. An unknown alias is `422 expected_unknown`.
   */
  expectedDevices?: string[];
}

/** Options for {@link RootHeraldClient.verify}. */
export interface AttestOptions {
  /** The challenge handle from {@link RootHeraldClient.issueChallenge}. */
  nonce: string;
  /**
   * Optional disclosure ceiling to request for this appraisal
   * (`"verdict" | "pseudonymous" | "derived" | "full"`). Omitted => the API
   * key's ceiling applies, which defaults to `pseudonymous`.
   */
  requestedDisclosureClass?: RequestedDisclosureClass;
  /**
   * The `expectedKey` the challenge was issued with. `verify` refuses a
   * verdict that does not echo it (`EXPECTED_NOT_ENFORCED`), so a server that
   * ignored the binding cannot pass silently.
   */
  expectedKey?: string;
  /**
   * The `expectedDevices` the challenge was issued with. `verify` refuses a
   * verdict that does not echo them, and a passing verdict naming a device
   * outside them (`EXPECTED_NOT_ENFORCED`).
   */
  expectedDevices?: string[];
}

/** Options for {@link RootHeraldClient.issueKeyChallenge}. */
export interface IssueKeyChallengeOptions {
  /** What the key is for. `"decrypt"` is refused by the server before wire 8.1. */
  purpose: KeyPurpose;
  /**
   * Aliases (`verdict.device.ueid`) you enrolled. The certify leg is refused
   * unless one of them certified the key. Pass the alias of the device that
   * just passed an attest challenge, so the key provably comes from it.
   */
  expectedDevices?: string[];
}

/**
 * Verdict plus the response top-level fields, as returned by
 * {@link RootHeraldClient.verify}. `assuranceClaimsMet` and
 * `enrollmentRequired` are surfaced from the response root so callers can gate
 * capabilities and drive the enroll-on-miss flow (they are NOT part of the
 * nested verdict).
 */
export type AttestResult = AttestationVerdict & {
  /**
   * The assurance claims the device satisfied for the resolved policy. Absent
   * when the server returns none.
   */
  assuranceClaimsMet?: string[];
  /**
   * `true` when the quote did not resolve to a live installation of yours.
   * The client should enroll; do not trust the verdict.
   */
  enrollmentRequired?: boolean;
};

/**
 * The certified key as {@link RootHeraldClient.certifyKey} returns it: the
 * wire {@link CertifiedKey} with `certifiedAt` parsed to a `Date`, the same
 * treatment the verdict's own timestamps get.
 */
export type CertifiedKeyResult = Omit<CertifiedKey, "certifiedAt"> & {
  /** When the key was certified. */
  certifiedAt: Date;
};

/**
 * Server-side RootHerald client for the Background-Check flow.
 *
 * @example
 * ```ts
 * const rh = new RootHeraldClient({ secretKey: process.env.RH_SECRET_KEY! });
 * const { nonce, challenge } = await rh.issueChallenge({ ask: ["identity"] });
 * // relay `challenge` to the client; it answers with `evidence`
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
   * answers with an evidence blob, which you submit with {@link verify} under
   * the returned `nonce`.
   */
  async issueChallenge(opts?: IssueChallengeOptions): Promise<ChallengeResponse> {
    const body: ChallengeRequest = {};
    if (opts?.ask !== undefined) body.ask = opts.ask;
    if (opts?.expectedKey !== undefined) {
      body.expectedKey = requireNonEmptyString(opts.expectedKey, "expectedKey");
    }
    if (opts?.expectedDevices !== undefined) {
      body.expectedDevices = requireAliasList(opts.expectedDevices, "expectedDevices");
    }

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
   * When the challenge named `expectedKey` or `expectedDevices`, pass the
   * same values here: the verdict must echo them under `expected`, and a
   * response that does not is refused with `EXPECTED_NOT_ENFORCED`.
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
    const expectedKey =
      opts.expectedKey === undefined
        ? undefined
        : requireNonEmptyString(opts.expectedKey, "expectedKey");
    const expectedDevices =
      opts.expectedDevices === undefined
        ? undefined
        : requireAliasList(opts.expectedDevices, "expectedDevices");

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
    delete (result as unknown as Record<string, unknown>).key;

    if (expectedKey !== undefined || expectedDevices !== undefined) {
      requireExpectedEnforced(result, expectedKey, expectedDevices);
    }
    return result;
  }

  /**
   * `POST /api/v1/keys/challenge` — mints a single-use key challenge for a
   * purpose. Relay the `keyChallenge` string to the client verbatim; its
   * `MintKey` answers with a certification, which you submit with
   * {@link certifyKey} under the returned `nonce`.
   *
   * Refused with `422 key_disclosure_too_low` when the API key's disclosure
   * ceiling is below `pseudonymous`: a key whose id could never be returned
   * is never minted.
   */
  async issueKeyChallenge(opts: IssueKeyChallengeOptions): Promise<KeyChallengeResponse> {
    if (!opts || !KEY_PURPOSES.includes(opts.purpose)) {
      throw new RootHeraldError(
        `issueKeyChallenge() requires \`purpose\` to be one of ${KEY_PURPOSES.join("/")}`,
        "INVALID_ARGUMENT",
      );
    }
    const body: KeyChallengeRequest = { purpose: opts.purpose };
    if (opts.expectedDevices !== undefined) {
      body.expectedDevices = requireAliasList(opts.expectedDevices, "expectedDevices");
    }

    const data = await this.post<KeyChallengeResponse>("/api/v1/keys/challenge", body);
    if (
      typeof data?.nonce !== "string" ||
      typeof data?.keyChallenge !== "string" ||
      typeof data?.expiresAt !== "string"
    ) {
      throw new RootHeraldApiError(
        "key challenge response missing nonce/keyChallenge/expiresAt",
        "INVALID_RESPONSE",
        200,
      );
    }
    return {
      nonce: data.nonce,
      keyChallenge: data.keyChallenge,
      expiresAt: data.expiresAt,
    };
  }

  /**
   * `POST /api/v1/keys/certify` — relays the client's `MintKey` output under
   * the key challenge's `nonce` and returns the key RootHerald registered:
   * its `keyId`, public `jwk`, `alg`, and the `deviceId` (alias) of the
   * installation that certified it. Store `keyId` and `jwk` against the
   * alias; later signatures are checked locally with `verifyKeySignature`.
   *
   * The certification is relayed verbatim, whichever platform shape it is.
   * The key is the call's only output, so a malformed one is refused with
   * `INVALID_RESPONSE` rather than returned half-parsed.
   */
  async certifyKey(nonce: string, certification: KeyCertification): Promise<CertifiedKeyResult> {
    if (typeof nonce !== "string" || !nonce) {
      throw new RootHeraldError(
        "certifyKey() requires `nonce` (from issueKeyChallenge)",
        "MISSING_NONCE",
      );
    }
    if (!isWellFormedCertification(certification)) {
      throw new RootHeraldError(
        "certifyKey() requires the client's certification: `{ publicArea, attest, signature }` on a TPM, or the platform form from macOS / iOS",
        "INVALID_CERTIFICATION",
      );
    }
    const body: CertifyKeyRequest = { nonce, certification };
    const data = await this.post<unknown>("/api/v1/keys/certify", body);
    return requireCertifiedKey(data);
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
   * each activation creates a new installation of the device with its own
   * AK blob, which the client keeps. The device's alias is returned by
   * {@link relayActivate}, not here, and does not change across installations.
   *
   * The client never holds the `rh_sk_` key and never talks to RootHerald; this
   * backend helper is the only thing that does.
   */
  async relayEnroll(enrollRequestBlob: EnrollRequestBlob): Promise<RelayEnrollResult> {
    if (!isWellFormedEnrollBlob(enrollRequestBlob)) {
      throw new RootHeraldError(
        "relayEnroll() requires an enroll request blob: `ekPublicKey` with `attestationKey { publicArea, parentPublicArea, qualifiedName }` (windows/linux), `ekPublicKey` with `akPublicArea` (macos), or `iosKeyId`, `iosAttestationObject` and `nonce` (ios)",
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

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) {
    throw new RootHeraldError(`\`${field}\` must be a non-empty string`, "INVALID_ARGUMENT");
  }
  return value;
}

function requireAliasList(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((v) => typeof v !== "string" || !v)
  ) {
    throw new RootHeraldError(
      `\`${field}\` must be a non-empty array of non-empty strings`,
      "INVALID_ARGUMENT",
    );
  }
  return value as string[];
}

/**
 * The 8.0 TPM body nests the AK; macOS stays flat; iOS is its own shape. A
 * flat TPM body is the 7.0 shape and is refused here rather than relayed:
 * the server would answer `wire_version_unsupported` anyway, and refusing
 * locally keeps the message specific.
 */
function isWellFormedEnrollBlob(blob: EnrollRequestBlob): boolean {
  if (!blob || typeof blob !== "object") return false;
  const rec = blob as unknown as Record<string, unknown>;
  switch (blob.platform) {
    case "ios":
      return (
        typeof blob.iosKeyId === "string" &&
        typeof blob.iosAttestationObject === "string" &&
        typeof blob.nonce === "string"
      );
    case "macos":
      return (
        typeof blob.ekPublicKey === "string" &&
        typeof blob.akPublicArea === "string" &&
        !("attestationKey" in rec)
      );
    case "windows":
    case "linux": {
      const ak = rec.attestationKey;
      return (
        typeof blob.ekPublicKey === "string" &&
        isObject(ak) &&
        typeof ak.publicArea === "string" &&
        typeof ak.parentPublicArea === "string" &&
        typeof ak.qualifiedName === "string" &&
        !("akPublicArea" in rec)
      );
    }
    default:
      return false;
  }
}

/**
 * The certification is per platform and relayed verbatim, so only its outer
 * shape is checked: a TPM certification's three base64 strings, or a
 * platform-tagged body from macOS or iOS.
 */
function isWellFormedCertification(value: unknown): value is KeyCertification {
  if (!isObject(value)) return false;
  if (typeof value.platform === "string") return true;
  return (
    typeof value.publicArea === "string" &&
    typeof value.attest === "string" &&
    typeof value.signature === "string"
  );
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
      `response \`${field}\` is not a timestamp (got ${JSON.stringify(value)})`,
      "INVALID_RESPONSE",
      200,
    );
  }
  return date;
}

/**
 * Normalize the date-typed fields on a verdict parsed from the JSON `/verify`
 * response. The API sends these as ISO-8601 strings; the SDK's typed surface
 * promises `Date` objects, so we convert in place. The two disclosure-gated
 * timestamps are converted only when present.
 */
function normalizeVerdictDates(result: AttestResult): AttestResult {
  result.authTime = requireDate(result.authTime as unknown, "verdict.authTime");
  result.expiresAt = requireDate(result.expiresAt as unknown, "verdict.expiresAt");
  result.device.attestedAt = requireDate(
    result.device.attestedAt as unknown,
    "verdict.device.attestedAt",
  );
  if (result.device.identityFirstSeen !== undefined && result.device.identityFirstSeen !== null) {
    result.device.identityFirstSeen = requireDate(
      result.device.identityFirstSeen as unknown,
      "verdict.device.identityFirstSeen",
    );
  }
  if (result.device.bootBaselineAt !== undefined && result.device.bootBaselineAt !== null) {
    result.device.bootBaselineAt = requireDate(
      result.device.bootBaselineAt as unknown,
      "verdict.device.bootBaselineAt",
    );
  }
  return result;
}

/**
 * A verdict is only as bound as the server says it enforced. The API ignores
 * unknown JSON fields, so a server that predates the binding would accept
 * any device and answer a verdict with no `expected` block; comparing the
 * echo with what was asked turns that silence into a refusal.
 */
function requireExpectedEnforced(
  result: AttestResult,
  expectedKey: string | undefined,
  expectedDevices: string[] | undefined,
): void {
  const echoed: ExpectedBinding | undefined = isObject(result.expected)
    ? (result.expected as ExpectedBinding)
    : undefined;
  const refuse = (what: string): never => {
    throw new RootHeraldApiError(
      `verify response did not echo the ${what} the challenge named; the binding was not enforced`,
      "EXPECTED_NOT_ENFORCED",
      200,
    );
  };
  if (expectedKey !== undefined && echoed?.key !== expectedKey) refuse("expectedKey");
  if (expectedDevices !== undefined) {
    // Aliases are GUIDs: the server accepts any spelling and echoes lowercase.
    const asked = expectedDevices.map(normalizeAlias);
    const devices = echoed?.devices;
    if (!Array.isArray(devices) || !sameSet(devices, asked)) refuse("expectedDevices");
    const ueid = result.device.ueid;
    if (result.device.verdict !== "fail" && typeof ueid === "string" && !asked.includes(normalizeAlias(ueid))) {
      refuse("expectedDevices");
    }
  }
}

function normalizeAlias(alias: string): string {
  return alias.trim().toLowerCase();
}

function sameSet(a: readonly unknown[], b: readonly string[]): boolean {
  const seen = new Set(a.filter((v): v is string => typeof v === "string").map(normalizeAlias));
  return seen.size === new Set(b).size && b.every((v) => seen.has(v));
}

/**
 * Read a `/keys/certify` response. The JWK family must match `alg`: an EC
 * key signs ES256 or agrees ECDH-ES, an RSA key signs RS256 or wraps
 * RSA-OAEP-256. Anything else is refused rather than surfaced half-parsed: a
 * caller that then called `verifyKeySignature` with it would silently get
 * `false`.
 */
function requireCertifiedKey(value: unknown): CertifiedKeyResult {
  const refuse = (why: string): never => {
    throw new RootHeraldApiError(`certify response ${why}`, "INVALID_RESPONSE", 200);
  };
  if (!isObject(value)) return refuse("is not an object");
  const k = value;
  if (typeof k.deviceId !== "string" || !k.deviceId) return refuse("missing `deviceId`");
  if (typeof k.keyId !== "string" || !k.keyId) return refuse("missing `keyId`");
  if (!KEY_PURPOSES.includes(k.purpose as KeyPurpose)) {
    return refuse(`\`purpose\` is not one of ${KEY_PURPOSES.join("/")}`);
  }
  if (typeof k.hardwareBound !== "boolean") return refuse("missing `hardwareBound`");
  const certifiedAt = toDate(k.certifiedAt);
  if (!certifiedAt) return refuse("`certifiedAt` is not a timestamp");
  const jwk = readJwk(k.jwk);
  if (!jwk) return refuse("`jwk` is not an EC P-256 or RSA public key");
  const alg = k.alg as KeyAlg;
  const algs = jwk.kty === "EC" ? EC_ALGS : RSA_ALGS;
  if (!algs.includes(alg)) return refuse(`\`alg\` ${JSON.stringify(k.alg)} does not fit a ${jwk.kty} key`);
  if (k.format !== undefined && !KEY_FORMATS.includes(k.format as KeyFormat)) {
    return refuse(`\`format\` is not one of ${KEY_FORMATS.join("/")}`);
  }

  const key: CertifiedKeyResult = {
    deviceId: k.deviceId,
    keyId: k.keyId,
    purpose: k.purpose as KeyPurpose,
    alg,
    jwk,
    hardwareBound: k.hardwareBound,
    certifiedAt,
  };
  if (k.format !== undefined) key.format = k.format as KeyFormat;
  return key;
}

function readJwk(value: unknown): CertifiedKeyJwk | undefined {
  if (!isObject(value)) return undefined;
  if (
    value.kty === "EC" &&
    value.crv === "P-256" &&
    typeof value.x === "string" &&
    typeof value.y === "string"
  ) {
    return { kty: "EC", crv: "P-256", x: value.x, y: value.y };
  }
  if (value.kty === "RSA" && typeof value.n === "string" && typeof value.e === "string") {
    return { kty: "RSA", n: value.n, e: value.e };
  }
  return undefined;
}

interface ErrorBody {
  errorCode?: string;
  message?: string;
  retryAfterSeconds?: number;
  budget?: RefusingBudget;
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
      const budget =
        isObject(rec.budget) && typeof rec.budget.id === "string" && typeof rec.budget.name === "string"
          ? { id: rec.budget.id, name: rec.budget.name }
          : undefined;
      return { errorCode, message, retryAfterSeconds, budget };
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
  const { errorCode, message, retryAfterSeconds, budget } = await readErrorBody(res);
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
      if (errorCode === "key_rotation_conflict") break;
      return new ChallengeError(message, errorCode);
    case 400:
      return errorCode === "invalid_ask" || errorCode === "invalid_purpose"
        ? new InvalidAskError(message, errorCode)
        : new InvalidEvidenceError(message, errorCode);
    case 429:
      return errorCode === "budget_exhausted" || res.headers.has("X-RootHerald-Quota")
        ? new QuotaExceededError(message, errorCode, budget)
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
