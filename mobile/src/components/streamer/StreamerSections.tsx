// Sections of a Streamer Hub's overview on mobile, mirroring web's
// src/streamer/controller.ts and community.ts with the same streamer.* strings.

import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Linking, Platform, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { CS2_MAP_POOL, type Leaderboard, type Pug } from "../../../../shared/streamer-pugs";
import type { Giveaway, QueueEntry, StreamerSnapshot } from "../../../../shared/streamer-mode";
import type { StreamerApi } from "@/src/lib/streamer-api";
import { dateLocale } from "@/src/lib/date-locale";
import { hour12Preference } from "@/src/lib/account-preferences-store";
import { colorMode, colors } from "@/src/theme";

export type Perform = (path: string, payload: unknown) => Promise<boolean>;
type Room = { id: number; name: string };

const when = (value: string) =>
  new Date(value).toLocaleString(dateLocale(), { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: hour12Preference() });

export function Card({ title, icon, children }: { title: string; icon: keyof typeof Ionicons.glyphMap; children: ReactNode }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Ionicons name={icon} size={17} color={colors.cyan} />
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

export function Button({ label, onPress, primary, danger, disabled }: { label: string; onPress: () => void; primary?: boolean; danger?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      style={[styles.button, primary && styles.primary, danger && styles.danger, disabled && { opacity: 0.45 }]}
      onPress={onPress}
    >
      <Text style={[styles.buttonText, primary && styles.primaryText, danger && { color: colors.red }]}>{label}</Text>
    </Pressable>
  );
}

function Field({ label, value, onChange, multiline, number, maxLength }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean; number?: boolean; maxLength?: number }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        maxLength={maxLength}
        keyboardType={number ? "number-pad" : "default"}
        placeholderTextColor={colors.faint}
        style={[styles.input, multiline && { minHeight: 80, textAlignVertical: "top" }]}
      />
    </View>
  );
}

// Queue ------------------------------------------------------------------------

export function QueueSection({ data, owner, perform, api }: { data: StreamerSnapshot; owner: boolean; perform: Perform; api: StreamerApi }) {
  const { t } = useTranslation(["streamer"]);
  const session = data.session;
  const mine = data.queue.mine;
  let label = t("streamer.join.queue");
  let path = "queue/join";
  if (mine?.status === "called") {
    label = t("streamer.join.ready");
    path = "queue/ready";
  } else if (mine && ["waiting", "ready"].includes(mine.status)) {
    label = t("streamer.join.leave");
    path = "queue/leave";
  } else if (mine?.status === "playing") label = t("streamer.join.inGame");
  else if (mine) label = t("streamer.join.completed");
  const disabled = !session || (!!mine && ["playing", "done", "skipped", "left"].includes(mine.status)) || (!mine && session.status !== "open");
  const status = !session
    ? t("streamer.queue.none")
    : session.status === "paused" && !mine
      ? t("streamer.queue.paused")
      : !mine
        ? t("streamer.queue.join")
        : mine.status === "waiting"
          ? t("streamer.queue.waiting", { position: mine.position ?? "?" })
          : mine.status === "called"
            ? t("streamer.queue.called", { time: mine.callExpiresAt ? new Date(mine.callExpiresAt).toLocaleTimeString(dateLocale(), { hour: "numeric", minute: "2-digit", hour12: hour12Preference() }) : "" })
            : mine.status === "ready"
              ? t("streamer.queue.ready")
              : mine.status === "playing"
                ? t("streamer.queue.playing")
                : t("streamer.queue.ended");

  return (
    <Card title={t("streamer.cards.queue.title")} icon="people-outline">
      {session && (
        <Text style={styles.muted}>
          {session.title} · {t("streamer.session.summary", { game: session.game, count: session.partySize, status: t(`streamer.session.status.${session.status}`) })}
        </Text>
      )}
      <Text style={styles.body}>{status}</Text>
      {!owner && <Button label={label} primary onPress={() => void perform(path, { sessionId: session?.id })} disabled={disabled} />}
      {!!session && <Text style={styles.muted}>{data.config.queueRules}</Text>}
      {owner && <QueueManager data={data} perform={perform} api={api} />}
    </Card>
  );
}

