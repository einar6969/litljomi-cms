'use client';

import { useEffect, useState } from 'react';
import { referenceOptionsAction } from '@/app/(editor)/t/[tenant]/reference-actions';
import type { ReferenceOption } from '@/editor/server/reference-options';
import { t } from '@/i18n/is';
import { Button } from '@/ui/Button';
import { Field, fieldErrorId, fieldHelpId } from '@/ui/Field';
import type { FieldProps } from '../field-registry';
import { useEditorTenant } from '../tenant-context';

/** The stored value of a reference field: the standard entry reference (§4.3). */
type ReferenceValue = { _ref: string; _kind: 'entry' };

type Loaded = { options: ReferenceOption[]; truncated: boolean };
type Failure = 'error' | 'auth';

const refOf = (value: unknown): string | null => {
  if (typeof value !== 'object' || value === null) return null;
  const { _ref, _kind } = value as Partial<ReferenceValue>;
  return typeof _ref === 'string' && _kind === 'entry' ? _ref : null;
};

const optionText = (option: ReferenceOption): string =>
  `${option.title ?? t.entries.untitled} (${t.entries.statuses[option.status] ?? option.status})`;

/**
 * A reference to another entry (§5.2): a picker over the entries of the field's allowed types in
 * the editor's own tenant, read with the editor's session (`referenceOptionsAction`, §4.5), each
 * shown with its title and status. Choosing one stores `{ _ref, _kind: 'entry' }`; choosing none
 * clears the field. A chosen entry that is not published gets a hint: publishing refuses a
 * reference to an unpublished entry (§6.2 step 5). A stored reference the list does not hold
 * (archived, deleted, or past the list's limit) stays as it is until the editor picks another. A failed load shows the error
 * and a retry; the picker stays disabled until the list is there.
 */
export function ReferenceField({ id, label, required, value, onChange, to = [] }: FieldProps) {
  const tenant = useEditorTenant();
  const ref = refOf(value);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [attempt, setAttempt] = useState(0);
  // The allowed types as a stable dependency (the descriptor's array is a new one each render).
  const types = to.join(',');

  useEffect(() => {
    let live = true;
    setFailure(null);
    referenceOptionsAction(tenant.slug, types === '' ? [] : types.split(','))
      .then((result) => {
        if (!live) return;
        if (result.ok) setLoaded({ options: result.options, truncated: result.truncated });
        else setFailure(result.code === 'auth' ? 'auth' : 'error');
      })
      .catch(() => live && setFailure('error'));
    return () => {
      live = false;
    };
  }, [tenant.slug, types, attempt]);

  const chosen = ref === null ? null : (loaded?.options.find((o) => o.id === ref) ?? null);
  // Archived entries are not listed, so a listed entry that is not published is a draft.
  const unpublished = chosen?.status === 'draft';
  const help = loaded === null ? (failure === null ? t.editor.reference.loading : null) : unpublished ? t.editor.reference.unpublished : loaded.truncated ? t.editor.reference.truncated : null;
  const describedBy = [help ? fieldHelpId(id) : null, failure ? fieldErrorId(id) : null].filter(Boolean).join(' ') || undefined;

  const change = (next: string) => {
    if (next === '') onChange(undefined);
    else onChange({ _ref: next, _kind: 'entry' } satisfies ReferenceValue);
  };

  return (
    <div className="flex flex-col gap-2">
      <Field label={label} htmlFor={id} help={help} error={failure ? (failure === 'auth' ? t.editor.signedOut : t.editor.reference.loadError) : null}>
        <select id={id} name={id} required={required} value={ref ?? ''} disabled={loaded === null} aria-describedby={describedBy} onChange={(e) => change(e.target.value)}>
          <option value="">{t.editor.reference.none}</option>
          {ref !== null && chosen === null ? <option value={ref}>{loaded === null ? t.editor.reference.loading : loaded.truncated ? t.editor.reference.notListed : t.editor.reference.missing}</option> : null}
          {loaded?.options.map((option) => (
            <option key={option.id} value={option.id}>
              {optionText(option)}
            </option>
          ))}
        </select>
      </Field>
      {failure ? (
        <Button className="self-start" onClick={() => setAttempt((n) => n + 1)}>
          {t.editor.retry}
        </Button>
      ) : null}
    </div>
  );
}
