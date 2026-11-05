'use client';

import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

type ShellState = { open: () => void; close: () => void };

const ShellContext = createContext<ShellState>({ open: () => undefined, close: () => undefined });

/** Opens and closes the drawer from anything inside the shell. */
export const useShell = () => useContext(ShellContext);

/**
 * The app's frame: a sidebar and the work area. There is one sidebar in the page: from 1024 px up
 * it stands beside the work, below that it is a drawer. Esc and a new page close the drawer.
 */
export function Shell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const state = useMemo(() => ({ open: () => setIsOpen(true), close: () => setIsOpen(false) }), []);

  useEffect(() => setIsOpen(false), [pathname]);
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen]);

  return (
    <ShellContext.Provider value={state}>
      <div className={isOpen ? 'app is-open' : 'app'}>
        {sidebar}
        <div className="scrim" aria-hidden="true" onClick={state.close} />
        <div className="work">{children}</div>
      </div>
    </ShellContext.Provider>
  );
}
