'use client';

import { useState } from 'react';
import { t } from '@/i18n/is';
import { Button } from '@/ui/Button';
import { Notice } from '@/ui/Notice';

export type PreviewTokenAnswer = { status: number; body: unknown };

/** POST /api/preview-token from the editor's own origin, with the session cookies (spec §7.5). */
async function requestPreviewToken(entryId: string): Promise<PreviewTokenAnswer> {
  const res = await fetch('/api/preview-token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entryId }),
    credentials: 'same-origin',
    cache: 'no-store',
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

type Props = {
  entryId: string;
  /** True while the form cannot preview what is on the screen (a save conflict, a lost session). */
  disabled?: boolean;
  /** True while an edit is not saved yet: the token names the saved draft version, so preview waits. */
  unsaved: () => boolean;
  request?: (entryId: string) => Promise<PreviewTokenAnswer>;
  navigate?: (url: string) => void;
};

const failureNotice = (a: PreviewTokenAnswer): string => {
  if (a.status === 401) return t.editor.signedOut;
  const code = (a.body as { error?: unknown } | null)?.error;
  if (a.status === 409 && (code === 'preview_unavailable' || code === 'site_required')) return t.preview.unavailable;
  return t.preview.failed;
};

/**
 * "Forskoða" (spec §7.5, plan M3-12): asks the privileged token route for a preview token of the
 * saved draft and sends the browser to the site's preview route with it. The site verifies the
 * token, turns on draft mode and shows the entry's page with the draft. The editor's own page never
 * sees a preview secret; the route answers only the token and the site's URL.
 */
export function PreviewButton({ entryId, disabled = false, unsaved, request = requestPreviewToken, navigate = (url) => window.location.assign(url) }: Props) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const open = async () => {
    setNotice(null);
    if (unsaved()) {
      setNotice(t.preview.unsaved);
      return;
    }
    setBusy(true);
    let answer: PreviewTokenAnswer;
    try {
      answer = await request(entryId);
    } catch {
      answer = { status: 0, body: null };
    }
    const url = (answer.body as { url?: unknown } | null)?.url;
    if (answer.status === 200 && typeof url === 'string' && /^https?:\/\//.test(url)) {
      // Stays busy: the browser is leaving the page.
      navigate(url);
      return;
    }
    setBusy(false);
    setNotice(failureNotice(answer));
  };

  return (
    <div className="flex flex-col gap-3">
      <Button variant="secondary" disabled={disabled || busy} onClick={() => void open()}>
        {busy ? t.preview.opening : t.preview.open}
      </Button>
      {notice ? (
        <Notice tone="error" role="alert">
          {notice}
        </Notice>
      ) : null}
    </div>
  );
}
