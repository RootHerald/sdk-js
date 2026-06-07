/**
 * @rootherald/js —  Root Herald browser core SDK
 *
 * Framework-agnostic. No React, Vue, or Angular dependencies.
 * Tree-shakable named exports only.
 */

export { RootHeraldSdkClient, createClient } from './client.js';
export {
  MemoryCache,
  LocalStorageCache,
  SessionStorageCache,
  createCache,
} from './storage.js';

// Re-export types from contracts for consumer convenience
export type {
  AcrRequestOptions,
  AcrUrn,
  AmrValue,
  AttestationTokenClaims,
  AttestationVerdict,
  AssuranceLevel,
  AttestationType,
  DeviceVerdict,
  EarStatus,
  LoginOptions,
  Platform,
  TokenCache,
  TrustworthinessVector,
} from '@rootherald/contracts';

// Re-export error classes
export {
  AuthenticationTooOldError,
  InsufficientAcrError,
  InsufficientAssuranceError,
  InvalidVerdictError,
  RootHeraldError,
  SsfApiError,
  StaleAttestationError,
  TokenExpiredError,
  WebhookSignatureError,
} from '@rootherald/contracts';

// Re-export ACR helpers
export { acrRank, legacyLevelToAcr, ACR_ORDER } from '@rootherald/contracts';
