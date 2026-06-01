/**
 * Re-exports the full error taxonomy from @rootherald/contracts.
 * @rootherald/js does not define its own error classes.
 */
export {
  RootHeraldError,
  TokenExpiredError,
  InvalidVerdictError,
  InsufficientAssuranceError,
  InsufficientAcrError,
  AuthenticationTooOldError,
  StaleAttestationError,
  WebhookSignatureError,
  SsfApiError,
} from '@rootherald/contracts';
