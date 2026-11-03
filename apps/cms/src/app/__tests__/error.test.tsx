// @vitest-environment jsdom
// M2-19: a page that fails shows Icelandic text and a retry, never the error's own message.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { t } from '@/i18n/is';
import ErrorPage from '../error';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('shows the Icelandic error text, hides the error message and retries on the button', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const reset = vi.fn();
  await act(async () => root.render(<ErrorPage error={new Error('entry_list: 42501')} reset={reset} />));

  expect(container.querySelector('h1')?.textContent).toBe(t.error.title);
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(t.error.body);
  expect(container.textContent).not.toContain('42501');

  const button = container.querySelector('button')!;
  expect(button.textContent).toBe(t.error.retry);
  await act(async () => button.click());
  expect(reset).toHaveBeenCalledOnce();

  await act(async () => root.unmount());
  container.remove();
});
