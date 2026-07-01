/**
 * A minimal fake `window` that simulates the RootHerald extension's content
 * script. Tests configure how it responds to each action, mirroring the real
 * Client ABI 3.0 postMessage wire (content-script.ts / service-worker.ts).
 */

import type { MessageWindow } from '../src/transport.js';
import type {
  EnrollRequestBlob,
  EnrollActivationResponse,
} from '@rootherald/contracts';

type Listener = (event: { data: unknown; source?: unknown }) => void;

export interface ExtensionBehavior {
  /** If false, the extension never answers a `ping` (simulates no extension). */
  extensionPresent?: boolean;
  /** If false, `status`/`collect`/`enroll-*` return a native-host failure. */
  hostPresent?: boolean;
  /** Evidence blob returned on a successful `collect`. */
  evidence?: unknown;
  /** Force a specific error string on host failure. */
  hostError?: string;
  /** If true, `collect` never answers (simulates a hung quote). */
  collectHangs?: boolean;
  /** If true, `status` never answers (simulates a hung host probe). */
  statusHangs?: boolean;
  /** Enroll request blob returned on a successful `enroll-begin`. */
  enrollRequestBlob?: EnrollRequestBlob;
  /** Activation blob returned on a successful `enroll-complete`. */
  activationBlob?: EnrollActivationResponse;
  /** If true, `enroll-begin` never answers (simulates a hung TPM op / UAC). */
  enrollBeginHangs?: boolean;
  /** If true, `enroll-complete` never answers. */
  enrollCompleteHangs?: boolean;
  /** If true, `enroll-begin` succeeds but omits the enrollRequestBlob. */
  enrollBeginNoBlob?: boolean;
  /** If true, `enroll-complete` succeeds but omits the activationBlob. */
  enrollCompleteNoBlob?: boolean;
}

const DEFAULT_ENROLL_REQUEST: EnrollRequestBlob = {
  ekPublicKey: 'ek-pub-b64',
  akPublicArea: 'ak-pub-b64',
  platform: 'windows',
};

const DEFAULT_ACTIVATION: EnrollActivationResponse = {
  deviceId: 'device-1',
  decryptedSecret: 'secret-b64',
};

export class FakeWindow implements MessageWindow {
  location = { origin: 'https://demo.rootherald.test' };
  private listeners = new Set<Listener>();
  behavior: ExtensionBehavior;

  /** The `challenge` last seen on an `enroll-complete` request, for assertions. */
  lastChallenge: unknown;

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
      challenge?: unknown;
    };
    if (req?.type !== 'rootherald-request') return;
    queueMicrotask(() => this.respond(req));
  }

  private hostFailure(requestId: string): void {
    this.emit({
      type: 'rootherald-response',
      requestId,
      success: false,
      error: this.behavior.hostError ?? 'Native host disconnected',
    });
  }

  private respond(req: {
    requestId?: string;
    action?: string;
    challengeId?: string;
    challenge?: unknown;
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
      if (b.hostPresent === false) return void this.hostFailure(requestId);
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
      if (b.hostPresent === false) return void this.hostFailure(requestId);
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

    if (req.action === 'enroll-begin') {
      if (b.enrollBeginHangs) return;
      if (b.extensionPresent === false) return; // no relay at all
      if (b.hostPresent === false) return void this.hostFailure(requestId);
      this.emit({
        type: 'rootherald-response',
        requestId,
        success: true,
        data: b.enrollBeginNoBlob
          ? {}
          : { enrollRequestBlob: b.enrollRequestBlob ?? DEFAULT_ENROLL_REQUEST },
      });
      return;
    }

    if (req.action === 'enroll-complete') {
      this.lastChallenge = req.challenge;
      if (b.enrollCompleteHangs) return;
      if (b.extensionPresent === false) return;
      if (b.hostPresent === false) return void this.hostFailure(requestId);
      this.emit({
        type: 'rootherald-response',
        requestId,
        success: true,
        data: b.enrollCompleteNoBlob
          ? {}
          : { activationBlob: b.activationBlob ?? DEFAULT_ACTIVATION },
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
