'use client';

import { richTextDocSchema } from '@litljomi/rich-text';
import { richTextExtensions } from '@litljomi/rich-text/editor';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { t } from '@/i18n/is';
import { Button } from '@/ui/Button';
import { Notice } from '@/ui/Notice';
import type { FieldProps } from '../field-registry';

/**
 * A rich-text field (§5.4): Tiptap with the v1 configuration from `@litljomi/rich-text/editor`,
 * which only the CMS app loads (decision 23). Its parser drops anything outside the v1 node set,
 * so pasted Word or web content is cleaned on the way in (review focus 2). The value is saved only
 * while it validates against `richTextDocSchema`; an empty editor clears the field. Inserting an
 * image inside rich text is M2 (decision 37.7); images already in the document are kept.
 */
export function RichTextField({ id, label, value, onChange }: FieldProps) {
  const initial = value == null ? { success: true as const, data: undefined } : richTextDocSchema.safeParse(value);
  if (!initial.success) {
    // A stored document this editor cannot load is shown as a notice and saved back unchanged.
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-[15px] font-medium">{label}</span>
        <Notice role="note">{t.editor.richText.unreadable}</Notice>
      </div>
    );
  }
  return <RichTextEditor id={id} label={label} initial={initial.data} onChange={onChange} />;
}

type EditorProps = { id: string; label: string; initial: unknown; onChange: (value: unknown) => void };

function RichTextEditor({ id, label, initial, onChange }: EditorProps) {
  const [invalid, setInvalid] = useState(false);
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  }, [onChange]);
  const labelId = `${id}-label`;
  const editor = useEditor({
    extensions: richTextExtensions(),
    content: (initial ?? undefined) as Record<string, unknown> | undefined,
    // Rendered on the server too; the editor mounts in the browser.
    immediatelyRender: false,
    // The field label is the accessible name (decision 39.3): aria-labelledby for browsers, and the
    // same text as aria-label for tools that read only the element's own attributes.
    editorProps: { attributes: { id, role: 'textbox', 'aria-multiline': 'true', 'aria-labelledby': labelId, 'aria-label': label } },
    onUpdate: ({ editor: current }) => {
      if (current.isEmpty) {
        setInvalid(false);
        latest.current(undefined);
        return;
      }
      const parsed = richTextDocSchema.safeParse(current.getJSON());
      setInvalid(!parsed.success);
      if (parsed.success) latest.current(parsed.data);
    },
  });

  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="text-[15px] font-medium">
        {label}
      </span>
      <div className="rt-box">
        {editor ? <Toolbar editor={editor} /> : null}
        <EditorContent editor={editor} className="rt-content" />
      </div>
      {invalid ? (
        <Notice tone="error" role="alert">
          {t.editor.richText.invalid}
        </Notice>
      ) : null}
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      heading2: e.isActive('heading', { level: 2 }),
      heading3: e.isActive('heading', { level: 3 }),
      bulletList: e.isActive('bulletList'),
      orderedList: e.isActive('orderedList'),
      blockquote: e.isActive('blockquote'),
      link: e.isActive('link'),
      href: (e.getAttributes('link').href as unknown) ?? '',
    }),
  });
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState('');
  const [linkInvalid, setLinkInvalid] = useState(false);

  const chain = () => editor.chain().focus();
  const toggle = (name: keyof typeof active, text: string, run: () => boolean) => (
    <Button aria-pressed={active[name] === true} onMouseDown={(e) => e.preventDefault()} onClick={() => run()}>
      {text}
    </Button>
  );
  const openLink = () => {
    setHref(typeof active.href === 'string' ? active.href : '');
    setLinkInvalid(false);
    setLinkOpen((open) => !open);
  };
  const applyLink = () => {
    // setLink refuses an unsafe or empty href (the same rule as the schema).
    const ok = chain().extendMarkRange('link').setLink({ href: href.trim() }).run();
    setLinkInvalid(!ok);
    if (ok) setLinkOpen(false);
  };

  return (
    <div role="toolbar" aria-label={t.editor.richText.toolbar}>
      <div className="rt-group">
        {toggle('bold', t.editor.richText.bold, () => chain().toggleBold().run())}
        {toggle('italic', t.editor.richText.italic, () => chain().toggleItalic().run())}
      </div>
      <div className="rt-group">
        {toggle('heading2', t.editor.richText.heading2, () => chain().toggleHeading({ level: 2 }).run())}
        {toggle('heading3', t.editor.richText.heading3, () => chain().toggleHeading({ level: 3 }).run())}
      </div>
      <div className="rt-group">
        {toggle('bulletList', t.editor.richText.bulletList, () => chain().toggleBulletList().run())}
        {toggle('orderedList', t.editor.richText.orderedList, () => chain().toggleOrderedList().run())}
        {toggle('blockquote', t.editor.richText.blockquote, () => chain().toggleBlockquote().run())}
      </div>
      <div className="rt-group">
        <Button onMouseDown={(e) => e.preventDefault()} onClick={() => chain().setHardBreak().run()}>
          {t.editor.richText.hardBreak}
        </Button>
        <Button aria-pressed={active.link} aria-expanded={linkOpen} onMouseDown={(e) => e.preventDefault()} onClick={openLink}>
          {t.editor.richText.link}
        </Button>
      </div>
      {linkOpen ? (
        <span className="rt-link">
          <label>
            {t.editor.richText.linkUrl}
            <input type="text" inputMode="url" value={href} aria-invalid={linkInvalid} onChange={(e) => setHref(e.target.value)} />
          </label>
          <Button variant="primary" onClick={applyLink}>
            {t.editor.richText.setLink}
          </Button>
          {active.link ? (
            <Button
              onClick={() => {
                chain().extendMarkRange('link').unsetLink().run();
                setLinkOpen(false);
              }}
            >
              {t.editor.richText.removeLink}
            </Button>
          ) : null}
          {linkInvalid ? <span role="alert" className="w-full text-sm font-medium text-danger">{t.editor.invalidUrl}</span> : null}
        </span>
      ) : null}
    </div>
  );
}
