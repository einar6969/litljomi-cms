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
    expect(url('/api/worker/x')).toBe(false);
  });

  it('still covers the editor, login and look-alike paths', () => {
    expect(url('/login')).toBe(true);
    expect(url('/t/demo/event')).toBe(true);
    expect(url('/fontsx/a.woff2')).toBe(true);
    expect(url('/t/demo/fonts/a')).toBe(true);
  });
});
