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
  /** `window.isSecureContext`. A window that reports `false` is refused. */
  readonly isSecureContext?: boolean;
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
  // The id is what pairs a response with its request, so it must not be
  // guessable by other code on the page. `crypto.randomUUID` exists in every
  // secure context; a runtime without it is not one this SDK runs in.
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
    throw new TypeError('@rootherald/browser requires crypto.randomUUID (a secure context)');
  }
  return `rh-${nextId++}-${crypto.randomUUID()}`;
}

export interface SendOptions {
  timeoutMs: number;
  /** Window to broker through. Defaults to the global `window`. */
  win?: MessageWindow;
}

/** {@link sendRequest} resolved with this when no response arrived in time. */
export const TIMED_OUT: unique symbol = Symbol('rootherald.timed-out');

/** A response from the extension, or {@link TIMED_OUT}. */
export type SendResult = RootHeraldResponseMessage | typeof TIMED_OUT;

/**
 * Post a single request to the extension and resolve with the matching
 * response, or with {@link TIMED_OUT} when none arrived within `timeoutMs`.
 * What a timeout means is the caller's call: `ping` reads it as "not
 * installed", every other action as "the host did not finish".
 */
export function sendRequest(
  request: Omit<RootHeraldRequestMessage, 'type' | 'requestId'>,
  opts: SendOptions,
): Promise<SendResult> {
  const win = resolveWindow(opts.win);
  if (win.isSecureContext === false) {
    throw new TypeError(
      '@rootherald/browser only runs in a secure context (https, or http on localhost)',
    );
  }
  const requestId = makeRequestId();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: SendResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      win.removeEventListener('message', onMessage);
      resolve(value);
    };

    const onMessage = (event: MessageEvent) => {
      // The content script answers from this window, at this origin. A
      // message from a frame, an opener, or another origin is not it.
      if ((event.source as unknown) !== (win as unknown)) return;
      if (event.origin !== win.location.origin) return;
      const data = event.data as RootHeraldResponseMessage | undefined;
      if (!data || data.type !== RESPONSE_TYPE) return;
      if (data.requestId !== requestId) return;
      finish(data);
    };

    const timer = setTimeout(() => finish(TIMED_OUT), opts.timeoutMs);

    win.addEventListener('message', onMessage);

    const message: RootHeraldRequestMessage = {
      type: REQUEST_TYPE,
      requestId,
      ...request,
    };
    win.postMessage(message, win.location.origin);
  });
}
