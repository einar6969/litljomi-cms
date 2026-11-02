import { defineType } from '../define-type.ts';
import { date } from '../fields/date.ts';
import { image } from '../fields/image.ts';
import { link } from '../fields/link.ts';
import { richText } from '../fields/rich-text.ts';
import { text } from '../fields/text.ts';

/** The shared `news` type. Labels are neutral English keys; a tenant module supplies its own wording. */
export const newsType = defineType({
  name: 'news',
  version: 1,
  label: 'News',
  fields: {
    title: text({ label: 'Title', required: true, max: 200 }),
    date: date({ label: 'Date', required: true }),
    excerpt: text({ label: 'Excerpt', max: 400, multiline: true }),
    image: image({ label: 'Image', required: true }),
    body: richText({ label: 'Body' }),
    source: link({ label: 'Source' }),
  },
  preview: { title: 'title', media: 'image' },
  orderBy: 'date',
});
