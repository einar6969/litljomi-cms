import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The directory served as the site root: `delivery/<tenant>/current.json` lives under it. */
export const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

export interface FixtureServer {
  /** `http://127.0.0.1:<port>`; the delivery base URL is `${origin}/delivery`. */
  origin: string;
  close(): Promise<void>;
}

/** Serves the fixture bundle files read-only over HTTP, standing in for the `delivery` bucket. */
export async function startFixtureServer(root: string = FIXTURES_ROOT, port = 0): Promise<FixtureServer> {
  const base = resolve(root); // a relative or unnormalised root still matches the prefix check below
  const server: Server = createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405).end();
        return;
      }
      const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
      const file = normalize(join(base, pathname));
      if (!file.startsWith(base + sep) || !file.endsWith('.json')) {
        res.writeHead(404).end();
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=30' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('fixture server has no port');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
