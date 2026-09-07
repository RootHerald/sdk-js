/**
 * Turn a failed extension response into a typed error.
 *
 * The native host prefixes every error it emits with a stable token,
 * `rh:<code>:<text>`, so the page can branch on the code instead of the
 * wording. The extension's own failures (it could not reach the host at all)
 * carry no token; those strings are matched by content, since they are the
 * extension's and not the host's.
 */

import {
  AbiMismatchError,
  AskUnsupportedError,
  ExtensionMissingError,
  HostError,
  HostMissingError,
  KeyUnloadableError,
  NotEnrolledError,
  RootHeraldBrowserError,
  TimeoutError,
} from './errors.js';

/** A host error token, split. */
export interface HostErrorToken {
  code: string;
  text: string;
}

const TOKEN = /^rh:([A-Za-z0-9_]+):(.*)$/s;

/**
 * Parse `rh:<code>:<text>`. Returns `null` for anything that is not a host
 * token — an extension-level failure, or an older host that predates them.
 */
export function parseHostError(error: string | undefined): HostErrorToken | null {
  if (typeof error !== 'string') return null;
  const m = TOKEN.exec(error);
  if (!m) return null;
  return { code: m[1], text: m[2] };
}

/** Host codes this SDK names. Anything else surfaces as a plain {@link HostError}. */
export const HOST_CODE_NOT_ENROLLED = '6';
export const HOST_CODE_ASK_UNSUPPORTED = '13';
export const HOST_CODE_KEY_UNLOADABLE = '14';
export const HOST_CODE_ABI_MISMATCH = 'abi_mismatch';
export const HOST_CODE_UNKNOWN_ACTION = 'unknown_action';

/**
 * Map a failed (or absent) response to the error to throw.
 *
 * - no response: the extension is not there to relay
 * - a host token: by code
 * - anything else: the extension's own wording for "could not reach the host"
 *   or "timed out"; failing both, a host problem is the most actionable guess
 */
export function classifyFailure(
  res: { success?: boolean; error?: string } | null,
  doing: string,
): RootHeraldBrowserError {
  if (res === null) {
    return new ExtensionMissingError(
      `No response from the RootHerald extension while ${doing}`,
    );
  }

  const token = parseHostError(res.error);
  if (token) {
    const text = token.text || undefined;
    switch (token.code) {
      case HOST_CODE_NOT_ENROLLED:
        return new NotEnrolledError(text);
      case HOST_CODE_ASK_UNSUPPORTED:
        return new AskUnsupportedError(text);
      case HOST_CODE_KEY_UNLOADABLE:
        return new KeyUnloadableError(text);
      case HOST_CODE_ABI_MISMATCH:
        return new AbiMismatchError(text, 'abi_mismatch');
      case HOST_CODE_UNKNOWN_ACTION:
        return new AbiMismatchError(
          text ?? 'The RootHerald native host does not know this action; update it',
          'unknown_action',
        );
      default:
        return new HostError(token.code, text ?? `RootHerald native host error ${token.code}`);
    }
  }

  const errText = String(res.error ?? '').toLowerCase();
  if (
    errText.includes('native host') ||
    errText.includes('disconnect') ||
    errText.includes('connectnative')
  ) {
    return new HostMissingError(res.error ?? 'RootHerald native host not reachable');
  }
  if (errText.includes('timed out') || errText.includes('timeout')) {
    return new TimeoutError(res.error ?? `RootHerald request timed out while ${doing}`);
  }
  return new HostMissingError(res.error ?? `RootHerald request failed while ${doing}`);
}