function QueueManager({ data, perform, api }: { data: StreamerSnapshot; perform: Perform; api: StreamerApi }) {
  const { t } = useTranslation(["streamer"]);
  const session = data.session;
  const [title, setTitle] = useState(t("streamer.session.defaultTitle"));
  const [game, setGame] = useState(data.config.game);
  const [partySize, setPartySize] = useState("4");
  const [readySeconds, setReadySeconds] = useState("90");
  const [entries, setEntries] = useState<QueueEntry[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);

  const sessionKey = `${session?.id}:${session?.version}:${data.queue.waiting}:${data.queue.called}:${data.queue.ready}:${data.queue.playing}`;
  useEffect(() => {
    if (!session) return;
    void api.queue().then((page) => {
      setEntries(page.entries);
      setCursor(page.nextCursor);
    }).catch(() => setEntries([]));
  }, [sessionKey]);

  if (!session)
    return (
      <View style={styles.form}>
        <Text style={styles.muted}>{t("streamer.session.intro")}</Text>
        <Field label={t("streamer.session.titleField")} value={title} onChange={setTitle} maxLength={100} />
        <Field label={t("streamer.session.gameField")} value={game} onChange={setGame} maxLength={80} />
        <Field label={t("streamer.session.partySizeField")} value={partySize} onChange={setPartySize} number />
        <Field label={t("streamer.session.readySecondsField")} value={readySeconds} onChange={setReadySeconds} number />
        <Button
          label={t("streamer.session.open")}
          primary
          disabled={!title.trim() || !game.trim()}
          onPress={() => void perform("session/create", { title: title.trim(), game: game.trim(), partySize: Number(partySize), readySeconds: Number(readySeconds) })}
        />
      </View>
    );
  const payload = { sessionId: session.id, version: session.version };
  return (
    <View style={styles.form}>
      <Text style={styles.muted}>
        {t("streamer.session.counts", { waiting: data.queue.waiting, called: data.queue.called, ready: data.queue.ready, playing: data.queue.playing })}
      </Text>
      <View style={styles.wrap}>
        <Button label={session.status === "paused" ? t("streamer.session.resume") : t("streamer.session.pause")} onPress={() => void perform(`session/${session.status === "paused" ? "resume" : "pause"}`, payload)} />
        <Button label={t("streamer.session.callNext")} primary onPress={() => void perform("session/call-next", payload)} />
        <Button label={t("streamer.session.startReady")} onPress={() => void perform("session/start-ready", payload)} />
        <Button label={t("streamer.session.finishGroup")} onPress={() => void perform("session/finish-playing", payload)} />
        <Button
          label={t("streamer.session.end")}
          danger
          onPress={() =>
            Alert.alert(t("streamer.session.end"), t("streamer.session.endConfirmText"), [
              { text: t("streamer.session.keep"), style: "cancel" },
              { text: t("streamer.session.endConfirm"), style: "destructive", onPress: () => void perform("session/end", payload) },
            ])
          }
        />
      </View>
      {entries === null ? (
        <ActivityIndicator color={colors.cyan} />
      ) : entries.length === 0 ? (
        <Text style={styles.muted}>{t("streamer.session.empty")}</Text>
      ) : (
        entries.map((entry) => (
          <View key={entry.id} style={styles.listRow}>
            <Text style={[styles.body, { flex: 1 }]} numberOfLines={1}>
              {entry.position ? `${entry.position}. ` : ""}
              {entry.name}
            </Text>
            <Text style={styles.muted}>{t(`streamer.session.entryStatus.${entry.status}`)}</Text>
            {["waiting", "called", "ready"].includes(entry.status) && <Button label={t("streamer.session.skip")} onPress={() => void perform("queue/skip", { entryId: entry.id })} />}
          </View>
        ))
      )}
      {cursor && (
        <Button
          label={t("streamer.session.nextPage")}
          onPress={() =>
            void api.queue(cursor).then((page) => {
              setEntries((current) => [...(current ?? []), ...page.entries]);
              setCursor(page.nextCursor);
            })
          }
        />
      )}
      <Text style={styles.muted}>{t("streamer.session.voiceNote")}</Text>
    </View>
  );
}

// Giveaways ----------------------------------------------------------------------

