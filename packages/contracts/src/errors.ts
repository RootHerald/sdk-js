/**
 * Shared error class hierarchy for  Root Herald SDK packages.
 *
 * All errors extend RootHeraldError, which carries a machine-readable
 * `code` string for programmatic handling. Downstream packages should
 * throw these errors rather than plain Error instances so consumers
 * can distinguish  Root Herald failures from other exceptions.
 */

/** Base class for all  Root Herald SDK errors. */
export class RootHeraldError extends Error {
  public readonly code: string;
  public override readonly cause: unknown;

  constructor(message: string, code: string, cause?: unknown) {
    super(message);
    this.name = "RootHeraldError";
    this.code = code;
    this.cause = cause;

    // Restore prototype chain for instanceof checks in transpiled output.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The attestation token has expired (exp claim is in the past). */
export class TokenExpiredError extends RootHeraldError {
  constructor(cause?: unknown) {
    super("Attestation token has expired", "TOKEN_EXPIRED", cause);
    this.name = "TokenExpiredError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * The token was parsed but carries a verdict value that is not a valid
 * member of the Verdict union.
 */
export class InvalidVerdictError extends RootHeraldError {
  constructor(cause?: unknown) {
    super("Token contains an invalid verdict value", "INVALID_VERDICT", cause);
    this.name = "InvalidVerdictError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * The attestation assurance level is lower than the caller required
 * (e.g. got "reduced", required "high").
 */
export class InsufficientAssuranceError extends RootHeraldError {
  constructor(cause?: unknown) {
    super(
      "Attestation assurance level is insufficient for this operation",
      "INSUFFICIENT_ASSURANCE",
      cause
    );
    this.name = "InsufficientAssuranceError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * The attestation is valid but older than the caller's maxAgeSeconds
 * requirement.
 */
export class StaleAttestationError extends RootHeraldError {
  constructor(cause?: unknown) {
    super(
      "Attestation is older than the maximum permitted age",
      "STALE_ATTESTATION",
      cause
    );
    this.name = "StaleAttestationError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * The CAEP SET JWT signature failed verification, or the JWKS could
 * not be fetched.
 */
export class WebhookSignatureError extends RootHeraldError {
  constructor(cause?: unknown) {
    super(
      "CAEP webhook signature verification failed",
      "WEBHOOK_SIGNATURE",
      cause
    );
    this.name = "WebhookSignatureError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** An SSF Management API call returned an error response. */
export class SsfApiError extends RootHeraldError {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number, cause?: unknown) {
    super(message, "SSF_API", cause);
    this.name = "SsfApiError";
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * The presented token's `acr` claim does not meet the minimum ACR tier
 * required by the resource server. The client should initiate a step-up
 * authentication flow per RFC 9470 to obtain a token at the required tier.
 */
export class InsufficientAcrError extends RootHeraldError {
  /** The ACR URN that was required but not satisfied. */
  public readonly requiredAcr?: string;
  /** The ACR URN that was actually present in the token. */
  public readonly presentAcr?: string;

  constructor(requiredAcr?: string, presentAcr?: string, cause?: unknown) {
    super(
      "Token ACR does not meet the required assurance tier",
      "INSUFFICIENT_ACR",
      cause
    );
    this.name = "InsufficientAcrError";
    this.requiredAcr = requiredAcr;
    this.presentAcr = presentAcr;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * The token is valid but `auth_time` is older than the `maxAgeSeconds`
 * requirement. The client must trigger a fresh authentication ceremony
 * (RFC 9470 step-up with `max_age`).
 */
export class AuthenticationTooOldError extends RootHeraldError {
  /** The auth_time value from the token (unix seconds). */
  public readonly authTime?: number;
  /** The maxAgeSeconds requirement that was not satisfied. */
  public readonly maxAgeSeconds?: number;

  constructor(authTime?: number, maxAgeSeconds?: number, cause?: unknown) {
    super(
      "User authentication is older than the maximum permitted age",
      "AUTH_TOO_OLD",
      cause
    );
    this.name = "AuthenticationTooOldError";
    this.authTime = authTime;
    this.maxAgeSeconds = maxAgeSeconds;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
