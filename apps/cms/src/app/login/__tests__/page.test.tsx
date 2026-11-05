import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../actions', () => ({ requestMagicLink: vi.fn() }));

const { default: LoginPage } = await import('../page');
const { t } = await import('@/i18n/is');

const render = async (query: Record<string, string | string[] | undefined>) =>
  renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve(query) }));

describe('the sign-in page', () => {
  it('says the other address has to confirm too after the first of an email change\'s two links', async () => {
    expect(await render({ emailChange: 'waiting' })).toContain(t.login.emailChangeWaiting);
  });

  it.each([{}, { emailChange: 'done' }, { sent: '1' }, { error: 'link' }])('says nothing about an email change for %j', async (query) => {
    expect(await render(query)).not.toContain(t.login.emailChangeWaiting);
  });
});
