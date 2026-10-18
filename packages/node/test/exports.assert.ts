// Compile-time checks on what @rootherald/node exports. Checked by
// tsconfig.test.json; never run.

import type {
  AttestResult,
  EkChainFailure,
  EkChainFailureKind,
  RootHeraldApiError,
  VerdictReason,
  VerdictReasonCode,
} from "../src/index.js";

const mismatchReason = {
  code: "expected_device_mismatch",
  text: "This is not one of the expected devices.",
} satisfies VerdictReason;

const mismatchCode: VerdictReasonCode = mismatchReason.code;

// verify's result types the reason as VerdictReason, absent on a pass.
const resultReason: VerdictReason | undefined = ({} as AttestResult).reason;
const typedReason: AttestResult["reason"] = undefined as VerdictReason | undefined;

const revokedChain = {
  kind: "revoked",
  policyCanAdmit: true,
} satisfies EkChainFailure;

const refusalKind: EkChainFailureKind | undefined = ({} as RootHeraldApiError).chainFailure;
const refusalCanAdmit: boolean | undefined = ({} as RootHeraldApiError).policyCanAdmit;

export const __exportAssertions = [
  mismatchReason,
  mismatchCode,
  resultReason,
  typedReason,
  revokedChain,
  refusalKind,
  refusalCanAdmit,
] as const;
