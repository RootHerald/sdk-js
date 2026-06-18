// Re-export the three SDK error classes for convenience. Consumers can also
// import them directly from @rootherald/contracts.
export {
  ChallengeError,
  InvalidEvidenceError,
  InvalidSecretKeyError,
  InvalidTokenError,
  QuotaExceededError,
  RootHeraldApiError,
  RootHeraldError,
  TokenExpiredError,
  UnknownPolicyError,
} from "@rootherald/contracts";
