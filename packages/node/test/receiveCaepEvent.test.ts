import { describe, it, expect, beforeAll, vi } from 'vitest';
import { createLocalJWKSet } from 'jose';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { getFixtures, type TestFixtures } from './fixtures/jwks.js';
import { receiveCaepEvent } from '../src/receiveCaepEvent.js';

let fixtures: TestFixtures;

beforeAll(async () => {
  fixtures = await getFixtures();
});

// ---- Fake HTTP primitives ----

function makePostReq(body: string, contentType = 'application/secevent+jwt'): IncomingMessage {
  const readable = Readable.from([Buffer.from(body, 'utf8')]);
  return Object.assign(readable, {
    method: 'POST',
    headers: { 'content-type': contentType },
    url: '/webhooks/rootherald',
  }) as unknown as IncomingMessage;
}

function makeGetReq(): IncomingMessage {
  return {
    method: 'GET',
    headers: {},
  } as unknown as IncomingMessage;
}

interface FakeRes {
  statusCode: number;
  body: string;
  ended: boolean;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

function makeFakeRes(): ServerResponse & FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    body: '',
    ended: false,
    setHeader() {},
    end(b?: string) {
      this.ended = true;
      if (b) this.body = b;
    },
  };
  return res as unknown as ServerResponse & FakeRes;
}

const TEST_EVENT_TYPE = 'tag:rootherald.io,2026:event-type:attestation-completed';

describe('receiveCaepEvent middleware', () => {
  it('happy path: verifies SET, calls onEvent with parsed event, responds 202', async () => {
    const setJwt = await fixtures.signSet({
      iss: 'https://rootherald.example.com',
      aud: 'stream-1',
      events: {
        [TEST_EVENT_TYPE]: {
          device_id: 'device-uuid-1234',
          session_id: 'session-uuid-abcd',
          verdict: 'pass',
          assurance_level: 'high',
          attested_at: Math.floor(Date.now() / 1000) - 5,
          report_id: 'report-uuid-efgh',
        },
      },
    });

    const req = makePostReq(setJwt);
    const res = makeFakeRes();
    const onEvent = vi.fn().mockResolvedValue(undefined);

    const middleware = receiveCaepEvent({
      issuer: 'https://rootherald.example.com',
      audience: 'stream-1',
      onEvent,
      _jwks: createLocalJWKSet(fixtures.publicJwks),
    });

    await middleware(req, res);

    expect(res.statusCode).toBe(202);
    expect(res.ended).toBe(true);
    expect(onEvent).toHaveBeenCalledOnce();
    const [event, raw] = onEvent.mock.calls[0] as [{ type: string; payload: unknown }, unknown];
    expect(event.type).toBe(TEST_EVENT_TYPE);
    expect(event.payload).toBeDefined();
    expect((raw as { jti: string }).jti).toBeTruthy();
  });

  it('non-POST request: responds 405', async () => {
    const req = makeGetReq();
    const res = makeFakeRes();
    const onEvent = vi.fn();

    const middleware = receiveCaepEvent({
      issuer: 'https://rootherald.example.com',
      onEvent,
      _jwks: createLocalJWKSet(fixtures.publicJwks),
    });

    await middleware(req, res);

    expect(res.statusCode).toBe(405);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('invalid signature: responds 400 and does not call onEvent', async () => {
    // Sign with fixture key, then tamper
    const setJwt = await fixtures.signSet({
      iss: 'https://rootherald.example.com',
      events: { [TEST_EVENT_TYPE]: { device_id: 'x' } },
    });
    const parts = setJwt.split('.');
    const tampered = parts[0] + '.' + parts[1] + '.badsig';

    const req = makePostReq(tampered);
    const res = makeFakeRes();
    const onEvent = vi.fn();

    const middleware = receiveCaepEvent({
      issuer: 'https://rootherald.example.com',
      onEvent,
      _jwks: createLocalJWKSet(fixtures.publicJwks),
    });

    await middleware(req, res);

    expect(res.statusCode).toBe(400);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('unknown event type: still dispatches to onEvent (receiver does not validate type)', async () => {
    const unknownType = 'tag:rootherald.io,2026:event-type:future-event';
    const setJwt = await fixtures.signSet({
      iss: 'https://rootherald.example.com',
      events: { [unknownType]: { some_field: 'value' } },
    });

    const req = makePostReq(setJwt);
    const res = makeFakeRes();
    const onEvent = vi.fn().mockResolvedValue(undefined);

    const middleware = receiveCaepEvent({
      issuer: 'https://rootherald.example.com',
      onEvent,
      _jwks: createLocalJWKSet(fixtures.publicJwks),
    });

    await middleware(req, res);

    expect(res.statusCode).toBe(202);
    expect(onEvent).toHaveBeenCalledOnce();
    const [event] = onEvent.mock.calls[0] as [{ type: string }];
    expect(event.type).toBe(unknownType);
  });

  it('body already parsed as string on req.body: uses it directly', async () => {
    const setJwt = await fixtures.signSet({
      iss: 'https://rootherald.example.com',
      events: { [TEST_EVENT_TYPE]: { device_id: 'device-1' } },
    });

    // Simulate Express with text() body parser already having parsed the body
    const req: IncomingMessage = {
      method: 'POST',
      headers: {},
      body: setJwt,
    } as unknown as IncomingMessage;

    const res = makeFakeRes();
    const onEvent = vi.fn().mockResolvedValue(undefined);

    const middleware = receiveCaepEvent({
      issuer: 'https://rootherald.example.com',
      onEvent,
      _jwks: createLocalJWKSet(fixtures.publicJwks),
    });

    await middleware(req, res);

    expect(res.statusCode).toBe(202);
    expect(onEvent).toHaveBeenCalledOnce();
  });
});
