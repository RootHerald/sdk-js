/**
 * JWT verification and EAT claim → AttestationVerdict mapping.
 *
 * All JWT crypto is delegated to jose. No hand-rolled signature verification.
 */

import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import type {
  AcrUrn,
  AmrValue,
  AttestationTokenClaims,
  AttestationVerdict,
  DeviceVerdict,
  EarStatus,
} from '@rootherald/contracts';
import {
  RootHeraldError,
  TokenExpiredError,
} from '@rootherald/contracts';

// jose JWKS cache: 30s cooldown between re-fetches, 1h max age
const _jwksSets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** Clears the internal JWKS set cache. Exposed for testing only. */
export function _clearJwksCache(): void {
  _jwksSets.clear();
}

function getJwksSet(jwksUri: string): ReturnType<typeof createRemoteJWKSet> {
  const existing = _jwksSets.get(jwksUri);
  if (existing) return existing;
  const set = createRemoteJWKSet(new URL(jwksUri), {
    cooldownDuration: 30_000,
    cacheMaxAge: 3_600_000,
  });
  _jwksSets.set(jwksUri, set);
  return set;
}

export interface VerifyJwtOptions {
  jwksUri: string;
  issuer: string;
  audience: string;
  /** Optional pre-built JWKS resolver. When provided, jwksUri is not fetched. Used in tests. */
  _jwks?: JWTVerifyGetKey;
}

/**
 * Verifies the EAT JWT signature and claims using jose, then maps
 * the payload to an AttestationVerdict.
 */
export async function verifyAndMapToken(
  token: string,
  options: VerifyJwtOptions,
): Promise<AttestationVerdict> {
  const jwks = options._jwks ?? getJwksSet(options.jwksUri);

  let payload: AttestationTokenClaims;
  try {
    const result = await jwtVerify(token, jwks, {
      issuer: options.issuer,
      audience: options.audience,
    });
    payload = result.payload as unknown as AttestationTokenClaims;
  } catch (err) {
    // Distinguish expired tokens from other verification failures
    if (err instanceof Error && err.message.includes('expired')) {
      throw new TokenExpiredError(err);
    }
    throw new RootHeraldError(
      `JWT verification failed: ${err instanceof Error ? err.message : String(err)}`,
      'JWT_INVALID',
      err,
    );
  }

  return mapClaimsToVerdict(payload);
}

/**
 * Maps a verified AttestationTokenClaims payload to the friendly
 * AttestationVerdict shape consumed by host applications.
 *
 * Prefers the nested `rootherald_device` container as the source of truth
 * for device fields, falling back to legacy top-level fields for tokens
 * that pre-date ADR-0012.
 */
export function mapClaimsToVerdict(
  claims: AttestationTokenClaims,
): AttestationVerdict {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const flat = claims as any;
  const device = flat.rootherald_device as AttestationTokenClaims['rootherald_device'] | undefined;

  // Validate required OIDC top-level fields (present in new composite tokens).
  // Fall back gracefully for legacy flat tokens that omit them.
  const acr: AcrUrn = (typeof flat.acr === 'string' ? flat.acr : 'urn:rootherald:device:any') as AcrUrn;
  const amr: AmrValue[] = Array.isArray(flat.amr) ? (flat.amr as AmrValue[]) : [];
  const authTimeSec: number = typeof flat.auth_time === 'number'
    ? flat.auth_time
    : (flat.iat as number ?? Math.floor(Date.now() / 1000));

  // Prefer nested device container, fall back to legacy top-level
  const deviceId: string = device?.ueid ?? (flat.ueid as string | undefined) ?? '';
  const earStatus: EarStatus = device?.ear_status ?? _mapLegacyAssurance(flat.assurance_level as string | undefined);
  const deviceVerdictStr = (device?.verdict ?? flat.verdict ?? 'pass') as 'pass' | 'fail' | 'warn';
  const attestationType = (device?.attestation_type ?? flat.attestation_type ?? 'unknown') as DeviceVerdict['attestationType'];

  if (!deviceId) {
    throw new RootHeraldError('missing device identifier (ueid)', 'JWT_INVALID');
  }

  const vector = device?.ear_trustworthiness_vector;
  const deviceVerdict: DeviceVerdict = {
    ueid: deviceId,
    earStatus,
    verdict: deviceVerdictStr,
    attestationType,
    attestedAt: new Date(((device?.attested_at ?? flat.attested_at ?? flat.iat) as number) * 1000),
    quoteVerified: device?.quote_verified ?? flat.quote_verified,
    secureBootVerified: device?.secure_boot_verified ?? flat.secure_boot_verified,
    eventLogVerified: device?.event_log_verified,
    platform: (device?.platform ?? flat.platform) as DeviceVerdict['platform'] | undefined,
    hardwareModel: device?.hardware_model ?? flat.hardware_model,
    trustworthinessVector: vector
      ? {
          instanceIdentity: vector.instance_identity,
          configuration: vector.configuration,
          executables: vector.executables,
          fileSystem: vector.file_system,
          hardware: vector.hardware,
          runtimeOpaque: vector.runtime_opaque,
          sourcedData: vector.sourced_data,
          storageOpaque: vector.storage_opaque,
        }
      : undefined,
  };

  return {
    // OIDC top-level claims
    acr,
    amr,
    authTime: new Date(authTimeSec * 1000),
    expiresAt: new Date((flat.exp as number) * 1000),
    userId: flat.sub as string,
    requestedAcrValues: (Array.isArray(flat.requested_acr_values) ? flat.requested_acr_values : []) as AcrUrn[],
    device: deviceVerdict,
    raw: claims,
    // Legacy top-level mirrors (@deprecated but kept for back-compat)
    verdict: deviceVerdictStr,
    assuranceLevel: _mapEarStatusToLegacy(earStatus),
    attestationType,
    deviceId,
  };
}

function _mapLegacyAssurance(legacy: string | undefined): EarStatus {
  if (legacy === 'high') return 'affirming';
  if (legacy === 'reduced') return 'warning';
  return 'warning';
}

function _mapEarStatusToLegacy(status: EarStatus): 'high' | 'reduced' | 'unverified' {
  if (status === 'affirming') return 'high';
  if (status === 'warning') return 'reduced';
  return 'unverified';
}
