import { describe, it, expect } from 'vitest';
import { classifyFailure, parseHostError } from '../src/host-error.js';
import {
  AbiMismatchError,
  AskUnsupportedError,
  ExtensionMissingError,
  HostError,
  HostMissingError,
  KeyUnloadableError,
  NotEnrolledError,
  TimeoutError,
} from '../src/errors.js';

describe('parseHostError', () => {
  it('splits rh:<code>:<text>', () => {
    expect(parseHostError('rh:6:device not enrolled')).toEqual({ code: '6', text: 'device not enrolled' });
    expect(parseHostError('rh:abi_mismatch:host speaks 5.0')).toEqual({ code: 'abi_mismatch', text: 'host speaks 5.0' });
  });

  it('keeps colons and newlines in the text', () => {
    expect(parseHostError('rh:14:TPM_RC_INTEGRITY: 0x9f\nsee log')).toEqual({
      code: '14',
      text: 'TPM_RC_INTEGRITY: 0x9f\nsee log',
    });
  });

  it('allows an empty text', () => {
    expect(parseHostError('rh:13:')).toEqual({ code: '13', text: '' });
  });

  it('returns null for anything that is not a token', () => {
    expect(parseHostError(undefined)).toBeNull();
    expect(parseHostError('')).toBeNull();
    expect(parseHostError('Native host disconnected')).toBeNull();
    expect(parseHostError('rh:')).toBeNull();
    expect(parseHostError('rh:6')).toBeNull();
    expect(parseHostError('RH:6:upper-cased prefix')).toBeNull();
    expect(parseHostError(' rh:6:leading space')).toBeNull();
    expect(parseHostError('rh:not enrolled:space in code')).toBeNull();
  });
});

describe('classifyFailure', () => {
  const doing = 'testing';

  it('maps no response to ExtensionMissingError', () => {
    expect(classifyFailure(null, doing)).toBeInstanceOf(ExtensionMissingError);
  });

  it.each([
    ['rh:6:not enrolled', NotEnrolledError, '6'],
    ['rh:13:ask unsupported', AskUnsupportedError, '13'],
    ['rh:14:key unloadable', KeyUnloadableError, '14'],
    ['rh:abi_mismatch:5.0 vs 6.0', AbiMismatchError, 'abi_mismatch'],
    ['rh:unknown_action:no such action', AbiMismatchError, 'unknown_action'],
  ])('maps %s to %s with code %s and the text as message', (error, ErrClass, code) => {
    const err = classifyFailure({ success: false, error }, doing);
    expect(err).toBeInstanceOf(ErrClass);
    expect(err).toBeInstanceOf(HostError);
    expect((err as HostError).code).toBe(code);
    expect(err.message).toBe(error.slice(error.indexOf(':', 3) + 1));
  });

  it('keeps an unnamed host code as a plain HostError', () => {
    const err = classifyFailure({ success: false, error: 'rh:42:TPM said no' }, doing);
    expect(err).toBeInstanceOf(HostError);
    expect(err).not.toBeInstanceOf(HostMissingError);
    expect((err as HostError).code).toBe('42');
    expect(err.message).toBe('TPM said no');
  });

  it('uses the class default message when the token text is empty', () => {
    const err = classifyFailure({ success: false, error: 'rh:6:' }, doing);
    expect(err).toBeInstanceOf(NotEnrolledError);
    expect(err.message.length).toBeGreaterThan(0);
  });

  it('does not treat a token as the extension wording, even when the text overlaps', () => {
    // A host that answered is present, whatever its text says.
    const err = classifyFailure({ success: false, error: 'rh:42:native host disconnected from TPM' }, doing);
    expect(err).toBeInstanceOf(HostError);
    expect(err).not.toBeInstanceOf(HostMissingError);
  });

  it.each([
    'Native host disconnected',
    'connectNative failed',
    'Specified native messaging host not found',
  ])('maps the extension wording %s to HostMissingError', (error) => {
    expect(classifyFailure({ success: false, error }, doing)).toBeInstanceOf(HostMissingError);
  });

  it('maps the extension wording "timed out" to TimeoutError', () => {
    expect(classifyFailure({ success: false, error: 'Request timed out' }, doing)).toBeInstanceOf(TimeoutError);
  });

  it('falls back to HostMissingError for an unrecognised failure', () => {
    expect(classifyFailure({ success: false, error: 'something else' }, doing)).toBeInstanceOf(HostMissingError);
    expect(classifyFailure({ success: false }, doing)).toBeInstanceOf(HostMissingError);
  });
});
