/**
 * Fetch wrappers for the  Root Herald OAuth endpoints.
 * Uses native fetch only — no third-party HTTP client.
 */

import { RootHeraldError } from '@rootherald/contracts';

export interface BuildAuthorizeUrlOptions {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  codeChallenge: string;
  prompt?: 'login' | 'none';
  acrValues?: string[];
  maxAge?: number;
  essential?: boolean;
}

/** Builds the OAuth authorization URL with PKCE query parameters. */
export function buildAuthorizeUrl(opts: BuildAuthorizeUrlOptions): string {
  const url = new URL(opts.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', opts.clientId);
  url.searchParams.set('redirect_uri', opts.redirectUri);
  url.searchParams.set('scope', opts.scope);
  url.searchParams.set('state', opts.state);
  url.searchParams.set('code_challenge', opts.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (opts.prompt !== undefined) {
    url.searchParams.set('prompt', opts.prompt);
  }
  if (opts.acrValues !== undefined && opts.acrValues.length > 0) {
    if (opts.essential === true) {
      const claimsParam = JSON.stringify({
        id_token: { acr: { essential: true, values: opts.acrValues } },
      });
      url.searchParams.set('claims', claimsParam);
    } else {
      url.searchParams.set('acr_values', opts.acrValues.join(' '));
    }
  }
  if (opts.maxAge !== undefined) {
    url.searchParams.set('max_age', String(opts.maxAge));
  }
  return url.toString();
}

export interface TokenRequestOptions {
  tokenEndpoint: string;
  clientId: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
  /** Optional client secret — see RootHeraldSdkClientOptions.clientSecret. */
  clientSecret?: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

/** Exchanges an authorization code for a token response. */
export async function exchangeCode(
  opts: TokenRequestOptions,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: opts.code,
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    code_verifier: opts.codeVerifier,
  });
  if (opts.clientSecret) {
    body.set('client_secret', opts.clientSecret);
  }

  let response: Response;
  try {
    response = await fetch(opts.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (err) {
    throw new RootHeraldError(
      `Network error during token exchange: ${err instanceof Error ? err.message : String(err)}`,
      'NETWORK',
      err,
    );
  }

  if (!response.ok) {
    let detail = '';
    try {
      const errBody = (await response.json()) as { error?: string; error_description?: string };
      detail = errBody.error_description ?? errBody.error ?? '';
    } catch {
      // ignore parse error
    }
    throw new RootHeraldError(
      `Token exchange failed (${response.status}): ${detail}`,
      'OAUTH_ERROR',
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (err) {
    throw new RootHeraldError('Failed to parse token response', 'NETWORK', err);
  }

  return json as TokenResponse;
}
