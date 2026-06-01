import { RootHeraldProvider, useAttestation } from '@rootherald/react';
import type { AttestationVerdict } from '@rootherald/react';
import { Landing } from './pages/Landing';
import { Success } from './pages/Success';

const config = {
  // Public-facing  Root Herald host (serves UI + reverse-proxies /api/* and
  // /.well-known/* to the backend). Browser only ever talks to :3000.
  issuer: 'http://localhost:3000',
  clientId: 'plat_test_rp',
  // demo-only — see README for production guidance
  clientSecret: 'rootherald_test_secret_do_not_use_in_production',
  redirectUri: 'http://localhost:4000/callback',
  // sessionStorage is required so PKCE state (code_verifier, state nonce)
  // survives the browser navigation through the OAuth redirect. MemoryCache
  // is ephemeral per page load and will produce a state mismatch on callback.
  cacheLocation: 'sessionStorage' as const,
};

export default function App() {
  return (
    <RootHeraldProvider
      issuer={config.issuer}
      clientId={config.clientId}
      clientSecret={config.clientSecret}
      redirectUri={config.redirectUri}
      cacheLocation={config.cacheLocation}
    >
      <AppInner />
    </RootHeraldProvider>
  );
}

function AppInner() {
  const { verdict, isLoading, error } = useAttestation();

  if (isLoading) return <LoadingView />;
  if (error) return <ErrorView error={error} />;
  if (verdict) return <Success verdict={verdict as AttestationVerdict} />;
  return <Landing />;
}

function LoadingView() {
  return (
    <main className="page">
      <div className="card">
        <div className="spinner" />
        <p>Verifying device...</p>
      </div>
    </main>
  );
}

function ErrorView({ error }: { error: Error }) {
  return (
    <main className="page">
      <div className="card error">
        <h1>Verification Failed</h1>
        <p>{error.message}</p>
        <a href="/" className="btn">Try Again</a>
      </div>
    </main>
  );
}
