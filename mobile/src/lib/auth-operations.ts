export type MobileAuthOperation = { generation: number; controller: AbortController };

/**
 * Serializes sign-in, MFA, restore and logout so only the most recent
 * operation may commit session state; starting a new one aborts the previous.
 */
export class MobileAuthOperationCoordinator {
  private generation = 0;
  private active: MobileAuthOperation | null = null;

  get current(): MobileAuthOperation | null { return this.active; }

  begin(): MobileAuthOperation {
    const previous = this.active;
    previous?.controller.abort();
    this.active = null;
    const operation = { generation: ++this.generation, controller: new AbortController() };
    this.active = operation;
    return operation;
  }

  owns(operation: MobileAuthOperation): boolean {
    return this.active === operation && operation.generation === this.generation && !operation.controller.signal.aborted;
  }

  async commitIfCurrent(operation: MobileAuthOperation, commit: () => Promise<void>): Promise<boolean> {
    if (!this.owns(operation)) return false;
    await commit();
    return this.owns(operation);
  }

  invalidate(): void {
    this.active?.controller.abort();
    this.active = null;
    this.generation++;
  }
}