function GiveawayConditions({ giveaway }: { giveaway: Giveaway }) {
  const { t } = useTranslation(["streamer"]);
  const c = giveaway.conditions;
  if (!c) return null;
  const parts = [c.subsOnly ? t("streamer.giveaways.subsOnly") : "", c.minMemberDays ? t("streamer.giveaways.minDays", { count: c.minMemberDays }) : "", c.subBonus ? t("streamer.giveaways.subBonus") : ""].filter(Boolean);
  return parts.length ? <Text style={styles.muted}>{parts.join(" · ")}</Text> : null;
}

export function GiveawaysSection({ data, owner, perform }: { data: StreamerSnapshot; owner: boolean; perform: Perform }) {
  const { t } = useTranslation(["streamer"]);
  const [creating, setCreating] = useState(false);
  if (!data.features.giveaways) return null;
  if (!owner && data.giveaways.length === 0) return null;
  return (
    <Card title={t("streamer.giveaways.heading")} icon="gift-outline">
      {data.giveaways.map((giveaway) => {
        const open = giveaway.status === "open" && Date.parse(giveaway.closesAt) > Date.now();
        return (
          <View key={giveaway.id} style={styles.item}>
            <Text style={styles.itemTitle}>{giveaway.title}</Text>
            <Text style={styles.body}>{giveaway.rules}</Text>
            <GiveawayConditions giveaway={giveaway} />
            <Text style={styles.muted}>
              {giveaway.winnerName
                ? t("streamer.giveaways.winner", { name: giveaway.winnerName })
                : t("streamer.giveaways.closes", { date: when(giveaway.closesAt) })}
            </Text>
            {owner ? (
              <>
                <Text style={styles.muted}>{t("streamer.giveaways.summary", { count: giveaway.entryCount, status: t(`streamer.giveaways.status.${giveaway.status}`) })}</Text>
                {giveaway.status === "open" && (
                  <View style={styles.wrap}>
                    <Button label={t("streamer.giveaways.draw")} primary onPress={() => void perform("giveaways/draw", { id: giveaway.id })} />
                    <Button label={t("streamer.giveaways.cancel")} danger onPress={() => void perform("giveaways/cancel", { id: giveaway.id })} />
                  </View>
                )}
              </>
            ) : giveaway.entered ? (
              <Text style={[styles.body, { color: colors.green }]}>{t("streamer.giveaways.entered")}</Text>
            ) : (
              <Button label={open ? t("streamer.giveaways.enter") : t("streamer.giveaways.closed")} primary disabled={!open} onPress={() => void perform("giveaways/enter", { id: giveaway.id })} />
            )}
          </View>
        );
      })}
      {owner && (creating ? <GiveawayForm subRoles={!!data.features.subRoles} perform={perform} onDone={() => setCreating(false)} /> : <Button label={t("streamer.giveaways.create")} onPress={() => setCreating(true)} />)}
    </Card>
  );
}

