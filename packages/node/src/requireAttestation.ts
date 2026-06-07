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

const ACR_ORDER: readonly AcrUrn[] = [
  "urn:rootherald:device:any",
  "urn:rootherald:device:high",
  "urn:rootherald:user:1fa",
  "urn:rootherald:user:2fa",
  "urn:rootherald:user:phr",
  "urn:rootherald:user:phrh",
  "urn:rootherald:user:phrh:fresh",
];

function acrRank(urn: string): number {
  return ACR_ORDER.indexOf(urn as AcrUrn);
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
    if (options.acrValues?.length) {
      const presentRank = acrRank(verdict.acr);
      const requiredRank = Math.min(...options.acrValues.map(acrRank));
      if (presentRank < 0 || presentRank < requiredRank) {
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
