// Holds a new camera track back until the Hub has told the room it is a camera.
//
// Receivers (web, desktop and this app) decide whether an incoming video track
// is a camera or a screen share from the sender's VOICE_STATE flags at the
// moment the track arrives. The server relays an RTC_DESCRIPTION after a few
// database reads, but broadcasts the VOICE_STATE that carries cameraSharing
// only after several more, so an offer sent right after VOICE_CAMERA_STATE
// can reach peers first. Web then files the camera as a screen share and
// drops it as soon as the state (cameraSharing, not screenSharing) lands, so
// nobody ever sees the camera. Waiting for our own copy of that VOICE_STATE,
// plus a short settle for the copies sent to everyone else, keeps the order.

type AdvertParticipant = { connectionId?: string; cameraSharing?: boolean };

type Waiter = {
  connectionId: string;
  finish: (advertised: boolean) => void;
};

/** Upper bound on the wait; on timeout the camera starts anyway, as before. */
export const CAMERA_ADVERT_TIMEOUT_MS = 3000;
/** Our copy of the broadcast can arrive slightly before other people's copies. */
export const CAMERA_ADVERT_SETTLE_MS = 250;

export type CameraAdvertWaiter = {
  /** Resolves true once a later VOICE_STATE shows `connectionId` with its camera on, false on timeout. */
  wait: (connectionId: string, timeoutMs?: number, settleMs?: number) => Promise<boolean>;
  /** Feed every VOICE_STATE participant list here. */
  observe: (participants: readonly AdvertParticipant[]) => void;
};

export function createCameraAdvertWaiter(): CameraAdvertWaiter {
  const waiters = new Set<Waiter>();

  return {
    wait(connectionId, timeoutMs = CAMERA_ADVERT_TIMEOUT_MS, settleMs = CAMERA_ADVERT_SETTLE_MS) {
      return new Promise<boolean>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const waiter: Waiter = {
          connectionId,
          finish: (advertised) => {
            if (!waiters.delete(waiter)) return;
            if (timer) clearTimeout(timer);
            if (advertised && settleMs > 0) setTimeout(() => resolve(true), settleMs);
            else resolve(advertised);
          },
        };
        waiters.add(waiter);
        timer = setTimeout(() => waiter.finish(false), timeoutMs);
      });
    },
    observe(participants) {
      if (waiters.size === 0 || !Array.isArray(participants)) return;
      for (const waiter of [...waiters]) {
        const advertised = participants.some(
          (participant) => participant?.connectionId === waiter.connectionId && participant.cameraSharing === true,
        );
        if (advertised) waiter.finish(true);
      }
    },
  };
}
