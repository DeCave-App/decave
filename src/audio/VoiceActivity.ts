// RTP header levels are optional. Fall back to decoded inbound stats, and
// reject old samples so a stopped sender cannot keep its indicator lit.
export class VoiceActivity {
  private energy = new WeakMap<RTCRtpReceiver, { id: string; energy: number; duration: number }>();
  private lastActive = new WeakMap<RTCRtpReceiver, number>();

  async speaking(receiver: RTCRtpReceiver, now: number): Promise<boolean> {
    let level: number | undefined;
    try {
      for (const source of receiver.getSynchronizationSources()) {
        if (now - source.timestamp > 350 || !Number.isFinite(source.audioLevel)) continue;
        level = Math.max(level ?? 0, source.audioLevel!);
      }
    } catch {
      /* Some clients do not expose RTP header levels. */
    }
    if (level === undefined) {
      try {
        const reports = await receiver.getStats();
        reports.forEach((report) => {
          if (report.type !== "inbound-rtp" || (report.kind ?? report.mediaType) !== "audio") return;
          const previous = this.energy.get(receiver);
          if (Number.isFinite(report.totalAudioEnergy) && Number.isFinite(report.totalSamplesDuration)) {
            this.energy.set(receiver, {
              id: report.id,
              energy: report.totalAudioEnergy,
              duration: report.totalSamplesDuration,
            });
            if (previous && previous.id === report.id && report.totalSamplesDuration >= previous.duration) {
              const duration = report.totalSamplesDuration - previous.duration;
              level = duration > 0 ? Math.sqrt(Math.max(0, report.totalAudioEnergy - previous.energy) / duration) : 0;
              return;
            }
          }
          if (Number.isFinite(report.audioLevel)) level = Math.max(level ?? 0, report.audioLevel);
        });
      } catch {
        /* An ended receiver may reject stats during peer cleanup. */
      }
    }
    // -50 dBFS catches quiet/denoised voices; hold across short word gaps.
    if ((level ?? 0) >= 0.0032) this.lastActive.set(receiver, now);
    const lastActive = this.lastActive.get(receiver);
    return lastActive !== undefined && now - lastActive < 250;
  }
}