function GiveawayForm({ subRoles, perform, onDone }: { subRoles: boolean; perform: Perform; onDone: () => void }) {
  const { t } = useTranslation(["streamer", "common"]);
  const [title, setTitle] = useState("");
  const [rules, setRules] = useState("");
  const [closesAt, setClosesAt] = useState(() => Date.now() + 24 * 3_600_000);
  const [subsOnly, setSubsOnly] = useState(false);
  const [subBonus, setSubBonus] = useState(false);
  const [minDays, setMinDays] = useState("0");
  const pickAndroid = () =>
    DateTimePickerAndroid.open({
      value: new Date(closesAt),
      mode: "date",
      minimumDate: new Date(),
      onChange: (event, date) => {
        if (event.type !== "set" || !date) return;
        DateTimePickerAndroid.open({ value: date, mode: "time", is24Hour: !hour12Preference(), onChange: (timeEvent, time) => { if (timeEvent.type === "set" && time) setClosesAt(time.getTime()); } });
      },
    });
  return (
    <View style={styles.form}>
      <Text style={styles.muted}>{t("streamer.giveaways.intro")}</Text>
      <Field label={t("streamer.giveaways.titleField")} value={title} onChange={setTitle} maxLength={120} />
      <Field label={t("streamer.giveaways.rulesField")} value={rules} onChange={setRules} multiline maxLength={1600} />
      <Text style={styles.label}>{t("streamer.giveaways.closesAtField")}</Text>
      {Platform.OS === "ios" ? (
        <DateTimePicker value={new Date(closesAt)} mode="datetime" display="compact" minimumDate={new Date()} themeVariant={colorMode} onChange={(_event, date) => date && setClosesAt(date.getTime())} />
      ) : (
        <Pressable accessibilityRole="button" style={styles.input} onPress={pickAndroid}>
          <Text style={styles.body}>{when(new Date(closesAt).toISOString())}</Text>
        </Pressable>
      )}
      {subRoles && (
        <>
          <View style={styles.switchRow}>
            <Text style={[styles.body, { flex: 1 }]}>{t("streamer.giveaways.subsOnly")}</Text>
            <Switch value={subsOnly} onValueChange={setSubsOnly} />
          </View>
          <View style={styles.switchRow}>
            <Text style={[styles.body, { flex: 1 }]}>{t("streamer.giveaways.subscriberBonus")}</Text>
            <Switch value={subBonus} onValueChange={setSubBonus} />
          </View>
          <Field label={t("streamer.giveaways.minDaysField")} value={minDays} onChange={setMinDays} number />
        </>
      )}
      <View style={styles.wrap}>
        <Button
          label={t("streamer.giveaways.create")}
          primary
          disabled={!title.trim() || !rules.trim()}
          onPress={() =>
            void perform("giveaways/create", {
              title: title.trim(),
              rules: rules.trim(),
              closesAt: new Date(closesAt).toISOString(),
              ...(subRoles ? { subsOnly, subBonus, minMemberDays: Number(minDays) || 0 } : {}),
            }).then((ok) => ok && onDone())
          }
        />
        <Button label={t("common.actions.cancel")} onPress={onDone} />
      </View>
    </View>
  );
}

// Highlights ----------------------------------------------------------------------

export function HighlightsSection({ data, owner, perform }: { data: StreamerSnapshot; owner: boolean; perform: Perform }) {
  const { t } = useTranslation(["streamer"]);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  if (!owner && data.highlights.length === 0) return null;
  return (
    <Card title={t("streamer.highlights.heading")} icon="film-outline">
      {data.highlights.length === 0 && <Text style={styles.muted}>{owner ? t("streamer.highlights.emptyOwner") : t("streamer.highlights.emptyMember")}</Text>}
      {data.highlights.map((highlight) => (
        <View key={highlight.id} style={styles.listRow}>
          <Text style={[styles.body, { flex: 1 }]} numberOfLines={2}>{highlight.title}</Text>
          <Button label={t("streamer.highlights.watch")} onPress={() => void Linking.openURL(highlight.url)} />
          {owner && <Button label={t("streamer.highlights.remove")} danger onPress={() => void perform("highlights/remove", { id: highlight.id })} />}
        </View>
      ))}
      {owner &&
        (adding ? (
          <View style={styles.form}>
            <Text style={styles.muted}>{t("streamer.highlights.intro")}</Text>
            <Field label={t("streamer.highlights.titleField")} value={title} onChange={setTitle} maxLength={120} />
            <Field label={t("streamer.highlights.urlField")} value={url} onChange={setUrl} />
            <Button
              label={t("streamer.highlights.publish")}
              primary
              disabled={!title.trim() || !url.trim()}
              onPress={() =>
                void perform("highlights/add", { title: title.trim(), url: url.trim() }).then((ok) => {
                  if (!ok) return;
                  setTitle("");
                  setUrl("");
                  setAdding(false);
                })
              }
            />
          </View>
        ) : (
          <Button label={t("streamer.highlights.curate")} onPress={() => setAdding(true)} />
        ))}
    </Card>
  );
}

// PUG ------------------------------------------------------------------------------

function pugStatus(pug: Pug | null | undefined, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (!pug) return t("streamer.pug.statusNone");
  if (pug.status === "open") return t("streamer.pug.statusOpen", { joined: pug.players.length, capacity: pug.teamSize * 2, size: pug.teamSize });
  if (pug.status === "live") return t("streamer.pug.statusLive", { map: pug.map ?? t("streamer.pug.aMap") });
  if (pug.status === "done") return t("streamer.pug.statusDone", { scoreA: pug.scoreA ?? 0, scoreB: pug.scoreB ?? 0, map: pug.map ?? t("streamer.pug.aMap") });
  return t("streamer.pug.statusCancelled");
}

