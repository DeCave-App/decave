// Owner-only admin on mobile: the same data and actions as web's Admin &
// Security page and Trust & Safety queue, using the common.admin.* and
// admin.trustSafety.* strings. Irreversible account tools (erase, scheduled
// deletion, role changes, Hub transfer, age correction) stay on desktop/web.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { AdminApi, OwnerReauth } from "@/src/lib/admin-api";
import { dateLocale } from "@/src/lib/date-locale";
import { colors } from "@/src/theme";

const when = (value: string | null | undefined) => (value ? new Date(value).toLocaleString(dateLocale(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const label = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={[styles.cardTitle, { flex: 1 }]}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

export function Btn({ text, onPress, primary, danger, disabled }: { text: string; onPress: () => void; primary?: boolean; danger?: boolean; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} style={[styles.btn, primary && styles.btnPrimary, danger && styles.btnDanger, disabled && { opacity: 0.45 }]} onPress={onPress}>
      <Text style={[styles.btnText, primary && { color: "#061018" }, danger && { color: colors.red }]}>{text}</Text>
    </Pressable>
  );
}

function Chips<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (id: T) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
      {options.map((option) => (
        <Pressable key={option.id} accessibilityRole="button" accessibilityState={{ selected: value === option.id }} style={[styles.chip, value === option.id && styles.chipOn]} onPress={() => onChange(option.id)}>
          <Text style={[styles.chipText, value === option.id && { color: colors.cyan }]}>{option.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

// Unlock --------------------------------------------------------------------------

export function UnlockCard({ reauth, onUnlock }: { reauth: OwnerReauth; onUnlock: (password: string, code: string) => Promise<string | null> }) {
  const { t } = useTranslation(["common", "admin"]);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = !!reauth && reauth.expiresAt > Date.now();
  if (active)
    return (
      <View style={[styles.card, styles.unlocked]}>
        <Text style={styles.cardTitle}>{t("admin.trustSafety.privilege.unlocked")}</Text>
        <Text style={styles.muted}>{t("admin.trustSafety.privilege.until", { date: when(new Date(reauth!.expiresAt).toISOString()) })}</Text>
      </View>
    );
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{t("common.admin.overview.unlockTitle")}</Text>
      <Text style={styles.muted}>{t("common.admin.overview.unlockBody")}</Text>
      <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder={t("common.account.currentPassword")} placeholderTextColor={colors.faint} style={styles.input} autoComplete="current-password" />
      <TextInput value={code} onChangeText={setCode} placeholder={t("common.account.mfaCodeLabel")} placeholderTextColor={colors.faint} style={styles.input} autoCapitalize="characters" autoComplete="one-time-code" />
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Btn
        text={busy ? "…" : t("common.admin.overview.unlock")}
        primary
        disabled={busy || !password || !code.trim()}
        onPress={() =>
          void (async () => {
            setBusy(true);
            setError("");
            const problem = await onUnlock(password, code.trim());
            setBusy(false);
            if (problem) setError(problem);
            else {
              setPassword("");
              setCode("");
            }
          })()
        }
      />
    </View>
  );
}

// Overview ------------------------------------------------------------------------

type Summary = Record<string, number | string>;

export function OverviewTab({ api }: { api: AdminApi }) {
  const { t } = useTranslation(["common", "chat"]);
  const [range, setRange] = useState<"day" | "week" | "month">("day");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const days = range === "day" ? 0 : range === "week" ? 6 : 29;
    const to = new Date();
    const from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - days);
    const day = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    setSummary(null);
    void api
      .call<Summary>(`/api/admin/dashboard?timezoneOffsetMinutes=${new Date().getTimezoneOffset()}&from=${day(from)}&to=${day(to)}`)
      .then(setSummary)
      .catch((cause) => setError(cause instanceof Error ? cause.message : t("chat.actions.admin.loadFailed")));
  }, [api, range]);
  const metric = (key: string, value: unknown) => (
    <View key={key} style={styles.metric}>
      <Text style={styles.metricValue}>{typeof value === "number" ? value.toLocaleString(dateLocale()) : String(value ?? "–")}</Text>
      <Text style={styles.muted}>{t(`common.admin.overview.metrics.${key}` as never)}</Text>
    </View>
  );
  const total = (key: string, value: unknown) => (
    <View key={key} style={styles.total}>
      <Text style={[styles.muted, { flex: 1 }]}>{t(`common.admin.overview.totalsLabels.${key}` as never)}</Text>
      <Text style={styles.body}>{typeof value === "number" ? value.toLocaleString(dateLocale()) : "–"}</Text>
    </View>
  );
  return (
    <View style={{ gap: 12 }}>
      <Chips value={range} onChange={setRange} options={(["day", "week", "month"] as const).map((id) => ({ id, label: t(`common.admin.range.${id}`) }))} />
      {!!error && <Text style={styles.error}>{error}</Text>}
      {!summary ? (
        <ActivityIndicator color={colors.cyan} />
      ) : (
        <>
          <View style={styles.metrics}>
            {metric("signedIn", summary.signedInToday)}
            {metric("onlineNow", summary.onlineUsers)}
            {metric("voice", summary.voiceUsers)}
            {metric("sharing", summary.screenSharingUsers)}
            {metric("returning", summary.returningUsers)}
            {metric("squad", summary.squadFinderUsers)}
          </View>
          <Section title={t("common.admin.overview.totals")}>
            {total("accounts", summary.accounts)}
            {total("verified", summary.verifiedAccounts)}
            {total("owners", summary.platformOwners)}
            {total("ownersMfa", summary.ownersWithMfa)}
            {total("platformAdmins", summary.platformAdmins)}
            {total("hubs", summary.hubs)}
            {total("publicHubs", summary.publicHubs)}
            {total("activeSessions", summary.activeSessions)}
            {total("security24h", summary.securityEvents24h)}
            {total("audit24h", summary.platformAuditEvents24h)}
            {total("suspended", summary.suspendedAccounts)}
            {total("deletionScheduled", summary.deletionScheduledAccounts)}
          </Section>
          <Text style={styles.muted}>{t("common.admin.overview.countedOnce")}</Text>
        </>
      )}
    </View>
  );
}

// Trust & Safety ------------------------------------------------------------------

type SafetyReport = {
  id: string;
  caseId: string;
  caseNumber: string | null;
  targetType: string;
  subjectUserId: string | null;
  subjectUsername: string | null;
  targetUsername: string | null;
  contextType: string | null;
  contextLabel: string | null;
  hubId: number | null;
  roomId: number | null;
  category: string;
  description: string;
  urgency: string;
  status: string;
  submittedAt: string;
  reportedContent?: { text: string; authorUsername: string; createdAt: string; editedAt: string | null; attachment: { name: string; mimeType: string; size: number } | null } | null;
};
type SafetyCase = {
  reports: SafetyReport[];
  notes: { id: string; note: string; createdAt: string; authorUsername: string | null }[];
  actions: { id: string; actionType: string; reason: string; createdAt: string; createdByUsername: string | null; expiresAt: string | null; reversedAt: string | null }[];
  evidence: { id: string; reportId: string | null; ciphertextSize: number; createdAt: string }[];
};
const STATUSES = ["submitted", "under_review", "awaiting_information", "action_taken", "no_violation", "escalated", "appealed", "closed"] as const;
const URGENCIES = ["critical", "high", "medium", "low", "spam_invalid"] as const;
const ACTIONS = ["no_action_taken", "warning", "restrict", "suspend", "unsuspend"] as const;

export function SafetyTab({ api, unlocked }: { api: AdminApi; unlocked: boolean }) {
  const { t } = useTranslation(["admin"]);
  const [filter, setFilter] = useState<"open" | "critical" | "all">("open");
  const [overview, setOverview] = useState<{ openCases: number; criticalCases: number; submittedReports: number; evidenceObjects: number } | null>(null);
  const [reports, setReports] = useState<SafetyReport[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<SafetyReport | null>(null);
  const load = useCallback(async () => {
    setError("");
    try {
      const query = filter === "critical" ? "/api/admin/trust-safety/critical" : filter === "open" ? "/api/admin/trust-safety/reports?status=submitted" : "/api/admin/trust-safety/reports";
      const [summary, list] = await Promise.all([api.call<typeof overview>("/api/admin/trust-safety/overview"), api.call<{ reports?: SafetyReport[] }>(query)]);
      setOverview(summary);
      setReports(Array.isArray(list.reports) ? list.reports : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("admin.trustSafety.loadFailed"));
      setReports([]);
    }
  }, [api, filter, t]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <View style={{ gap: 12 }}>
      {overview && (
        <View style={styles.metrics}>
          {(
            [
              ["openCases", overview.openCases],
              ["critical", overview.criticalCases],
              ["newReports", overview.submittedReports],
              ["evidence", overview.evidenceObjects],
            ] as const
          ).map(([key, value]) => (
            <View key={key} style={styles.metric}>
              <Text style={styles.metricValue}>{value}</Text>
              <Text style={styles.muted}>{t(`admin.trustSafety.metrics.${key}`)}</Text>
            </View>
          ))}
        </View>
      )}
      <Chips value={filter} onChange={setFilter} options={(["open", "critical", "all"] as const).map((id) => ({ id, label: t(`admin.trustSafety.filter.${id}`) }))} />
      {!!error && <Text style={styles.error}>{error}</Text>}
      {reports === null ? (
        <ActivityIndicator color={colors.cyan} />
      ) : reports.length === 0 ? (
        <Text style={styles.muted}>{t("admin.trustSafety.queueEmpty")}</Text>
      ) : (
        reports.map((report) => (
          <Pressable key={report.id} accessibilityRole="button" style={styles.listItem} onPress={() => setOpen(report)}>
            <View style={styles.row}>
              <Text style={[styles.badge, report.urgency === "critical" && styles.badgeCritical]}>{t(`admin.trustSafety.enum.urgency.${report.urgency}` as never, { defaultValue: label(report.urgency) })}</Text>
              <Text style={[styles.muted, { flex: 1 }]} numberOfLines={1}>{t(`admin.trustSafety.enum.status.${report.status}` as never, { defaultValue: label(report.status) })}</Text>
              <Text style={styles.muted}>{when(report.submittedAt)}</Text>
            </View>
            <Text style={styles.body} numberOfLines={1}>
              {t("admin.trustSafety.rowMeta", {
                subject: report.subjectUsername || report.targetUsername || t("admin.trustSafety.unknownUser"),
                category: t(`admin.trustSafety.enum.category.${report.category}` as never, { defaultValue: label(report.category) }),
              })}
            </Text>
          </Pressable>
        ))
      )}
      {open && <CaseSheet report={open} api={api} unlocked={unlocked} onClose={() => setOpen(null)} onChanged={() => void load()} />}
    </View>
  );
}

function CaseSheet({ report, api, unlocked, onClose, onChanged }: { report: SafetyReport; api: AdminApi; unlocked: boolean; onClose: () => void; onChanged: () => void }) {
  const { t } = useTranslation(["admin", "common"]);
  const insets = useSafeAreaInsets();
  const [detail, setDetail] = useState<SafetyCase | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(report.status);
  const [urgency, setUrgency] = useState(report.urgency);
  const [note, setNote] = useState("");
  const [action, setAction] = useState<(typeof ACTIONS)[number]>("no_action_taken");
  const [reason, setReason] = useState("");
  const load = useCallback(async () => {
    try {
      const data = await api.call<Partial<SafetyCase>>(`/api/admin/trust-safety/cases/${encodeURIComponent(report.caseId)}`, {}, t("admin.trustSafety.detailFailed"));
      setDetail({ reports: data.reports ?? [], notes: data.notes ?? [], actions: data.actions ?? [], evidence: data.evidence ?? [] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("admin.trustSafety.detailFailed"));
    }
  }, [api, report.caseId, t]);
  useEffect(() => {
    void load();
  }, [load]);
  const current = detail?.reports.find((item) => item.id === report.id) ?? report;
  const run = async (path: string, body: unknown, ok: string, fail: string) => {
    setBusy(true);
    setNotice("");
    try {
      await api.call(path, { method: "POST", body }, fail);
      setNotice(ok);
      await load();
      onChanged();
      return true;
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : fail);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const content = current.reportedContent;
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.sheetHead}>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>{t("admin.trustSafety.caseKicker", { id: current.caseNumber ?? current.caseId.slice(0, 8) })}</Text>
            <Text style={styles.cardTitle}>{t("admin.trustSafety.reportedTarget", { target: t(`admin.trustSafety.enum.target.${current.targetType}` as never, { defaultValue: label(current.targetType) }) })}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t("admin.trustSafety.close")} hitSlop={8} onPress={onClose}>
            <Ionicons name="close" size={22} color={colors.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
          {!!notice && <Text style={styles.notice}>{notice}</Text>}
          {!!error && <Text style={styles.error}>{error}</Text>}
          <Section title={t("admin.trustSafety.field.reportedUser")}>
            <Text style={styles.body}>{current.subjectUsername || current.targetUsername || t("admin.trustSafety.unknownUser")}</Text>
            <Text style={styles.muted}>{t("admin.trustSafety.field.context")}: {current.contextLabel || label(current.contextType ?? "unknown")}</Text>
            <Text style={styles.muted}>{t("admin.trustSafety.field.submitted")}: {when(current.submittedAt)}</Text>
          </Section>
          <Section title={t("admin.trustSafety.description.title")}>
            <Text style={styles.body}>{current.description || t("admin.trustSafety.description.empty")}</Text>
          </Section>
          <Section title={t("admin.trustSafety.message.title")}>
            {content ? (
              <>
                <Text style={styles.muted}>{content.authorUsername} · {content.editedAt ? t("admin.trustSafety.message.editedAt", { date: when(content.createdAt) }) : when(content.createdAt)}</Text>
                <Text style={styles.body} selectable>{content.text || t("admin.trustSafety.message.noText")}</Text>
                {content.attachment && <Text style={styles.muted}>{t("admin.trustSafety.message.attachment")}: {content.attachment.name}</Text>}
              </>
            ) : (
              <Text style={styles.muted}>{(detail?.evidence ?? []).length ? t("admin.trustSafety.message.encryptedOnly") : t("admin.trustSafety.message.noCopy")}</Text>
            )}
          </Section>

          {!unlocked && <Text style={styles.notice}>{t("admin.trustSafety.privilege.howToUnlock")}</Text>}
          <Section title={t("admin.trustSafety.controls.status")}>
            <Chips value={status} onChange={setStatus} options={STATUSES.map((id) => ({ id, label: t(`admin.trustSafety.enum.status.${id}`) }))} />
            <Btn text={t("admin.trustSafety.controls.saveStatus")} disabled={busy || !unlocked} onPress={() => void run(`/api/admin/trust-safety/reports/${encodeURIComponent(current.id)}/status`, { status }, t("admin.trustSafety.statusSaved"), t("admin.trustSafety.statusFailed"))} />
          </Section>
          <Section title={t("admin.trustSafety.controls.urgency")}>
            <Chips value={urgency} onChange={setUrgency} options={URGENCIES.map((id) => ({ id, label: t(`admin.trustSafety.enum.urgency.${id}`) }))} />
            <Btn text={t("admin.trustSafety.controls.saveUrgency")} disabled={busy || !unlocked} onPress={() => void run(`/api/admin/trust-safety/reports/${encodeURIComponent(current.id)}/urgency`, { urgency }, t("admin.trustSafety.urgencySaved"), t("admin.trustSafety.urgencyFailed"))} />
          </Section>
          <Section title={t("admin.trustSafety.controls.note")}>
            <TextInput value={note} onChangeText={setNote} multiline style={[styles.input, { minHeight: 70, textAlignVertical: "top" }]} placeholderTextColor={colors.faint} />
            <Btn
              text={t("admin.trustSafety.controls.addNote")}
              disabled={busy || !unlocked || !note.trim()}
              onPress={() => void run(`/api/admin/trust-safety/cases/${encodeURIComponent(current.caseId)}/notes`, { note }, t("admin.trustSafety.noteSaved"), t("admin.trustSafety.noteFailed")).then((ok) => ok && setNote(""))}
            />
          </Section>
          <Section title={t("admin.trustSafety.controls.action")}>
            <Chips value={action} onChange={setAction} options={ACTIONS.map((id) => ({ id, label: t(`admin.trustSafety.enum.action.${id}`) }))} />
            <TextInput value={reason} onChangeText={setReason} placeholder={t("admin.trustSafety.controls.reasonPlaceholder")} placeholderTextColor={colors.faint} style={styles.input} />
            <Btn
              text={t("admin.trustSafety.controls.recordAction")}
              danger={action === "suspend"}
              disabled={busy || !unlocked}
              onPress={() => {
                if (!reason.trim()) {
                  setNotice(t("admin.trustSafety.reasonRequired"));
                  return;
                }
                void run(`/api/admin/trust-safety/cases/${encodeURIComponent(current.caseId)}/actions`, { actionType: action, reason, targetUserId: current.subjectUserId || undefined }, t("admin.trustSafety.actionSaved"), t("admin.trustSafety.actionFailed")).then((ok) => ok && setReason(""));
              }}
            />
          </Section>
          <Section title={t("admin.trustSafety.actions.title")}>
            {(detail?.actions ?? []).length === 0 ? (
              <Text style={styles.muted}>{t("admin.trustSafety.actions.empty")}</Text>
            ) : (
              detail!.actions.map((item) => (
                <View key={item.id} style={styles.listRow}>
                  <Text style={styles.body}>{t(`admin.trustSafety.enum.action.${item.actionType}` as never, { defaultValue: label(item.actionType) })} · {when(item.createdAt)}</Text>
                  <Text style={styles.muted}>{item.reason || t("admin.trustSafety.actions.noReason")}</Text>
                </View>
              ))
            )}
          </Section>
          <Section title={t("admin.trustSafety.notes.title")}>
            {(detail?.notes ?? []).length === 0 ? (
              <Text style={styles.muted}>{t("admin.trustSafety.notes.empty")}</Text>
            ) : (
              detail!.notes.map((item) => (
                <View key={item.id} style={styles.listRow}>
                  <Text style={styles.muted}>{item.authorUsername || t("admin.trustSafety.notes.owner")} · {when(item.createdAt)}</Text>
                  <Text style={styles.body}>{item.note}</Text>
                </View>
              ))
            )}
          </Section>
          {busy && <ActivityIndicator color={colors.cyan} />}
        </ScrollView>
      </View>
    </Modal>
  );
}

// Accounts --------------------------------------------------------------------------

type Account = {
  id: string;
  username: string;
  email: string | null;
  emailVerified: boolean;
  platformRole: string;
  createdAt: string;
  activeSessions: number;
  suspended: boolean;
  suspendedUntil: string | null;
  suspensionReason: string;
  passwordResetRequired: boolean;
  deletedAt: string | null;
  erasedAt: string | null;
};
type AccountDetail = Account & { recentSecurityEvents?: { id: string; event: string; detail: string; createdAt: string }[]; hubsOwned?: { id: number; name: string }[] | number };

export function AccountsTab({ api, unlocked }: { api: AdminApi; unlocked: boolean }) {
  const { t } = useTranslation(["common", "chat"]);
  const [search, setSearch] = useState("");
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const load = useCallback(async (query: string) => {
    setError("");
    try {
      const data = await api.call<{ accounts?: Account[] }>(`/api/admin/accounts?limit=100&search=${encodeURIComponent(query.trim())}`);
      setAccounts(Array.isArray(data.accounts) ? data.accounts : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("chat.actions.admin.loadFailed"));
      setAccounts([]);
    }
  }, [api, t]);
  useEffect(() => {
    void load("");
  }, [load]);
  const badge = (account: Account) =>
    account.erasedAt ? t("common.admin.accounts.badgeErased") : account.deletedAt ? t("common.admin.accounts.badgeDeletion") : account.suspended ? t("common.admin.accounts.badgeSuspended") : account.passwordResetRequired ? t("common.admin.accounts.badgeReset") : t("common.admin.accounts.badgeActive");
  return (
    <View style={{ gap: 12 }}>
      <View style={styles.row}>
        <TextInput value={search} onChangeText={setSearch} placeholder={t("common.admin.accounts.search")} placeholderTextColor={colors.faint} style={[styles.input, { flex: 1 }]} autoCapitalize="none" returnKeyType="search" onSubmitEditing={() => void load(search)} />
        <Btn text={t("common.actions.search")} onPress={() => void load(search)} />
      </View>
      {!!error && <Text style={styles.error}>{error}</Text>}
      {accounts === null ? (
        <ActivityIndicator color={colors.cyan} />
      ) : (
        accounts.map((account) => (
          <Pressable key={account.id} accessibilityRole="button" style={styles.listItem} onPress={() => setSelected(account.id)}>
            <View style={styles.row}>
              <Text style={[styles.body, { flex: 1, fontWeight: "800" }]} numberOfLines={1}>{account.username}</Text>
              <Text style={[styles.badge, account.suspended && styles.badgeCritical]}>{badge(account)}</Text>
            </View>
            <Text style={styles.muted} numberOfLines={1}>{account.email ?? t("common.admin.accounts.noEmail")} · {label(account.platformRole)} · {`${t("common.admin.accounts.sessions")}: ${account.activeSessions}`}</Text>
          </Pressable>
        ))
      )}
      {selected && <AccountSheet id={selected} api={api} unlocked={unlocked} onClose={() => setSelected(null)} onChanged={() => void load(search)} />}
    </View>
  );
}

function AccountSheet({ id, api, unlocked, onClose, onChanged }: { id: string; api: AdminApi; unlocked: boolean; onClose: () => void; onChanged: () => void }) {
  const { t } = useTranslation(["common", "chat", "admin", "errors"]);
  const insets = useSafeAreaInsets();
  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState<"1" | "7" | "30" | "indefinite">("7");
  const load = useCallback(async () => {
    try {
      const data = await api.call<{ account?: AccountDetail }>(`/api/admin/accounts/${encodeURIComponent(id)}`);
      setAccount(data.account ?? null);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : t("chat.actions.admin.loadFailed"));
    }
  }, [api, id, t]);
  useEffect(() => {
    void load();
  }, [load]);
  const run = async (path: string, body: unknown, ok: string) => {
    setBusy(true);
    setNotice("");
    try {
      await api.call(path, { method: "POST", body }, t("errors.client.connect" as never));
      setNotice(ok);
      await load();
      onChanged();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : t("errors.client.connect" as never));
    } finally {
      setBusy(false);
    }
  };
  const confirm = (title: string, action: () => void) => Alert.alert(title, account?.username, [{ text: t("common.actions.cancel"), style: "cancel" }, { text: title, style: "destructive", onPress: action }]);
  const base = `/api/admin/accounts/${encodeURIComponent(id)}`;
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.sheetHead}>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>{t("common.admin.accounts.kicker")}</Text>
            <Text style={styles.cardTitle} numberOfLines={1}>{account?.username ?? ""}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t("common.actions.close")} hitSlop={8} onPress={onClose}>
            <Ionicons name="close" size={22} color={colors.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
          {!!notice && <Text style={styles.notice}>{notice}</Text>}
          {!account ? (
            <ActivityIndicator color={colors.cyan} />
          ) : (
            <>
              <Section title={account.email ?? t("common.admin.accounts.noEmail")}>
                <Text style={styles.muted}>{t("common.admin.accounts.created")}: {when(account.createdAt)}</Text>
                <Text style={styles.muted}>{t("common.admin.accounts.platformRole")}: {label(account.platformRole)}</Text>
                <Text style={styles.muted}>{`${t("common.admin.accounts.sessions")}: ${account.activeSessions}`}</Text>
                {account.suspended && <Text style={styles.error}>{t("common.admin.accounts.badgeSuspended")}{account.suspendedUntil ? ` · ${when(account.suspendedUntil)}` : ""} · {account.suspensionReason}</Text>}
              </Section>
              {!unlocked && <Text style={styles.notice}>{t("chat.actions.admin.unlockFirst")}</Text>}
              <Section title={t("common.admin.accounts.securityActions")}>
                <View style={styles.wrap}>
                  {!account.emailVerified && account.email && <Btn text={t("common.admin.accounts.resendVerification")} disabled={busy} onPress={() => void run(`${base}/resend-verification`, {}, t("chat.actions.admin.verificationResent"))} />}
                  <Btn text={t("common.admin.accounts.forceReset")} disabled={busy || !unlocked} onPress={() => confirm(t("common.admin.accounts.forceReset"), () => void run(`${base}/force-password-reset`, {}, t("chat.actions.admin.resetForced")))} />
                  <Btn text={t("common.admin.accounts.revokeSessions")} disabled={busy || !unlocked} onPress={() => confirm(t("common.admin.accounts.revokeSessions"), () => void run("/api/admin/sessions/revoke-user", { targetUserId: id }, t("chat.actions.admin.sessionsRevoked")))} />
                </View>
              </Section>
              <Section title={t("common.admin.accounts.suspension")}>
                {account.suspended ? (
                  <Btn text={t("common.admin.accounts.unsuspend")} primary disabled={busy || !unlocked} onPress={() => void run(`${base}/unsuspend`, {}, t("chat.actions.admin.unsuspended"))} />
                ) : (
                  <>
                    <TextInput value={reason} onChangeText={setReason} placeholder={t("common.admin.accounts.suspendReason")} placeholderTextColor={colors.faint} style={styles.input} />
                    <Chips
                      value={duration}
                      onChange={setDuration}
                      options={[
                        { id: "1", label: "1d" },
                        { id: "7", label: "7d" },
                        { id: "30", label: "30d" },
                        { id: "indefinite", label: t("common.admin.accounts.durationIndefinite") },
                      ]}
                    />
                    <Btn
                      text={t("common.admin.accounts.suspend")}
                      danger
                      disabled={busy || !unlocked}
                      onPress={() => {
                        if (!reason.trim()) {
                          setNotice(t("chat.actions.admin.suspendReasonMissing"));
                          return;
                        }
                        confirm(t("common.admin.accounts.suspend"), () => void run(`${base}/suspend`, { reason: reason.trim(), durationDays: duration === "indefinite" ? null : Number(duration) }, t("chat.actions.admin.suspended")));
                      }}
                    />
                  </>
                )}
              </Section>
              <Section title={t("common.admin.accounts.recentSecurity")}>
                {(account.recentSecurityEvents ?? []).length === 0 ? (
                  <Text style={styles.muted}>{t("common.admin.accounts.noRecentSecurity")}</Text>
                ) : (
                  account.recentSecurityEvents!.slice(0, 20).map((event) => (
                    <View key={event.id} style={styles.listRow}>
                      <Text style={styles.body}>{t(`admin.auditEvents.${event.event}` as never, { defaultValue: label(event.event) })}</Text>
                      <Text style={styles.muted}>{when(event.createdAt)}{event.detail ? ` · ${event.detail}` : ""}</Text>
                    </View>
                  ))
                )}
              </Section>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

// Security events / audit / games ------------------------------------------------------

export function SecurityTab({ api }: { api: AdminApi }) {
  const { t } = useTranslation(["common", "admin"]);
  const [events, setEvents] = useState<{ id: string; username: string | null; event: string; detail: string; createdAt: string }[] | null>(null);
  const [filter, setFilter] = useState("");
  useEffect(() => {
    void api.call<{ events?: typeof events }>("/api/admin/security-events?limit=100").then((data) => setEvents(data.events ?? [])).catch(() => setEvents([]));
  }, [api]);
  const q = filter.trim().toLowerCase();
  const shown = (events ?? []).filter((event) => !q || `${event.event} ${event.username ?? ""} ${event.detail}`.toLowerCase().includes(q));
  return (
    <View style={{ gap: 10 }}>
      <TextInput value={filter} onChangeText={setFilter} placeholder={t("common.admin.security.filter")} placeholderTextColor={colors.faint} style={styles.input} autoCapitalize="none" />
      {events === null ? <ActivityIndicator color={colors.cyan} /> : shown.map((event) => (
        <View key={event.id} style={styles.listItem}>
          <Text style={styles.body}>{t(`admin.auditEvents.${event.event}` as never, { defaultValue: label(event.event) })}</Text>
          <Text style={styles.muted}>{t("common.admin.security.accountDetail", { account: event.username ?? t("common.admin.security.unknownAccount"), detail: event.detail || "–" })} · {when(event.createdAt)}</Text>
        </View>
      ))}
    </View>
  );
}

export function AuditTab({ api }: { api: AdminApi }) {
  const { t } = useTranslation(["common", "admin"]);
  const [events, setEvents] = useState<{ id: string; action: string; actorUsername: string | null; actorUserId: string; targetUsername: string | null; requestCountry: string | null; createdAt: string }[] | null>(null);
  const [filter, setFilter] = useState("");
  useEffect(() => {
    void api.call<{ events?: typeof events }>("/api/admin/platform-audit?limit=100").then((data) => setEvents(data.events ?? [])).catch(() => setEvents([]));
  }, [api]);
  const q = filter.trim().toLowerCase();
  const shown = (events ?? []).filter((event) => !q || `${event.action} ${event.actorUsername ?? ""} ${event.targetUsername ?? ""} ${event.requestCountry ?? ""}`.toLowerCase().includes(q));
  return (
    <View style={{ gap: 10 }}>
      <TextInput value={filter} onChangeText={setFilter} placeholder={t("common.admin.audit.filter")} placeholderTextColor={colors.faint} style={styles.input} autoCapitalize="none" />
      {events === null ? <ActivityIndicator color={colors.cyan} /> : shown.map((event) => {
        const actor = event.actorUsername ?? event.actorUserId;
        return (
          <View key={event.id} style={styles.listItem}>
            <Text style={styles.body}>{t(`admin.auditEvents.${event.action.replace(/\./g, "_")}` as never, { defaultValue: label(event.action.replace(/\./g, "_")) })}</Text>
            <Text style={styles.muted}>
              {event.targetUsername
                ? event.requestCountry
                  ? t("common.admin.audit.actorTargetCountry", { actor, target: event.targetUsername, country: event.requestCountry })
                  : t("common.admin.audit.actorTarget", { actor, target: event.targetUsername })
                : event.requestCountry
                  ? t("common.admin.audit.actorCountry", { actor, country: event.requestCountry })
                  : t("common.admin.audit.actor", { actor })}{" "}
              · {when(event.createdAt)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export function GamesTab({ api }: { api: AdminApi }) {
  const { t } = useTranslation(["common", "chat"]);
  const [games, setGames] = useState<{ id: string; gameName: string; status: string; createdAt: string; submittedBy: string }[] | null>(null);
  const [notice, setNotice] = useState("");
  const load = useCallback(() => {
    void api.call<{ suggestions?: typeof games }>("/api/admin/squad-game-suggestions").then((data) => setGames(data.suggestions ?? [])).catch(() => setGames([]));
  }, [api]);
  useEffect(load, [load]);
  const review = async (id: string, action: "approve" | "reject") => {
    try {
      await api.call(`/api/admin/squad-game-suggestions/${encodeURIComponent(id)}/${action}`, { method: "POST" });
      setNotice(action === "approve" ? t("chat.actions.admin.gameApproved") : t("chat.actions.admin.gameRejected"));
      load();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : t("chat.actions.admin.loadFailed"));
    }
  };
  const pending = (games ?? []).filter((game) => game.status === "pending");
  return (
    <View style={{ gap: 10 }}>
      <Text style={styles.muted}>{t("common.admin.games.lead")}</Text>
      {!!notice && <Text style={styles.notice}>{notice}</Text>}
      {games === null ? <ActivityIndicator color={colors.cyan} /> : pending.length === 0 ? <Text style={styles.muted}>{t("common.admin.games.empty")}</Text> : pending.map((game) => (
        <View key={game.id} style={styles.listItem}>
          <Text style={styles.body}>{game.gameName}</Text>
          <Text style={styles.muted}>{t("common.admin.games.suggestedBy", { name: game.submittedBy, date: when(game.createdAt) })}</Text>
          <View style={styles.wrap}>
            <Btn text={t("common.admin.games.approve")} primary onPress={() => void review(game.id, "approve")} />
            <Btn text={t("common.admin.games.reject")} danger onPress={() => void review(game.id, "reject")} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 12, gap: 8, borderRadius: 16, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  unlocked: { borderColor: colors.green },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: "900" },
  kicker: { color: colors.cyan, fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  body: { color: colors.text, fontSize: 14, lineHeight: 20 },
  muted: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  error: { color: colors.red, fontSize: 12 },
  notice: { padding: 10, borderRadius: 12, overflow: "hidden", color: colors.cyan, backgroundColor: colors.cyanSoft, fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  input: { minHeight: 42, paddingHorizontal: 12, borderRadius: 12, color: colors.text, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border, fontSize: 14 },
  btn: { minHeight: 38, paddingHorizontal: 14, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  btnPrimary: { backgroundColor: colors.cyan, borderColor: colors.cyan },
  btnDanger: { backgroundColor: colors.redSoft },
  btnText: { color: colors.text, fontSize: 13, fontWeight: "800" },
  chip: { paddingHorizontal: 11, height: 32, justifyContent: "center", borderRadius: 99, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  chipOn: { borderColor: colors.cyan, backgroundColor: colors.cyanSoft },
  chipText: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metric: { width: "31%", flexGrow: 1, padding: 10, borderRadius: 14, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  metricValue: { color: colors.text, fontSize: 20, fontWeight: "900" },
  total: { flexDirection: "row", alignItems: "center", paddingVertical: 4 },
  listItem: { padding: 12, gap: 4, borderRadius: 14, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  listRow: { gap: 2, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  badge: { overflow: "hidden", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, color: colors.muted, fontSize: 10, fontWeight: "900", backgroundColor: colors.panel2 },
  badgeCritical: { color: "#fff", backgroundColor: colors.red },
  sheet: { flex: 1, backgroundColor: colors.solid },
  sheetHead: { flexDirection: "row", alignItems: "center", gap: 10, padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
});
