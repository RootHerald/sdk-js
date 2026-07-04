/**
 * Typed errors for @rootherald/browser.
 *
 * The two "missing" states are distinct error classes because they route to
 * different fixes in the cold-start install flow:
 *   - ExtensionMissingError -> install the browser extension (Step 1)
 *   - HostMissingError      -> download + run the native host installer (Step 2)
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

/**
 * The extension and native host are both present, but the device has no
 * enrolled attestation key yet — the host returned "not enrolled" from a
 * `collect`/`attest` call. This is the signal for the "attest-first,
 * enroll-on-miss" pattern: catch it, run `enroll()`, then retry `attest()`.
 * It is DISTINCT from {@link HostMissingError} (host unreachable) so callers
 * can branch on "needs enrollment" vs "needs install".
 */
export class NotEnrolledError extends RootHeraldBrowserError {
  constructor(message = 'Device is not enrolled — run enroll() first') {
    super(message);
    this.name = 'NotEnrolledError';
  }
}

/** A collect/probe request exceeded its timeout without a usable response. */
export class TimeoutError extends RootHeraldBrowserError {
  constructor(message = 'RootHerald request timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}
