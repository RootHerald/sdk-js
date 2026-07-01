/**
 * RootHeraldSdkClient — the main entry point for the browser SDK.
 *
 * Implements the RootHeraldSdkClient interface from @rootherald/contracts.
 * All OAuth/PKCE/JWT logic is delegated to purpose-specific modules.
 */

import type {
  RootHeraldSdkClient as IRootHeraldSdkClient,
  RootHeraldSdkClientOptions,
  AttestationVerdict,
  AssuranceLevel,
  AcrUrn,
  AcrRequestOptions,
} from '@rootherald/contracts';
import {
  RootHeraldError,
  InsufficientAssuranceError,
  InsufficientAcrError,
  StaleAttestationError,
  AuthenticationTooOldError,
} from '@rootherald/contracts';
import { resolveConfig, type ResolvedConfig } from './config.js';
import { discoverEndpoints, type DiscoveredEndpoints } from './discovery.js';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
} from './pkce.js';
import { buildAuthorizeUrl, exchangeCode } from './transport.js';
import { verifyAndMapToken } from './tokens.js';
import type { JWTVerifyGetKey } from 'jose';

// Cache key constants
const KEY_VERIFIER = 'rootherald:pkce:verifier';
const KEY_STATE = 'rootherald:pkce:state';
const KEY_VERDICT = 'rootherald:verdict';
const KEY_TOKEN = 'rootherald:token';

/** Ordering for assurance level comparisons (legacy). */
const ASSURANCE_ORDER: Record<AssuranceLevel, number> = {
  unverified: 0,
  reduced: 1,
  high: 2,
};

/** Canonical rank order for ACR URNs. Higher index = higher assurance. */
const ACR_ORDER: AcrUrn[] = [
  'urn:rootherald:device:any',
  'urn:rootherald:device:high',
  'urn:rootherald:user:1fa',
  'urn:rootherald:user:2fa',
  'urn:rootherald:user:phr',
  'urn:rootherald:user:phrh',
  'urn:rootherald:user:phrh:fresh',
];

function acrRank(urn: AcrUrn): number {
  return ACR_ORDER.indexOf(urn);
}

/** Maps legacy assurance level to equivalent minimum ACR URN. */
function legacyLevelToMinAcr(level: AssuranceLevel): AcrUrn {
  if (level === 'high') return 'urn:rootherald:user:phrh';
  if (level === 'reduced') return 'urn:rootherald:user:1fa';
  return 'urn:rootherald:device:any';
}

export class RootHeraldSdkClient implements IRootHeraldSdkClient {
  private readonly _config: ResolvedConfig;
  private _endpoints: DiscoveredEndpoints | null = null;
  /** Internal test hook: override JWKS resolver to avoid real HTTP calls. */
  _jwksResolver?: JWTVerifyGetKey;

  constructor(config: ResolvedConfig, endpoints: DiscoveredEndpoints | null = null) {
    this._config = config;
    this._endpoints = endpoints;
  }

  private async _getEndpoints(): Promise<DiscoveredEndpoints> {
    if (this._endpoints === null) {
      this._endpoints = await discoverEndpoints(this._config.issuer);
    }
    return this._endpoints;
  }

  async loginWithRedirect(options?: {
    prompt?: 'login' | 'none';
    state?: string;
    acrValues?: AcrUrn[] | string[];
    maxAge?: number;
    essential?: boolean;
  }): Promise<void> {
    const endpoints = await this._getEndpoints();

    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    const state = options?.state ?? generateState();

    const cache = this._config.cache;
    // Store PKCE artifacts — no TTL: they're cleared after callback
    await cache.set(KEY_VERIFIER, verifier);
    await cache.set(KEY_STATE, state);

    // Merge defaultAcr from config with per-call options.
    // Per-call values override defaults; essential=true wins (never downgraded).
    const defaults: AcrRequestOptions = this._config.defaultAcr ?? {};
    const mergedAcrValues = options?.acrValues ?? defaults.acrValues;
    const mergedMaxAge = options?.maxAge ?? defaults.maxAge;
    const mergedEssential = options?.essential === false
      ? false
      : (options?.essential || defaults.essential);

    const authorizeUrl = buildAuthorizeUrl({
      authorizationEndpoint: endpoints.authorization_endpoint,
      clientId: this._config.clientId,
      redirectUri: this._config.redirectUri,
      scope: this._config.scope,
      state,
      codeChallenge: challenge,
      prompt: options?.prompt,
      acrValues: mergedAcrValues as string[] | undefined,
      maxAge: mergedMaxAge,
      essential: mergedEssential,
    });

    window.location.assign(authorizeUrl);
  }

