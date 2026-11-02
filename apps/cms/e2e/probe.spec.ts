import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from './support/test';

// Probe: Chromium starts and loads a page from a loopback server (decision 37.3).
const PAGE = '<!doctype html><html lang="is"><head><title>Prófun</title></head><body><p id="probe">Playwright virkar</p></body></html>';

let server: Server;
let origin: string;

test.beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

test('Chromium loads a page from a loopback server', async ({ page }) => {
  await page.goto(`${origin}/`);
  await expect(page.locator('#probe')).toHaveText('Playwright virkar');
  await expect(page).toHaveTitle('Prófun');
});
