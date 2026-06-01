export { verifyAttestationToken, mapClaimsToVerdict, _clearJwksCache } from './verify.js';
export { requireAttestation } from './requireAttestation.js';
export { receiveCaepEvent, _clearCaepJwksCache } from './receiveCaepEvent.js';
export { createSsfClient } from './ssfClient.js';
export { acrRank, acrMeets } from './acrRank.js';

export type { VerifyOptions } from './verify.js';
export type { RequireAttestationMiddlewareOptions } from './requireAttestation.js';
export type { ReceiveCaepEventOptions, ParsedCaepEvent } from './receiveCaepEvent.js';
export type { SsfClientOptions } from './ssfClient.js';

export type {
  AcrUrn,
  AmrValue,
  AttestationVerdict,
  DeviceVerdict,
  AssuranceLevel,
  AttestationType,
  AcrRequestOptions,
  SsfClient,
  SsfStream,
} from '@rootherald/contracts';

export {
  RootHeraldError,
  TokenExpiredError,
  InvalidVerdictError,
  InsufficientAssuranceError,
  StaleAttestationError,
  InsufficientAcrError,
  AuthenticationTooOldError,
  WebhookSignatureError,
  SsfApiError,
} from '@rootherald/contracts';
