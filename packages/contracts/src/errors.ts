/**
 * Error class hierarchy for the RootHerald SDK.
 *
 * Three classes cover everything 0.1 needs:
 *   - RootHeraldError    — base; carries a machine-readable `code`
 *   - TokenExpiredError  — exp claim is in the past
 *   - InvalidTokenError  — signature, issuer, audience, or schema check failed
 *
 * Consumers can discriminate via `instanceof` or by the `code` string.
 */

/** Base class for all RootHerald SDK errors. */
export class RootHeraldError extends Error {
  public readonly code: string;
  public override readonly cause: unknown;

  constructor(message: string, code: string, cause?: unknown) {
    super(message);
    this.name = "RootHeraldError";
    this.code = code;
    this.cause = cause;
    // Restore prototype for instanceof checks after transpilation.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The token's `exp` claim is in the past. */
export class TokenExpiredError extends RootHeraldError {
  constructor(cause?: unknown) {
    super("Attestation token has expired", "TOKEN_EXPIRED", cause);
    this.name = "TokenExpiredError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Signature, issuer, audience, or schema validation failed. */
export class InvalidTokenError extends RootHeraldError {
  constructor(message: string, cause?: unknown) {
    super(message, "INVALID_TOKEN", cause);
    this.name = "InvalidTokenError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Base class for errors returned by the server-side Background-Check API
 * (`RootHeraldClient.issueChallenge` / `RootHeraldClient.verify`). Carries the HTTP
 * `status` and, when the server provided one, a machine-readable `errorCode`
 * (e.g. `invalid_secret_key`, `unknown_policy`).
 */
export class RootHeraldApiError extends RootHeraldError {
  /** HTTP status code from the API response. */
  public readonly status: number;
  /** The server's `error` discriminator, when present. */
  public readonly errorCode?: string;

  constructor(
    message: string,
    code: string,
    status: number,
    errorCode?: string,
    cause?: unknown,
  ) {
    super(message, code, cause);
    this.name = "RootHeraldApiError";
    this.status = status;
    this.errorCode = errorCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * 401 — the `rh_sk_` secret key is missing, malformed, or rejected. A 401
 * carrying `activation_refused` is {@link ActivationRefusedError} instead.
 */
export class InvalidSecretKeyError extends RootHeraldApiError {
  constructor(message = "invalid secret key", errorCode?: string, cause?: unknown) {
    super(message, "INVALID_SECRET_KEY", 401, errorCode, cause);
    this.name = "InvalidSecretKeyError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 422 — a policy bound to the API key no longer exists; nothing is substituted. */
export class UnknownPolicyError extends RootHeraldApiError {
  constructor(message = "unknown policy", errorCode?: string, cause?: unknown) {
    super(message, "UNKNOWN_POLICY", 422, errorCode, cause);
    this.name = "UnknownPolicyError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 409 — the challenge has expired or has already been used (single-use). */
export class ChallengeError extends RootHeraldApiError {
  constructor(message = "challenge expired or already used", errorCode?: string, cause?: unknown) {
    super(message, "CHALLENGE_EXPIRED_OR_USED", 409, errorCode, cause);
    this.name = "ChallengeError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 400 — the evidence blob was malformed or could not be appraised. */
export class InvalidEvidenceError extends RootHeraldApiError {
  constructor(message = "invalid evidence", errorCode?: string, cause?: unknown) {
    super(message, "INVALID_EVIDENCE", 400, errorCode, cause);
    this.name = "InvalidEvidenceError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * 429 `quota_exceeded` (or an `X-RootHerald-Quota` header) — the `rh_sk_`
 * tenant has exceeded its metered verify quota. A 429 without that signal is
 * {@link RateLimitedError}.
 */
export class QuotaExceededError extends RootHeraldApiError {
  constructor(message = "quota exceeded", errorCode?: string, cause?: unknown) {
    super(message, "QUOTA_EXCEEDED", 429, errorCode, cause);
    this.name = "QuotaExceededError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * 422 — enrollment was refused because the device can never satisfy the
 * identity policy bound to the API key (e.g. a firmware TPM under a
 * discrete-TPM-only policy). The server's `detail` names the TPM class and is
 * carried in `message`.
 */
export class AdmissionRefusedError extends RootHeraldApiError {
  constructor(message = "admission refused", errorCode?: string, cause?: unknown) {
    super(message, "ADMISSION_REFUSED", 422, errorCode, cause);
    this.name = "AdmissionRefusedError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}


/**
 * 401 `activation_refused` — `POST /api/v1/attest/activate` refused the
 * enrollment: the `enrollmentId` is unknown, spent or foreign, or the proof
 * did not match. The secret key was accepted; this is not a credential
 * problem. Every activation refusal reason produces this one answer.
 */
export class ActivationRefusedError extends RootHeraldApiError {
  constructor(message = "activation refused", errorCode?: string, cause?: unknown) {
    super(message, "ACTIVATION_REFUSED", 401, errorCode, cause);
    this.name = "ActivationRefusedError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * 429 without a quota signal — the request-rate limiter refused the call.
 * Retry after `retryAfterSeconds` (from the `Retry-After` header, else the
 * body, else `undefined`). Distinct from {@link QuotaExceededError}, which is
 * the metered billing ceiling.
 */
export class RateLimitedError extends RootHeraldApiError {
  /** Seconds to wait before retrying, when the server said. */
  public readonly retryAfterSeconds?: number;

  constructor(
    message = "rate limited",
    errorCode?: string,
    retryAfterSeconds?: number,
    cause?: unknown,
  ) {
    super(message, "RATE_LIMITED", 429, errorCode, cause);
    this.name = "RateLimitedError";
    this.retryAfterSeconds = retryAfterSeconds;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
