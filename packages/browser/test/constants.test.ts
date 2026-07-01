import { describe, it, expect } from 'vitest';
import {
  ROOTHERALD_EXTENSION_ID,
  ROOTHERALD_NATIVE_HOST_NAME,
  ACTION_PING,
  ACTION_COLLECT,
  ACTION_STATUS,
  ACTION_ENROLL_BEGIN,
  ACTION_ENROLL_COMPLETE,
  REQUEST_TYPE,
  RESPONSE_TYPE,
} from '../src/constants.js';

describe('constants', () => {
  it('exposes the deterministic 32-char extension id', () => {
    expect(ROOTHERALD_EXTENSION_ID).toMatch(/^[a-p]{32}$/);
    expect(ROOTHERALD_EXTENSION_ID).toBe('aailkamjlhedocihiogjgnmambbjhlnj');
  });

  it('exposes the native host name matching the extension', () => {
    expect(ROOTHERALD_NATIVE_HOST_NAME).toBe('com.rootherald.native');
  });

  it('exposes the wire constants', () => {
    expect(REQUEST_TYPE).toBe('rootherald-request');
    expect(RESPONSE_TYPE).toBe('rootherald-response');
    expect(ACTION_PING).toBe('ping');
    expect(ACTION_COLLECT).toBe('collect');
    expect(ACTION_STATUS).toBe('status');
    expect(ACTION_ENROLL_BEGIN).toBe('enroll-begin');
    expect(ACTION_ENROLL_COMPLETE).toBe('enroll-complete');
  });
});
