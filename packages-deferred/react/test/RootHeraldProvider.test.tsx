import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useContext } from 'react';
import type { AttestationVerdict } from '@rootherald/contracts';
import { RootHeraldProvider } from '../src/RootHeraldProvider.js';
import { RootHeraldContext } from '../src/context.js';

vi.mock('@rootherald/js', () => ({
  createClient: vi.fn(),
}));

import { createClient } from '@rootherald/js';

const mockVerdict: AttestationVerdict = {
  // New OIDC top-level fields
  acr: 'urn:rootherald:user:phrh',
  amr: ['pwd', 'hwk'],
  authTime: new Date('2026-04-11T09:59:50Z'),
  requestedAcrValues: [],
  // Nested device
  device: {
    ueid: 'device-uuid',
    earStatus: 'affirming',
    verdict: 'pass',
    attestationType: 'tpm20',
    attestedAt: new Date('2026-04-11T09:59:50Z'),
  },
  // Shared
  userId: 'user-uuid',
  expiresAt: new Date('2026-04-11T10:05:00Z'),
  raw: {} as AttestationVerdict['raw'],
  // Legacy mirrors
  verdict: 'pass',
  assuranceLevel: 'high',
  attestationType: 'tpm20',
  deviceId: 'device-uuid',
};

function makeFakeClient(overrides: Record<string, unknown> = {}) {
  return {
    loginWithRedirect: vi.fn(),
    handleRedirectCallback: vi.fn().mockResolvedValue(mockVerdict),
    getVerdict: vi.fn().mockResolvedValue(mockVerdict),
    logout: vi.fn(),
    getToken: vi.fn().mockResolvedValue(null),
    isVerified: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

const defaultProps = {
  issuer: 'https://rootherald.example.com',
  clientId: 'test-client',
  redirectUri: 'https://app.example.com/callback',
};

beforeEach(() => {
  vi.clearAllMocks();
  // Reset URL to clean state
  window.history.replaceState(null, '', '/');
});

describe('RootHeraldProvider', () => {
  it('renders children after client initializes', async () => {
    (createClient as Mock).mockResolvedValue(makeFakeClient());

    render(
      <RootHeraldProvider {...defaultProps}>
        <div>child content</div>
      </RootHeraldProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('child content')).toBeInTheDocument();
    });
  });

  it('provides verdict in context after initialization', async () => {
    const fakeClient = makeFakeClient();
    (createClient as Mock).mockResolvedValue(fakeClient);

    let capturedVerdict: AttestationVerdict | null = null;

    function Consumer() {
      const ctx = useContext(RootHeraldContext);
      capturedVerdict = ctx?.verdict ?? null;
      return <div>{ctx?.isLoading ? 'loading' : 'ready'}</div>;
    }

    render(
      <RootHeraldProvider {...defaultProps}>
        <Consumer />
      </RootHeraldProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('ready')).toBeInTheDocument();
    });

    expect(capturedVerdict).toEqual(mockVerdict);
  });

  it('handles OAuth callback when code and state params are present', async () => {
    const fakeClient = makeFakeClient();
    (createClient as Mock).mockResolvedValue(fakeClient);

    // Simulate callback URL
    window.history.replaceState(null, '', '/?code=authcode&state=randomstate');

    let capturedVerdict: AttestationVerdict | null = null;

    function Consumer() {
      const ctx = useContext(RootHeraldContext);
      capturedVerdict = ctx?.verdict ?? null;
      return <div>{ctx?.isLoading ? 'loading' : 'ready'}</div>;
    }

    render(
      <RootHeraldProvider {...defaultProps}>
        <Consumer />
      </RootHeraldProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('ready')).toBeInTheDocument();
    });

    expect(fakeClient.handleRedirectCallback).toHaveBeenCalledOnce();
    expect(fakeClient.getVerdict).not.toHaveBeenCalled();
    expect(capturedVerdict).toEqual(mockVerdict);

    // URL should be cleaned
    expect(window.location.search).toBe('');
    expect(window.location.pathname).toBe('/');
  });

  it('cleans the URL after OAuth callback', async () => {
    const fakeClient = makeFakeClient();
    (createClient as Mock).mockResolvedValue(fakeClient);

    window.history.replaceState(null, '', '/callback?code=abc&state=xyz');

    render(
      <RootHeraldProvider {...defaultProps}>
        <div>child</div>
      </RootHeraldProvider>,
    );

    await waitFor(() => {
      expect(fakeClient.handleRedirectCallback).toHaveBeenCalledOnce();
    });

    expect(window.location.search).toBe('');
  });

  it('sets error state when createClient throws', async () => {
    const boom = new Error('Network failure');
    (createClient as Mock).mockRejectedValue(boom);

    let capturedError: Error | null = null;

    function Consumer() {
      const ctx = useContext(RootHeraldContext);
      capturedError = ctx?.error ?? null;
      return <div>{ctx?.isLoading ? 'loading' : 'done'}</div>;
    }

    render(
      <RootHeraldProvider {...defaultProps}>
        <Consumer />
      </RootHeraldProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('done')).toBeInTheDocument();
    });

    expect(capturedError).toEqual(boom);
  });

  it('wraps non-Error throws in an Error', async () => {
    (createClient as Mock).mockRejectedValue('string error');

    let capturedError: Error | null = null;

    function Consumer() {
      const ctx = useContext(RootHeraldContext);
      capturedError = ctx?.error ?? null;
      return <div>{ctx?.isLoading ? 'loading' : 'done'}</div>;
    }

    render(
      <RootHeraldProvider {...defaultProps}>
        <Consumer />
      </RootHeraldProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('done')).toBeInTheDocument();
    });

    expect(capturedError).toBeInstanceOf(Error);
    expect(capturedError?.message).toBe('string error');
  });
});