  async handleRedirectCallback(url?: string): Promise<AttestationVerdict> {
    const callbackUrl = url ?? window.location.href;
    const params = new URL(callbackUrl).searchParams;

    const error = params.get('error');
    if (error !== null) {
      const description = params.get('error_description') ?? error;
      throw new RootHeraldError(
        `OAuth error: ${description}`,
        'OAUTH_ERROR',
      );
    }

    const code = params.get('code');
    const incomingState = params.get('state');

    if (code === null) {
      throw new RootHeraldError('No authorization code in callback URL', 'OAUTH_ERROR');
    }

    const cache = this._config.cache;

    // Validate state
    const storedState = await cache.get(KEY_STATE);
    if (storedState === null || storedState !== incomingState) {
      throw new RootHeraldError(
        'OAuth state parameter mismatch — possible CSRF attack',
        'STATE_MISMATCH',
      );
    }

    const verifier = await cache.get(KEY_VERIFIER);
    if (verifier === null) {
      throw new RootHeraldError('No PKCE code_verifier in cache', 'OAUTH_ERROR');
    }

    // Exchange code for token
    const endpoints = await this._getEndpoints();
    const tokenResponse = await exchangeCode({
      tokenEndpoint: endpoints.token_endpoint,
      clientId: this._config.clientId,
      redirectUri: this._config.redirectUri,
      code,
      codeVerifier: verifier,
      clientSecret: this._config.clientSecret,
    });

    // Verify and map the EAT JWT
    const verdict = await verifyAndMapToken(tokenResponse.access_token, {
      jwksUri: endpoints.jwks_uri,
      issuer: endpoints.issuer,
      audience: this._config.clientId,
      _jwks: this._jwksResolver,
    });

    // Cache verdict + raw token
    await cache.set(KEY_VERDICT, JSON.stringify(verdict), tokenResponse.expires_in);
    await cache.set(KEY_TOKEN, tokenResponse.access_token, tokenResponse.expires_in);

    // Clear PKCE artifacts
    await cache.delete(KEY_VERIFIER);
    await cache.delete(KEY_STATE);

    return verdict;
  }

  async getVerdict(): Promise<AttestationVerdict | null> {
    const raw = await this._config.cache.get(KEY_VERDICT);
    if (raw === null) return null;

    let verdict: AttestationVerdict;
    try {
      verdict = JSON.parse(raw) as AttestationVerdict;
    } catch {
      await this._config.cache.delete(KEY_VERDICT);
      return null;
    }

    // Re-hydrate Date objects (JSON.parse gives strings)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = verdict as any;
    if (v.attestedAt) v.attestedAt = new Date(v.attestedAt);
    verdict.expiresAt = new Date(verdict.expiresAt);
    if (verdict.authTime) verdict.authTime = new Date(verdict.authTime);
    if (verdict.device?.attestedAt) {
      verdict.device.attestedAt = new Date(verdict.device.attestedAt);
    }

    // Check expiry (belt-and-suspenders — cache TTL handles it too)
    if (Date.now() >= verdict.expiresAt.getTime()) {
      await this._config.cache.delete(KEY_VERDICT);
      await this._config.cache.delete(KEY_TOKEN);
      return null;
    }

    return verdict;
  }

  async getToken(): Promise<string | null> {
    return this._config.cache.get(KEY_TOKEN);
  }

  async isVerified(options?: {
    minAcr?: AcrUrn;
    minAcrTier?: 'any' | 'high' | 'user1fa' | 'user2fa' | 'phr' | 'phrh';
    maxAgeSeconds?: number;
    /** @deprecated use minAcr instead */
    minLevel?: AssuranceLevel;
  }): Promise<boolean> {
    const verdict = await this.getVerdict();
    if (verdict === null) return false;

    // New ACR-based check (preferred): minAcr or minAcrTier
    if (options?.minAcr !== undefined || options?.minAcrTier !== undefined) {
      let effectiveMinAcr: AcrUrn | undefined = options.minAcr;
      if (!effectiveMinAcr && options.minAcrTier !== undefined) {
        const tierMap: Record<string, AcrUrn> = {
          any: 'urn:rootherald:device:any',
          high: 'urn:rootherald:device:high',
          user1fa: 'urn:rootherald:user:1fa',
          user2fa: 'urn:rootherald:user:2fa',
          phr: 'urn:rootherald:user:phr',
          phrh: 'urn:rootherald:user:phrh',
        };
        effectiveMinAcr = tierMap[options.minAcrTier];
      }
      if (effectiveMinAcr !== undefined) {
        const verdictAcr = verdict.acr ?? ('urn:rootherald:device:any' as AcrUrn);
        if (acrRank(verdictAcr) < acrRank(effectiveMinAcr)) {
          throw new InsufficientAcrError(effectiveMinAcr, verdictAcr);
        }
      }
    }

    // Legacy minLevel check — keeps original InsufficientAssuranceError for back-compat
    if (options?.minLevel !== undefined) {
      const required = ASSURANCE_ORDER[options.minLevel];
      const actual = ASSURANCE_ORDER[verdict.assuranceLevel ?? 'unverified'];
      if (actual < required) {
        throw new InsufficientAssuranceError();
      }
    }

    if (options?.maxAgeSeconds !== undefined) {
      const authTime = verdict.authTime ?? (verdict as any).attestedAt;
      if (authTime instanceof Date) {
        const ageMs = Date.now() - authTime.getTime();
        if (ageMs > options.maxAgeSeconds * 1000) {
          throw new AuthenticationTooOldError(
            Math.floor(authTime.getTime() / 1000),
            options.maxAgeSeconds,
          );
        }
      }
    }

    return true;
  }

  async logout(options?: { returnTo?: string }): Promise<void> {
    await this._config.cache.delete(KEY_VERDICT);
    await this._config.cache.delete(KEY_TOKEN);
    await this._config.cache.delete(KEY_VERIFIER);
    await this._config.cache.delete(KEY_STATE);

    // TODO: Wire server-side token revocation here once RootHerald exposes
    // a revocation endpoint at /api/v1/oauth/revoke (RFC 7009). For now,
    // tokens are short-lived (5 min) so client-side removal is sufficient.

    if (options?.returnTo !== undefined) {
      window.location.assign(options.returnTo);
    }
  }
}

/**
 * Factory function that initializes the client and pre-fetches the
 * OIDC discovery document so the first redirect is instant.
 */
export async function createClient(
  opts: RootHeraldSdkClientOptions,
): Promise<RootHeraldSdkClient> {
  const config = resolveConfig(opts);
  const endpoints = await discoverEndpoints(config.issuer);
  return new RootHeraldSdkClient(config, endpoints);
}
