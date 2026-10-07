export type AccountSessionSnapshot = { accountKey: string | null; generation: number };

/** Invalidates asynchronous work when the signed-in account/session changes. */
export class AccountSessionGuard {
  private accountKey: string | null = null;
  private generation = 0;

  switchTo(accountKey: string | null): AccountSessionSnapshot {
    if (this.accountKey !== accountKey) {
      this.accountKey = accountKey;
      this.generation += 1;
    }
    return this.capture();
  }

  invalidate(): AccountSessionSnapshot {
    this.generation += 1;
    return this.capture();
  }

  capture(): AccountSessionSnapshot {
    return { accountKey: this.accountKey, generation: this.generation };
  }

  owns(snapshot: AccountSessionSnapshot): boolean {
    return snapshot.accountKey === this.accountKey && snapshot.generation === this.generation;
  }
}

/** Commits a response only while the session snapshot that requested it still owns the UI. */
export function commitForSession<T>(
  guard: AccountSessionGuard,
  snapshot: AccountSessionSnapshot,
  value: T,
  commit: (value: T) => void,
): boolean {
  if (!guard.owns(snapshot)) return false;
  commit(value);
  return true;
}
