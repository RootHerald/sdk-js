/**
 * Why a verify verdict came out as `warn` or `fail`: the rule that decided.
 * The codes are the `enum` the platform publishes on `VerdictReasonDto.code`,
 * in its order.
 */

export const VERDICT_REASON_CODES = [
  "not_enrolled",
  "evidence_not_verified",
  "expected_device_mismatch",
  "chip_kind_not_accepted",
  "cloud_cross_check_required",
  "mac_unattested",
  "chip_reset",
  "identities_per_chip",
  "os_switch",
  "os_switches_per_window",
  "boot_log_missing",
  "secure_boot_off",
  "secure_boot_not_microsoft",
  "revoked_boot_component",
  "secure_boot_ca_2023_missing",
  "boot_stage_not_measured",
  "boot_stage_mismatch",
  "boot_changed",
  "unusual_boot_setup",
  "boot_setup_too_few_seen",
  "boot_setup_not_checked",
] as const;

export type VerdictReasonCode = (typeof VERDICT_REASON_CODES)[number];

export interface VerdictReason {
  /**
   * One of {@link VERDICT_REASON_CODES}. A newer server may send a code this
   * version does not list, so a `switch` on it needs a `default`.
   */
  code: VerdictReasonCode | (string & {});
  /** The rule that decided, in plain words. */
  text: string;
}
