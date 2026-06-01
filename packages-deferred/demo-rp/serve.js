#!/usr/bin/env node
/**
 * AcmeCorp demo server.
 * Serves the Vite-built React app from dist/ on port 4000.
 * Also exposes POST /api/sensitive-action, gated by @rootherald/node's
 * requireAttestation middleware with acrValues: ['urn:rootherald:user:phr'].
 *
 * Run:  node serve.js     (expects dist/ to exist; run `pnpm build` first)
 *       pnpm dev          (alternative — Vite's dev server, with HMR)
 */

import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const PORT = 4000;
const DIST_DIR = join(__dirname, 'dist');
const INDEX_HTML = join(DIST_DIR, 'index.html');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
};

if (!existsSync(DIST_DIR)) {
  console.error(`Build output not found: ${DIST_DIR}`);
  console.error('Run: pnpm --filter demo-rp build');
  process.exit(1);
}

// @rootherald/node is ESM — import it inside an async bootstrap so the rest
// of the file can stay native ESM without top-level await.
const { requireAttestation } = await import('@rootherald/node');

const ATTEST_OPTIONS = {
  issuer: 'http://localhost:3000',
  audience: 'plat_test_rp',
  acrValues: /** @type {import('@rootherald/contracts').AcrUrn[]} */ (['urn:rootherald:user:phr']),
  jwksUri: 'http://localhost:3000/.well-known/jwks.json',
};

const sensitiveActionMiddleware = requireAttestation(ATTEST_OPTIONS);

const server = createServer((req, res) => {
  const urlPath = req.url?.split('?')[0] ?? '/';

  // ---- POST /api/sensitive-action — RFC 9470 step-up gated endpoint ----
  if (urlPath === '/api/sensitive-action' && req.method === 'POST') {
    // requireAttestation writes its own error response on failure (401/403)
    // and calls next() on success. We pass a plain callback as "next".
    sensitiveActionMiddleware(req, res, (err) => {
      // If err is set the middleware already wrote the response.
      if (err) return;
      if (res.writableEnded) return;

      const attestation = /** @type {any} */ (req).attestation;
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        ok: true,
        message: 'Wire transfer authorized',
        amount: '$5,000.00',
        device_id: attestation?.device?.ueid ?? null,
        acr: attestation?.acr ?? null,
        authenticated_at: attestation?.authTime ?? null,
        timestamp: new Date().toISOString(),
      }));
    });
    return;
  }

  // ---- CORS preflight for /api/* (same-origin in production, but handy for curl tests) ----
  if (req.method === 'OPTIONS' && urlPath.startsWith('/api/')) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    });
    res.end();
    return;
  }

  const fsPath = join(DIST_DIR, urlPath);

  // Static asset — serve if it exists and is inside DIST_DIR
  if (
    fsPath.startsWith(DIST_DIR) &&
    urlPath !== '/' &&
    existsSync(fsPath) &&
    statSync(fsPath).isFile()
  ) {
    const ext = extname(fsPath);
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
    createReadStream(fsPath).pipe(res);
    return;
  }

  // SPA fallback — serve index.html for any route the client router handles
  try {
    const html = readFileSync(INDEX_HTML, 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (err) {
    console.error('Failed to read index.html:', err.message);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal server error');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`AcmeCorp demo running at http://localhost:${PORT}`);
  console.log(`Serving: ${DIST_DIR}`);
});
