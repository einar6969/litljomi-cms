export { RICH_TEXT_MAX_DEPTH, canonicalUuid, richTextDocSchema } from './doc-schema.ts';
export { canonicalHttpsUrl, canonicalMediaUrl, isHttpsUrl, isRootRelativePath, loopbackHttpOrigin } from './safe-url.ts';
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
