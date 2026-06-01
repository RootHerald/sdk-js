import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSsfClient } from '../src/ssfClient.js';
import { SsfApiError } from '@rootherald/contracts';

const TEST_ISSUER = 'https://rootherald.example.com';
const TEST_CLIENT_ID = 'acme-client';
const TEST_CLIENT_SECRET = 'super-secret';
const BASE_URL = `${TEST_ISSUER}/api/v1/ssf`;

const EXPECTED_AUTH =
  'Basic ' + Buffer.from(`${TEST_CLIENT_ID}:${TEST_CLIENT_SECRET}`).toString('base64');

// Snake_case stream object as the backend returns it
const STREAM_SNAKE = {
  stream_id: 'stream-uuid-1234',
  url: 'https://app.example.com/webhooks',
  event_types: ['tag:rootherald.io,2026:event-type:attestation-completed'],
  status: 'enabled',
  created_at: '2026-04-11T12:00:00Z',
};

// Expected camelCase shape after parsing
const STREAM_CAMEL = {
  streamId: 'stream-uuid-1234',
  url: 'https://app.example.com/webhooks',
  eventTypes: ['tag:rootherald.io,2026:event-type:attestation-completed'],
  status: 'enabled',
  createdAt: '2026-04-11T12:00:00Z',
};

function mockFetch(
  response: { ok: boolean; status?: number; body?: unknown },
): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 400),
    statusText: response.ok ? 'OK' : 'Error',
    json: () => Promise.resolve(response.body ?? {}),
    text: () => Promise.resolve(JSON.stringify(response.body ?? {})),
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createSsfClient', () => {
  it('createStream: POSTs to /streams with snake_case body and Basic auth', async () => {
    const fakeFetch = mockFetch({ ok: true, status: 201, body: STREAM_SNAKE });
    vi.stubGlobal('fetch', fakeFetch);

    const client = createSsfClient({
      issuer: TEST_ISSUER,
      clientId: TEST_CLIENT_ID,
      clientSecret: TEST_CLIENT_SECRET,
    });

    const stream = await client.createStream({
      url: 'https://app.example.com/webhooks',
      eventTypes: ['tag:rootherald.io,2026:event-type:attestation-completed'],
      delivery: 'push',
    });

    // Assert correct URL and method
    expect(fakeFetch).toHaveBeenCalledOnce();
    const [url, init] = fakeFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/streams`);
    expect(init.method).toBe('POST');

    // Assert Basic auth header
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(EXPECTED_AUTH);

    // Assert snake_case wire body
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['event_types']).toEqual(['tag:rootherald.io,2026:event-type:attestation-completed']);
    expect(body['url']).toBe('https://app.example.com/webhooks');
    expect(body['delivery']).toBe('push');
    // No camelCase keys on the wire
    expect(body['eventTypes']).toBeUndefined();

    // Assert camelCase response mapping
    expect(stream).toEqual(STREAM_CAMEL);
  });

  it('getStream: GETs /streams/{id}, parses snake_case response to camelCase', async () => {
    const fakeFetch = mockFetch({ ok: true, body: STREAM_SNAKE });
    vi.stubGlobal('fetch', fakeFetch);

    const client = createSsfClient({
      issuer: TEST_ISSUER,
      clientId: TEST_CLIENT_ID,
      clientSecret: TEST_CLIENT_SECRET,
    });

    const stream = await client.getStream('stream-uuid-1234');

    const [url, init] = fakeFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/streams/stream-uuid-1234`);
    expect(init.method).toBeUndefined(); // default GET
    expect((init.headers as Record<string, string>)['Authorization']).toBe(EXPECTED_AUTH);
    expect(stream).toEqual(STREAM_CAMEL);
  });

  it('listStreams: GETs /streams, returns array of camelCase SsfStream', async () => {
    const fakeFetch = mockFetch({ ok: true, body: { streams: [STREAM_SNAKE] } });
    vi.stubGlobal('fetch', fakeFetch);

    const client = createSsfClient({
      issuer: TEST_ISSUER,
      clientId: TEST_CLIENT_ID,
      clientSecret: TEST_CLIENT_SECRET,
    });

    const streams = await client.listStreams();

    const [url] = fakeFetch.mock.calls[0] as [string];
    expect(url).toBe(`${BASE_URL}/streams`);
    expect(streams).toHaveLength(1);
    expect(streams[0]).toEqual(STREAM_CAMEL);
  });

  it('updateStream: PATCHes /streams/{id} with snake_case body', async () => {
    const updatedSnake = { ...STREAM_SNAKE, status: 'paused' };
    const fakeFetch = mockFetch({ ok: true, body: updatedSnake });
    vi.stubGlobal('fetch', fakeFetch);

    const client = createSsfClient({
      issuer: TEST_ISSUER,
      clientId: TEST_CLIENT_ID,
      clientSecret: TEST_CLIENT_SECRET,
    });

    const stream = await client.updateStream('stream-uuid-1234', {
      status: 'paused',
      eventTypes: ['tag:rootherald.io,2026:event-type:attestation-failed'],
    });

    const [url, init] = fakeFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/streams/stream-uuid-1234`);
    expect(init.method).toBe('PATCH');

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['status']).toBe('paused');
    expect(body['event_types']).toEqual(['tag:rootherald.io,2026:event-type:attestation-failed']);
    expect(body['eventTypes']).toBeUndefined();

    expect(stream.status).toBe('paused');
  });

  it('deleteStream: DELETEs /streams/{id}, returns undefined', async () => {
    const fakeFetch = mockFetch({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fakeFetch);

    const client = createSsfClient({
      issuer: TEST_ISSUER,
      clientId: TEST_CLIENT_ID,
      clientSecret: TEST_CLIENT_SECRET,
    });

    const result = await client.deleteStream('stream-uuid-1234');

    const [url, init] = fakeFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/streams/stream-uuid-1234`);
    expect(init.method).toBe('DELETE');
    expect(result).toBeUndefined();
  });

  it('verifyStream: POSTs to /streams/{id}:verify, returns { ok: true }', async () => {
    const fakeFetch = mockFetch({ ok: true, status: 202, body: { queued_at: '2026-04-11T12:05:00Z' } });
    vi.stubGlobal('fetch', fakeFetch);

    const client = createSsfClient({
      issuer: TEST_ISSUER,
      clientId: TEST_CLIENT_ID,
      clientSecret: TEST_CLIENT_SECRET,
    });

    const result = await client.verifyStream('stream-uuid-1234');

    const [url, init] = fakeFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/streams/stream-uuid-1234:verify`);
    expect(init.method).toBe('POST');
    expect(result).toEqual({ ok: true });
  });

  it('throws SsfApiError with status 404 when backend returns 404', async () => {
    const fakeFetch = mockFetch({ ok: false, status: 404, body: { error: 'not_found' } });
    vi.stubGlobal('fetch', fakeFetch);

    const client = createSsfClient({
      issuer: TEST_ISSUER,
      clientId: TEST_CLIENT_ID,
      clientSecret: TEST_CLIENT_SECRET,
    });

    const err = await client.getStream('nonexistent').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SsfApiError);
    expect((err as SsfApiError).statusCode).toBe(404);
  });
});
