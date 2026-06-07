import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { AttestationVerdict } from '@rootherald/contracts';
import { useAttestation } from '../src/useAttestation.js';
import { RootHeraldProvider } from '../src/RootHeraldProvider.js';

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
    loginWithRedirect: vi.fn().mockResolvedValue(undefined),
    handleRedirectCallback: vi.fn().mockResolvedValue(mockVerdict),
    getVerdict: vi.fn().mockResolvedValue(mockVerdict),
    logout: vi.fn().mockResolvedValue(undefined),
    getToken: vi.fn().mockResolvedValue(null),
    isVerified: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

const defaultProviderProps = {
  issuer: 'https://rootherald.example.com',
  clientId: 'test-client',
  redirectUri: 'https://app.example.com/callback',
};

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

function makeWrapper(fakeClient: ReturnType<typeof makeFakeClient>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <RootHeraldProvider {...defaultProviderProps}>
        {children}
      </RootHeraldProvider>
    );
  };
}

describe('useAttestation', () => {
  it('throws when used outside RootHeraldProvider', () => {
    expect(() => {
      renderHook(() => useAttestation());
    }).toThrow('useAttestation must be used inside <RootHeraldProvider>');
  });

  it('returns verdict, isLoading, isAuthenticated, error, login, logout', async () => {
    const fakeClient = makeFakeClient();
    (createClient as Mock).mockResolvedValue(fakeClient);

    const { result } = renderHook(() => useAttestation(), {
      wrapper: makeWrapper(fakeClient),
    });

    // Initially loading
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.verdict).toEqual(mockVerdict);
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.error).toBeNull();
    expect(typeof result.current.login).toBe('function');
    expect(typeof result.current.logout).toBe('function');
  });

  it('isAuthenticated is false when verdict is null', async () => {
    const fakeClient = makeFakeClient({ getVerdict: vi.fn().mockResolvedValue(null) });
    (createClient as Mock).mockResolvedValue(fakeClient);

    const { result } = renderHook(() => useAttestation(), {
      wrapper: makeWrapper(fakeClient),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.verdict).toBeNull();
  });

  it('login() calls client.loginWithRedirect()', async () => {
    const fakeClient = makeFakeClient();
    (createClient as Mock).mockResolvedValue(fakeClient);

    const { result } = renderHook(() => useAttestation(), {
      wrapper: makeWrapper(fakeClient),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.login({ prompt: 'login' });
    });

    expect(fakeClient.loginWithRedirect).toHaveBeenCalledWith({ prompt: 'login' });
  });

  it('login() with no options calls loginWithRedirect with undefined', async () => {
    const fakeClient = makeFakeClient();
    (createClient as Mock).mockResolvedValue(fakeClient);

    const { result } = renderHook(() => useAttestation(), {
      wrapper: makeWrapper(fakeClient),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.login();
    });

    expect(fakeClient.loginWithRedirect).toHaveBeenCalledWith(undefined);
  });

  it('logout() calls client.logout() and refreshes', async () => {
    const fakeClient = makeFakeClient();
    (createClient as Mock).mockResolvedValue(fakeClient);

    const { result } = renderHook(() => useAttestation(), {
      wrapper: makeWrapper(fakeClient),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // After logout, getVerdict returns null
    fakeClient.getVerdict.mockResolvedValueOnce(null);

    await act(async () => {
      await result.current.logout({ returnTo: '/home' });
    });

    expect(fakeClient.logout).toHaveBeenCalledWith({ returnTo: '/home' });
    // getVerdict should have been called twice: once on mount and once on refresh
    expect(fakeClient.getVerdict).toHaveBeenCalledTimes(2);
  });
});
