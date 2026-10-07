// While in voice, polls WebRTC stats per peer: round-trip time, packet loss and bitrate.

import { type Dispatch, type SetStateAction, type MutableRefObject, useEffect } from "react";
import type { PeerSession, RemoteScreen } from "../app/types";

export type RtcStatsPollingDeps = {
  setRtcStats: Dispatch<SetStateAction<Record<string, { rttMs: number; lossPct: number; bitrateKbps: number | null }>>>;
  voiceChannelId: number | null;
  remoteScreensRef: MutableRefObject<Record<string, RemoteScreen>>;
  remoteCamerasRef: MutableRefObject<Record<string, RemoteScreen>>;
  inboundVideoBitrateSamplesRef: MutableRefObject<
    Map<string, { trackId: string; reportKey: string; bytesReceived: number; timestamp: number }>
  >;
  peerSessionsRef: MutableRefObject<Map<string, PeerSession>>;
};

export function useRtcStatsPolling(deps: RtcStatsPollingDeps): void {
  const {
    setRtcStats,
    voiceChannelId,
    remoteScreensRef,
    remoteCamerasRef,
    inboundVideoBitrateSamplesRef,
    peerSessionsRef,
  } = deps;

  useEffect(() => {
    if (voiceChannelId === null) {
      inboundVideoBitrateSamplesRef.current.clear();
      setRtcStats({});
      return;
    }

    const updateRtcStats = async () => {
      const next: Record<string, { rttMs: number; lossPct: number; bitrateKbps: number | null }> = {};
      const activeConnections = new Set<string>();

      for (const [connectionId, session] of peerSessionsRef.current.entries()) {
        activeConnections.add(connectionId);
        try {
          const reports = await session.pc.getStats();
          let rtt = 0,
            mediaRtt = 0,
            lost = 0,
            received = 0,
            audioBytes = 0;
          type VoiceCandidatePairStats = RTCStats & {
            selected?: boolean;
            nominated?: boolean;
            state?: string;
            currentRoundTripTime?: number;
            responsesReceived?: number;
            totalRoundTripTime?: number;
          };
          type InboundVideoStats = RTCStats & {
            kind?: string;
            mediaType?: string;
            bytesReceived?: number;
            trackIdentifier?: string;
          };
          let selectedCandidatePairId = "";
          const candidatePairs: VoiceCandidatePairStats[] = [];
          reports.forEach((report) => {
            if (report.type === "transport" && typeof report.selectedCandidatePairId === "string")
              selectedCandidatePairId = report.selectedCandidatePairId;
            if (report.type === "candidate-pair") candidatePairs.push(report as VoiceCandidatePairStats);
            if (report.type === "remote-inbound-rtp" && typeof report.roundTripTime === "number")
              mediaRtt = Math.max(mediaRtt, report.roundTripTime * 1000);
            if (report.type === "inbound-rtp" && report.kind === "audio") {
              lost += Number(report.packetsLost || 0);
              received += Number(report.packetsReceived || 0);
              audioBytes += Number(report.bytesReceived || 0);
            }
          });
          // A PeerConnection can retain several successful ICE checks. Only
          // the transport-selected/nominated pair carries the call; taking the
          // maximum across every successful pair can display an unused relay's
          // RTT and make a healthy direct connection look much slower.
          const selectedPair = ((selectedCandidatePairId ? reports.get(selectedCandidatePairId) : undefined) ??
            candidatePairs.find((report) => report.selected === true) ??
            candidatePairs.find((report) => report.nominated === true && report.state === "succeeded")) as
            VoiceCandidatePairStats | undefined;
          if (selectedPair && typeof selectedPair.currentRoundTripTime === "number") {
            rtt = selectedPair.currentRoundTripTime * 1000;
          } else if (
            selectedPair &&
            Number(selectedPair.responsesReceived) > 0 &&
            typeof selectedPair.totalRoundTripTime === "number"
          ) {
            rtt = (selectedPair.totalRoundTripTime / Number(selectedPair.responsesReceived)) * 1000;
          } else {
            rtt = mediaRtt;
          }

          // Keep voice-health recovery based on inbound microphone RTP only.
          // The bitrate shown on screen/camera cards is measured separately
          // from the active remote video receiver below.
          session.resumeAudio();
          const inboundAdvanced =
            audioBytes > session.lastInboundAudioBytes || received > session.lastInboundAudioPackets;
          const hasMutedLiveTrack = session.remoteAudioStream
            .getAudioTracks()
            .some((track) => track.readyState === "live" && track.muted);
          session.mutedInboundSamples = hasMutedLiveTrack && !inboundAdvanced ? session.mutedInboundSamples + 1 : 0;
          if (session.mutedInboundSamples >= 2) {
            session.mutedInboundSamples = 0;
            session.recover("inbound audio RTP remained stalled", true, true);
          }
          const expectsInboundAudio =
            session.pc.connectionState === "connected" &&
            session.participant.muted !== true &&
            session.participant.serverMuted !== true &&
            session.participant.deafened !== true &&
            session.participant.serverDeafened !== true;
          const hasInboundVoiceTrack =
            session.remoteAudioTrackAttached &&
            session.remoteAudioStream.getAudioTracks().some((track) => track.readyState === "live");
          session.missingInboundAudioSamples =
            expectsInboundAudio && !hasInboundVoiceTrack ? session.missingInboundAudioSamples + 1 : 0;
          if (session.missingInboundAudioSamples >= 2) {
            session.missingInboundAudioSamples = 0;
            session.recover("connected peer has no inbound voice track", true, true);
          }
          session.lastInboundAudioBytes = audioBytes;
          session.lastInboundAudioPackets = received;

          const remoteVideo = remoteScreensRef.current[connectionId] ?? remoteCamerasRef.current[connectionId];
          const videoTrack = remoteVideo?.stream.getVideoTracks().find((track) => track.readyState === "live") ?? null;
          let bitrateKbps: number | null = null;

          if (videoTrack) {
            const receiver = session.pc.getReceivers().find((item) => item.track?.id === videoTrack.id);
            const videoReports = receiver ? await receiver.getStats() : reports;
            const matchingReports: InboundVideoStats[] = [];

            videoReports.forEach((report) => {
              if (report.type !== "inbound-rtp") return;
              const inbound = report as InboundVideoStats;
              if (inbound.kind !== "video" && inbound.mediaType !== "video") return;
              if (!Number.isFinite(Number(inbound.bytesReceived)) || !Number.isFinite(Number(inbound.timestamp)))
                return;
              if (inbound.trackIdentifier && inbound.trackIdentifier !== videoTrack.id) return;
              matchingReports.push(inbound);
            });

            if (matchingReports.length > 0) {
              const bytesReceived = matchingReports.reduce(
                (total, report) => total + Number(report.bytesReceived || 0),
                0,
              );
              const timestamp = Math.max(...matchingReports.map((report) => Number(report.timestamp)));
              const reportKey = matchingReports
                .map((report) => report.id)
                .sort()
                .join("|");
              const previous = inboundVideoBitrateSamplesRef.current.get(connectionId);

              if (previous && previous.trackId === videoTrack.id && previous.reportKey === reportKey) {
                const deltaBytes = bytesReceived - previous.bytesReceived;
                const deltaSeconds = (timestamp - previous.timestamp) / 1000;
                if (deltaBytes >= 0 && deltaSeconds > 0) {
                  bitrateKbps = Math.round((deltaBytes * 8) / deltaSeconds / 1000);
                }
              }

              inboundVideoBitrateSamplesRef.current.set(connectionId, {
                trackId: videoTrack.id,
                reportKey,
                bytesReceived,
                timestamp,
              });
            } else {
              inboundVideoBitrateSamplesRef.current.delete(connectionId);
            }
          } else {
            inboundVideoBitrateSamplesRef.current.delete(connectionId);
          }

          next[connectionId] = {
            rttMs: Math.round(rtt),
            lossPct: received + lost > 0 ? Math.round((lost / (received + lost)) * 1000) / 10 : 0,
            bitrateKbps,
          };
        } catch {
          inboundVideoBitrateSamplesRef.current.delete(connectionId);
        }
      }

      for (const connectionId of Array.from(inboundVideoBitrateSamplesRef.current.keys())) {
        if (!activeConnections.has(connectionId)) inboundVideoBitrateSamplesRef.current.delete(connectionId);
      }
      setRtcStats(next);
    };

    void updateRtcStats();
    const interval = window.setInterval(() => void updateRtcStats(), 3000);
    return () => {
      window.clearInterval(interval);
      inboundVideoBitrateSamplesRef.current.clear();
    };
  }, [voiceChannelId]);
}
