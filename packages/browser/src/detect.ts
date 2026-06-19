/**
 * Cold-start client detection: OS, browser, extension presence, and native
 * host reachability. Drives the install stepper on first-visit.
 */

import { ACTION_PING, ACTION_STATUS } from './constants.js';
import { sendRequest, type MessageWindow } from './transport.js';

export type OsName = 'windows' | 'macos' | 'linux' | 'unknown';
export type BrowserName = 'chrome' | 'edge' | 'firefox' | 'safari' | 'unknown';
export type ExtensionState = 'present' | 'missing';
/**
 * Host state. `unsupported` means the native host does not ship for this OS
 * yet (Windows-first); `missing` means a supported OS without the host
 * installed/running; `present` means the extension reached the host.
 */
export type HostState = 'present' | 'missing' | 'unsupported';

export interface ClientStatus {
  os: OsName;
  browser: BrowserName;
  extension: ExtensionState;
  host: HostState;
}

export interface DetectOptions {
  /** Probe timeout per step (ms). Default 1500. */
  timeoutMs?: number;
  /** Window to broker through. Defaults to global `window`. */
  win?: MessageWindow;
  /** Override the user-agent string (testing). Defaults to `navigator.userAgent`. */
  userAgent?: string;
}

const DEFAULT_TIMEOUT_MS = 1500;

function resolveUserAgent(override?: string): string {
  if (override !== undefined) return override;
  if (typeof navigator !== 'undefined' && navigator.userAgent)
    return navigator.userAgent;
  return '';
}

export function detectOs(userAgent: string): OsName {
  const ua = userAgent.toLowerCase();
  if (ua.includes('windows')) return 'windows';
  // Match macOS before generic "mac" tokens; iOS is treated as unknown (no host).
  if (ua.includes('mac os') || ua.includes('macintosh')) return 'macos';
  if (ua.includes('linux') && !ua.includes('android')) return 'linux';
  return 'unknown';
}

export function detectBrowser(userAgent: string): BrowserName {
  const ua = userAgent.toLowerCase();
  // Order matters: Edge/Chrome UAs both contain "chrome"; Edge wins first.
  if (ua.includes('edg/') || ua.includes('edga/') || ua.includes('edgios/'))
    return 'edge';
  if (ua.includes('firefox/')) return 'firefox';
  if (ua.includes('chrome/') || ua.includes('crios/')) return 'chrome';
  if (ua.includes('safari/')) return 'safari';
  return 'unknown';
}

/** The native host is Windows-first today; everything else is `unsupported`. */
export function hostSupportedOn(os: OsName): boolean {
  return os === 'windows';
}

/**
 * Resolve full client status. Pings the extension; if present and the OS is
 * supported, probes host reachability via the local-only `status` action.
 */
export async function getClientStatus(
  opts: DetectOptions = {},
): Promise<ClientStatus> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ua = resolveUserAgent(opts.userAgent);
  const os = detectOs(ua);
  const browser = detectBrowser(ua);

  const extension = await pingExtension({ timeoutMs, win: opts.win });

  let host: HostState;
  if (!hostSupportedOn(os)) {
    host = 'unsupported';
  } else if (extension === 'missing') {
    // Can't reach the host without the extension to broker; report missing.
    host = 'missing';
  } else {
    host = await probeHost({ timeoutMs, win: opts.win });
  }

  return { os, browser, extension, host };
}

interface ProbeOptions {
  timeoutMs: number;
  win?: MessageWindow;
}

/** Detect the extension via the documented `ping` -> `extensionInstalled` marker. */
export async function pingExtension(
  opts: ProbeOptions,
): Promise<ExtensionState> {
  const res = await sendRequest(
    { action: ACTION_PING },
    { timeoutMs: opts.timeoutMs, win: opts.win },
  );
  if (res === null) return 'missing'; // timeout => not installed
  if (res.success === true && res.data?.extensionInstalled === true)
    return 'present';
  return 'missing';
}

/**
 * Probe native host reachability through the extension's local-only `status`
 * action. The extension returns `success:false` (with a "Native host
 * disconnected"/"timed out" error) when `connectNative` fails — that maps to
 * `missing`. A successful status response maps to `present`.
 */
export async function probeHost(opts: ProbeOptions): Promise<HostState> {
  const res = await sendRequest(
    { action: ACTION_STATUS },
    { timeoutMs: opts.timeoutMs, win: opts.win },
  );
  // Timeout or extension-level failure => the host did not answer.
  if (res === null) return 'missing';
  if (res.success === true) return 'present';
  return 'missing';
}
