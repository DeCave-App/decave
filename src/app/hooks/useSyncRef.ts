// Keeps a ref pointing at the latest committed value, for callbacks that
// outlive the render that created them.

import { useEffect } from "react";

export function useSyncRef<T>(ref: { current: T }, value: T): void {
  useEffect(() => {
    ref.current = value;
  }, [ref, value]);
}
