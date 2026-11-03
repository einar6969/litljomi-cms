// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DropLinkQuery, dropLinkQuery } from '../DropLinkQuery';

// React's act() warns unless the environment says it is a test.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HASH = 'pkce_16b012167d533434e7798fb52bd2c600ea40eac016b347f9d5dd10f3';

const place = (search: string, hash = '') => ({
  location: { pathname: '/auth/confirm', search, hash },
  history: { state: { tree: 'next-router-state' }, replaceState: vi.fn() },
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
  document.body.innerHTML = '';
});

describe('dropLinkQuery (Task 32 security r1)', () => {
  it('replaces the address with the bare path, keeping the router state and the fragment', () => {
    const p = place(`?token_hash=${HASH}&type=email&next=%2Ft%2Facme`, '#x');
    dropLinkQuery(p);
    expect(p.history.replaceState).toHaveBeenCalledExactlyOnceWith({ tree: 'next-router-state' }, '', '/auth/confirm#x');
  });

  it('leaves an address without a query alone', () => {
    const p = place('');
    dropLinkQuery(p);
    expect(p.history.replaceState).not.toHaveBeenCalled();
  });
});

describe('<DropLinkQuery />', () => {
  it('drops the token hash from the address bar once mounted, without adding a history entry', async () => {
    window.history.replaceState(null, '', `/auth/confirm?token_hash=${HASH}&type=email`);
    const length = window.history.length;
    const root = createRoot(document.body.appendChild(document.createElement('div')));
    await act(async () => root.render(<DropLinkQuery />));
    expect(window.location.pathname).toBe('/auth/confirm');
    expect(window.location.search).toBe('');
    expect(window.location.href).not.toContain(HASH);
    expect(window.history.length).toBe(length);
    expect(document.body.textContent).toBe('');
    await act(async () => root.unmount());
  });
});
