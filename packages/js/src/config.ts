/**
 * RootHeraldSdkClient configuration types and defaults.
 */

import type { AcrRequestOptions, RootHeraldSdkClientOptions } from '@rootherald/contracts';
import type { TokenCache } from '@rootherald/contracts';
import { createCache } from './storage.js';

export type { RootHeraldSdkClientOptions };

export const DEFAULT_SCOPE = 'openid attestation';

/** Resolved, validated configuration used internally by RootHeraldSdkClient. */
export interface ResolvedConfig {
  issuer: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  cache: TokenCache;
  /** See RootHeraldSdkClientOptions.clientSecret for caveats. */
  clientSecret?: string;
  /** Default ACR request options applied to every loginWithRedirect call. */
  defaultAcr?: AcrRequestOptions;
}

/** Validates and resolves RootHeraldSdkClientOptions into a ResolvedConfig. */
export function resolveConfig(opts: RootHeraldSdkClientOptions): ResolvedConfig {
  if (!opts.issuer) throw new Error('RootHeraldSdkClientOptions.issuer is required');
  if (!opts.clientId) throw new Error('RootHeraldSdkClientOptions.clientId is required');
  if (!opts.redirectUri) throw new Error('RootHeraldSdkClientOptions.redirectUri is required');

  // Strip trailing slash from issuer
  const issuer = opts.issuer.replace(/\/$/, '');
  const scope = opts.scope ?? DEFAULT_SCOPE;
  const cacheLocation = opts.cacheLocation ?? 'memory';
  const cache = createCache(cacheLocation, opts.customCache);

  return {
    issuer,
    clientId: opts.clientId,
    redirectUri: opts.redirectUri,
    scope,
    cache,
    clientSecret: opts.clientSecret,
    defaultAcr: opts.defaultAcr,
  };
}
