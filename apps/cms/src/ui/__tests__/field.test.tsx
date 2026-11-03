import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Field, fieldErrorId, fieldHelpId } from '../Field';

// Task 31 spec-quality r1: help and error text sit outside the <label>, so they never become part
// of the control's accessible name; the control refers to them with aria-describedby.
const render = (props: { help?: string; error?: string }) =>
  renderToStaticMarkup(
    <Field label="Titill" htmlFor="title" {...props}>
      <input id="title" />
    </Field>,
  );

const labelOf = (html: string) => /<label[^>]*>(.*?)<\/label>/s.exec(html)![1]!;

describe('Field', () => {
  it('the label holds the label text and the control only', () => {
    const html = render({ help: 'Hjálp', error: 'Villa' });
    const label = labelOf(html);
    expect(label).toContain('Titill');
    expect(label).toContain('<input id="title"/>');
    expect(label).not.toContain('Hjálp');
    expect(label).not.toContain('Villa');
  });

  it('help and error follow the label with ids the control can reference; the error is an alert', () => {
    const html = render({ help: 'Hjálp', error: 'Villa' });
    expect(fieldHelpId('title')).toBe('title-help');
    expect(fieldErrorId('title')).toBe('title-error');
    expect(html).toMatch(/<\/label><span id="title-help"[^>]*>Hjálp<\/span><span id="title-error" role="alert"[^>]*>Villa<\/span>/);
  });

  it('renders neither span without help or error', () => {
    const html = render({});
    expect(html).not.toContain('title-help');
    expect(html).not.toContain('title-error');
  });
});
