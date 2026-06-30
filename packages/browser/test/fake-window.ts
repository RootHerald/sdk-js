/**
 * A minimal fake `window` that simulates the RootHerald extension's content
 * script. Tests configure how it responds to each action, mirroring the real
 * postMessage wire (content-script.ts / service-worker.ts).
 */

import type { MessageWindow } from '../src/transport.js';

type Listener = (event: { data: unknown; source?: unknown }) => void;

export interface ExtensionBehavior {
  /** If false, the extension never answers a `ping` (simulates no extension). */
  extensionPresent?: boolean;
  /** If false, `status`/`collect` return a native-host failure. */
  hostPresent?: boolean;
  /** Evidence blob returned on a successful `collect`. */
  evidence?: unknown;
  /** Force a specific error string on host failure. */
  hostError?: string;
  /** If true, `collect` never answers (simulates a hung quote). */
  collectHangs?: boolean;
  /** If true, `status` never answers (simulates a hung host probe). */
  statusHangs?: boolean;
  /** deviceId returned on a successful `enroll`. */
  deviceId?: string;
  /** If true, `enroll` never answers (simulates a hung TPM op / UAC). */
  enrollHangs?: boolean;
}

export class FakeWindow implements MessageWindow {
  location = { origin: 'https://demo.rootherald.test' };
  private listeners = new Set<Listener>();
  behavior: ExtensionBehavior;

  constructor(behavior: ExtensionBehavior = {}) {
    this.behavior = behavior;
  }

  addEventListener(_type: 'message', listener: (event: MessageEvent) => void): void {
    this.listeners.add(listener as unknown as Listener);
  }

  removeEventListener(_type: 'message', listener: (event: MessageEvent) => void): void {
    this.listeners.delete(listener as unknown as Listener);
  }

  /** Page posts a request; the fake extension reacts asynchronously. */
  postMessage(message: unknown, _targetOrigin: string): void {
    const req = message as {
      type?: string;
      requestId?: string;
      action?: string;
      challengeId?: string;
      serverUrl?: string;
    };
    if (req?.type !== 'rootherald-request') return;
    queueMicrotask(() => this.respond(req));
  }

  /** The `serverUrl` last seen on an `enroll` request, for assertions. */
  lastEnrollServerUrl: unknown;

  private respond(req: {
    requestId?: string;
    action?: string;
    challengeId?: string;
    serverUrl?: string;
  }): void {
    const b = this.behavior;
    const requestId = req.requestId!;

    if (req.action === 'ping') {
      if (b.extensionPresent === false) return; // silent => timeout
      this.emit({
        type: 'rootherald-response',
        requestId,
        success: true,
        data: { extensionInstalled: true },
      });
      return;
    }

    if (req.action === 'status') {
      if (b.statusHangs) return;
      if (b.hostPresent === false) {
        this.emit({
          type: 'rootherald-response',
          requestId,
          success: false,
          error: b.hostError ?? 'Native host disconnected',
        });
        return;
      }
      this.emit({
        type: 'rootherald-response',
        requestId,
        success: true,
        data: { status: 'ready', platform: 'windows', hasTpm: 'true' },
      });
      return;
    }

    if (req.action === 'collect') {
      if (b.collectHangs) return;
      if (b.extensionPresent === false) return; // no relay at all
      if (b.hostPresent === false) {
        this.emit({
          type: 'rootherald-response',
          requestId,
          success: false,
          error: b.hostError ?? 'Native host disconnected',
        });
        return;
      }
      this.emit({
        type: 'rootherald-response',
        requestId,
        success: true,
        data: {
          evidence: b.evidence ?? { quote: 'fake-quote', sig: 'abc' },
          challengeId: req.challengeId,
        },
      });
      return;
    }

    if (req.action === 'enroll') {
      this.lastEnrollServerUrl = req.serverUrl;
      if (b.enrollHangs) return;
      if (b.extensionPresent === false) return; // no relay at all
      if (b.hostPresent === false) {
        this.emit({
          type: 'rootherald-response',
          requestId,
          success: false,
          error: b.hostError ?? 'Native host disconnected',
        });
        return;
      }
      this.emit({
        type: 'rootherald-response',
        requestId,
        success: true,
        data: { deviceId: b.deviceId ?? 'device-1' },
      });
      return;
    }
  }

  private emit(data: Record<string, unknown>): void {
    for (const l of this.listeners) {
      l({ data } as unknown as MessageEvent);
    }
  }
}
