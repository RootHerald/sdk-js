/**
 * Hook tests using react-test-renderer. We avoid @testing-library/react-native
 * because it requires a real RN runtime; the hook logic is platform-agnostic
 * and only needs React's scheduler.
 */

import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useVerifyDevice, getOrCreateSharedClient, _resetSharedClientForTesting } from '../src/hooks';
import { useDevicePosture } from '../src/hooks';
import { RootHeraldClient } from '../src/client';
import { __setMockNative, __resetMockNative } from './__mocks__/react-native';
import type { UseVerifyDeviceResult, VerifyResult } from '../src/types';

function flushMicrotasks() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function Probe(props: {
  action: string;
  autoStart?: boolean;
  client: RootHeraldClient;
  onState: (s: UseVerifyDeviceResult) => void;
}) {
  const state = useVerifyDevice({ action: props.action, autoStart: props.autoStart, client: props.client });
  props.onState(state);
  return null;
}

describe('useVerifyDevice', () => {
  let renderer: TestRenderer.ReactTestRenderer | null = null;

  beforeEach(() => {
    _resetSharedClientForTesting();
  });

  afterEach(() => {
    if (renderer) {
      act(() => {
        renderer!.unmount();
      });
      renderer = null;
    }
    __resetMockNative();
  });

  it('starts with loading=false, error=null, result=null when autoStart is false', async () => {
    __setMockNative({ create: jest.fn().mockResolvedValue('h'), verify: jest.fn() });
    const client = new RootHeraldClient({ apiKey: 'k' });

    let captured: UseVerifyDeviceResult | null = null;
    act(() => {
      renderer = TestRenderer.create(
        <Probe action="signup" client={client} onState={(s) => (captured = s)} />,
      );
    });

    expect(captured!.loading).toBe(false);
    expect(captured!.error).toBeNull();
    expect(captured!.result).toBeNull();
    expect(typeof captured!.verify).toBe('function');
  });

  it('autoStart fires verify() once on mount and populates result', async () => {
    const verifyResult: VerifyResult = {
      verdict: 'allow',
      deviceId: 'd',
      tpmClass: 'tpm20',
      posture: '{}',
      reason: 'ok',
    };
    const verify = jest.fn().mockResolvedValue(verifyResult);
    __setMockNative({ create: jest.fn().mockResolvedValue('h'), verify });
    const client = new RootHeraldClient({ apiKey: 'k' });

    let captured: UseVerifyDeviceResult | null = null;
    await act(async () => {
      renderer = TestRenderer.create(
        <Probe action="signup" autoStart client={client} onState={(s) => (captured = s)} />,
      );
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(verify).toHaveBeenCalledWith('h', 'signup');
    expect(captured!.result?.verdict).toBe('allow');
    expect(captured!.loading).toBe(false);
    expect(captured!.error).toBeNull();
  });

  it('captures errors into hook state', async () => {
    const verify = jest.fn().mockRejectedValue({ code: 'E_NETWORK', message: 'offline' });
    __setMockNative({ create: jest.fn().mockResolvedValue('h'), verify });
    const client = new RootHeraldClient({ apiKey: 'k' });

    let captured: UseVerifyDeviceResult | null = null;
    await act(async () => {
      renderer = TestRenderer.create(
        <Probe action="signup" autoStart client={client} onState={(s) => (captured = s)} />,
      );
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(captured!.error).toBeInstanceOf(Error);
    expect((captured!.error as Error & { code?: string }).code).toBe('E_NETWORK');
    expect(captured!.result).toBeNull();
    expect(captured!.loading).toBe(false);
  });

  it('manual verify() returns a result and updates state', async () => {
    const verify = jest.fn().mockResolvedValue({
      verdict: 'warn',
      deviceId: 'd',
      tpmClass: 'tpm20',
      posture: '{}',
      reason: 'soft',
    });
    __setMockNative({ create: jest.fn().mockResolvedValue('h'), verify });
    const client = new RootHeraldClient({ apiKey: 'k' });

    let captured: UseVerifyDeviceResult | null = null;
    act(() => {
      renderer = TestRenderer.create(
        <Probe action="checkout" client={client} onState={(s) => (captured = s)} />,
      );
    });

    let returned: VerifyResult | null = null;
    await act(async () => {
      returned = await captured!.verify();
    });
    expect(returned?.verdict).toBe('warn');
    expect(captured!.result?.verdict).toBe('warn');
  });

  it('reset() clears state without firing verify', async () => {
    const verify = jest.fn().mockResolvedValue({
      verdict: 'allow',
      deviceId: '',
      tpmClass: '',
      posture: '{}',
      reason: '',
    });
    __setMockNative({ create: jest.fn().mockResolvedValue('h'), verify });
    const client = new RootHeraldClient({ apiKey: 'k' });

    let captured: UseVerifyDeviceResult | null = null;
    await act(async () => {
      renderer = TestRenderer.create(
        <Probe action="x" autoStart client={client} onState={(s) => (captured = s)} />,
      );
      await flushMicrotasks();
      await flushMicrotasks();
    });

    expect(captured!.result).not.toBeNull();
    act(() => {
      captured!.reset();
    });
    expect(captured!.result).toBeNull();
    expect(captured!.error).toBeNull();
  });

  it('cancels in-flight verify on unmount', async () => {
    let resolveVerify: ((v: unknown) => void) | undefined;
    const verify = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveVerify = resolve;
        }),
    );
    __setMockNative({ create: jest.fn().mockResolvedValue('h'), verify });
    const client = new RootHeraldClient({ apiKey: 'k' });

    let captured: UseVerifyDeviceResult | null = null;
    act(() => {
      renderer = TestRenderer.create(
        <Probe action="x" autoStart client={client} onState={(s) => (captured = s)} />,
      );
    });

    // Unmount while verify() is still pending.
    act(() => {
      renderer!.unmount();
      renderer = null;
    });

    // Resolving the native promise after unmount must not throw / cause warns.
    resolveVerify?.({ verdict: 'allow', deviceId: '', tpmClass: '', posture: '{}', reason: '' });
    await flushMicrotasks();
    expect(captured!.loading).toBe(true); // last observed state before unmount
  });

  it('throws if used without a client', () => {
    expect(() => {
      // Call the hook outside React would normally throw — emulate via a tiny renderer.
      const Bad = () => {
        // @ts-expect-error — purposely missing client
        useVerifyDevice({ action: 'x' });
        return null;
      };
      act(() => {
        TestRenderer.create(<Bad />);
      });
    }).toThrow(/requires a `client`/);
  });
});

describe('useDevicePosture', () => {
  it('parses posture JSON and returns null when result is null', () => {
    function Host({
      r,
      onState,
    }: {
      r: VerifyResult | null;
      onState: (v: ReturnType<typeof useDevicePosture>) => void;
    }) {
      const v = useDevicePosture(r);
      onState(v);
      return null;
    }

    let captured: ReturnType<typeof useDevicePosture> = null;
    act(() => {
      TestRenderer.create(<Host r={null} onState={(v) => (captured = v)} />);
    });
    expect(captured).toBeNull();

    act(() => {
      TestRenderer.create(
        <Host
          r={{
            verdict: 'allow',
            deviceId: 'd',
            tpmClass: 'tpm20-firmware',
            posture: '{"backing":"tpm","fwLevel":3}',
            reason: 'ok',
          }}
          onState={(v) => (captured = v)}
        />,
      );
    });
    expect(captured?.tpmClass).toBe('tpm20-firmware');
    expect(captured?.posture).toEqual({ backing: 'tpm', fwLevel: 3 });
    expect(captured?.parseError).toBeNull();
  });

  it('reports parse errors for malformed posture JSON', () => {
    let captured: ReturnType<typeof useDevicePosture> = null;
    function Host() {
      captured = useDevicePosture({
        verdict: 'allow',
        deviceId: 'd',
        tpmClass: 't',
        posture: 'not-json',
        reason: '',
      });
      return null;
    }
    act(() => {
      TestRenderer.create(<Host />);
    });
    expect(captured?.parseError).toBeInstanceOf(Error);
  });
});

describe('getOrCreateSharedClient', () => {
  beforeEach(() => _resetSharedClientForTesting());

  it('returns the same instance for the same key', () => {
    const a = getOrCreateSharedClient({ apiKey: 'k', endpoint: 'https://x' });
    const b = getOrCreateSharedClient({ apiKey: 'k', endpoint: 'https://x' });
    expect(a).toBe(b);
  });

  it('returns a fresh instance when the key changes', () => {
    const a = getOrCreateSharedClient({ apiKey: 'k', endpoint: 'https://x' });
    const b = getOrCreateSharedClient({ apiKey: 'k', endpoint: 'https://y' });
    expect(a).not.toBe(b);
  });
});
