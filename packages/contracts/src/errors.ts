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
 * (`RootHerald.createChallenge` / `RootHerald.attest`). Carries the HTTP
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

/** 401 — the `rh_sk_` secret key is missing, malformed, or rejected. */
export class InvalidSecretKeyError extends RootHeraldApiError {
  constructor(message = "invalid secret key", errorCode?: string, cause?: unknown) {
    super(message, "INVALID_SECRET_KEY", 401, errorCode, cause);
    this.name = "InvalidSecretKeyError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 422 — the named policy is unknown, foreign, or not resolvable for the tenant. */
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

/** 429 — the `rh_sk_` tenant has exceeded its metered verify quota. */
export class QuotaExceededError extends RootHeraldApiError {
  constructor(message = "quota exceeded", errorCode?: string, cause?: unknown) {
    super(message, "QUOTA_EXCEEDED", 429, errorCode, cause);
    this.name = "QuotaExceededError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
