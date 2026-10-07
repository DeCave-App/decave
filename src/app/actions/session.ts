// Session tools: voice self-tests, posting decision polls and events, quiet
// presence, saved session kits and squad presets.

import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import type { VoiceActivationGateMetrics } from "../../audio/clearvoice/VoiceActivationGate";
import {
  toLegacyPresencePatch,
  type QuietPresenceRepository,
  type QuietPresenceSettings as QuietPresenceModel,
} from "../../session/quiet-presence.ts";
import type { SessionKit, SessionKitLaunchPlan, SessionKitRepository } from "../../../shared/session-kit.ts";
import type { SquadPreset, SupportedSquadFilters } from "../../session/squad-presets.ts";
import type { VoiceLocalTestResult, VoiceTestVariant } from "../../session/voice-readiness.ts";
import type {
  AppLocalRecapActionInput,
  Channel,
  PollPayload,
  EventInviteMode,
  ComposerTarget,
  Server,
  ChatMessage,
  ServerMemberView,
  NoiseSuppressionMode,
  HubCalendarEvent,
  AudioSettings,
} from "../types";
import { POLL_PREFIX, EVENT_PREFIX } from "../message-payloads";
import type { ProfileFieldsState } from "../state/profile-fields";
import type { PreferencesState } from "../state/preferences";
import type { AudioSetupState } from "../state/audio-setup";

export type SessionActionsDeps = {
  setQuietPresence: Dispatch<SetStateAction<QuietPresenceModel>>;
  quietPresence: QuietPresenceModel;
  setSessionKits: Dispatch<SetStateAction<SessionKit[]>>;
  sessionKitRepositoryRef: MutableRefObject<SessionKitRepository | null>;
  quietPresenceRepositoryRef: MutableRefObject<QuietPresenceRepository | null>;
  messagesRef: MutableRefObject<ChatMessage[]>;
  homeCalendarEvents: HubCalendarEvent[];
  setShowHome: Dispatch<SetStateAction<boolean>>;
  servers: Server[];
  hubMembers: ServerMemberView[];
  setShowSquadFinder: Dispatch<SetStateAction<boolean>>;
  setSquadGame: Dispatch<SetStateAction<string>>;
  squadPlatform: string;
  setSquadPlatform: Dispatch<SetStateAction<string>>;
  setSquadLanguage: Dispatch<SetStateAction<string>>;
  setSquadRegion: Dispatch<SetStateAction<string>>;
  setSquadMicrophone: Dispatch<SetStateAction<boolean>>;
  setEventInviteMode: Dispatch<SetStateAction<EventInviteMode>>;
  eventInviteMemberIds: string[];
  setEventInviteMemberIds: Dispatch<SetStateAction<string[]>>;
  audioSettings: AudioSettings;
  setAudioSettings: Dispatch<SetStateAction<AudioSettings>>;
  localMicStreamRef: MutableRefObject<MediaStream | null>;
  voiceActivationMetricsRef: MutableRefObject<Partial<VoiceActivationGateMetrics> | null>;
  micTestActiveRef: MutableRefObject<boolean>;
  audioSettingsRef: MutableRefObject<AudioSettings>;
  appendSessionRecap: (action: AppLocalRecapActionInput) => void;
  currentServer: Server;
  currentChannel: Channel;
  loadSquadGames: () => Promise<void>;
  startSquadSearch: (filters?: SupportedSquadFilters) => Promise<void>;
  applyOutputDevice: (outputDeviceId: string) => Promise<void>;
  startMicTest: () => Promise<void>;
  stopMicTest: () => void;
  buildMicrophonePipeline: (
    settings?: AudioSettings,
    forceBrowserProcessing?: boolean,
    signal?: AbortSignal,
  ) => Promise<MediaStream>;
  rebuildMicrophoneIfActive: (next: AudioSettings) => Promise<void>;
  changeServer: (serverId: number, availableServers?: Server[]) => void;
  changeChannel: (channelId: number) => void;
  sendRichComposerText: (target: ComposerTarget, text: string, hubChannelId?: number) => Promise<boolean>;
  waitForPostedHubMessage: (encodedText: string, channelId: number, beforeIds: ReadonlySet<string>) => Promise<string>;
  currentHubCalendarEvents: HubCalendarEvent[];
  navigateToHubCalendarEvent: (event: HubCalendarEvent) => void;
  currentAutomaticGameName: string;
  studioVoiceProcessingMode: "standard" | "high-quality" | "low-cpu";
  profileFields: ProfileFieldsState;
  preferences: PreferencesState;
  audioSetup: AudioSetupState;
};

