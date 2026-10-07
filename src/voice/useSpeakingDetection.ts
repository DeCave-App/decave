// While in voice, detects who is speaking from their audio levels.

import { type Dispatch, type SetStateAction, type MutableRefObject, useEffect } from "react";
import { VoiceActivity } from "../audio/VoiceActivity";
import type { VoiceActivationGateMetrics } from "../audio/clearvoice/VoiceActivationGate";
import type { VoiceParticipant, PeerSession, AudioSettings } from "../app/types";

export type SpeakingDetectionDeps = {
  setSpeakingConnections: Dispatch<SetStateAction<Record<string, boolean>>>;
  voiceChannelId: number | null;
  selfConnectionIdRef: MutableRefObject<string>;
  voiceParticipantsRef: MutableRefObject<VoiceParticipant[]>;
  voiceActivationNodeRef: MutableRefObject<AudioWorkletNode | null>;
  autoSensitivityDbRef: MutableRefObject<number>;
  micLevelDbRef: MutableRefObject<number>;
  micVoiceActivationAudibleRef: MutableRefObject<boolean>;
  voiceActivationMetricsRef: MutableRefObject<Partial<VoiceActivationGateMetrics> | null>;
  audioSettingsRef: MutableRefObject<AudioSettings>;
  isMutedRef: MutableRefObject<boolean>;
  isServerMutedRef: MutableRefObject<boolean>;
  isServerDeafenedRef: MutableRefObject<boolean>;
  peerSessionsRef: MutableRefObject<Map<string, PeerSession>>;
  pushToTalkHeldRef: MutableRefObject<boolean>;
  isDeafenedRef: MutableRefObject<boolean>;
};

export function useSpeakingDetection(deps: SpeakingDetectionDeps): void {
  const {
    setSpeakingConnections,
    voiceChannelId,
    selfConnectionIdRef,
    voiceParticipantsRef,
    voiceActivationNodeRef,
    autoSensitivityDbRef,
    micLevelDbRef,
    micVoiceActivationAudibleRef,
    voiceActivationMetricsRef,
    audioSettingsRef,
    isMutedRef,
    isServerMutedRef,
    isServerDeafenedRef,
    peerSessionsRef,
    pushToTalkHeldRef,
    isDeafenedRef,
  } = deps;

  useEffect(() => {
    if (voiceChannelId === null) {
      setSpeakingConnections({});
      return;
    }

    const activity = new VoiceActivity();
    let cancelled = false;
    let updating = false;
    const updateSpeakingState = async () => {
      if (updating || cancelled) return;
      updating = true;
      try {
        const next: Record<string, boolean> = {};

        await Promise.all(
          Array.from(peerSessionsRef.current, async ([connectionId, session]) => {
            const voiceTracks = new Set(session.remoteAudioStream.getAudioTracks().map((track) => track.id));
            const levels = await Promise.all(
              session.pc
                .getReceivers()
                .filter((receiver) => receiver.track?.readyState === "live" && voiceTracks.has(receiver.track.id))
                .map((receiver) => activity.speaking(receiver, performance.now())),
            );
            if (peerSessionsRef.current.get(connectionId) !== session) return;

            const participant = voiceParticipantsRef.current.find((item) => item.connectionId === connectionId);
            next[connectionId] = levels.some(Boolean) && !participant?.muted && !participant?.serverMuted;
          }),
        );
        if (cancelled) return;

        const selfConnectionId = selfConnectionIdRef.current;
        if (selfConnectionId) {
          const selfParticipant = voiceParticipantsRef.current.find((item) => item.connectionId === selfConnectionId);
          const settings = audioSettingsRef.current;
          const speakingThreshold =
            settings.sensitivityMode === "auto" ? autoSensitivityDbRef.current : settings.sensitivityDb;

          const locallyAudible = settings.pushToTalk
            ? pushToTalkHeldRef.current && micLevelDbRef.current >= -70
            : voiceActivationNodeRef.current
              ? (voiceActivationMetricsRef.current?.audible ?? micVoiceActivationAudibleRef.current)
              : micLevelDbRef.current >= speakingThreshold;
          next[selfConnectionId] =
            locallyAudible &&
            !isMutedRef.current &&
            !isDeafenedRef.current &&
            !isServerMutedRef.current &&
            !isServerDeafenedRef.current &&
            !selfParticipant?.muted &&
            !selfParticipant?.deafened;
        }

        setSpeakingConnections((current) => {
          const currentKeys = Object.keys(current);
          const nextKeys = Object.keys(next);
          if (currentKeys.length === nextKeys.length && nextKeys.every((key) => current[key] === next[key])) {
            return current;
          }
          return next;
        });
      } finally {
        updating = false;
      }
    };

    void updateSpeakingState();
    const interval = window.setInterval(() => void updateSpeakingState(), 110);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      setSpeakingConnections({});
    };
  }, [voiceChannelId]);
}
