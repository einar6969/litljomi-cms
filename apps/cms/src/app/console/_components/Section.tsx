import type { ReactNode } from 'react';
import { Notice } from '@/ui/Notice';
import type { Read } from '@/console/data';

type Column<T> = { header: string; cell: (row: T) => ReactNode };

type Props<T> = {
  id: string;
  title: string;
  /** What the section is called in a sentence, for the empty and error messages. */
  noun: string;
  read: Read<T>;
  columns: Array<Column<T>>;
  rowKey: (row: T) => string;
};

/**
 * One list of the console: a heading and a table. A failed read says so; it is never shown as an
 * empty list. The rows arrive already ordered and limited by the read.
 */
export function Section<T>({ id, title, noun, read, columns, rowKey }: Props<T>) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id}>{title}</h2>
      {!read.ok ? (
        <Notice tone="error" role="alert">
          The {noun} could not be read. Reload the page to try again.
        </Notice>
      ) : read.rows.length === 0 ? (
        <p className="text-muted">No {noun}.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[15px]">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.header} scope="col" className="border-b border-hairline px-3 py-2 font-semibold whitespace-nowrap">
                    {column.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {read.rows.map((row) => (
                <tr key={rowKey(row)}>
                  {columns.map((column) => (
                    <td key={column.header} className="border-b border-hairline px-3 py-2 align-top">
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
