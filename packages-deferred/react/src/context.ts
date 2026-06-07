import { createContext } from 'react';
import type { RootHeraldSdkClient, AttestationVerdict } from '@rootherald/contracts';

export interface RootHeraldContextValue {
  client: RootHeraldSdkClient | null;
  verdict: AttestationVerdict | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: Error | null;
  token: string | null;
  refresh: () => Promise<void>;
}

export const RootHeraldContext = createContext<RootHeraldContextValue | null>(null);
