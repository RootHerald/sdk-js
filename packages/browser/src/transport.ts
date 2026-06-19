/**
 * Page <-> extension transport over `window.postMessage`.
 *
 * We always use the content-script postMessage bridge (works in Chrome, Edge,
 * and Firefox uniformly) rather than `chrome.runtime.sendMessage`, which is not
 * available to ordinary page scripts. Each request carries a unique `requestId`
 * so concurrent requests don't cross wires.
 */

import {
  REQUEST_TYPE,
  RESPONSE_TYPE,
  type RootHeraldRequestMessage,
  type RootHeraldResponseMessage,
} from './constants.js';
import { TimeoutError } from './errors.js';

/** Minimal window surface we depend on — keeps the SDK testable without a DOM. */
export interface MessageWindow {
  postMessage(message: unknown, targetOrigin: string): void;
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent) => void,
  ): void;
  removeEventListener(
    type: 'message',
    listener: (event: MessageEvent) => void,
  ): void;
  readonly location: { readonly origin: string };
}

function resolveWindow(win?: MessageWindow): MessageWindow {
  if (win) return win;
  if (typeof window !== 'undefined') return window as unknown as MessageWindow;
  throw new TypeError(
    '@rootherald/browser requires a browser window; pass `window` explicitly in non-DOM environments',
  );
}

let nextId = 0;
function makeRequestId(): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `rh-${nextId++}-${rand}`;
}

export interface SendOptions {
  timeoutMs: number;
  /** Window to broker through. Defaults to the global `window`. */
  win?: MessageWindow;
}

/**
 * Post a single request to the extension and resolve with the matching
 * response. Resolves with `null` on timeout (the caller decides whether a
 * timeout means "extension missing" or "host unreachable").
 */
export function sendRequest(
  request: Omit<RootHeraldRequestMessage, 'type' | 'requestId'>,
  opts: SendOptions,
): Promise<RootHeraldResponseMessage | null> {
  const win = resolveWindow(opts.win);
  const requestId = makeRequestId();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: RootHeraldResponseMessage | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      win.removeEventListener('message', onMessage);
      resolve(value);
    };

    const onMessage = (event: MessageEvent) => {
      // Only same-window responses; ignore cross-frame noise.
      const data = event.data as RootHeraldResponseMessage | undefined;
      if (!data || data.type !== RESPONSE_TYPE) return;
      if (data.requestId !== requestId) return;
      finish(data);
    };

    const timer = setTimeout(() => finish(null), opts.timeoutMs);

    win.addEventListener('message', onMessage);

    const message: RootHeraldRequestMessage = {
      type: REQUEST_TYPE,
      requestId,
      ...request,
    };
    win.postMessage(message, win.location.origin);
  });
}

/** Like {@link sendRequest} but throws {@link TimeoutError} instead of `null`. */
export async function sendRequestOrThrow(
  request: Omit<RootHeraldRequestMessage, 'type' | 'requestId'>,
  opts: SendOptions,
): Promise<RootHeraldResponseMessage> {
  const res = await sendRequest(request, opts);
  if (res === null) throw new TimeoutError();
  return res;
}
