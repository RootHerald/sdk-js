/**
 * Express/Fastify/Node-http attestation middleware.
 *
 * Verifies the bearer token, enforces optional ACR and `auth_time` freshness
 * requirements, and attaches the verdict at `req.attestation`. Insufficient
 * ACR or stale auth_time returns an RFC 9470 step-up challenge.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  AcrUrn,
  AttestationVerdict,
  RequireAttestationMiddlewareOptions,
} from "@rootherald/contracts";
import { InvalidTokenError, RootHeraldError } from "@rootherald/contracts";
import { verifyAttestationToken } from "./verify.js";

/**
 * ACR satisfaction is evaluated over TWO SEPARATE ordered tracks, per the
 * Root Herald ACR Value Registry (docs/architecture/contracts/acr-values.md,
 * "Hierarchy and Subsumption"): the device-only track and the user track are
 * distinct. A user-track ACR does NOT subsume a device-track requirement, and
 * vice versa — "user:1fa does not subsume device:any; both device evidence and
 * user auth are required independently."
 *
 * Within a track, higher tiers subsume lower ones (e.g. device:high satisfies a
 * device:any requirement; user:phrh:fresh satisfies a user:1fa requirement).
 */
const DEVICE_TRACK: readonly AcrUrn[] = [
  "urn:rootherald:device:any",
  "urn:rootherald:device:high",
];

const USER_TRACK: readonly AcrUrn[] = [
  "urn:rootherald:user:1fa",
  "urn:rootherald:user:2fa",
  "urn:rootherald:user:phr",
  "urn:rootherald:user:phrh",
  "urn:rootherald:user:phrh:fresh",
];

type Track = "device" | "user";

function trackOf(urn: string): Track | null {
  if (DEVICE_TRACK.includes(urn as AcrUrn)) return "device";
  if (USER_TRACK.includes(urn as AcrUrn)) return "user";
  return null;
}

function rankInTrack(urn: string, track: Track): number {
  const order = track === "device" ? DEVICE_TRACK : USER_TRACK;
  return order.indexOf(urn as AcrUrn);
}

/**
 * Confirms the device-evidence booleans the registry requires for a given
 * device-track URN are present and true on the verdict. The ACR string alone
 * is never sufficient for device:high — the underlying evidence must be there.
 *
 * Per acr-values.md (device:high definition): requires
 * `quote_verified && secure_boot_verified && event_log_verified`.
 */
function deviceEvidenceSatisfies(required: AcrUrn, verdict: AttestationVerdict): boolean {
  const d = verdict.device;
  switch (required) {
    case "urn:rootherald:device:high":
      return d.quoteVerified === true &&
        d.secureBootVerified === true &&
        d.eventLogVerified === true;
    case "urn:rootherald:device:any":
      // device:any requires a valid quote/platform attestation; the EAR status
      // (affirming/warning) is the registry's gate for device:any.
      return d.earStatus === "affirming" || d.earStatus === "warning";
    default:
      return false;
  }
}

/**
 * Returns true iff the token's `acr` satisfies a single required URN, evaluating
 * strictly within the required URN's track and confirming device evidence for
 * device-track requirements.
 */
function satisfiesRequirement(required: AcrUrn, verdict: AttestationVerdict): boolean {
  const reqTrack = trackOf(required);
  const presentTrack = trackOf(verdict.acr);
  if (reqTrack === null || presentTrack === null) return false;

  // Cross-track never satisfies: a user-track ACR must not satisfy a device
  // requirement, and vice versa. This is the security-critical invariant.
  if (reqTrack !== presentTrack) return false;

  // Within-track laddering: the present tier must be >= the required tier.
  const presentRank = rankInTrack(verdict.acr, reqTrack);
  const requiredRank = rankInTrack(required, reqTrack);
  if (presentRank < 0 || presentRank < requiredRank) return false;

  // Device-track requirements additionally demand the evidence booleans.
  if (reqTrack === "device") {
    return deviceEvidenceSatisfies(required, verdict);
  }
  return true;
}

