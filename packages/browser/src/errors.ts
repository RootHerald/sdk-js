/**
 * Typed errors for @rootherald/browser.
 *
 * The two "missing" states are distinct error classes because they route to
 * different fixes in the cold-start install flow:
 *   - ExtensionMissingError -> install the browser extension (Step 1)
 *   - HostMissingError      -> download + run the native host installer (Step 2)
 *
 * Everything under {@link HostError} means the host answered: the fix is on
 * the flow (enroll first, ask for less, refresh the key), not the install.
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
 * timeout, so we treat it as not installed. Route the user to install it.
 */
export class ExtensionMissingError extends RootHeraldBrowserError {
  constructor(message = 'RootHerald browser extension not detected') {
    super(message);
    this.name = 'ExtensionMissingError';
  }
}

/**
 * The extension is present but could not reach the native messaging host
 * (`connectNative` failed / disconnected). Route the user to install + run
 * the native host.
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
 * The extension and native host are both present, but the device has no
 * enrolled attestation key yet (host code `6`). This is the signal for the
 * "respond-first, enroll-on-miss" pattern: catch it, run `enroll()`, then
 * retry `respond()`. It is DISTINCT from {@link HostMissingError} (host
 * unreachable) so callers can branch on "needs enrollment" vs "needs install".
 */
export class NotEnrolledError extends HostError {
  constructor(message = 'Device is not enrolled — run enroll() first') {
    super('6', message);
    this.name = 'NotEnrolledError';
  }
}

/**
 * The challenge asks for something this host cannot do (host code `13`), such
 * as `"key"` on a host or TPM without key certification. The backend should
 * issue a challenge with a smaller ask.
 */
export class AskUnsupportedError extends HostError {
  constructor(message = 'The challenge asks for something this host does not support') {
    super('13', message);
    this.name = 'AskUnsupportedError';
  }
}

/**
 * The `KeyBlob` could not be loaded back into the TPM (host code `14`): it was
 * made by a different TPM, its parent has been rotated, or it is corrupt. Ask
 * the backend for a new `"key"` challenge and replace the stored blob.
 */
export class KeyUnloadableError extends HostError {
  constructor(message = 'The key blob could not be loaded into this TPM') {
    super('14', message);
    this.name = 'KeyUnloadableError';
  }
}

/**
 * The installed host speaks a different client ABI than this SDK (host code
 * `abi_mismatch`, or an action the host does not know). Route the user to
 * update the native host.
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
