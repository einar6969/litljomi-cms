import { unstable_doesMiddlewareMatch as matches } from 'next/experimental/testing/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase/proxy', () => ({ updateSession: vi.fn() }));
const { config } = await import('../proxy');

const url = (path: string) => matches({ config, url: `http://localhost:3100${path}` });

describe('proxy matcher', () => {
  it('leaves the self-hosted fonts and other static assets alone', () => {
    expect(url('/fonts/AlbertSans-VariableFont_wght.woff2')).toBe(false);
    expect(url('/_next/static/chunk.js')).toBe(false);
    expect(url('/favicon.ico')).toBe(false);
    // The app router's icon (src/app/icon.svg), with or without its cache-busting query.
    expect(url('/favicon.ico?v=2')).toBe(false);
    expect(url('/icon.svg')).toBe(false);
    expect(url('/icon.svg?b6c1d2e3f4a5b6c7')).toBe(false);
    expect(url('/api/worker/x')).toBe(false);
  });

  it('still covers the editor, login and look-alike paths', () => {
    expect(url('/login')).toBe(true);
    expect(url('/t/demo/event')).toBe(true);
    expect(url('/fontsx/a.woff2')).toBe(true);
    expect(url('/t/demo/fonts/a')).toBe(true);
    expect(url('/icon.svgx')).toBe(true);
    expect(url('/icon.svg/x')).toBe(true);
    expect(url('/icon')).toBe(true);
    // Exactly /favicon.ico (M3-14; C3 follow-up): longer paths that start with it still go through the proxy.
    expect(url('/favicon.icoX')).toBe(true);
    expect(url('/favicon.ico/x')).toBe(true);
    expect(url('/favicon.ico.html')).toBe(true);
    expect(url('/t/demo/icon.svg')).toBe(true);
  });
});
