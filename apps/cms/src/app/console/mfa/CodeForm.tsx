'use client';

import { useActionState } from 'react';
import { Button } from '@/ui/Button';
import { describedByOf, Field } from '@/ui/Field';
import { verifyCode, type CodeFormState } from './actions';

const INITIAL: CodeFormState = {};

/**
 * The six-digit code. A client component so a refused code answers in place: the page above it
 * keeps its QR and manual code, which a reload would replace with a new factor's.
 */
export function CodeForm() {
  const [state, action, pending] = useActionState(verifyCode, INITIAL);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Six-digit code" htmlFor="code" error={state.error}>
        <input
          id="code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          aria-describedby={describedByOf('code', { error: state.error })}
        />
      </Field>
      <Button type="submit" variant="primary" disabled={pending}>
        Verify
      </Button>
    </form>
  );
}
