/**
 * @rootherald/contracts — shared types for RootHerald SDK packages.
 *
 * Types only; no runtime code. Use this package directly if you need to
 * share types between your own code and a RootHerald SDK; otherwise
 * import what you need from @rootherald/node and the published SDK
 * pulls these types in transitively.
 */

export type {
  AcrUrn,
  AmrValue,
  AttestationTokenClaims,
  AttestationType,
  EarStatus,
  EarTrustworthinessVector,
  Platform,
  RootHeraldDeviceClaims,
  Verdict,
} from "./eat.js";

export type {
  AttestationVerdict,
  DeviceVerdict,
  RequireAttestationMiddlewareOptions,
  TrustworthinessVector,
  VerifyOptions,
} from "./sdk-api.js";

export {
  InvalidTokenError,
  RootHeraldError,
  TokenExpiredError,
} from "./errors.js";
