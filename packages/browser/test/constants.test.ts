import { describe, it, expect } from 'vitest';
import {
  ROOTHERALD_EXTENSION_ID,
  ROOTHERALD_NATIVE_HOST_NAME,
  HOST_ABI_MAJOR,
  ACTION_PING,
  ACTION_ATTEST,
  ACTION_MINT_KEY,
  ACTION_SIGN,
  ACTION_STATUS,
  ACTION_POSTURE,
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

  it('speaks client ABI 8', () => {
    expect(HOST_ABI_MAJOR).toBe(8);
  });

  it('exposes the wire constants', () => {
    expect(REQUEST_TYPE).toBe('rootherald-request');
    expect(RESPONSE_TYPE).toBe('rootherald-response');
    expect(ACTION_PING).toBe('ping');
    expect(ACTION_ATTEST).toBe('attest');
    expect(ACTION_MINT_KEY).toBe('mint-key');
    expect(ACTION_SIGN).toBe('sign');
    expect(ACTION_STATUS).toBe('status');
    expect(ACTION_POSTURE).toBe('posture');
    expect(ACTION_ENROLL_BEGIN).toBe('enroll-begin');
    expect(ACTION_ENROLL_COMPLETE).toBe('enroll-complete');
  });
});
