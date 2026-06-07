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
