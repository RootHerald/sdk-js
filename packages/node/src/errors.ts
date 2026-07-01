// Re-export the SDK error classes for convenience. Consumers can also import
// them directly from @rootherald/contracts (server-context errors from the
// @rootherald/contracts/server subpath).
export {
  InvalidTokenError,
  RootHeraldError,
  TokenExpiredError,
} from "@rootherald/contracts";
export {
  ChallengeError,
  InvalidEvidenceError,
  InvalidSecretKeyError,
  QuotaExceededError,
  RootHeraldApiError,
  UnknownPolicyError,
} from "@rootherald/contracts/server";
