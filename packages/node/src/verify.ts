/**
 * Core JWT verification and AttestationVerdict mapping for Node.js.
 *
 * All JWT crypto is delegated to jose. No hand-rolled signature verification.
 *
 * Token shape (ADR-0012 composite):
 *   OIDC standard claims (acr, amr, auth_time, sub, …) at the top level.
 *   All device claims inside `rootherald_device`.
 *   Legacy top-level device fields (ueid, verdict, assurance_level, …) are
 *   still accepted as a fallback so old tokens continue to decode.
 */

import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import type {
  AcrUrn,
  AmrValue,
  AttestationTokenClaims,
  AttestationVerdict,
  DeviceVerdict,
} from '@rootherald/contracts';
import { RootHeraldError, TokenExpiredError } from '@rootherald/contracts';

// Module-level JWKS cache keyed by URL string.
// Reuses jose's internal fetch caching (cooldown + max-age) while also
// avoiding repeated createRemoteJWKSet calls across middleware invocations.
const _jwksSets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** Clears the internal JWKS cache. Exposed for testing only. */
export function _clearJwksCache(): void {
  _jwksSets.clear();
}

function getJwksSet(
  jwksUri: string,
  cacheMaxAge: number,
): ReturnType<typeof createRemoteJWKSet> {
  const existing = _jwksSets.get(jwksUri);
  if (existing) return existing;
  const set = createRemoteJWKSet(new URL(jwksUri), {
    cooldownDuration: 30_000,
    cacheMaxAge,
  });
  _jwksSets.set(jwksUri, set);
  return set;
}

export interface VerifyOptions {
  /** Expected issuer URL. Validation fails if iss does not match. */
  issuer: string;
  /** Expected audience (client_id). Accepts string or array. */
  audience?: string | string[];
  /** Clock skew tolerance in seconds. Defaults to 5. */
  clockTolerance?: number;
  /** JWKS cache TTL in milliseconds. Defaults to 3_600_000 (1 hour). */
  jwksCacheMs?: number;
  /** Override the JWKS endpoint URL. Default: `${issuer}/api/v1/.well-known/jwks.json`. */
  jwksUri?: string;
  /**
   * Inject a pre-built JWKS resolver (e.g. createLocalJWKSet for tests).
   * When provided, jwksUri and jwksCacheMs are ignored.
   */
  _jwks?: JWTVerifyGetKey;
}

// Required OIDC top-level claims in the composite token.
const REQUIRED_OIDC_CLAIMS = ['acr', 'amr', 'auth_time'] as const;

// Minimum required device claims — accepted from rootherald_device (preferred)
// or from legacy top-level fields (fallback).
const EXPECTED_EAT_PROFILE = 'tag:rootherald.io,2026:tpm20-v1';

/**
 * Verifies an EAT JWT and maps the validated claims to an AttestationVerdict.
 *
 * Throws:
 *  - TokenExpiredError             — when the token's exp is in the past
 *  - RootHeraldError('JWT_INVALID')     — signature / issuer / audience failures,
 *                                         or missing OIDC claims
 *  - RootHeraldError('SCHEMA_VIOLATION') — missing required device claims or wrong
 *                                          eat_profile
 */
export async function verifyAttestationToken(
  token: string,
  options: VerifyOptions,
): Promise<AttestationVerdict> {
  const cacheMaxAge = options.jwksCacheMs ?? 3_600_000;
  const jwksUri =
    options.jwksUri ?? `${options.issuer}/api/v1/.well-known/jwks.json`;

  const jwks = options._jwks ?? getJwksSet(jwksUri, cacheMaxAge);

  // jose types the payload as JWTPayload; we cast to our richer type after
  // claims validation below.
  let payload: AttestationTokenClaims;
  try {
    const result = await jwtVerify(token, jwks, {
      issuer: options.issuer,
      audience: options.audience,
      clockTolerance: options.clockTolerance ?? 5,
    });
    payload = result.payload as unknown as AttestationTokenClaims;
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes('expired') ||
        (err as NodeJS.ErrnoException).code === 'ERR_JWT_EXPIRED')
    ) {
      throw new TokenExpiredError(err);
    }
    throw new RootHeraldError(
      `JWT verification failed: ${err instanceof Error ? err.message : String(err)}`,
      'JWT_INVALID',
      err,
    );
  }

  // Validate required OIDC top-level claims.
  const payloadAny = payload as unknown as Record<string, unknown>;
  for (const claim of REQUIRED_OIDC_CLAIMS) {
    if (payloadAny[claim] === undefined || payloadAny[claim] === null) {
      throw new RootHeraldError(
        `missing oidc claim: ${claim}`,
        'JWT_INVALID',
      );
    }
  }

  // Validate eat_profile — prefer nested device container, fall back to top-level.
  const device = (payload as unknown as Record<string, unknown>)['rootherald_device'] as
    (AttestationTokenClaims['rootherald_device'] | undefined);

  const eatProfile = device?.eat_profile ??
    (payload as unknown as Record<string, unknown>)['eat_profile'] as string | undefined;

  if (eatProfile !== undefined && eatProfile !== EXPECTED_EAT_PROFILE) {
    throw new RootHeraldError(
      `Unexpected eat_profile: ${eatProfile}. Expected: ${EXPECTED_EAT_PROFILE}`,
      'SCHEMA_VIOLATION',
    );
  }

  // Require at least a ueid from somewhere (device container or top-level legacy).
  const ueid = device?.ueid ??
    (payload as unknown as Record<string, unknown>)['ueid'] as string | undefined;

  if (!ueid) {
    throw new RootHeraldError(
      'Missing required EAT claim: ueid',
      'SCHEMA_VIOLATION',
    );
  }

  return mapClaimsToVerdict(payload);
}

