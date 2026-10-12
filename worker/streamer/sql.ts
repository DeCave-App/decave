import type { Database } from "./types";

export function statement<D extends Database>(
  db: D,
  sql: string,
  ...args: (string | number | null)[]
): ReturnType<D["prepare"]> {
  // D1 bind returns a prepared statement from the same binding. Preserve that concrete
  // type so public factory helpers fit the host's existing D1PreparedStatement[] batches.
  return db.prepare(sql).bind(...args) as ReturnType<D["prepare"]>;
}
export async function one<T>(db: Database, sql: string, ...args: (string | number | null)[]): Promise<T | null> {
  return statement(db, sql, ...args).first<T>();
}
export async function all<T>(db: Database, sql: string, ...args: (string | number | null)[]): Promise<T[]> {
  return (await statement(db, sql, ...args).all<T>()).results;
}
