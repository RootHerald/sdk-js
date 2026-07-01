import { describe, it, expect } from 'vitest';
import { onClientStatusChange } from '../src/watch.js';
import type { ClientStatus } from '../src/detect.js';
import { FakeWindow } from './fake-window.js';

const WIN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';

function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const t = setInterval(() => {
      if (predicate()) {
        clearInterval(t);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(t);
        reject(new Error('waitFor timed out'));
      }
    }, 10);
  });
}

describe('onClientStatusChange', () => {
  it('emits the initial reading, then fires on each transition', async () => {
    // Start: no extension. Then extension appears. Then host appears.
    const win = new FakeWindow({ extensionPresent: false });
    const seen: ClientStatus[] = [];

    const stop = onClientStatusChange(
      (s) => seen.push(s),
      { win, userAgent: WIN_UA, intervalMs: 20, timeoutMs: 50 },
    );

    // Initial: NO_EXTENSION
    await waitFor(() => seen.length >= 1);
    expect(seen[0].extension).toBe('missing');

    // Extension installs, host not yet running -> NO_HOST transition
    win.behavior = { extensionPresent: true, hostPresent: false };
    await waitFor(() => seen.some((s) => s.extension === 'present' && s.host === 'missing'));

    // Host starts -> READY transition
    win.behavior = { extensionPresent: true, hostPresent: true };
    await waitFor(() => seen.some((s) => s.extension === 'present' && s.host === 'present'));

    stop();
    const last = seen[seen.length - 1];
    expect(last.extension).toBe('present');
    expect(last.host).toBe('present');
  });

  it('does not re-fire when status is unchanged', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true });
    const seen: ClientStatus[] = [];
    const stop = onClientStatusChange(
      (s) => seen.push(s),
      { win, userAgent: WIN_UA, intervalMs: 15, timeoutMs: 50 },
    );
    await waitFor(() => seen.length >= 1);
    // Let several poll cycles elapse with no change.
    await new Promise((r) => setTimeout(r, 100));
    stop();
    expect(seen.length).toBe(1);
  });

  it('respects emitInitial: false', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true });
    const seen: ClientStatus[] = [];
    const stop = onClientStatusChange(
      (s) => seen.push(s),
      { win, userAgent: WIN_UA, intervalMs: 15, timeoutMs: 50, emitInitial: false },
    );
    await new Promise((r) => setTimeout(r, 80));
    stop();
    expect(seen.length).toBe(0);
  });
});
