import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// Loads @rootherald/contracts the way a consumer does: through its package
// exports, from the built dist, in both formats.
const require = createRequire(import.meta.url);

describe("@rootherald/contracts dist", () => {
  it("exports EK_CHAIN_FAILURE_KINDS from /server under ESM and CJS alike", async () => {
    const esm = await import("@rootherald/contracts/server");
    const cjs = require("@rootherald/contracts/server");
    expect(esm.EK_CHAIN_FAILURE_KINDS, "ESM /server exports EK_CHAIN_FAILURE_KINDS").toBeInstanceOf(Array);
    expect(esm.EK_CHAIN_FAILURE_KINDS.length).toBeGreaterThan(0);
    expect(cjs.EK_CHAIN_FAILURE_KINDS, "CJS /server exports EK_CHAIN_FAILURE_KINDS").toEqual(esm.EK_CHAIN_FAILURE_KINDS);
  });

  it("gives /server and the root one InvalidEvidenceError class per format", async () => {
    const esmServer = await import("@rootherald/contracts/server");
    const esmRoot = await import("@rootherald/contracts");
    expect(esmServer.InvalidEvidenceError).toBe(esmRoot.InvalidEvidenceError);

    const cjsServer = require("@rootherald/contracts/server");
    const cjsRoot = require("@rootherald/contracts");
    expect(cjsServer.InvalidEvidenceError).toBe(cjsRoot.InvalidEvidenceError);
  });
});
