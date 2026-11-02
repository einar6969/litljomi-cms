'use client';

import { createContext, useContext } from 'react';

/** The tenant of the form's page, as the page resolved it through `api.my_tenants`. */
export type EditorTenant = { id: string; slug: string };

const EditorTenantContext = createContext<EditorTenant | null>(null);

/** Gives the form's fields their tenant (an upload's storage path starts with its id, §5.6). */
export const EditorTenantProvider = EditorTenantContext.Provider;

export function useEditorTenant(): EditorTenant {
  const tenant = useContext(EditorTenantContext);
  if (!tenant) throw new Error('useEditorTenant: no EditorTenantProvider');
  return tenant;
}
