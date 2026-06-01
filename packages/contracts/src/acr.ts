/**
 * ACR URN ranking helpers.
 *
 * Canonical rank order for  Root Herald ACR URNs. Shared by @rootherald/js,
 * @rootherald/react, and @rootherald/node so tier comparisons are consistent.
 */

import type { AcrUrn } from "./eat.js";
import type { AssuranceLevel } from "./eat.js";

/** Ordered list of ACR URNs from lowest to highest assurance. */
export const ACR_ORDER: readonly AcrUrn[] = [
  "urn:rootherald:device:any",
  "urn:rootherald:device:high",
  "urn:rootherald:user:1fa",
  "urn:rootherald:user:2fa",
  "urn:rootherald:user:phr",
  "urn:rootherald:user:phrh",
  "urn:rootherald:user:phrh:fresh",
] as const;

/**
 * Returns the numeric rank of an ACR URN. Higher rank = higher assurance.
 * Returns -1 for unknown URNs.
 */
export function acrRank(urn: AcrUrn): number {
  return ACR_ORDER.indexOf(urn);
}

/** Maps a legacy assurance level string to its equivalent minimum ACR URN. */
export function legacyLevelToAcr(level: AssuranceLevel): AcrUrn {
  if (level === "high") return "urn:rootherald:user:phrh";
  if (level === "reduced") return "urn:rootherald:user:1fa";
  return "urn:rootherald:device:any";
}
