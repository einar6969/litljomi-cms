import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The form is a client component with its own tests (sign-in-form.test.tsx); here it shows the
// `next` it is given.
vi.mock('../SignInForm', () => ({
  SignInForm: ({ next }: { next?: string }) => <form data-next={next === undefined ? 'none' : next} />,
}));
// Whether the page reaches the sign-in actions on the server (see the test at the end).
const actions = vi.hoisted(() => ({ loaded: false }));
vi.mock('../actions', () => {
  actions.loaded = true;
  return {};
});

const { default: LoginPage } = await import('../page');
const { t } = await import('@/i18n/is');

const render = async (query: Record<string, string | string[] | undefined>) =>
  renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve(query) }));

describe('the sign-in page', () => {
  it('shows the sign-in form under its heading', async () => {
    const html = await render({});
    expect(html).toContain(`<h1>${t.login.title}</h1>`);
    expect(html).toContain('data-next="none"');
  });

  it('hands the form the next path as given; the form makes it safe', async () => {
    expect(await render({ next: '/t/labak' })).toContain('data-next="/t/labak"');
    expect(await render({ next: '//evil.example' })).toContain('data-next="//evil.example"');
  });

  it('hands the form no next path for a repeated one', async () => {
    expect(await render({ next: ['/t/labak', '/console'] })).toContain('data-next="none"');
  });

  it('says a link was invalid after a failed link', async () => {
    expect(await render({ error: 'link' })).toContain(t.login.linkInvalid);
  });

  it('says the other address has to confirm too after the first of an email change\'s two links', async () => {
    expect(await render({ emailChange: 'waiting' })).toContain(t.login.emailChangeWaiting);
  });

  it.each([{}, { emailChange: 'done' }, { error: 'link' }])('says nothing about an email change for %j', async (query) => {
    expect(await render(query)).not.toContain(t.login.emailChangeWaiting);
  });

  it.each([{}, { error: 'other' }, { emailChange: 'waiting' }])('says nothing about a link for %j', async (query) => {
    expect(await render(query)).not.toContain(t.login.linkInvalid);
  });

  // A sign-out posted after the session expired is sent on to /login by the proxy, with its action
  // id; it runs only if /login registers it, which the page's server-side import of ./actions does.
  it('reaches the sign-in actions on the server, so a sign-out sent on to /login still runs', () => {
    expect(actions.loaded).toBe(true);
  });
});