export function PugSection({ data, owner, perform, voiceRooms, hubId }: { data: StreamerSnapshot; owner: boolean; perform: Perform; voiceRooms: Room[]; hubId: number }) {
  const { t } = useTranslation(["streamer"]);
  if (!data.features.pugs) return null;
  const pug = data.pug ?? null;
  const tr = t as unknown as (key: string, options?: Record<string, unknown>) => string;
  const active = pug && (pug.status === "open" || pug.status === "live");
  const team = (side: "a" | "b") => (side === "a" ? t("streamer.pug.teamA") : t("streamer.pug.teamB"));
  const teamRoom = pug?.myTeam ? (pug.myTeam === "a" ? pug.voiceA : pug.voiceB) : null;
  const room = voiceRooms.find((item) => item.id === teamRoom);
  return (
    <Card title={t("streamer.panels.pug")} icon="game-controller-outline">
      <Text style={styles.body}>{pugStatus(pug, tr)}</Text>
      {active && pug ? (
        <>
          <Text style={styles.muted}>{t("streamer.pug.rules", { size: pug.teamSize })}</Text>
          {pug.status === "live" ? (
            <View style={styles.teams}>
              {(["a", "b"] as const).map((side) => (
                <View key={side} style={{ flex: 1, gap: 3 }}>
                  <Text style={styles.label}>{team(side)}</Text>
                  {pug.players.filter((player) => player.team === side).map((player, i) => (
                    <Text key={i} style={styles.body}>{player.name}{player.me ? t("streamer.pug.you") : ""}</Text>
                  ))}
                </View>
              ))}
            </View>
          ) : (
            <>
              <Text style={styles.label}>{t("streamer.pug.players", { joined: pug.players.length, capacity: pug.teamSize * 2 })}</Text>
              <Text style={styles.body}>{pug.players.length ? pug.players.map((player) => `${player.name}${player.me ? t("streamer.pug.you") : ""}`).join(", ") : t("streamer.pug.nobody")}</Text>
              <Text style={styles.label}>{t("streamer.pug.mapVote")}</Text>
              <View style={styles.wrap}>
                {pug.maps.map((map) => (
                  <Button key={map} label={`${map} · ${pug.votes[map] ?? 0}`} primary={pug.myVote === map} disabled={!pug.joined} onPress={() => void perform("pug/vote", { map })} />
                ))}
              </View>
              {!pug.joined && <Text style={styles.muted}>{t("streamer.pug.voteHint")}</Text>}
            </>
          )}
          <View style={styles.wrap}>
            {pug.status === "open" &&
              (pug.joined ? (
                <Button label={t("streamer.pug.leave")} onPress={() => void perform("pug/leave", {})} />
              ) : (
                <Button label={t("streamer.pug.join")} primary disabled={pug.players.length >= pug.teamSize * 2} onPress={() => void perform("pug/join", {})} />
              ))}
            {room && (
              <Button label={t("streamer.pug.joinTeamVoice", { team: team(pug.myTeam!) })} primary onPress={() => router.push(`/voice/${room.id}?hubId=${hubId}&name=${encodeURIComponent(room.name)}` as never)} />
            )}
            {owner && pug.status === "open" && <Button label={t("streamer.pug.start")} primary disabled={pug.players.length < 2} onPress={() => void perform("pug/start", {})} />}
            {owner && <Button label={t("streamer.pug.cancel")} danger onPress={() => void perform("pug/cancel", {})} />}
          </View>
          {owner && pug.status === "live" && <PugResultForm perform={perform} />}
        </>
      ) : owner ? (
        <PugCreateForm voiceRooms={voiceRooms} perform={perform} />
      ) : (
        <Text style={styles.muted}>{t("streamer.pug.memberNone")}</Text>
      )}
    </Card>
  );
}