function defaultExtractor(req: IncomingMessage): string | null {
  const h = req.headers["authorization"];
  if (typeof h !== "string" || !h.startsWith("Bearer ")) return null;
  return h.slice(7).trim() || null;
}

function stepUpChallenge(acrValues: AcrUrn[] | undefined, maxAge: number | undefined, msg: string): string {
  const parts = [
    "Bearer",
    'realm=""',
    'error="insufficient_user_authentication"',
    `error_description="${msg.replace(/"/g, '\\"')}"`,
  ];
  if (acrValues?.length) parts.push(`acr_values="${acrValues.join(" ")}"`);
  if (maxAge !== undefined) parts.push(`max_age="${maxAge}"`);
  return parts.join(", ");
}

type Next = (err?: unknown) => void;

/**
 * Returns an Express-compatible `(req, res, next)` middleware.
 *
 * On success: attaches the verdict at `(req as any).attestation` and calls `next()`.
 * On failure: writes a JSON error response and calls `next(err)`.
 */
export function requireAttestation(
  options: RequireAttestationMiddlewareOptions,
): (req: IncomingMessage, res: ServerResponse, next: Next) => Promise<void> {
  const extract = (options.tokenExtractor ?? defaultExtractor) as (
    req: IncomingMessage,
  ) => string | null;

  return async (req, res, next) => {
    const token = extract(req);
    if (!token) {
      const err = new RootHeraldError("missing attestation token", "UNAUTHENTICATED");
      respond(res, 401, { error: "unauthenticated", code: err.code });
      options.onError?.(err, req, res);
      return next(err);
    }

    let verdict: AttestationVerdict;
    try {
      verdict = await verifyAttestationToken(token, options);
    } catch (err) {
      const error = err instanceof Error ? err : new InvalidTokenError(String(err));
      const code = error instanceof RootHeraldError ? error.code : "INVALID_TOKEN";
      respond(res, 401, { error: "unauthorized", code });
      options.onError?.(error, req, res);
      return next(error);
    }

    // ACR enforcement (RFC 9470 step-up).
    //
    // The requested list is a preference set: it is satisfied if the token
    // satisfies AT LEAST ONE entry, evaluated within that entry's own track
    // (device vs. user) with the registry's device-evidence checks. A
    // user-track token can never satisfy a device-track requirement.
    if (options.acrValues?.length) {
      const satisfied = options.acrValues.some((required) =>
        satisfiesRequirement(required, verdict),
      );
      if (!satisfied) {
        const err = new RootHeraldError(
          `acr ${verdict.acr} does not meet ${options.acrValues.join(", ")}`,
          "INSUFFICIENT_ACR",
        );
        respondStepUp(res, options.acrValues, options.maxAgeSeconds, err.message);
        options.onError?.(err, req, res);
        return next(err);
      }
    }

    // auth_time freshness.
    if (options.maxAgeSeconds !== undefined) {
      const ageSec = (Date.now() - verdict.authTime.getTime()) / 1000;
      if (ageSec > options.maxAgeSeconds) {
        const err = new RootHeraldError(
          `auth_time is ${Math.floor(ageSec)}s old, max ${options.maxAgeSeconds}`,
          "AUTH_TOO_OLD",
        );
        respondStepUp(res, options.acrValues, options.maxAgeSeconds, err.message);
        options.onError?.(err, req, res);
        return next(err);
      }
    }

    (req as unknown as Record<string, unknown>)["attestation"] = verdict;
    next();
  };
}

function respond(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function respondStepUp(
  res: ServerResponse,
  acrValues: AcrUrn[] | undefined,
  maxAge: number | undefined,
  msg: string,
): void {
  res.statusCode = 401;
  res.setHeader("WWW-Authenticate", stepUpChallenge(acrValues, maxAge, msg));
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({
    error: "insufficient_user_authentication",
    error_description: msg,
    acr_values: acrValues,
    max_age: maxAge,
  }));
}
