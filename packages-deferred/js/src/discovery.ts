/**
 * OIDC discovery document fetching with fallback to hardcoded endpoints.
 *
 * RootHerald may not always expose a discovery document. When the endpoint
 * returns 404 or the fetch fails, we fall back to the known RootHerald
 * endpoint conventions.
 */

import { RootHeraldError } from '@rootherald/contracts';

export interface DiscoveredEndpoints {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  issuer: string;
}

function hardcodedEndpoints(issuer: string): DiscoveredEndpoints {
  // JWKS lives at the spec-standard /.well-known path (unversioned), so that
  // third-party JWT libraries can discover it via the iss claim + the RFC
  // 8414 convention. OAuth flow endpoints are under /api/v1 for versioning.
  return {
    authorization_endpoint: `${issuer}/api/v1/oauth/authorize`,
    token_endpoint: `${issuer}/api/v1/token`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    issuer,
  };
}

/**
 * Attempts to fetch the OIDC discovery document.
 * Tries `{issuer}/api/v1/.well-known/openid-configuration` first,
 * then `{issuer}/.well-known/openid-configuration`.
 * Falls back to hardcoded paths on any non-2xx response or network error.
 */
export async function discoverEndpoints(
  issuer: string,
): Promise<DiscoveredEndpoints> {
  const candidates = [
    `${issuer}/api/v1/.well-known/openid-configuration`,
    `${issuer}/.well-known/openid-configuration`,
  ];

  for (const url of candidates) {
    let response: Response;
    try {
      response = await fetch(url, { headers: { Accept: 'application/json' } });
    } catch {
      // Network error — try next candidate
      continue;
    }

    if (!response.ok) continue;

    let doc: Partial<DiscoveredEndpoints>;
    try {
      doc = (await response.json()) as Partial<DiscoveredEndpoints>;
    } catch {
      throw new RootHeraldError(
        'Failed to parse OIDC discovery document',
        'NETWORK',
      );
    }

    if (doc.authorization_endpoint && doc.token_endpoint && doc.jwks_uri) {
      return {
        authorization_endpoint: doc.authorization_endpoint,
        token_endpoint: doc.token_endpoint,
        jwks_uri: doc.jwks_uri,
        issuer: doc.issuer ?? issuer,
      };
    }
  }

  // All candidates failed — use hardcoded fallback
  return hardcodedEndpoints(issuer);
}
