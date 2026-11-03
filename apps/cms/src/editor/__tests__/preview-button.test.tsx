// @vitest-environment jsdom
// The editor's "Forskoða" (spec §7.5, plan M3-12).
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/is';
import { PreviewButton, type PreviewTokenAnswer } from '../publish/PreviewButton';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ENTRY = '00000000-0000-4000-8000-0000000000e1';
const URL_OK = 'https://demo.example/api/cms/preview?token=a.b&path=%2Fevents%2Fx';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const button = () => container.querySelector('button')!;
const alertText = () => container.querySelector('[role="alert"]')?.textContent ?? null;

async function render(o: { answer?: PreviewTokenAnswer | Error; unsaved?: boolean; disabled?: boolean } = {}) {
  const request = vi.fn(async () => {
    if (o.answer instanceof Error) throw o.answer;
    return o.answer ?? { status: 200, body: { token: 'a.b', expiresAt: 1, url: URL_OK } };
  });
  const navigate = vi.fn();
  await act(async () =>
    root.render(<PreviewButton entryId={ENTRY} unsaved={() => o.unsaved ?? false} disabled={o.disabled} request={request} navigate={navigate} />),
  );
  return { request, navigate };
}

describe('PreviewButton', () => {
  it('asks for a token for the entry and sends the browser to the site’s preview URL', async () => {
    const { request, navigate } = await render();
    expect(button().textContent).toBe(t.preview.open);
    await act(async () => button().click());
    expect(request).toHaveBeenCalledWith(ENTRY);
    expect(navigate).toHaveBeenCalledWith(URL_OK);
    expect(button().textContent).toBe(t.preview.opening);
    expect(button().disabled).toBe(true);
  });

  it('waits for unsaved edits: no token is asked for', async () => {
    const { request, navigate } = await render({ unsaved: true });
    await act(async () => button().click());
    expect(request).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(alertText()).toBe(t.preview.unsaved);
  });

  it('is disabled while the form cannot preview', async () => {
    await render({ disabled: true });
    expect(button().disabled).toBe(true);
  });

  it.each([
    [{ status: 401, body: { error: 'auth' } }, t.editor.signedOut],
    [{ status: 409, body: { error: 'preview_unavailable' } }, t.preview.unavailable],
    [{ status: 409, body: { error: 'site_required' } }, t.preview.unavailable],
    [{ status: 404, body: { error: 'not_found' } }, t.preview.failed],
    [{ status: 500, body: null }, t.preview.failed],
    [{ status: 200, body: { url: 'javascript:alert(1)' } }, t.preview.failed],
    [new Error('network'), t.preview.failed],
  ])('shows a plain failure and stays on the page: %o', async (answer, text) => {
    const { navigate } = await render({ answer });
    await act(async () => button().click());
    expect(navigate).not.toHaveBeenCalled();
    expect(alertText()).toBe(text);
    expect(button().disabled).toBe(false);
  });
});
