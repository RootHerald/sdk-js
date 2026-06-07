import { useCallback, useContext } from 'react';
import type { AcrUrn, LoginOptions, UseAttestationResult } from '@rootherald/contracts';
import { RootHeraldContext } from './context.js';

export function useAttestation(): UseAttestationResult {
  const ctx = useContext(RootHeraldContext);
  if (!ctx) throw new Error('useAttestation must be used inside <RootHeraldProvider>');

  const login = useCallback(
    async (options?: LoginOptions & {
      acrValues?: AcrUrn[];
      maxAge?: number;
      essential?: boolean;
    }) => {
      if (!ctx.client) throw new Error('RootHerald client not initialized');
      await ctx.client.loginWithRedirect(options);
    },
    [ctx.client],
  );

  const logout = useCallback(
    async (options?: { returnTo?: string }) => {
      if (!ctx.client) throw new Error('RootHerald client not initialized');
      await ctx.client.logout(options);
      await ctx.refresh();
    },
    [ctx.client, ctx.refresh],
  );

  return {
    verdict: ctx.verdict,
    isLoading: ctx.isLoading,
    isAuthenticated: ctx.verdict !== null,
    error: ctx.error,
    token: ctx.token,
    login,
    logout,
  };
}
