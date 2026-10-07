const listeners = new Set<() => void>();

/** Lets background pollers react at once when a Squad Finder search starts or stops in-app. */
export function onSquadSearchChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitSquadSearchChanged(): void {
  listeners.forEach((listener) => listener());
}
