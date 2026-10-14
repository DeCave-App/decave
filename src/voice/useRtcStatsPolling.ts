// While in voice, polls WebRTC stats per peer: round-trip time, packet loss,
// concealment, jitter, relay protocol and bitrate. Loss and concealment are
// measured over the last poll interval, so short bursts (heard as robotic or
// cutting-out voice) aren't averaged away over the whole call.

import { type Dispatch, type SetStateAction, type MutableRefObject, useEffect } from "react";
import type { PeerSession, RemoteScreen } from "../app/types";

export type RtcStatsPollingDeps = {
  setRtcStats: Dispatch<
    SetStateAction<
      Record<
        string,
        {
          rttMs: number;
          lossPct: number;
          bitrateKbps: number | null;
          concealPct?: number;
          jitterMs?: number;
          relayProtocol?: string;
        }
      >
    >
  >;
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

    const previousAudioCounters = new Map<
      string,
      { lost: number; received: number; concealed: number; totalSamples: number }
    >();
    const updateRtcStats = async () => {
      const next: Record<
        string,
        {
          rttMs: number;
          lossPct: number;
          bitrateKbps: number | null;
          concealPct?: number;
          jitterMs?: number;
          relayProtocol?: string;
        }
      > = {};
      const activeConnections = new Set<string>();

      for (const [connectionId, session] of peerSessionsRef.current.entries()) {
        activeConnections.add(connectionId);
        try {
          const reports = await session.pc.getStats();
          let rtt = 0,
            mediaRtt = 0,
            lost = 0,
            received = 0,
            audioBytes = 0,
            concealed = 0,
            totalSamples = 0,
            jitterMs = 0;
          type VoiceCandidatePairStats = RTCStats & {
            selected?: boolean;
            nominated?: boolean;
            state?: string;
            currentRoundTripTime?: number;
            responsesReceived?: number;
            totalRoundTripTime?: number;
            localCandidateId?: string;
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
              concealed += Number(report.concealedSamples || 0);
              totalSamples += Number(report.totalSamplesReceived || 0);
              if (typeof report.jitter === "number") jitterMs = Math.max(jitterMs, report.jitter * 1000);
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

          const previous = previousAudioCounters.get(connectionId);
          previousAudioCounters.set(connectionId, { lost, received, concealed, totalSamples });
          const lostDelta = Math.max(0, lost - (previous?.lost ?? 0));
          const receivedDelta = Math.max(0, received - (previous?.received ?? 0));
          const concealedDelta = Math.max(0, concealed - (previous?.concealed ?? 0));
          const samplesDelta = Math.max(0, totalSamples - (previous?.totalSamples ?? 0));
          const lossPct =
            receivedDelta + lostDelta > 0 ? Math.round((lostDelta / (receivedDelta + lostDelta)) * 1000) / 10 : 0;
          const concealPct = samplesDelta > 0 ? Math.round((concealedDelta / samplesDelta) * 1000) / 10 : 0;
          const localCandidate = selectedPair?.localCandidateId
            ? (reports.get(selectedPair.localCandidateId) as { relayProtocol?: string } | undefined)
            : undefined;
          const relayProtocol = localCandidate?.relayProtocol;
          if (lossPct >= 3 || concealPct >= 3) {
            console.warn(
              `[voice-quality] peer ${connectionId}: loss ${lossPct}% concealed ${concealPct}% ` +
                `jitter ${Math.round(jitterMs)} ms rtt ${Math.round(rtt)} ms relay ${relayProtocol ?? "unknown"}`,
            );
          }
          next[connectionId] = {
            rttMs: Math.round(rtt),
            lossPct,
            bitrateKbps,
            concealPct,
            jitterMs: Math.round(jitterMs),
            relayProtocol,
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
