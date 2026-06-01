import type { ReactNode } from 'react';
import type { AcrUrn, AssuranceLevel } from '@rootherald/contracts';
import { acrRank, legacyLevelToAcr } from '@rootherald/contracts';
import { useAttestation } from './useAttestation.js';

interface RequireAttestationProps {
  minAcr?: AcrUrn;
  maxAgeSeconds?: number;
  fallback?: ReactNode;
  children: ReactNode;
  /** @deprecated use minAcr instead */
  minLevel?: AssuranceLevel;
}

export function RequireAttestation({
  minAcr,
  minLevel,
  maxAgeSeconds,
  fallback,
  children,
}: RequireAttestationProps): JSX.Element {
  const { verdict, isLoading, login } = useAttestation();

  if (isLoading) return <>{fallback ?? null}</>;

  if (!verdict) {
    return (
      <>
        {fallback ?? (
          <button onClick={() => { void login(); }}>Verify with RootHerald</button>
        )}
      </>
    );
  }

  // Resolve required ACR URN: explicit minAcr > legacy minLevel > permissive default
  const requiredAcr: AcrUrn = minAcr
    ?? (minLevel ? legacyLevelToAcr(minLevel) : 'urn:rootherald:device:any');

  const verdictAcr: AcrUrn = verdict.acr ?? 'urn:rootherald:device:any';
  if (acrRank(verdictAcr) < acrRank(requiredAcr)) {
    return (
      <>
        {fallback ?? (
          <div>
            Device assurance level insufficient (need {requiredAcr}, got{' '}
            {verdictAcr})
          </div>
        )}
      </>
    );
  }

  if (maxAgeSeconds !== undefined) {
    const authTime = verdict.authTime ?? (verdict as any).attestedAt;
    if (authTime instanceof Date) {
      const ageSec = (Date.now() - authTime.getTime()) / 1000;
      if (ageSec > maxAgeSeconds) {
        return (
          <>
            {fallback ?? (
              <div>
                Attestation is stale (age {Math.round(ageSec)}s, max{' '}
                {maxAgeSeconds}s)
              </div>
            )}
          </>
        );
      }
    }
  }

  return <>{children}</>;
}
