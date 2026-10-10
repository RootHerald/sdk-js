/**
 * SDK API types — the shape returned by verify functions and the options
 * accepted by middleware. Pure types, no implementations.
 */

import type {
  AcrUrn,
  AmrValue,
  AttestationType,
  EarStatus,
  Platform,
  Verdict,
} from "./eat.js";
import type { RequestedDisclosureClass } from "./background-check.js";

/** Camel-cased AR4SI trustworthiness vector. Each dimension: 0 = unknown, 1 = warning, 2 = affirming. */
export interface TrustworthinessVector {
  instanceIdentity?: number;
  configuration?: number;
  executables?: number;
  fileSystem?: number;
  hardware?: number;
  runtimeOpaque?: number;
  sourcedData?: number;
  storageOpaque?: number;
}

/**
 * What the challenge bound the verdict to, echoed by the server after it
 * enforced it. Absent when the challenge named nothing. The server SDKs
 * compare it with what they asked for and refuse a verdict that does not
 * echo it, so a server that ignored the binding cannot pass silently.
 */
export interface ExpectedBinding {
  /** The `expectedKey` the challenge named. */
  key?: string;
  /** The `expectedDevices` the challenge named. */
  devices?: string[];
}

/**
 * Server-validated device claims. Every field below `ueid` that is marked
 * with a disclosure class is omitted when the applied class is lower.
 */
export interface DeviceVerdict {
  /**
   * This tenant's alias for the device (UUID): `HMAC(tenant salt, Device.Id)`,
   * so two tenants observing one machine receive uncorrelated values. Omitted
   * below `pseudonymous`.
   */
  ueid?: string;
  /** The disclosure class actually applied: `min(requested, key ceiling)`. */
  disclosureClass?: RequestedDisclosureClass;
  earStatus: EarStatus;
  verdict: Verdict;
  attestationType: AttestationType;
  attestedAt: Date;
  quoteVerified?: boolean;
  secureBootVerified?: boolean;
  eventLogVerified?: boolean;
  /** Whether boot state was checked at all; false on an identity-only challenge. */
  postureEvaluated?: boolean;
  /** `"plan_lapsed"` when a posture policy could not ask for posture. */
  postureSkippedReason?: string;
  platform?: Platform;
  hardwareModel?: string;
  /**
   * Kind of root of trust: `discrete-tpm` | `firmware-tpm` | `cloud-vtpm` |
   * `mobile-hardware` | `mobile-software` | `emulated` | `unknown`.
   */
  tpmKind?: string;
  /** Experimental, off by default: a rotation-resistant identity keyed on the per-chip ODCA intermediate. */
  chipAnchorId?: string;
  /** What `ueid` is anchored to: `ek` or `odca-chip-intermediate`. */
  identityAnchor?: string;
  trustworthinessVector?: TrustworthinessVector;
  /** True if the root of trust is genuine hardware silicon. */
  hardwareGenuine?: boolean;
  /** True when the root of trust was proved at enrollment (EK chain or platform attestation). */
  ekChainTrusted?: boolean;
  /** Derived Sybil posture: `none` | `elevated`. */
  sybilRisk?: string;
  /**
   * How farmable this device's attested identity is, strongest to weakest:
   * `distinct-silicon` | `distinct-silicon-rotatable` | `per-instance` | `per-key`.
   */
  sybilResistance?: string;
  /** True if this hardware identity has been seen before. */
  returningDevice?: boolean;
  /** Coarse identity-age band, e.g. `new` | `under-7d` | `under-90d` | `over-90d`. Pseudonymous+. */
  identityAgeBucket?: string;
  /** Coarse per-tenant binding-count band, e.g. `1` | `2-3` | `4-10` | `10+`. Pseudonymous+. */
  accountBindingBand?: string;
  /** When this hardware identity was first seen. Derived+. */
  identityFirstSeen?: Date;
  /** Attestations for this identity in your tenant, including this one. Derived+. */
  attestationCount?: number;
  /** Distinct enrollments of this device into your tenant. Derived+. */
  accountBindingCount?: number;
  /** True when the silicon appears to have rotated its EK and re-enrolled. */
  possiblyRotated?: boolean;
  /** Distinct identities this device's chip anchor produced inside the policy's rotation window. */
  identitiesOnAnchor?: number;
  /** True when this device has attested from a different OS than it first enrolled from. */
  platformRotated?: boolean;
  /** OS switches inside the policy's rotation window. */
  platformRotationsInWindow?: number;
  /** True when a watched boot stage differs from the accepted boot set. */
  bootChanged?: boolean;
  /** The PCR indices that differ. Present with `bootChanged`. */
  bootChangedStages?: number[];
  /** True when the change fell inside the maintenance window and became the new baseline. */
  bootChangeAccepted?: boolean;
  /** When the accepted boot set was first seen. Present with `bootChanged`. */
  bootBaselineAt?: Date;
  /**
   * Cohort fields — how common this device's boot configuration is among
   * devices like it. Present only when a quote-bound event log was supplied
   * and the cohort was computed. Advisory; never a trust gate.
   */
  cohortKey?: string;
  cohortScope?: "global" | "tenant-fleet";
  cohortPrevalence?: number | null;
  cohortPrevalencePerPcr?: Record<string, number>;
  cohortSampleSize?: number | null;
  novelProfile?: boolean | null;
}

/** The appraisal verdict returned by `POST /api/v1/attest/verify`. */
export interface AttestationVerdict {
  /** Satisfied ACR URN. */
  acr: AcrUrn;
  /** RFC 8176 authentication methods used. */
  amr: AmrValue[];
  /** When the appraisal completed. */
  authTime: Date;
  /** When the verdict expires. */
  expiresAt: Date;
  /** The subject, when the appraisal carried one. Omitted below `pseudonymous`. */
  userId?: string;
  /** ACR values the RP requested, preserved for audit. */
  requestedAcrValues: AcrUrn[];
  /** Device attestation result. */
  device: DeviceVerdict;
  /** The binding the challenge named, echoed after enforcement. */
  expected?: ExpectedBinding;
}
