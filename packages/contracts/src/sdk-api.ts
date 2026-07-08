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

/** Parsed device attestation claims, sourced from `rootherald_device` in the JWT. */
export interface DeviceVerdict {
  /** Device UUID (the JWT's `ueid`). */
  ueid: string;
  earStatus: EarStatus;
  verdict: Verdict;
  attestationType: AttestationType;
  attestedAt: Date;
  quoteVerified?: boolean;
  secureBootVerified?: boolean;
  eventLogVerified?: boolean;
  platform?: Platform;
  hardwareModel?: string;
  trustworthinessVector?: TrustworthinessVector;
  /**
   * Cohort fields — how common this device's boot configuration is among
   * devices like it. Populated by the Background-Check `/verify` response when
   * a quote-bound event log was supplied; absent/null otherwise. ADDITIVE and
   * advisory only — never a trust gate.
   */
  /** Opaque key identifying the cohort this device was bucketed into. */
  cohortKey?: string;
  /** Cohort comparison scope. */
  cohortScope?: "global" | "tenant-fleet";
  /** Fraction of the cohort sharing this device's profile, or null if unknown. */
  cohortPrevalence?: number | null;
  /** Per-PCR prevalence map (PCR index -> fraction). */
  cohortPrevalencePerPcr?: Record<string, number>;
  /** Number of devices in the cohort sample, or null if unknown. */
  cohortSampleSize?: number | null;
  /** Whether this is a previously-unseen profile, or null if not evaluated. */
  novelProfile?: boolean | null;
}

/** Parsed attestation verdict from a verified RootHerald JWT. */
export interface AttestationVerdict {
  /** Satisfied ACR URN. */
  acr: AcrUrn;
  /** RFC 8176 authentication methods used. */
  amr: AmrValue[];
  /** When the user most recently authenticated. */
  authTime: Date;
  /** When the token expires. */
  expiresAt: Date;
  /** User ID from the `sub` claim. */
  userId: string;
  /** ACR values the RP requested, preserved for audit. */
  requestedAcrValues: AcrUrn[];
  /** Device attestation result. */
  device: DeviceVerdict;
  /** Raw appraisal claim bag, for consumers that need fields the SDK doesn't model. */
  raw: Record<string, unknown>;
}
