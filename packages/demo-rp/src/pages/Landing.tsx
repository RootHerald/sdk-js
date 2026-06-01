import { useAttestation } from '@rootherald/react';

export function Landing() {
  const { login } = useAttestation();

  return (
    <main className="page">
      <header className="header">
        <h1 className="brand">AcmeCorp</h1>
      </header>
      <div className="card">
        <h2>Sign in</h2>
        <p>AcmeCorp uses  Root Herald to verify that your device is secure before you sign in.</p>
        <button className="btn btn-primary" onClick={() => login()}>
          Verify with RootHerald
        </button>
        <p className="footer-note">
           Root Herald uses hardware-level device attestation. No personal data is shared with AcmeCorp.
        </p>
      </div>
    </main>
  );
}