function PugCreateForm({ voiceRooms, perform }: { voiceRooms: Room[]; perform: Perform }) {
  const { t } = useTranslation(["streamer"]);
  const [teamSize, setTeamSize] = useState("5");
  const [maps, setMaps] = useState<string[]>([...CS2_MAP_POOL]);
  const [voiceA, setVoiceA] = useState<number | null>(voiceRooms[0]?.id ?? null);
  const [voiceB, setVoiceB] = useState<number | null>(voiceRooms[1]?.id ?? null);
  if (voiceRooms.length < 2) return <Text style={styles.muted}>{t("streamer.pug.needRooms")}</Text>;
  const roomChips = (value: number | null, set: (id: number) => void) => (
    <View style={styles.wrap}>
      {voiceRooms.map((room) => (
        <Button key={room.id} label={room.name} primary={value === room.id} onPress={() => set(room.id)} />
      ))}
    </View>
  );
  return (
    <View style={styles.form}>
      <Text style={styles.muted}>{t("streamer.pug.createIntro")}</Text>
      <Field label={t("streamer.pug.teamSizeField")} value={teamSize} onChange={setTeamSize} number />
      <Text style={styles.label}>{t("streamer.pug.mapPool")}</Text>
      <View style={styles.wrap}>
        {CS2_MAP_POOL.map((map) => (
          <Button key={map} label={map} primary={maps.includes(map)} onPress={() => setMaps((current) => (current.includes(map) ? current.filter((item) => item !== map) : [...current, map]))} />
        ))}
      </View>
      <Text style={styles.label}>{t("streamer.pug.voiceAField")}</Text>
      {roomChips(voiceA, setVoiceA)}
      <Text style={styles.label}>{t("streamer.pug.voiceBField")}</Text>
      {roomChips(voiceB, setVoiceB)}
      <Button
        label={t("streamer.pug.open")}
        primary
        disabled={!maps.length || !voiceA || !voiceB || voiceA === voiceB}
        onPress={() => void perform("pug/create", { teamSize: Number(teamSize), maps, voiceA, voiceB })}
      />
    </View>
  );
}

function PugResultForm({ perform }: { perform: Perform }) {
  const { t } = useTranslation(["streamer"]);
  const [scoreA, setScoreA] = useState("");
  const [scoreB, setScoreB] = useState("");
  return (
    <View style={styles.form}>
      <Text style={styles.label}>{t("streamer.pug.reportScore")}</Text>
      <View style={styles.teams}>
        <View style={{ flex: 1 }}><Field label={t("streamer.pug.teamARounds")} value={scoreA} onChange={setScoreA} number /></View>
        <View style={{ flex: 1 }}><Field label={t("streamer.pug.teamBRounds")} value={scoreB} onChange={setScoreB} number /></View>
      </View>
      <Button label={t("streamer.pug.saveResult")} primary disabled={scoreA === "" || scoreB === ""} onPress={() => void perform("pug/result", { scoreA: Number(scoreA), scoreB: Number(scoreB) })} />
    </View>
  );
}

// Leaderboard -----------------------------------------------------------------------

