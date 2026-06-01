import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { AttestationVerdict } from '@rootherald/contracts';
import { RootHeraldProvider } from '../src/RootHeraldProvider.js';
import { RequireAttestation } from '../src/RequireAttestation.js';

vi.mock('@rootherald/js', () => ({
  createClient: vi.fn(),
}));

import { createClient } from '@rootherald/js';

function makeVerdict(overrides: Partial<AttestationVerdict> = {}): AttestationVerdict {
  return {
    // New OIDC top-level fields
    acr: 'urn:rootherald:user:phrh',
    amr: ['pwd', 'hwk'],
    authTime: new Date(Date.now() - 10_000),
    requestedAcrValues: [],
    // Nested device
    device: {
      ueid: 'device-uuid',
      earStatus: 'affirming',
      verdict: 'pass',
      attestationType: 'tpm20',
      attestedAt: new Date(Date.now() - 10_000),
    },
    // Shared
    userId: 'user-uuid',
    expiresAt: new Date(Date.now() + 300_000),
    raw: {} as AttestationVerdict['raw'],
    // Legacy mirrors
    verdict: 'pass',
    assuranceLevel: 'high',
    attestationType: 'tpm20',
    deviceId: 'device-uuid',
    ...overrides,
  };
}

function makeFakeClient(verdict: AttestationVerdict | null) {
  return {
    loginWithRedirect: vi.fn().mockResolvedValue(undefined),
    handleRedirectCallback: vi.fn(),
    getVerdict: vi.fn().mockResolvedValue(verdict),
    logout: vi.fn().mockResolvedValue(undefined),
    getToken: vi.fn().mockResolvedValue(null),
    isVerified: vi.fn().mockResolvedValue(true),
  };
}

const defaultProviderProps = {
  issuer: 'https://rootherald.example.com',
  clientId: 'test-client',
  redirectUri: 'https://app.example.com/callback',
};

function Wrapper({ children, verdict }: { children: ReactNode; verdict: AttestationVerdict | null }) {
  (createClient as Mock).mockResolvedValue(makeFakeClient(verdict));
  return (
    <RootHeraldProvider {...defaultProviderProps}>
      {children}
    </RootHeraldProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('RequireAttestation', () => {
  it('shows login button when verdict is null', async () => {
    render(
      <Wrapper verdict={null}>
        <RequireAttestation>
          <div>protected content</div>
        </RequireAttestation>
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Verify with RootHerald' })).toBeInTheDocument();
    });

    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  it('renders custom fallback when verdict is null', async () => {
    render(
      <Wrapper verdict={null}>
        <RequireAttestation fallback={<div>custom fallback</div>}>
          <div>protected content</div>
        </RequireAttestation>
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('custom fallback')).toBeInTheDocument();
    });

    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  it('renders children when assurance level meets minLevel', async () => {
    const verdict = makeVerdict({ assuranceLevel: 'high' });

    render(
      <Wrapper verdict={verdict}>
        <RequireAttestation minLevel="high">
          <div>protected content</div>
        </RequireAttestation>
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('protected content')).toBeInTheDocument();
    });
  });

  it('renders children when assurance level exceeds minLevel', async () => {
    const verdict = makeVerdict({ assuranceLevel: 'high' });

    render(
      <Wrapper verdict={verdict}>
        <RequireAttestation minLevel="reduced">
          <div>protected content</div>
        </RequireAttestation>
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('protected content')).toBeInTheDocument();
    });
  });

  it('shows insufficient fallback when assuranceLevel is below minLevel (legacy prop)', async () => {
    // acr: user:1fa maps to rank 2 (< phrh which is rank 5), so minLevel="high" => phrh should fail
    const verdict = makeVerdict({
      acr: 'urn:rootherald:user:1fa',
      assuranceLevel: 'reduced',
      device: {
        ueid: 'device-uuid',
        earStatus: 'warning',
        verdict: 'pass',
        attestationType: 'tpm20',
        attestedAt: new Date(Date.now() - 10_000),
      },
    });

    render(
      <Wrapper verdict={verdict}>
        <RequireAttestation minLevel="high">
          <div>protected content</div>
        </RequireAttestation>
      </Wrapper>,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Device assurance level insufficient/),
      ).toBeInTheDocument();
    });

    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  it('shows custom fallback for insufficient assurance level', async () => {
    const verdict = makeVerdict({
      acr: 'urn:rootherald:user:1fa',
      assuranceLevel: 'reduced',
      device: {
        ueid: 'device-uuid',
        earStatus: 'warning',
        verdict: 'pass',
        attestationType: 'tpm20',
        attestedAt: new Date(Date.now() - 10_000),
      },
    });

    render(
      <Wrapper verdict={verdict}>
        <RequireAttestation minLevel="high" fallback={<div>need high assurance</div>}>
          <div>protected content</div>
        </RequireAttestation>
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('need high assurance')).toBeInTheDocument();
    });

    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  it('shows stale fallback when authTime exceeds maxAgeSeconds', async () => {
    const verdict = makeVerdict({
      authTime: new Date(Date.now() - 60_000), // 60 seconds ago
    });

    render(
      <Wrapper verdict={verdict}>
        <RequireAttestation minLevel="high" maxAgeSeconds={30}>
          <div>protected content</div>
        </RequireAttestation>
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Attestation is stale/)).toBeInTheDocument();
    });

    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  it('renders children when authTime is within maxAgeSeconds', async () => {
    const verdict = makeVerdict({
      authTime: new Date(Date.now() - 10_000), // 10 seconds ago
    });

    render(
      <Wrapper verdict={verdict}>
        <RequireAttestation minLevel="high" maxAgeSeconds={30}>
          <div>protected content</div>
        </RequireAttestation>
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('protected content')).toBeInTheDocument();
    });
  });

  it('renders children when minAcr is satisfied', async () => {
    const verdict = makeVerdict({ acr: 'urn:rootherald:user:phrh' });

    render(
      <Wrapper verdict={verdict}>
        <RequireAttestation minAcr="urn:rootherald:user:phr">
          <div>protected content</div>
        </RequireAttestation>
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('protected content')).toBeInTheDocument();
    });
  });

  it('blocks when minAcr is not satisfied', async () => {
    const verdict = makeVerdict({ acr: 'urn:rootherald:user:1fa' });

    render(
      <Wrapper verdict={verdict}>
        <RequireAttestation minAcr="urn:rootherald:user:phrh" fallback={<div>blocked</div>}>
          <div>protected content</div>
        </RequireAttestation>
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('blocked')).toBeInTheDocument();
    });
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  it('renders null fallback while loading', async () => {
    // Use a promise that never resolves to stay in loading state
    const neverResolves = new Promise(() => {/* intentionally never resolves */});
    (createClient as Mock).mockReturnValue(neverResolves);

    const { container } = render(
      <RootHeraldProvider {...defaultProviderProps}>
        <RequireAttestation fallback={<div>loading...</div>}>
          <div>protected content</div>
        </RequireAttestation>
      </RootHeraldProvider>,
    );

    expect(screen.getByText('loading...')).toBeInTheDocument();
    expect(container.querySelector('.protected')).toBeNull();
  });
});
