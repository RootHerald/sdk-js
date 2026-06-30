/**
 * @rootherald/contracts/server — SERVER-CONTEXT error types.
 *
 * These errors model failures of the Background-Check API (`/challenge`,
 * `/verify`), which is only ever called from the CUSTOMER's backend with its
 * `rh_sk_` secret key (via @rootherald/node or another server SDK). They are
 * intentionally segregated onto this subpath: a browser/page bundle has no
 * `rh_sk_` secret and never reaches this API, so it should never need to import
 * these. Server code should import them from here:
 *
 *   import { InvalidSecretKeyError } from "@rootherald/contracts/server";
 *
 * For backwards compatibility these are also (deprecated) re-exported from the
 * package root; new server code should prefer this subpath.
 */

export {
  ChallengeError,
  InvalidEvidenceError,
  InvalidSecretKeyError,
  QuotaExceededError,
  RootHeraldApiError,
  UnknownPolicyError,
} from "./errors.js";
