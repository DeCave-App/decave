// Opens the signed-in account's local stores: session kits, local recap, squad presets and quiet presence.

import { type Dispatch, type SetStateAction, type MutableRefObject, useEffect } from "react";
import {
  createQuietPresenceRepository,
  DEFAULT_QUIET_PRESENCE,
  type QuietPresenceRepository,
  type QuietPresenceSettings as QuietPresenceModel,
} from "../../session/quiet-presence.ts";
import {
  createLocalRecapRepository,
  type LocalRecapAction,
  type LocalRecapRepository,
} from "../../session/local-recap.ts";
import type { SessionKit, SessionKitRepository } from "../../../shared/session-kit.ts";
import { createSessionKitRepository } from "../../session/session-kits.ts";
import {
  createSquadPresetRepository,
  type SquadPreset,
  type SquadPresetRepository,
} from "../../session/squad-presets.ts";
import type { VoiceReadiness } from "../../session/voice-readiness.ts";
import type { AccountUser } from "../types";

export type SessionKitRepositoryDeps = {
  currentUser: AccountUser | null;
  setQuietPresence: Dispatch<SetStateAction<QuietPresenceModel>>;
  setSessionKits: Dispatch<SetStateAction<SessionKit[]>>;
  setSessionRecapActions: Dispatch<SetStateAction<LocalRecapAction[]>>;
  setSquadPresets: Dispatch<SetStateAction<SquadPreset[]>>;
  setVoiceReadiness: Dispatch<SetStateAction<VoiceReadiness | null>>;
  sessionKitRepositoryRef: MutableRefObject<SessionKitRepository | null>;
  quietPresenceRepositoryRef: MutableRefObject<QuietPresenceRepository | null>;
  localRecapRepositoryRef: MutableRefObject<LocalRecapRepository | null>;
  squadPresetRepositoryRef: MutableRefObject<SquadPresetRepository | null>;
  sessionIdRef: MutableRefObject<string>;
};

export function useSessionKitRepository(deps: SessionKitRepositoryDeps): void {
  const {
    currentUser,
    setQuietPresence,
    setSessionKits,
    setSessionRecapActions,
    setSquadPresets,
    setVoiceReadiness,
    sessionKitRepositoryRef,
    quietPresenceRepositoryRef,
    localRecapRepositoryRef,
    squadPresetRepositoryRef,
    sessionIdRef,
  } = deps;

  useEffect(() => {
    const accountId = currentUser?.id;
    if (!accountId) {
      sessionKitRepositoryRef.current = null;
      quietPresenceRepositoryRef.current = null;
      localRecapRepositoryRef.current = null;
      squadPresetRepositoryRef.current = null;
      sessionIdRef.current = "";
      setQuietPresence(DEFAULT_QUIET_PRESENCE);
      setSessionKits([]);
      setSessionRecapActions([]);
      setSquadPresets([]);
      setVoiceReadiness(null);
      return;
    }
    sessionKitRepositoryRef.current = createSessionKitRepository(accountId);
    quietPresenceRepositoryRef.current = createQuietPresenceRepository(accountId);
    localRecapRepositoryRef.current = createLocalRecapRepository(accountId);
    squadPresetRepositoryRef.current = createSquadPresetRepository(accountId);
    sessionIdRef.current = `session-${accountId}-${Date.now().toString(36)}`;
    setQuietPresence(quietPresenceRepositoryRef.current.load());
    setSessionKits(sessionKitRepositoryRef.current.load());
    setSessionRecapActions(localRecapRepositoryRef.current.load());
    setSquadPresets(squadPresetRepositoryRef.current.load());
  }, [currentUser?.id]);
}
