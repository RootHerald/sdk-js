import { InjectionToken } from "@angular/core";
import type {
  AcrRequestOptions,
  RootHeraldProviderProps,
} from "@rootherald/contracts";

export interface RootHeraldAngularOptions
  extends Omit<RootHeraldProviderProps, "children"> {
  /** Optional client secret for confidential clients. */
  clientSecret?: string;
  /** Default ACR / step-up parameters for login flows. */
  defaultAcr?: AcrRequestOptions;
}

/**
 * DI token holding the configured Root Herald options. Provided by
 * `provideRootHerald(...)` and consumed by `RootHeraldService`.
 */
export const ROOTHERALD_OPTIONS = new InjectionToken<RootHeraldAngularOptions>(
  "ROOTHERALD_OPTIONS",
);
