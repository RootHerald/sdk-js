/**
 * How the EK certificate chain failed, on a `400 ek_chain_rejected`
 * enrollment refusal. The kinds are the `enum` the platform publishes on
 * `EnrollmentRefusal.chainFailure`, in its order.
 */

export const EK_CHAIN_FAILURE_KINDS = [
  "other",
  "key_mismatch",
  "not_trusted",
  "chain_incomplete",
  "chain_fetch_failed",
  "cert_missing",
  "per_chip_ca_missing",
  "revoked",
] as const;

export type EkChainFailureKind = (typeof EK_CHAIN_FAILURE_KINDS)[number];

export interface EkChainFailure {
  kind: EkChainFailureKind;
  /** The server's answer: whether some policy could admit this device. */
  policyCanAdmit: boolean;
}
