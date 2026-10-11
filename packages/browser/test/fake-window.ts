/**
 * A minimal fake `window` that simulates the RootHerald extension's content
 * script. Tests configure how it responds to each action, mirroring the real
 * Client ABI 8.0 postMessage wire (content-script / service-worker).
 */

import type { MessageWindow } from '../src/transport.js';
import type {
  EnrollRequestBlob,
  EnrollActivationResponse,
  KeyCertification,
} from '@rootherald/contracts';

type Listener = (event: { data: unknown; source?: unknown; origin?: string }) => void;

export interface ExtensionBehavior {
  /** If false, the extension never answers a `ping` (simulates no extension). */
  extensionPresent?: boolean;
  /** If false, every host action returns a native-host failure. */
  hostPresent?: boolean;
  /** The `abi` the host stamps on every answer; defaults to `8.0`, `null` omits it. */
  abi?: string | null;
  /** Evidence blob returned on a successful `attest`. */
  evidence?: unknown;
  /** AK blob returned on a successful `enroll-begin`. */
  akBlob?: unknown;
  /** Certification returned on a successful `mint-key`. */
  certification?: KeyCertification;
  /** Key blob returned on a successful `mint-key`. */
  keyBlob?: unknown;
  /** Signature returned on a successful `sign`. */
  signature?: unknown;
  /** `alg` returned on a successful `sign`; defaults to ES256, `null` omits it. */
  alg?: unknown;
  /** Posture signals returned on a successful `posture`. */
  posture?: Record<string, unknown>;
  /** Force a specific error string on host failure. */
  hostError?: string;
  /** If true, `attest` never answers (simulates a hung quote). */
  attestHangs?: boolean;
  /** If true, `mint-key` never answers. */
  mintKeyHangs?: boolean;
  /** If true, `sign` never answers. */
  signHangs?: boolean;
  /** If true, `status` never answers (simulates a hung host probe). */
  statusHangs?: boolean;
  /** Enroll request blob returned on a successful `enroll-begin`. */
  enrollBody?: EnrollRequestBlob;
  /** Activation blob returned on a successful `enroll-complete`. */
  activationBlob?: EnrollActivationResponse;
  /** If true, `enroll-begin` never answers (simulates a hung TPM op). */
  enrollBeginHangs?: boolean;
  /** If true, `enroll-complete` never answers (simulates a hung UAC). */
  enrollCompleteHangs?: boolean;
  /** If true, `enroll-begin` succeeds but omits the enrollBody. */
  enrollBeginNoBlob?: boolean;
  /** If true, `enroll-begin` succeeds but omits the akBlob. */
  enrollBeginNoAk?: boolean;
  /** If true, `enroll-complete` succeeds but omits the activationBlob. */
  enrollCompleteNoBlob?: boolean;
  /** If true, `attest` succeeds but omits the evidence. */
  attestNoEvidence?: boolean;
  /** If true, `mint-key` succeeds but omits the certification. */
  mintKeyNoCertification?: boolean;
  /** If true, `mint-key` succeeds but omits the keyBlob. */
  mintKeyNoKey?: boolean;
  /** If true, `sign` succeeds but omits the signature. */
  signNoSignature?: boolean;
}

const DEFAULT_ENROLL_REQUEST: EnrollRequestBlob = {
  ekPublicKey: 'ek-pub-b64',
  attestationKey: {
    publicArea: 'ak-pub-b64',
    parentPublicArea: 'parent-pub-b64',
    qualifiedName: 'ak-qn-b64',
  },
  platform: 'windows',
};

const DEFAULT_ACTIVATION: EnrollActivationResponse = {
  enrollmentId: 'enr-1',
  decryptedSecret: 'secret-b64',
};

const DEFAULT_CERTIFICATION: KeyCertification = {
  publicArea: 'key-pub-b64',
  attest: 'certify-attest-b64',
  signature: 'ak-sig-b64',
};

export const DEFAULT_AK_BLOB = 'cmhhMQEB...ak';
export const DEFAULT_KEY_BLOB = 'cmhrMQIB...key';

interface SeenRequest {
  action?: string;
  challenge?: unknown;
  keyChallenge?: unknown;
  akBlob?: unknown;
  keyBlob?: unknown;
  data?: unknown;
}

