/**
 * Typed client for the  Root Herald SSF Management API.
 *
 * Uses native fetch (Node 20+). All request bodies are snake_case on the wire
 * (matching the backend's [JsonPropertyName] attributes). Responses are mapped
 * to camelCase TypeScript types before being returned to callers.
 */

import type { SsfClient, SsfStream } from '@rootherald/contracts';
import { SsfApiError } from '@rootherald/contracts';

export interface SsfClientOptions {
  /**  Root Herald issuer URL. */
  issuer: string;
  /** Relying party client_id. */
  clientId: string;
  /** Relying party client_secret. */
  clientSecret: string;
  /** Override the base URL. Default: `${issuer}/api/v1/ssf`. */
  baseUrl?: string;
}

/** Maps a snake_case stream response object to the camelCase SsfStream shape. */
function parseStream(json: Record<string, unknown>): SsfStream {
  return {
    streamId: json['stream_id'] as string,
    url: json['url'] as string,
    eventTypes: json['event_types'] as string[],
    status: json['status'] as SsfStream['status'],
    createdAt: json['created_at'] as string,
  };
}

async function assertOk(response: Response): Promise<void> {
  if (!response.ok) {
    let body = '';
    try {
      body = await response.text();
    } catch {
      // ignore body read failures
    }
    throw new SsfApiError(
      `SSF API error: ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`,
      response.status,
    );
  }
}

/**
 * Creates a typed client for the  Root Herald SSF Management API.
 *
 * Authentication uses HTTP Basic (client_id:client_secret), encoded once at
 * construction time.
 */
export function createSsfClient(options: SsfClientOptions): SsfClient {
  const baseUrl = options.baseUrl ?? `${options.issuer}/api/v1/ssf`;
  const auth =
    'Basic ' +
    Buffer.from(`${options.clientId}:${options.clientSecret}`).toString('base64');

  const headers = (extra?: Record<string, string>): Record<string, string> => ({
    Authorization: auth,
    ...extra,
  });

  return {
    async createStream(config) {
      const response = await fetch(`${baseUrl}/streams`, {
        method: 'POST',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          url: config.url,
          event_types: config.eventTypes,
          delivery: config.delivery ?? 'push',
        }),
      });
      await assertOk(response);
      const json = (await response.json()) as Record<string, unknown>;
      return parseStream(json);
    },

    async getStream(streamId) {
      const response = await fetch(`${baseUrl}/streams/${streamId}`, {
        headers: headers(),
      });
      await assertOk(response);
      const json = (await response.json()) as Record<string, unknown>;
      return parseStream(json);
    },

    async listStreams() {
      const response = await fetch(`${baseUrl}/streams`, {
        headers: headers(),
      });
      await assertOk(response);
      const json = (await response.json()) as { streams: Record<string, unknown>[] };
      return json.streams.map(parseStream);
    },

    async updateStream(streamId, update) {
      const body: Record<string, unknown> = {};
      if (update.url !== undefined) body['url'] = update.url;
      if (update.eventTypes !== undefined) body['event_types'] = update.eventTypes;
      if (update.status !== undefined) body['status'] = update.status;

      const response = await fetch(`${baseUrl}/streams/${streamId}`, {
        method: 'PATCH',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
      await assertOk(response);
      const json = (await response.json()) as Record<string, unknown>;
      return parseStream(json);
    },

    async deleteStream(streamId) {
      const response = await fetch(`${baseUrl}/streams/${streamId}`, {
        method: 'DELETE',
        headers: headers(),
      });
      await assertOk(response);
    },

    async verifyStream(streamId) {
      const response = await fetch(`${baseUrl}/streams/${streamId}:verify`, {
        method: 'POST',
        headers: headers(),
      });
      await assertOk(response);
      return { ok: true };
    },
  };
}
