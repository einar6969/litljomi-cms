/**
 * True only for a tenant whose content may be edited now. Every editor route and action uses this
 * one rule; a missing tenant (not a member, or not found) counts as inactive.
 *
 * Its own module, with no imports, so privileged code (the preview token route) can use the rule
 * without loading the editor's request-scoped Supabase client through `lib/tenant`.
 */
export const isActive = (tenant: { status: string } | null | undefined): boolean => tenant?.status === 'active';
