/**
 * Turn a failed extension response into a typed error, and refuse a host of
 * the wrong ABI.
 *
 * The native host prefixes every error it emits with a stable token,
 * `rh:<code>:<text>`, so the page can branch on the code instead of the
 * wording. The extension's own failures (it could not reach the host at all)
 * carry no token; those strings are matched by content, since they are the
 * extension's and not the host's.
 */

import { HOST_ABI_MAJOR, type RootHeraldResponseData } from './constants.js';
import { pingExtension } from './detect.js';
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
import { TIMED_OUT, type MessageWindow, type SendResult } from './transport.js';

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

/** How long the post-timeout probe waits for the extension's `ping` answer. */
const PROBE_TIMEOUT_MS = 1500;

/** The major of a `"<major>.<minor>"` ABI string, or `undefined`. */
export function abiMajor(abi: unknown): number | undefined {
  if (typeof abi !== 'string') return undefined;
  const m = /^(\d+)\.\d+$/.exec(abi);
  return m ? Number(m[1]) : undefined;
}

/**
 * Refuse a host that speaks another ABI major, from the page.
 *
 * The extension compares majors between itself and the host, never against
 * the page, so an 8.0 page behind a 7.0 extension and a 7.0 host would run
 * `enroll-begin` on the shared slot without anyone noticing. Every host
 * answer carries `abi`; a wrong major is refused wherever it appears, and
 * `enroll-begin` additionally requires it to be present, since that is the
 * action whose silent success does the damage.
 */
export function requireHostAbi(
  data: RootHeraldResponseData | undefined,
  opts: { required: boolean },
): void {
  const major = abiMajor(data?.abi);
  if (major === undefined && !opts.required) return;
  if (major !== HOST_ABI_MAJOR) {
    throw new AbiMismatchError(
      `The RootHerald native host speaks ABI ${typeof data?.abi === 'string' ? data.abi : 'unknown'}; this SDK needs ${HOST_ABI_MAJOR}.x`,
      'abi_mismatch',
    );
  }
}

/**
 * The error to throw for a verb's {@link SendResult} that is not a success.
 *
 * A timeout on its own does not say whether the extension is absent or the
 * host is slow (a mint creates and certifies; enrollment waits on a UAC
 * prompt). So it is followed by a `ping`, which the extension answers
 * without touching the host: answered, the verb timed out
 * ({@link TimeoutError}); silent, there is nothing on the page to relay
 * ({@link ExtensionMissingError}). A failed response is classified by
 * {@link classifyFailure}.
 */
export async function failureOf(
  res: SendResult | { success?: boolean; error?: string },
  doing: string,
  win?: MessageWindow,
): Promise<RootHeraldBrowserError> {
  if (res !== TIMED_OUT) return classifyFailure(res, doing);
  const seen = await pingExtension({ timeoutMs: PROBE_TIMEOUT_MS, win });
  return seen === 'present'
    ? new TimeoutError(`RootHerald request timed out while ${doing}`)
    : new ExtensionMissingError(`No response from the RootHerald extension while ${doing}`);
}

/**
 * Map a failed response to the error to throw.
 *
 * - a host token: by code
 * - anything else: the extension's own wording for "could not reach the host"
 *   or "timed out"; failing both, a host problem is the most actionable guess
 */
export function classifyFailure(
  res: { success?: boolean; error?: string },
  doing: string,
): RootHeraldBrowserError {
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
