import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createClient } from '@rootherald/js';
import type {
  AcrRequestOptions,
  AttestationVerdict,
  RootHeraldProviderProps,
} from '@rootherald/contracts';
import type { RootHeraldSdkClient } from '@rootherald/contracts';
import { RootHeraldContext } from './context.js';

interface ProviderProps extends Omit<RootHeraldProviderProps, 'children'> {
  children: ReactNode;
  clientSecret?: string;
  defaultAcr?: AcrRequestOptions;
}

interface ProviderState {
  verdict: AttestationVerdict | null;
  isLoading: boolean;
  error: Error | null;
  token: string | null;
}

export function RootHeraldProvider({
  issuer,
  clientId,
  redirectUri,
  scope,
  cacheLocation,
  clientSecret,
  defaultAcr,
  children,
}: ProviderProps): JSX.Element {
  const clientRef = useRef<RootHeraldSdkClient | null>(null);
  const [state, setState] = useState<ProviderState>({
    verdict: null,
    isLoading: true,
    error: null,
    token: null,
  });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const client = await createClient({
          issuer,
          clientId,
          redirectUri,
          scope,
          cacheLocation,
          clientSecret,
          defaultAcr,
        });

        if (cancelled) return;
        clientRef.current = client;

        // Handle OAuth callback if present
        const url = new URL(window.location.href);
        if (url.searchParams.has('code') && url.searchParams.has('state')) {
          const verdict = await client.handleRedirectCallback();
          const token = await client.getToken();
          const cleanUrl = `${url.pathname}${url.hash}`;
          window.history.replaceState(null, '', cleanUrl);
          if (!cancelled) setState({ verdict, isLoading: false, error: null, token });
          return;
        }

        // Otherwise load verdict from cache (may be null)
        const verdict = await client.getVerdict();
        const token = await client.getToken();
        if (!cancelled) setState({ verdict, isLoading: false, error: null, token });
      } catch (err) {
        if (!cancelled) {
          setState({
            verdict: null,
            isLoading: false,
            error: err instanceof Error ? err : new Error(String(err)),
            token: null,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [issuer, clientId, redirectUri, scope, cacheLocation, clientSecret, defaultAcr]);

  const refresh = useCallback(async () => {
    if (!clientRef.current) return;
    const verdict = await clientRef.current.getVerdict();
    const token = await clientRef.current.getToken();
    setState(s => ({ ...s, verdict, token }));
  }, []);

  const isAuthenticated = state.verdict !== null;

  return (
    <RootHeraldContext.Provider
      value={{
        client: clientRef.current,
        verdict: state.verdict,
        isLoading: state.isLoading,
        isAuthenticated,
        error: state.error,
        token: state.token,
        refresh,
      }}
    >
      {children}
    </RootHeraldContext.Provider>
  );
}
