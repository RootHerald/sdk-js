/**
 * Typed errors for @rootherald/browser.
 *
 * The two "missing" states are distinct error classes because they route to
 * different fixes: install the browser extension, or install and run the
 * native host. Everything under {@link HostError} means the host answered:
 * the fix is on the flow (enroll, ask for less, mint again), not the install.
 */

/** Base class for all errors thrown by @rootherald/browser. */
export class RootHeraldBrowserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RootHeraldBrowserError';
    // Restore prototype chain for instanceof across transpilation targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * The RootHerald browser extension did not respond to a probe within the
 * timeout, so we treat it as not installed.
 */
export class ExtensionMissingError extends RootHeraldBrowserError {
  constructor(message = 'RootHerald browser extension not detected') {
    super(message);
    this.name = 'ExtensionMissingError';
  }
}

/**
 * The extension is present but could not reach the native messaging host
 * (`connectNative` failed / disconnected), or the host answered without the
 * field the action promises.
 */
export class HostMissingError extends RootHeraldBrowserError {
  constructor(message = 'RootHerald native host not reachable') {
    super(message);
    this.name = 'HostMissingError';
  }
}

/** A request exceeded its timeout without a usable response. */
export class TimeoutError extends RootHeraldBrowserError {
  constructor(message = 'RootHerald request timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * The native host answered with an error. `code` is the host's stable code
 * from its `rh:<code>:<text>` token; the subclasses below name the ones a page
 * can act on, and this class carries the rest.
 */
export class HostError extends RootHeraldBrowserError {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'HostError';
    this.code = code;
  }
}

/**
 * No enrollment is in progress (host code `6`): `enroll-complete` was sent
 * without an `enroll-begin` before it. `enroll()` runs both legs in order.
 */
export class NotEnrolledError extends HostError {
  constructor(message = 'No enrollment in progress — enroll() runs both legs') {
    super('6', message);
    this.name = 'NotEnrolledError';
  }
}

/**
 * The challenge asks for something this host cannot do (host code `13`): a
 * known ask a platform cannot answer, or a key challenge on a host that
 * cannot mint. The backend should issue a smaller ask.
 */
export class AskUnsupportedError extends HostError {
  constructor(message = 'The challenge asks for something this host does not support') {
    super('13', message);
    this.name = 'AskUnsupportedError';
  }
}

/**
 * A blob could not be loaded back into the TPM (host code `14`): it was made
 * by a different TPM, the TPM was cleared, or its parent changed. For the AK
 * blob: discard it, `enroll()`, retry once. For a key blob: mint a new key.
 */
export class KeyUnloadableError extends HostError {
  constructor(message = 'The blob could not be loaded into this TPM') {
    super('14', message);
    this.name = 'KeyUnloadableError';
  }
}

/**
 * The installed host speaks a different client ABI than this SDK: the host
 * reported another major, said `abi_mismatch`, or does not know the action.
 * Update the native host.
 */
export class AbiMismatchError extends HostError {
  constructor(
    message = 'The RootHerald native host is a different version than this SDK expects',
    code: 'abi_mismatch' | 'unknown_action' = 'abi_mismatch',
  ) {
    super(code, message);
    this.name = 'AbiMismatchError';
  }
}

/**
 * `setUp` stopped before minting: the backend reported that the attest step
 * did not pass. The installation is enrolled; no key was minted.
 */
export class NotAttestedError extends RootHeraldBrowserError {
  constructor(message = 'The attest step did not pass; no key was minted') {
    super(message);
    this.name = 'NotAttestedError';
  }
}
