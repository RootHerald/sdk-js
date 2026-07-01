import { describe, it, expect } from 'vitest';
import { getClientStatus, detectOs, detectBrowser, hostSupportedOn } from '../src/detect.js';
import { FakeWindow } from './fake-window.js';

const WIN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const EDGE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0';
const FF_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0';

const FAST = { timeoutMs: 50 } as const;

describe('os/browser sniffing', () => {
  it('detects OS', () => {
    expect(detectOs(WIN_UA)).toBe('windows');
    expect(detectOs(MAC_UA)).toBe('macos');
    expect(detectOs('X11; Linux x86_64')).toBe('linux');
    expect(detectOs('weird-ua')).toBe('unknown');
  });

  it('detects browser with Edge before Chrome', () => {
    expect(detectBrowser(EDGE_UA)).toBe('edge');
    expect(detectBrowser(WIN_UA)).toBe('chrome');
    expect(detectBrowser(FF_UA)).toBe('firefox');
    expect(detectBrowser(MAC_UA)).toBe('safari');
  });

  it('host supported on Windows only', () => {
    expect(hostSupportedOn('windows')).toBe(true);
    expect(hostSupportedOn('macos')).toBe(false);
    expect(hostSupportedOn('linux')).toBe(false);
  });
});

describe('getClientStatus states', () => {
  it('READY: extension + host both present on Windows', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true });
    const s = await getClientStatus({ ...FAST, win, userAgent: WIN_UA });
    expect(s).toEqual({ os: 'windows', browser: 'chrome', extension: 'present', host: 'present' });
  });

  it('NO_EXTENSION: extension missing -> host reported missing too', async () => {
    const win = new FakeWindow({ extensionPresent: false });
    const s = await getClientStatus({ ...FAST, win, userAgent: WIN_UA });
    expect(s.extension).toBe('missing');
    expect(s.host).toBe('missing');
  });

  it('NO_HOST: extension present but native host disconnected', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: false });
    const s = await getClientStatus({ ...FAST, win, userAgent: WIN_UA });
    expect(s.extension).toBe('present');
    expect(s.host).toBe('missing');
  });

  it('UNSUPPORTED: non-Windows OS reports host unsupported (no host probe)', async () => {
    const win = new FakeWindow({ extensionPresent: true, hostPresent: true });
    const s = await getClientStatus({ ...FAST, win, userAgent: MAC_UA });
    expect(s.os).toBe('macos');
    expect(s.host).toBe('unsupported');
  });

  it('UNSUPPORTED takes precedence even when extension missing', async () => {
    const win = new FakeWindow({ extensionPresent: false });
    const s = await getClientStatus({ ...FAST, win, userAgent: MAC_UA });
    expect(s.host).toBe('unsupported');
    expect(s.extension).toBe('missing');
  });
});
