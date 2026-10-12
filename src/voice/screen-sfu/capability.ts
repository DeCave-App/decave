export function screenSfuCapable(env: {
  RTCRtpScriptTransform?: unknown;
  e2eeReady: boolean;
  sfuOffered: boolean;
}): boolean {
  return Boolean(env.RTCRtpScriptTransform) && env.e2eeReady && env.sfuOffered;
}

// Tracks decrypt health inside the transform worker: failure reports are
// throttled to one per second; a success after failures is reported once.
export class DecryptHealth {
  private lastReport = -Infinity;
  private failing = false;

  onFailure(now: number): boolean {
    this.failing = true;
    if (now - this.lastReport < 1000) return false;
    this.lastReport = now;
    return true;
  }

  onSuccess(): boolean {
    if (!this.failing) return false;
    this.failing = false;
    return true;
  }
}
