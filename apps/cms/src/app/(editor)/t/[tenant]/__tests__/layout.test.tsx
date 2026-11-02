import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
}));
vi.mock('@/lib/supabase/server', () => ({ createEditorClient: vi.fn(async () => ({})) }));
const session = vi.hoisted(() => ({ requireUserId: vi.fn(async () => 'user-id') }));
vi.mock('@/lib/auth/session', () => session);
const tenants = vi.hoisted(() => ({ currentTenant: vi.fn() }));
// Only the tenant lookup is replaced; the `isActive` rule is the real one.
vi.mock('@/lib/tenant', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/tenant')>()), ...tenants }));

const { default: TenantLayout } = await import('../layout');
const { t } = await import('@/i18n/is');

const TENANT = { id: '00000000-0000-4000-8000-0000000000f1', slug: 'acme', name: 'Acme', status: 'active' as const };
const render = async (slug = 'acme') =>
  renderToStaticMarkup(await TenantLayout({ children: <p>content</p>, params: Promise.resolve({ tenant: slug }) }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the tenant layout', () => {
  it('checks the session, then shows an active tenant\'s pages', async () => {
    tenants.currentTenant.mockResolvedValue(TENANT);
    expect(await render()).toBe('<p>content</p>');
    expect(session.requireUserId).toHaveBeenCalledOnce();
    expect(tenants.currentTenant).toHaveBeenCalledExactlyOnceWith('acme');
  });

  it('answers 404 for a tenant the editor is not a member of', async () => {
    tenants.currentTenant.mockResolvedValue(null);
    await expect(render('other')).rejects.toThrow('NOT_FOUND');
  });

  it('shows "Vefur óvirkur" instead of the pages of a suspended tenant', async () => {
    tenants.currentTenant.mockResolvedValue({ ...TENANT, status: 'suspended' });
    const html = await render();
    expect(html).toContain(t.tenant.inactive);
    expect(t.tenant.inactive).toBe('Vefur óvirkur');
    expect(html).not.toContain('content');
  });

  it('never resolves the tenant without a session', async () => {
    session.requireUserId.mockRejectedValueOnce(new Error('REDIRECT /login'));
    await expect(render()).rejects.toThrow('REDIRECT /login');
    expect(tenants.currentTenant).not.toHaveBeenCalled();
  });
});