/** Called once per render with that render's values. */
export function createSessionActions(deps: SessionActionsDeps) {
  const {
    setQuietPresence,
    quietPresence,
    setSessionKits,
    sessionKitRepositoryRef,
    quietPresenceRepositoryRef,
    messagesRef,
    homeCalendarEvents,
    setShowHome,
    servers,
    hubMembers,
    setShowSquadFinder,
    setSquadGame,
    squadPlatform,
    setSquadPlatform,
    setSquadLanguage,
    setSquadRegion,
    setSquadMicrophone,
    setEventInviteMode,
    eventInviteMemberIds,
    setEventInviteMemberIds,
    audioSettings,
    setAudioSettings,
    localMicStreamRef,
    voiceActivationMetricsRef,
    micTestActiveRef,
    audioSettingsRef,
    appendSessionRecap,
    currentServer,
    currentChannel,
    loadSquadGames,
    startSquadSearch,
    applyOutputDevice,
    startMicTest,
    stopMicTest,
    buildMicrophonePipeline,
    rebuildMicrophoneIfActive,
    changeServer,
    changeChannel,
    sendRichComposerText,
    waitForPostedHubMessage,
    currentHubCalendarEvents,
    navigateToHubCalendarEvent,
    currentAutomaticGameName,
    studioVoiceProcessingMode,
    profileFields,
    preferences,
    audioSetup,
  } = deps;
  const { setAudioSettingsError } = audioSetup;
  const { setNotificationPreset } = preferences;
  const { setProfileStatus } = profileFields;

  const runStudioVoiceTest = async (variant: VoiceTestVariant): Promise<VoiceLocalTestResult> => {
    const wasActive = micTestActiveRef.current;
    try {
      if (!wasActive) await startMicTest();
      if (!localMicStreamRef.current)
        throw new Error("Microphone preview is unavailable. Open Voice & Audio and choose an input first.");
      const startedAt = performance.now();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 1_000));
      const metrics = voiceActivationMetricsRef.current;
      if (!metrics) throw new Error("The local voice meter has not produced a reading yet. Try the test again.");
      const inputDb = variant === "raw" ? metrics.rawDb : metrics.postDb;
      return {
        variant,
        durationMs: performance.now() - startedAt,
        inputRms: 10 ** ((inputDb ?? -80) / 20),
        cleanedRms: metrics.outputRms ?? 0,
        transmittedActivity: metrics.activity ?? 0,
        measuredAt: new Date().toISOString(),
      };
    } finally {
      if (!wasActive) stopMicTest();
    }
  };

  const runStudioVoiceABTest = async (): Promise<{ raw: VoiceLocalTestResult; processed: VoiceLocalTestResult }> => {
    const original = audioSettingsRef.current;
    const hadPipeline = Boolean(localMicStreamRef.current);
    const processedMode: NoiseSuppressionMode =
      original.noiseSuppression === "off" ? "standard" : original.noiseSuppression;
    try {
      // Both samples use the live microphone graph and meter. The raw sample
      // deliberately bypasses DeCave processing, then the processed sample
      // restores the user's selected mode (or Standard when they had it off).
      await buildMicrophonePipeline({ ...original, noiseSuppression: "off" });
      const raw = await runStudioVoiceTest("raw");
      await buildMicrophonePipeline({ ...original, noiseSuppression: processedMode });
      const processed = await runStudioVoiceTest("processed");
      return { raw, processed };
    } finally {
      try {
        if (hadPipeline) await buildMicrophonePipeline(original);
        else stopMicTest();
      } catch (error) {
        setAudioSettingsError(
          error instanceof Error
            ? error.message
            : "The microphone graph could not be restored after the local comparison.",
        );
      }
    }
  };

  const postStudioPoll = async (
    payload: { question: string; options: string[] },
    metadata: {
      cardId: string;
      kind: "poll" | "availability" | "choose-game";
      deadlineAt: string | null;
      eventId: string | null;
    },
  ) => {
    if (!currentServer.id || !currentChannel.id || currentChannel.type !== "text")
      throw new Error("Open a text room before posting a decision card.");
    const encoded = `${POLL_PREFIX}${JSON.stringify({ question: payload.question, options: payload.options } satisfies PollPayload)}`;
    const beforeIds = new Set(messagesRef.current.map((message) => message.id));
    if (!(await sendRichComposerText("hub", encoded, currentChannel.id)))
      throw new Error("The Hub is reconnecting; the decision card was not posted.");
    const sourceMessageId = await waitForPostedHubMessage(encoded, currentChannel.id, beforeIds);
    appendSessionRecap({
      kind: "poll-created",
      pollId: sourceMessageId,
      question: payload.question,
      optionCount: payload.options.length,
    });
    void metadata;
    return { sourceMessageId };
  };

  const postStudioEvent = async (
    payload: {
      title: string;
      startAt: string;
      description: string;
      inviteMode: EventInviteMode;
      invitedUserIds: string[];
      invitedUsernames: string[];
    },
    metadata: {
      cardId: string;
      kind: "poll" | "availability" | "choose-game";
      deadlineAt: string | null;
      eventId: string | null;
    },
  ) => {
    if (!currentServer.id) throw new Error("Open a Hub before linking an event.");
    const targetChannel = currentServer.channels.find((channel) => channel.type === "text");
    if (!targetChannel) throw new Error("This Hub has no text room for the linked event.");
    const encoded = `${EVENT_PREFIX}${JSON.stringify(payload)}`;
    const beforeIds = new Set(messagesRef.current.map((message) => message.id));
    if (!(await sendRichComposerText("hub", encoded, targetChannel.id)))
      throw new Error("The Hub is reconnecting; the linked event was not posted.");
    const eventId = await waitForPostedHubMessage(encoded, targetChannel.id, beforeIds);
    appendSessionRecap({ kind: "event-scheduled", eventId, title: payload.title, startAt: payload.startAt });
    void metadata;
    return { eventId };
  };

  const updateQuietPresence = (next: QuietPresenceModel) => {
    const saved = quietPresenceRepositoryRef.current?.save(next).settings ?? next;
    setQuietPresence(saved);
    const legacy = toLegacyPresencePatch(saved);
    setProfileStatus(legacy.status);
    setNotificationPreset(legacy.notificationPreset);
  };

  const saveCurrentSessionKit = (name: string, intent: "play" | "watch" | "chat" | "plan") => {
    const repository = sessionKitRepositoryRef.current;
    if (!repository || !currentServer.id) return;
    const result = repository.upsert({
      name,
      intent,
      scope: {
        hubId: String(currentServer.id),
        channelId: currentChannel.id ? String(currentChannel.id) : null,
        eventId: currentHubCalendarEvents[0]?.id ?? null,
      },
      inviteUserIds: eventInviteMemberIds.filter((id) => hubMembers.some((member) => member.userId === id)),
      game: { name: currentAutomaticGameName, platform: squadPlatform || null },
      voice: {
        inputDeviceId: audioSettings.inputDeviceId || null,
        outputDeviceId: audioSettings.outputDeviceId || null,
        processingMode: studioVoiceProcessingMode,
      },
      privacy: {
        presenceStatus: quietPresence.presenceStatus,
        notificationPreset: quietPresence.notificationPreset,
        allowUrgentMentions: quietPresence.interruptPolicy.urgentMentions,
      },
    });
    setSessionKits(result.kits);
  };

  const launchSessionKit = (plan: SessionKitLaunchPlan) => {
    const hubId = Number(plan.restored.hubId);
    if (!Number.isInteger(hubId) || !servers.some((server) => server.id === hubId)) return;
    setShowHome(false);
    changeServer(hubId);
    const channelId = Number(plan.restored.channelId);
    if (Number.isInteger(channelId) && channelId > 0) window.setTimeout(() => changeChannel(channelId), 0);
    if (plan.restored.eventId) {
      const event = homeCalendarEvents.find((item) => item.id === plan.restored.eventId);
      if (event) window.setTimeout(() => navigateToHubCalendarEvent(event), 0);
    }
    setEventInviteMemberIds(plan.restored.inviteUserIds);
    setEventInviteMode(plan.restored.inviteUserIds.length ? "selected" : "all");
    setAudioSettings((current) => ({
      ...current,
      inputDeviceId: plan.restored.voice.inputDeviceId ?? current.inputDeviceId,
      outputDeviceId: plan.restored.voice.outputDeviceId ?? current.outputDeviceId,
      noiseSuppression:
        plan.restored.voice.processingMode === "high-quality"
          ? "ai"
          : plan.restored.voice.processingMode === "standard"
            ? "standard"
            : "off",
    }));
    const restoredAudio = {
      ...audioSettingsRef.current,
      inputDeviceId: plan.restored.voice.inputDeviceId ?? audioSettingsRef.current.inputDeviceId,
      outputDeviceId: plan.restored.voice.outputDeviceId ?? audioSettingsRef.current.outputDeviceId,
      noiseSuppression:
        plan.restored.voice.processingMode === "high-quality"
          ? ("ai" as NoiseSuppressionMode)
          : plan.restored.voice.processingMode === "standard"
            ? ("standard" as NoiseSuppressionMode)
            : ("off" as NoiseSuppressionMode),
    };
    if (localMicStreamRef.current) void rebuildMicrophoneIfActive(restoredAudio);
    void applyOutputDevice(restoredAudio.outputDeviceId);
    const nextPresence = {
      ...quietPresence,
      presenceStatus: plan.restored.privacy.presenceStatus,
      notificationPreset: plan.restored.privacy.notificationPreset,
      interruptPolicy: { ...quietPresence.interruptPolicy, urgentMentions: plan.restored.privacy.allowUrgentMentions },
      updatedAt: new Date().toISOString(),
    };
    updateQuietPresence(nextPresence);
  };

  const removeSessionKit = (kit: SessionKit) => {
    const result = sessionKitRepositoryRef.current?.remove(kit.id);
    if (result) setSessionKits(result.kits);
  };

  const runSquadPreset = (preset: SquadPreset, request: SupportedSquadFilters) => {
    setSquadGame(request.game);
    setSquadPlatform(request.platform);
    setSquadLanguage(request.language);
    setSquadRegion(request.region);
    setSquadMicrophone(request.microphoneRequired);
    setShowHome(false);
    setShowSquadFinder(true);
    void loadSquadGames();
    void startSquadSearch(request);
    void preset;
  };

  return {
    runStudioVoiceABTest,
    postStudioPoll,
    postStudioEvent,
    saveCurrentSessionKit,
    launchSessionKit,
    removeSessionKit,
    runSquadPreset,
  };
}