export function LeaderboardSection({ data, api, onLink, onUnlink }: { data: StreamerSnapshot; api: StreamerApi; onLink: () => void; onUnlink: () => void }) {
  const { t } = useTranslation(["streamer"]);
  const [board, setBoard] = useState<Leaderboard | null>(null);
  useEffect(() => {
    if (!data.features.leaderboard) return;
    void api.leaderboard().then(setBoard).catch(() => setBoard(null));
  }, [data.features.leaderboard, data.serverTime]);
  if (!data.features.leaderboard) return null;
  const month = board ? new Date(`${board.month}-01T12:00:00Z`).toLocaleDateString(dateLocale(), { month: "long", year: "numeric" }) : "";
  return (
    <Card title={t("streamer.panels.leaderboard")} icon="podium-outline">
      {!board ? (
        <Text style={styles.muted}>{t("streamer.leaderboard.loading")}</Text>
      ) : (
        <>
          <Text style={styles.itemTitle}>{board.champion ? t("streamer.leaderboard.champion", { name: board.champion.name }) : t("streamer.leaderboard.upForGrabs")}</Text>
          <Text style={styles.muted}>
            {board.champion ? t("streamer.leaderboard.championLine", { month, count: board.champion.wins }) : t("streamer.leaderboard.noChampion", { month })}
          </Text>
          {board.previousChampion && <Text style={styles.muted}>{t("streamer.leaderboard.lastMonth", { name: board.previousChampion.name, count: board.previousChampion.wins })}</Text>}
          {board.rows.length === 0 ? (
            <Text style={styles.muted}>{t("streamer.leaderboard.empty")}</Text>
          ) : (
            board.rows.slice(0, 20).map((row, i) => (
              <View key={`${row.name}:${i}`} style={styles.listRow}>
                <Text style={[styles.body, { flex: 1, fontWeight: row.me ? "900" : "600" }]} numberOfLines={1}>{i + 1}. {row.name}</Text>
                {row.faceitElo !== null && (
                  <Text style={styles.muted}>{row.faceitLevel ? t("streamer.leaderboard.eloWithLevel", { level: row.faceitLevel, elo: row.faceitElo }) : t("streamer.leaderboard.elo", { elo: row.faceitElo })}</Text>
                )}
                <Text style={styles.body}>{row.wins}/{row.games}</Text>
              </View>
            ))
          )}
          <Text style={styles.label}>{t("streamer.leaderboard.yourAccount")}</Text>
          {board.myFaceit ? (
            <>
              <Text style={styles.muted}>
                {board.myFaceit.elo !== null ? t("streamer.leaderboard.linkedWithElo", { nickname: board.myFaceit.nickname, elo: board.myFaceit.elo }) : t("streamer.leaderboard.linked", { nickname: board.myFaceit.nickname })}
              </Text>
              <Button label={t("streamer.leaderboard.unlink")} onPress={onUnlink} />
            </>
          ) : (
            <>
              <Text style={styles.muted}>{t("streamer.leaderboard.signInIntro")}</Text>
              <Button label={t("streamer.leaderboard.signIn")} primary onPress={onLink} />
            </>
          )}
        </>
      )}
    </Card>
  );
}

// Twitch subscriber ---------------------------------------------------------------

export function TwitchSection({ data, onLink, onRecheck, onUnlink }: { data: StreamerSnapshot; onLink: () => void; onRecheck: () => void; onUnlink: () => void }) {
  const { t } = useTranslation(["streamer"]);
  if (!data.features.subRoles || !data.twitchMember) return null;
  const member = data.twitchMember;
  return (
    <Card title={t("streamer.cards.twitch.title")} icon="logo-twitch">
      <Text style={styles.muted}>{member.linked ? t("streamer.cards.twitch.linkedDescription") : t("streamer.cards.twitch.unlinkedDescription")}</Text>
      <Text style={styles.body}>
        {!member.linked
          ? t("streamer.cards.twitch.notLinked")
          : member.subscribed
            ? t("streamer.cards.twitch.subscribed", { login: member.login ?? "" })
            : t("streamer.cards.twitch.notSubscribed", { login: member.login ?? "" })}
      </Text>
      <View style={styles.wrap}>
        {member.linked ? (
          <>
            <Button label={t("streamer.cards.twitch.checkAgain")} onPress={onRecheck} />
            <Button label={t("streamer.cards.twitch.unlink")} onPress={onUnlink} />
          </>
        ) : (
          <Button label={t("streamer.cards.twitch.link")} primary onPress={onLink} />
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, gap: 10, borderRadius: 18, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: "900" },
  body: { color: colors.text, fontSize: 14, lineHeight: 20 },
  muted: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  label: { color: colors.muted, fontSize: 12, fontWeight: "900", textTransform: "uppercase" },
  item: { gap: 4, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  itemTitle: { color: colors.text, fontSize: 15, fontWeight: "900" },
  listRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  teams: { flexDirection: "row", gap: 12 },
  form: { gap: 10, paddingTop: 6 },
  input: { minHeight: 42, justifyContent: "center", paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, color: colors.text, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border, fontSize: 14 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  button: { minHeight: 38, paddingHorizontal: 14, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  primary: { backgroundColor: colors.cyan, borderColor: colors.cyan },
  danger: { backgroundColor: colors.redSoft, borderColor: "rgba(255,102,120,.25)" },
  buttonText: { color: colors.text, fontSize: 13, fontWeight: "800" },
  primaryText: { color: "#061018" },
});
