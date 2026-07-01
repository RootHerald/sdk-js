/**
 * JWT verification for RootHerald attestation tokens.
 * All crypto goes through jose — no hand-rolled signature checks.
 */

import { createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTVerifyGetKey } from "jose";
import type {
  AcrUrn,
  AmrValue,
  AttestationTokenClaims,
  AttestationVerdict,
  DeviceVerdict,
  VerifyOptions,
} from "@rootherald/contracts";
import { InvalidTokenError, TokenExpiredError } from "@rootherald/contracts";

const EXPECTED_EAT_PROFILE = "tag:rootherald.io,2026:tpm20-v1";

// Module-level cache. jose's createRemoteJWKSet is itself caching, but we
// avoid rebuilding the JWKSet wrapper on every call by stashing per URL.
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(jwksUri: string, cacheMaxAge: number) {
  let set = jwksCache.get(jwksUri);
  if (!set) {
    set = createRemoteJWKSet(new URL(jwksUri), {
      cooldownDuration: 30_000,
      cacheMaxAge,
    });
    jwksCache.set(jwksUri, set);
  }
  return set;
}

/**
 * Verify a RootHerald attestation token and return the parsed verdict.
 *
 * Throws:
 *   - TokenExpiredError   — `exp` is in the past
 *   - InvalidTokenError   — signature / issuer / audience / schema check failed
 */
export async function verifyAttestationToken(
  token: string,
  options: VerifyOptions & { _jwks?: JWTVerifyGetKey },
): Promise<AttestationVerdict> {
  const jwksUri =
    options.jwksUri ?? `${options.issuer}/.well-known/jwks.json`;
  const jwks =
    options._jwks ?? getJwks(jwksUri, options.jwksCacheMs ?? 3_600_000);

  let claims: AttestationTokenClaims;
  try {
    const result = await jwtVerify(token, jwks, {
      issuer: options.issuer,
      audience: options.audience,
      clockTolerance: options.clockTolerance ?? 5,
    });
    claims = result.payload as unknown as AttestationTokenClaims;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      err instanceof Error &&
      (msg.includes("expired") ||
        (err as NodeJS.ErrnoException).code === "ERR_JWT_EXPIRED")
    ) {
      throw new TokenExpiredError(err);
    }
    throw new InvalidTokenError(`JWT verification failed: ${msg}`, err);
  }

  // Required OIDC claims — jose has already accepted iss/aud/exp/nbf,
  // but the SDK's verdict shape assumes these others are present.
  const claimsRecord = claims as unknown as Record<string, unknown>;
  for (const claim of ["acr", "amr", "auth_time", "sub", "exp"] as const) {
    if (claimsRecord[claim] === undefined) {
      throw new InvalidTokenError(`missing oidc claim: ${claim}`);
    }
  }

  // Validate the rootherald_device container is present and well-formed.
  const device = claims.rootherald_device;
  if (!device) {
    throw new InvalidTokenError("missing rootherald_device claim");
  }
  if (device.eat_profile !== EXPECTED_EAT_PROFILE) {
    throw new InvalidTokenError(
      `unexpected eat_profile: ${device.eat_profile} (expected ${EXPECTED_EAT_PROFILE})`,
    );
  }
  if (!device.ueid) {
    throw new InvalidTokenError("missing rootherald_device.ueid");
  }

  return mapClaimsToVerdict(claims);
}

/** Maps verified claims to the AttestationVerdict shape. Internal helper. */
function mapClaimsToVerdict(claims: AttestationTokenClaims): AttestationVerdict {
  const d = claims.rootherald_device;
  const tv = d.ear_trustworthiness_vector;
  const device: DeviceVerdict = {
    ueid: d.ueid,
    earStatus: d.ear_status,
    verdict: d.verdict,
    attestationType: d.attestation_type,
    attestedAt: new Date(d.attested_at * 1000),
    quoteVerified: d.quote_verified,
    secureBootVerified: d.secure_boot_verified,
    eventLogVerified: d.event_log_verified,
    platform: d.platform,
    hardwareModel: d.hardware_model,
    trustworthinessVector: tv && {
      instanceIdentity: tv.instance_identity,
      configuration: tv.configuration,
      executables: tv.executables,
      fileSystem: tv.file_system,
      hardware: tv.hardware,
      runtimeOpaque: tv.runtime_opaque,
      sourcedData: tv.sourced_data,
      storageOpaque: tv.storage_opaque,
    },
  };

  return {
    acr: claims.acr as AcrUrn,
    amr: (claims.amr as AmrValue[]) ?? [],
    authTime: new Date(claims.auth_time * 1000),
    expiresAt: new Date(claims.exp * 1000),
    userId: claims.sub,
    requestedAcrValues: (claims.requested_acr_values as AcrUrn[]) ?? [],
    device,
    raw: claims,
  };
}
