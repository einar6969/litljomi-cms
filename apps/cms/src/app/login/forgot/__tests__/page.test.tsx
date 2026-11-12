import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The form is a client component with its own tests (forgot-password-form.test.tsx).
vi.mock('../ForgotPasswordForm', () => ({ ForgotPasswordForm: () => <form data-form="forgot" /> }));

const { default: ForgotPasswordPage } = await import('../page');
const { t } = await import('@/i18n/is');

describe('the "Gleymt lykilorð?" page (PW-03)', () => {
  it('shows the form under its heading, and the way back to sign in', () => {
    const html = renderToStaticMarkup(<ForgotPasswordPage />);
    expect(html).toContain(`<h1>${t.forgot.title}</h1>`);
    expect(html).toContain(t.forgot.intro);
    expect(html).toContain('data-form="forgot"');
    expect(html).toContain(`<a href="/login">${t.forgot.back}</a>`);
  });
});
