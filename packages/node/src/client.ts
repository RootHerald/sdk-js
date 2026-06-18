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
import {
  ChallengeError,
  InvalidEvidenceError,
  InvalidSecretKeyError,
  QuotaExceededError,
  RootHeraldApiError,
  RootHeraldError,
  UnknownPolicyError,
} from "@rootherald/contracts";

/** Production RootHerald API base URL. */
const DEFAULT_BASE_URL = "https://api.rootherald.com";

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

/** Verdict plus the optional signed token, as returned by {@link RootHerald.attest}. */
export type AttestResult = AttestationVerdict & { token?: string };

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
   * C1 — `POST /api/v1/attestations/challenge`. Mints a relay-friendly nonce.
   * Relay `nonce` to the client; the client quotes over it, then submit the
   * resulting evidence with {@link attest} using the returned `challengeId`.
   */
  async createChallenge(opts?: CreateChallengeOptions): Promise<ChallengeResponse> {
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
   * C2 — `POST /api/v1/attestations/verify`. Submits the opaque evidence blob
   * for server-side appraisal and returns the verdict (plus an optional signed
   * EAT when `returnToken: true`).
   *
   * An un-enrolled / failing device is NOT an error — it returns a normal
   * verdict with a `fail` (or `warn`) result. Only protocol/auth/quota problems
   * raise a typed {@link RootHeraldApiError}.
   *
   * The optional `token` is itself verifiable with `verifyAttestationToken`.
   *
   * @param evidence  Opaque blob from the client collector; passed through verbatim.
   */
  async attest(evidence: EvidenceBlob, opts: AttestOptions): Promise<AttestResult> {
    if (!opts || typeof opts.challengeId !== "string" || !opts.challengeId) {
      throw new RootHeraldError(
        "attest() requires `challengeId` (from createChallenge)",
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
    const result = data.verdict as AttestResult;
    if (typeof data.token === "string") result.token = data.token;
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
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new RootHeraldError(`network request failed: ${msg}`, "NETWORK_ERROR", err);
    }

    if (!res.ok) {
      throw await toApiError(res);
    }

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
