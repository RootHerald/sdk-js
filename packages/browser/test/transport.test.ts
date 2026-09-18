import { describe, it, expect } from 'vitest';
import { sendRequest, TIMED_OUT } from '../src/transport.js';
import { FakeWindow } from './fake-window.js';

const FAST = { timeoutMs: 50 } as const;

/** A fake whose replies arrive the way a foreign frame's or origin's would. */
class SpoofingWindow extends FakeWindow {
  constructor(private readonly spoof: 'source' | 'origin') {
    super({ extensionPresent: true });
  }
  protected override emit(data: Record<string, unknown>): void {
    const event =
      this.spoof === 'source'
        ? { data, source: {}, origin: this.location.origin }
        : { data, source: this, origin: 'https://evil.example' };
    for (const l of this.listeners) l(event as unknown as MessageEvent);
  }
}

describe('sendRequest', () => {
  it('resolves with the matching response from this window at its own origin', async () => {
    const win = new FakeWindow({ extensionPresent: true });
    const res = await sendRequest({ action: 'ping' }, { ...FAST, win });
    expect(res).not.toBe(TIMED_OUT);
    expect(res).toMatchObject({ type: 'rootherald-response', success: true });
  });

  it('resolves TIMED_OUT, not null, when nothing answers', async () => {
    const win = new FakeWindow({ extensionPresent: false });
    await expect(sendRequest({ action: 'ping' }, { ...FAST, win })).resolves.toBe(TIMED_OUT);
  });

  it('ignores a response whose source is not this window', async () => {
    const win = new SpoofingWindow('source');
    await expect(sendRequest({ action: 'ping' }, { ...FAST, win })).resolves.toBe(TIMED_OUT);
  });

  it('ignores a response from another origin', async () => {
    const win = new SpoofingWindow('origin');
    await expect(sendRequest({ action: 'ping' }, { ...FAST, win })).resolves.toBe(TIMED_OUT);
  });

  it('refuses to run in a window that is not a secure context', () => {
    const win = new FakeWindow({ extensionPresent: true });
    win.isSecureContext = false;
    expect(() => sendRequest({ action: 'ping' }, { ...FAST, win })).toThrow(TypeError);
    expect(win.requests).toHaveLength(0);
  });
});
