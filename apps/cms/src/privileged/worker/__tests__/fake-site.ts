// A local fake site for the worker's tests (plan Task 21): a node:http server on 127.0.0.1 that
// serves controllable pages and records every request (webhook calls included) with its raw body.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type Page = { status: number; html?: string; headers?: Record<string, string> };
export type Recorded = { method: string; path: string; headers: IncomingMessage['headers']; body: Buffer };
/** Answers a request; `undefined` falls back to the static pages, then 404. */
export type Handler = (req: Recorded, res: ServerResponse) => Page | undefined | 'hang' | Promise<Page | undefined | 'hang'>;

export interface FakeSite {
  origin: string;
  /** Static pages by path (query ignored); a function is evaluated per request. */
  pages: Map<string, Page | (() => Page)>;
  /** Every request in order. */
  requests: Recorded[];
  handler: Handler | null;
  hits(path: string): number;
  close(): Promise<void>;
}

/** The marker markup the SDK's CmsEntryMarker renders (React's server output). */
export const entryMarker = (id: string, hash: string) => `<span hidden="" data-cms-entry="${id}" data-cms-hash="${hash}"></span>`;
export const releaseMeta = (n: number) => `<meta name="cms-release" content="${n}"/>`;
export const html = (head: string, body: string) => `<!DOCTYPE html><html lang="is"><head>${head}</head><body>${body}</body></html>`;

export async function startFakeSite(port = 0): Promise<FakeSite> {
  const site: FakeSite = {
    origin: '',
    pages: new Map(),
    requests: [],
    handler: null,
    hits: (path) => site.requests.filter((r) => r.path === path).length,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      void (async () => {
        const recorded: Recorded = {
          method: req.method ?? 'GET',
          path: new URL(req.url ?? '/', 'http://x').pathname,
          headers: req.headers,
          body: Buffer.concat(chunks),
        };
        site.requests.push(recorded);
        let page: Page | undefined | 'hang' = site.handler ? await site.handler(recorded, res) : undefined;
        if (page === 'hang') return; // never answers (timeouts)
        if (page === undefined) {
          const found = site.pages.get(recorded.path);
          page = typeof found === 'function' ? found() : (found ?? { status: 404, html: html('', '<h1>404</h1>') });
        }
        res.writeHead(page.status, { 'content-type': 'text/html; charset=utf-8', ...page.headers });
        res.end(recorded.method === 'HEAD' ? undefined : (page.html ?? ''));
      })();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  site.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return site;
}