export class FakeWindow implements MessageWindow {
  location = { origin: 'https://demo.rootherald.test' };
  isSecureContext = true;
  protected listeners = new Set<Listener>();
  behavior: ExtensionBehavior;

  /** Every request the page posted, oldest first, for assertions. */
  requests: SeenRequest[] = [];
  /** The `challenge` last seen on an `enroll-complete` request. */
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
    const req = message as SeenRequest & { type?: string; requestId?: string };
    if (req?.type !== 'rootherald-request') return;
    this.requests.push({
      action: req.action,
      challenge: req.challenge,
      keyChallenge: req.keyChallenge,
      akBlob: req.akBlob,
      keyBlob: req.keyBlob,
      data: req.data,
    });
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

  /** What a real host says on success: the action's data plus its `abi`. */
  private ok(requestId: string, data: Record<string, unknown>): void {
    const abi = this.behavior.abi === undefined ? '8.0' : this.behavior.abi;
    if (abi !== null) data.abi = abi;
    this.emit({ type: 'rootherald-response', requestId, success: true, data });
  }

  private respond(req: SeenRequest & { requestId?: string }): void {
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

    if (b.extensionPresent === false) return; // no relay at all

    if (req.action === 'status') {
      if (b.statusHangs) return;
      if (b.hostPresent === false) return void this.hostFailure(requestId);
      this.ok(requestId, { platform: 'windows', hasTpm: true, capabilities: 3, host: '2.0.0' });
      return;
    }

    if (req.action === 'posture') {
      if (b.hostPresent === false) return void this.hostFailure(requestId);
      this.ok(requestId, b.posture ?? { host: '2.0.0', capabilities: 3, secureBoot: true });
      return;
    }

    if (req.action === 'attest') {
      if (b.attestHangs) return;
      if (b.hostPresent === false) return void this.hostFailure(requestId);
      this.ok(
        requestId,
        b.attestNoEvidence ? {} : { evidence: b.evidence ?? { quote: 'fake-quote', sig: 'abc' } },
      );
      return;
    }

    if (req.action === 'mint-key') {
      if (b.mintKeyHangs) return;
      if (b.hostPresent === false) return void this.hostFailure(requestId);
      const data: Record<string, unknown> = {};
      if (!b.mintKeyNoCertification) data.certification = b.certification ?? DEFAULT_CERTIFICATION;
      if (!b.mintKeyNoKey) data.keyBlob = b.keyBlob ?? DEFAULT_KEY_BLOB;
      this.ok(requestId, data);
      return;
    }

    if (req.action === 'sign') {
      if (b.signHangs) return;
      if (b.hostPresent === false) return void this.hostFailure(requestId);
      const data: Record<string, unknown> = b.signNoSignature
        ? {}
        : { signature: b.signature ?? 'c2ln' };
      if (b.alg !== null) data.alg = b.alg ?? 'ES256'; // null => the host omitted it
      this.ok(requestId, data);
      return;
    }

    if (req.action === 'enroll-begin') {
      if (b.enrollBeginHangs) return;
      if (b.hostPresent === false) return void this.hostFailure(requestId);
      const data: Record<string, unknown> = {};
      if (!b.enrollBeginNoBlob) data.enrollBody = b.enrollBody ?? DEFAULT_ENROLL_REQUEST;
      if (!b.enrollBeginNoAk) data.akBlob = b.akBlob ?? DEFAULT_AK_BLOB;
      this.ok(requestId, data);
      return;
    }

    if (req.action === 'enroll-complete') {
      this.lastChallenge = req.challenge;
      if (b.enrollCompleteHangs) return;
      if (b.hostPresent === false) return void this.hostFailure(requestId);
      this.ok(
        requestId,
        b.enrollCompleteNoBlob ? {} : { activationBlob: b.activationBlob ?? DEFAULT_ACTIVATION },
      );
      return;
    }

    // What a real host says to an action it does not know.
    this.emit({
      type: 'rootherald-response',
      requestId,
      success: false,
      error: `rh:unknown_action:unknown action "${String(req.action)}"`,
    });
  }

  /** What the content script's `window.postMessage` looks like from the page. */
  protected emit(data: Record<string, unknown>): void {
    for (const l of this.listeners) {
      l({ data, source: this, origin: this.location.origin } as unknown as MessageEvent);
    }
  }
}
