import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { describedByOf, Field, FieldGroup, fieldErrorId, fieldHelpId } from '../Field';

// Task 31 spec-quality r1: help and error text sit outside the <label>, so they never become part
// of the control's accessible name; the control refers to them with aria-describedby.
const render = (props: { help?: string; error?: string; required?: boolean }) =>
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

  // M2-07: the required marker is visual only; the control's `required` attribute is announced.
  it('shows an aria-hidden required marker inside the label when required, and none otherwise', () => {
    expect(labelOf(render({ required: true }))).toContain('<span aria-hidden="true" data-required-marker=""');
    expect(render({})).not.toContain('data-required-marker');
  });
});

describe('FieldGroup', () => {
  it('is a fieldset named by its legend, with the marker, help and error outside the legend', () => {
    const html = renderToStaticMarkup(
      <FieldGroup id="free" label="Frítt inn" required help="Hjálp" error="Villa" describedBy={describedByOf('free', { help: 'Hjálp', error: 'Villa' })}>
        <input type="radio" name="free" />
      </FieldGroup>,
    );
    expect(html).toMatch(/<fieldset id="free" aria-describedby="free-help free-error"/);
    const legend = /<legend[^>]*>(.*?)<\/legend>/s.exec(html)![1]!;
    expect(legend).toContain('Frítt inn');
    expect(legend).toContain('data-required-marker');
    expect(legend).not.toContain('Hjálp');
    expect(html).toMatch(/<\/fieldset><span id="free-help"[^>]*>Hjálp<\/span><span id="free-error" role="alert"[^>]*>Villa<\/span>/);
  });

  it('describedByOf lists only the parts that are shown', () => {
    expect(describedByOf('x', {})).toBeUndefined();
    expect(describedByOf('x', { help: 'a' })).toBe('x-help');
    expect(describedByOf('x', { error: 'b' })).toBe('x-error');
  });
});
