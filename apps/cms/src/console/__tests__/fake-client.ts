// A stand-in for the signed-in client's query builder: it records each read and answers from rows
// per view, applying eq filters, the order and the limit it was given, as the database would.
export type Call = { view: string; filters: Array<[string, unknown]>; orders: Array<{ column: string; ascending: boolean; nullsFirst?: boolean }>; limit?: number };

export function fakeClient(views: Record<string, Array<Record<string, unknown>> | { error: string }>) {
  const calls: Call[] = [];
  const from = (view: string) => {
    const call: Call = { view, filters: [], orders: [] };
    calls.push(call);
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => (call.filters.push([column, value]), builder),
      in: (column: string, values: unknown[]) => (call.filters.push([column, values]), builder),
      order: (column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) => (
        call.orders.push({ column, ascending: options?.ascending ?? true, nullsFirst: options?.nullsFirst }), builder
      ),
      limit: (n: number) => ((call.limit = n), builder),
      then: (resolve: (value: unknown) => unknown) => {
        const source = views[view];
        if (!source) return resolve({ data: null, error: { code: 'PGRST205' } });
        if ('error' in source) return resolve({ data: null, error: { code: source.error } });
        let rows = source.filter((row) => call.filters.every(([column, value]) => (Array.isArray(value) ? value.includes(row[column]) : row[column] === value)));
        rows = [...rows].sort((a, b) => {
          for (const { column, ascending } of call.orders) {
            const x = a[column] as string | number;
            const y = b[column] as string | number;
            if (x !== y) return (x < y ? -1 : 1) * (ascending ? 1 : -1);
          }
          return 0;
        });
        return resolve({ data: rows.slice(0, call.limit), error: null });
      },
    };
    return builder;
  };
  return { client: { from }, calls };
}
