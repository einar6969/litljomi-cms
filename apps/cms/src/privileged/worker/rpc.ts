import type { SupabaseClient } from '../../lib/supabase/types';

/** An error returned by an `api` function, with its SQLSTATE and message (decision 3). */
export class WorkerRpcError extends Error {
  readonly fn: string;
  readonly code: string;
  readonly dbMessage: string;
  constructor(fn: string, code: string, message: string) {
    super(`${fn}: ${code} ${message}`);
    this.name = 'WorkerRpcError';
    this.fn = fn;
    this.code = code;
    this.dbMessage = message;
  }
}

/** Calls an `api` function and returns its result; a database error is thrown as WorkerRpcError. */
export async function callRpc<T>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new WorkerRpcError(fn, error.code ?? '', error.message ?? '');
  return data as T;
}

/** A decision-3 error (`raise exception '<code>' using errcode = 'P0001'`) with one of the given codes. */
export function isApiError(error: unknown, ...codes: string[]): error is WorkerRpcError {
  return error instanceof WorkerRpcError && error.code === 'P0001' && codes.includes(error.dbMessage);
}
