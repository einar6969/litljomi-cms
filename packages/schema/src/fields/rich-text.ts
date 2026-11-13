import { projectRichText, richTextDocSchema, type ProjectedRichTextDoc, type RichTextDoc } from '@litljomi/rich-text';
import { definedOnly, draftOf, publishOf, type FieldKind } from '../field-kind.ts';
import { resolveAsset, resolveEntry } from '../projection.ts';

export interface RichTextOptions {
  label: string;
  required?: boolean;
}

export function richText(o: RichTextOptions): FieldKind<RichTextDoc, ProjectedRichTextDoc> {
  const required = o.required ?? false;
  return {
    kind: 'richText',
    label: o.label,
    required,
    draftSchema: () => draftOf(richTextDocSchema),
    publishSchema: () => publishOf(richTextDocSchema, required),
    project: (v, ctx) =>
      v == null
        ? null
        : projectRichText(v, {
            asset: (id) => resolveAsset(ctx, id),
            entryPath: (id) => resolveEntry(ctx, id)?.path ?? null,
            localMediaOrigin: ctx.localMediaOrigin ?? null,
          }),
    tsType: () => 'ProjectedRichTextDoc | null',
    withOptions: (x) => richText({ ...o, ...definedOnly(x) }),
  };
}
