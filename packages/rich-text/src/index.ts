export { richTextDocSchema } from './doc-schema.ts';
export type {
  RichTextBlock,
  RichTextDoc,
  RichTextInline,
  RichTextListItem,
  RichTextMark,
} from './doc-schema.ts';
export { toPlainText } from './plain-text.ts';
export { projectRichText } from './project.ts';
export type { ProjectedRichTextDoc, RichTextResolver } from './project.ts';
export { RichText } from './render.tsx';
// The Tiptap configuration is on its own entry point, `@litljomi/rich-text/editor` (decision 23).