/** Maps verified AttestationTokenClaims to the friendly AttestationVerdict shape. */
export function mapClaimsToVerdict(claims: AttestationTokenClaims): AttestationVerdict {
  const raw = claims as unknown as Record<string, unknown>;

  // ---- OIDC top-level fields ----
  const acr = raw['acr'] as AcrUrn;
  const amr = (raw['amr'] as AmrValue[] | undefined) ?? [];
  const authTime = new Date(((raw['auth_time'] as number) ?? 0) * 1000);
  const requestedAcrValues = (raw['requested_acr_values'] as AcrUrn[] | undefined) ?? [];

  // ---- Device claims: prefer nested container, fall back to legacy top-level ----
  const deviceClaims = raw['rootherald_device'] as
    (AttestationTokenClaims['rootherald_device'] | undefined);

  const ueid = (deviceClaims?.ueid ?? raw['ueid']) as string;
  const earStatus = (deviceClaims?.ear_status ?? raw['ear_status'] ?? 'warning') as
    DeviceVerdict['earStatus'];
  const verdict = (deviceClaims?.verdict ?? raw['verdict'] ?? 'warn') as
    DeviceVerdict['verdict'];
  const attestationType = (deviceClaims?.attestation_type ?? raw['attestation_type'] ?? 'unknown') as
    DeviceVerdict['attestationType'];
  const attestedAt = new Date(
    ((deviceClaims?.attested_at ?? raw['attested_at'] as number | undefined) ?? 0) * 1000,
  );
  const quoteVerified = (deviceClaims?.quote_verified ?? raw['quote_verified']) as
    boolean | undefined;
  const secureBootVerified = (deviceClaims?.secure_boot_verified ?? raw['secure_boot_verified']) as
    boolean | undefined;
  const eventLogVerified = (deviceClaims?.event_log_verified ?? raw['event_log_verified']) as
    boolean | undefined;
  const platform = (deviceClaims?.platform ?? raw['platform']) as
    DeviceVerdict['platform'];
  const hardwareModel = (deviceClaims?.hardware_model ?? raw['hardware_model']) as
    string | undefined;

  // Trustworthiness vector (nested device only — no legacy equivalent).
  const tv = deviceClaims?.ear_trustworthiness_vector;
  const trustworthinessVector = tv
    ? {
        instanceIdentity: tv.instance_identity,
        configuration: tv.configuration,
        executables: tv.executables,
        fileSystem: tv.file_system,
        hardware: tv.hardware,
        runtimeOpaque: tv.runtime_opaque,
        sourcedData: tv.sourced_data,
        storageOpaque: tv.storage_opaque,
      }
    : undefined;

  const device: DeviceVerdict = {
    ueid,
    earStatus,
    verdict,
    attestationType,
    attestedAt,
    quoteVerified,
    secureBootVerified,
    eventLogVerified,
    platform,
    hardwareModel,
    trustworthinessVector,
  };

  // Legacy assuranceLevel mirror: map ear_status → old AssuranceLevel string.
  const legacyAssuranceLevel = (() => {
    const legacyRaw = raw['assurance_level'] as string | undefined;
    if (legacyRaw === 'high' || legacyRaw === 'reduced' || legacyRaw === 'unverified') {
      return legacyRaw;
    }
    // Derive from ear_status if legacy field absent.
    if (earStatus === 'affirming') return 'high' as const;
    if (earStatus === 'warning') return 'reduced' as const;
    return 'unverified' as const;
  })();

  return {
    // OIDC fields
    acr,
    amr,
    authTime,
    requestedAcrValues,
    userId: claims.sub,
    expiresAt: new Date(claims.exp * 1000),

    // Nested device
    device,

    // Raw
    raw: claims,

    // Deprecated backward-compat mirrors
    verdict,
    assuranceLevel: legacyAssuranceLevel,
    attestationType,
    deviceId: ueid,
  };
}
