// Idiomatic TypeScript wrapper over the N-API addon. The native side
// returns numeric status codes; this layer maps them to strongly-typed
// enums and promise-based methods so callers get the experience they
// expect from a Node SDK.

import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url ?? __filename);

// Use node-gyp-build so the addon is resolved from the prebuilt binary
// when one was shipped in the package, falling back to a from-source
// build when nothing is bundled.
let addon: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  addon = require("node-gyp-build")(path.resolve(__dirname, ".."));
} catch (err) {
  throw new Error(
    "RootHerald native binding could not be loaded. Either the prebuilt " +
    ".node binary is missing for this Node version/platform, or RootHerald.dll " +
    "is not on the loader path. Run `npm run build:native` to build from source. " +
    `Underlying error: ${(err as Error).message}`,
  );
}

export enum RootHeraldVerdict {
  Allow = 0,
  Warn = 1,
  Deny = 2,
}

export enum RootHeraldStatus {
  Ok = 0,
  InvalidArg = 1,
  TpmUnavailable = 2,
  Network = 3,
  Server = 4,
  QuotaExceeded = 5,
  Internal = 99,
}

export interface RootHeraldVerifyResult {
  verdict: RootHeraldVerdict;
  deviceId: string;
  tpmClass: string;
  postureJson: string;
  reason: string;
}

export interface RootHeraldClientOptions {
  /** Tenant publishable key (rh_pk_live_...). */
  apiKey: string;
  /** Endpoint URL — direct, custom-domain, or proxy. */
  endpoint?: string;
  /** Logical application id (audit/policy tag). */
  applicationId?: string;
}

/**
 * Wrap the N-API addon. The native ABI is synchronous; we dispatch each
 * call through a microtask so callers see a Promise-shaped API.
 */
export class RootHeraldClient {
  private readonly _native: any;
  private _destroyed = false;

  constructor(options: RootHeraldClientOptions) {
    if (!options?.apiKey) throw new TypeError("apiKey is required");
    this._native = new addon.RootHeraldNative(options.apiKey, options.endpoint);
    if (options.applicationId) {
      this._native.setApplicationId(options.applicationId);
    }
  }

  static get abiVersion(): string {
    return String(addon.abiVersion);
  }

  static get libraryVersion(): string {
    return String(addon.libraryVersion);
  }

  setEndpoint(endpoint: string): void {
    this._native.setEndpoint(endpoint);
  }

  setApplicationId(applicationId: string): void {
    this._native.setApplicationId(applicationId);
  }

  async verify(action: string = "default"): Promise<RootHeraldVerifyResult> {
    if (this._destroyed) throw new Error("RootHeraldClient has been destroyed");
    const r = await Promise.resolve(this._native.verify(action));
    if (r.status !== RootHeraldStatus.Ok) {
      const err: any = new Error(
        `RootHerald.verify failed: status=${r.status} reason=${r.reason}`,
      );
      err.status = r.status;
      err.reason = r.reason;
      throw err;
    }
    return {
      verdict: r.verdict as RootHeraldVerdict,
      deviceId: r.deviceId,
      tpmClass: r.tpmClass,
      postureJson: r.postureJson,
      reason: r.reason,
    };
  }

  destroy(): void {
    if (!this._destroyed) {
      this._destroyed = true;
      this._native.destroy();
    }
  }
}
