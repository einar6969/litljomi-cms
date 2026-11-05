// A stand-in for the signed-in client's query builder: it records each read and answers from rows
// per view, applying eq filters, the order and the limit it was given, as the database would.
export type Call = { view: string; filters: Array<[string, unknown]>; orders: Array<{ column: string; ascending: boolean }>; limit?: number };

export function fakeClient(views: Record<string, Array<Record<string, unknown>> | { error: string }>) {
  const calls: Call[] = [];
  const from = (view: string) => {
    const call: Call = { view, filters: [], orders: [] };
    calls.push(call);
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => (call.filters.push([column, value]), builder),
      order: (column: string, options?: { ascending?: boolean }) => (call.orders.push({ column, ascending: options?.ascending ?? true }), builder),
      limit: (n: number) => ((call.limit = n), builder),
      then: (resolve: (value: unknown) => unknown) => {
        const source = views[view];
        if (!source) return resolve({ data: null, error: { code: 'PGRST205' } });
        if ('error' in source) return resolve({ data: null, error: { code: source.error } });
        let rows = source.filter((row) => call.filters.every(([column, value]) => row[column] === value));
        const [first] = call.orders;
        if (first) {
          rows = [...rows].sort((a, b) => {
            const x = a[first.column] as string | number;
            const y = b[first.column] as string | number;
            return (x < y ? -1 : x > y ? 1 : 0) * (first.ascending ? 1 : -1);
          });
        }
        return resolve({ data: rows.slice(0, call.limit), error: null });
      },
    };
    return builder;
  };
  return { client: { from }, calls };
}
