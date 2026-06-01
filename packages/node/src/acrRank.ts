/**
 * ACR URN ranking helpers for @rootherald/node.
 *
 * Local copy — do NOT replace with an import from @rootherald/contracts until
 * Package 5 has stabilised and both packages are on the same version.
 */

import type { AcrUrn } from '@rootherald/contracts';

const ACR_ORDER: readonly AcrUrn[] = [
  'urn:rootherald:device:any',      // rank 0
  'urn:rootherald:device:high',     // rank 1
  'urn:rootherald:user:1fa',        // rank 2
  'urn:rootherald:user:2fa',        // rank 3
  'urn:rootherald:user:phr',        // rank 4
  'urn:rootherald:user:phrh',       // rank 5
  'urn:rootherald:user:phrh:fresh', // rank 6
] as const;

/**
 * Returns the rank of an ACR URN (0-6). Higher = stricter. Unknown → -1.
 * A session's ACR meets a required ACR when sessionRank >= requiredRank.
 */
export function acrRank(urn: string): number {
  return ACR_ORDER.indexOf(urn as AcrUrn);
}

/**
 * Checks whether a session's ACR meets any of the required ACR values.
 * Returns true if session's rank >= lowest rank in required set.
 */
export function acrMeets(sessionAcr: string, requiredAcrValues: readonly string[]): boolean {
  const sessionRank = acrRank(sessionAcr);
  if (sessionRank < 0) return false;
  const minRequiredRank = Math.min(...requiredAcrValues.map(acrRank));
  return sessionRank >= minRequiredRank;
}
