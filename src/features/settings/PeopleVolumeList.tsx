// Settings → Voice & video → People you've adjusted: everyone with a custom
// volume, a slider and reset for each, and reset all.

import { useState } from "react";
import type { ServerMemberView, SocialUser, VoiceParticipant } from "../../app/types";
import { FieldError } from "./SettingsControls";
import { SLIDER_DEBOUNCE_MS, useSettingField } from "./useSettingField";
import { useSettingsT } from "./useSettingsT";

export type PeopleVolumeListProps = {
  voiceUserVolumes: Record<string, number>;
  voiceParticipants: VoiceParticipant[];
  hubMembers: ServerMemberView[];
  friends: SocialUser[];
  changeVoiceUserVolume: (participant: VoiceParticipant, volume: number) => void;
  resetVoiceUserVolumes: (userId?: string) => void;
};

type Row = { userId: string; name: string; volume: number };

/** People whose volume differs from normal, named from voice, the Hub or friends. */
export function adjustedPeople(
  volumes: Record<string, number>,
  sources: Pick<PeopleVolumeListProps, "voiceParticipants" | "hubMembers" | "friends">,
  unknownName: string,
  keep: ReadonlySet<string> = new Set(),
): Row[] {
  return Object.entries(volumes)
    .filter(([userId, volume]) => Math.round(volume) !== 100 || keep.has(userId))
    .map(([userId, volume]) => ({
      userId,
      volume: Math.round(volume),
      name:
        sources.voiceParticipants.find((person) => person.userId === userId)?.username ??
        sources.hubMembers.find((member) => member.userId === userId)?.username ??
        sources.friends.find((friend) => friend.id === userId)?.username ??
        unknownName,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function PersonRow({ row, props }: { row: Row; props: PeopleVolumeListProps }) {
  const { t } = useSettingsT();
  const participant: VoiceParticipant =
    props.voiceParticipants.find((person) => person.userId === row.userId) ??
    ({ userId: row.userId, connectionId: "" } as VoiceParticipant);
  const field = useSettingField(
    `voice.person.${row.userId}`,
    () => row.volume,
    async () => undefined, // per-person volumes are kept on this device as they change
    {
      debounceMs: SLIDER_DEBOUNCE_MS,
      apply: (volume: number) => props.changeVoiceUserVolume(participant, volume),
    },
  );
  return (
    <li className="dcs-list-row">
      <span className="dcs-initial" aria-hidden="true">
        {row.name.charAt(0).toUpperCase()}
      </span>
      <span className="dcs-list-copy">
        <strong>{row.name}</strong>
        <small>{field.value === 0 ? t("settings.voice.people.muted") : `${field.value}%`}</small>
        <input
          className="settings-range"
          type="range"
          min="0"
          max="200"
          step="5"
          value={field.value}
          aria-label={t("settings.voice.people.volumeFor", { name: row.name })}
          onChange={(event) => field.set(Number(event.target.value))}
        />
        <FieldError field={field} />
      </span>
      <button type="button" className="modal-secondary" onClick={() => props.resetVoiceUserVolumes(row.userId)}>
        {t("settings.voice.people.reset")}
      </button>
    </li>
  );
}

export function PeopleVolumeList(props: PeopleVolumeListProps) {
  const { t } = useSettingsT();
  // Someone dragged back to 100% stays listed until Settings closes, so the slider doesn't vanish mid-drag.
  const [shown] = useState(() => new Set<string>());
  const rows = adjustedPeople(props.voiceUserVolumes, props, t("settings.voice.people.unknown"), shown);
  rows.forEach((row) => shown.add(row.userId));
  return (
    <div className="settings-audio-panel settings-audio-panel-wide" data-settings-anchor="people-volume">
      <div className="settings-audio-panel-title">
        <span>{t("settings.voice.people.title")}</span>
        <small>{t("settings.voice.people.help")}</small>
      </div>
      {rows.length === 0 ? (
        <p className="dcs-muted">{t("settings.voice.people.empty")}</p>
      ) : (
        <>
          <ul className="dcs-list">
            {rows.map((row) => (
              <PersonRow key={row.userId} row={row} props={props} />
            ))}
          </ul>
          <div className="dcs-card-actions">
            <button type="button" className="modal-secondary" onClick={() => props.resetVoiceUserVolumes()}>
              {t("settings.voice.people.resetAll")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
