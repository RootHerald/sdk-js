import { useState } from 'react';
import type { AttestationVerdict } from '@rootherald/react';
import { useAttestation } from '@rootherald/react';

export function Success({ verdict }: { verdict: AttestationVerdict }) {
  const { logout, login, token } = useAttestation();
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  async function triggerSensitiveAction() {
    setActionLoading(true);
    setActionResult(null);
    setActionError(null);
    try {
      if (!token) {
        setActionError('No attestation token available. Please sign in again.');
        return;
      }
      const resp = await fetch('/api/sensitive-action', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.ok) {
        const data = await resp.json();
        setActionResult(data.message || 'Action authorized');
        return;
      }
      if (resp.status === 401) {
        // Step-up challenge — parse acr_values from the JSON body
        // The @rootherald/node middleware returns:
        //   { error: "insufficient_user_authentication", acr_values: ["urn:rootherald:user:phr"] }
        const body = await resp.json().catch(() => ({}));
        const required = body.acr_values as string[] | undefined;
        if (required && required.length > 0) {
          setActionError('Additional verification required. Redirecting to RootHerald...');
          // Re-initiate login with the required ACR. essential:true tells the
          // authorization server to treat this as a hard requirement (OIDC claims
          // parameter) rather than a preference hint (acr_values parameter).
          // After re-auth the user lands back here with an upgraded verdict;
          // they click the button again to complete the action.
          await login({ acrValues: required as any[], essential: true });
          return;
        }
      }
      setActionError(`Request failed (${resp.status})`);
    } catch (err: any) {
      setActionError(err.message ?? 'Unknown error');
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <main className="page">
      <header className="header">
        <h1 className="brand">AcmeCorp</h1>
      </header>
      <div className="card success">
        <div className="checkmark">&#10003;</div>
        <h2>Device Verified</h2>
        <p className="subtitle">Attestation Passed</p>

        <dl className="details">
          <dt>Assurance Level</dt>
          <dd className={`level ${verdict.acr}`}>{verdict.acr}</dd>
          <dt>Auth Methods</dt>
          <dd>{verdict.amr.join(', ')}</dd>
          <dt>Device Trust</dt>
          <dd>{verdict.device.earStatus}</dd>
          <dt>Attestation Type</dt>
          <dd>{verdict.device.attestationType}</dd>
          <dt>Platform</dt>
          <dd>{verdict.device.platform ?? '—'}</dd>
          <dt>Hardware</dt>
          <dd>{verdict.device.hardwareModel ?? '—'}</dd>
          <dt>Attested</dt>
          <dd>{verdict.device.attestedAt.toLocaleString()}</dd>
          <dt>Authenticated</dt>
          <dd>{verdict.authTime.toLocaleString()}</dd>
          <dt>Expires</dt>
          <dd>{verdict.expiresAt.toLocaleString()}</dd>
        </dl>

        {/* Sensitive action section — requires phishing-resistant auth (RFC 9470 step-up) */}
        <div className="sensitive-action">
          <h3>Sensitive action</h3>
          <p>Authorizing a wire transfer requires phishing-resistant authentication.</p>
          <button
            className="btn btn-danger"
            onClick={triggerSensitiveAction}
            disabled={actionLoading}
          >
            {actionLoading ? 'Authorizing...' : 'Authorize wire transfer'}
          </button>
          {actionResult && <p className="action-result">{actionResult}</p>}
          {actionError && <p className="action-error">{actionError}</p>}
        </div>

        <button className="btn" onClick={() => logout({ returnTo: '/' })}>Sign out</button>
      </div>
    </main>
  );
}
