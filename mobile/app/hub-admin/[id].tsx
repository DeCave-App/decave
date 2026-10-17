import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  Platform,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Screen } from "@/src/components/Screen";
import { API_BASE, apiErrorText, apiFetch, apiJson, type ApiErrorBody } from "@/src/lib/api";
import { useSession } from "@/src/providers/SessionProvider";
import { colors } from "@/src/theme";
import { useTranslation } from "react-i18next";
import { DEFAULT_HUB_CATEGORY } from "../../../shared/hub-categories";
import { hubCategoryField, hubCategoryInput } from "@/src/lib/hub-category";
import { dateLocale } from "@/src/lib/date-locale";
import { forgetHub, loadHubList } from "@/src/lib/hub-list-cache";
import { DiscordImportCard } from "@/src/components/hub/DiscordImportCard";

type HubRole = "owner" | "admin" | "member";
type Permission =
  | "manageRooms"
  | "moderateMessages"
  | "moderateMembers"
  | "voiceModerate"
  | "createInvites"
  | "viewAudit";

type Hub = {
  id: number;
  name: string;
  icon?: string;
  iconUrl?: string | null;
  bannerUrl?: string | null;
  chatBackgroundUrl?: string | null;
  useBannerBackground?: boolean;
  useChatBackground?: boolean;
  description?: string;
  accent?: string;
  category?: string;
  tags?: string[];
  slowModeSeconds?: number;
  visibility?: "public" | "private";
  myRole?: HubRole | null;
  channels?: Array<{ id: number; name: string; type: string; private?: boolean; category?: string }>;
};

type CustomRole = {
  id: string;
  name: string;
  color: string;
  permissions: Permission[];
};

type Member = {
  userId: string;
  username: string;
  role: HubRole;
  avatarUrl?: string | null;
  customRoleIds?: string[];
  customRoles?: CustomRole[];
};

type AuditEntry = {
  id: string;
  action: string;
  actorUserId?: string | null;
  actorUsername?: string | null;
  targetUserId?: string | null;
  targetUsername?: string | null;
  detail?: string | null;
  timestamp: string;
};

type HubAsset = {
  id: string;
  kind: "emote" | "sticker";
  name: string;
  mimeType?: string;
  url?: string;
};

type HubBot = {
  id: string;
  name: string;
  enabled: boolean;
  createdAt?: string;
};

const ROLE_PERMISSIONS: Permission[] = ["manageRooms", "moderateMessages", "moderateMembers", "voiceModerate", "createInvites", "viewAudit"];

function assetUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^(https?:|data:|file:)/i.test(value)) return value;
  return `${API_BASE}${value.startsWith("/") ? "" : "/"}${value}`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default function HubAdminScreen() {
  const { t } = useTranslation(["hub", "common"]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const permissionLabel = (key: Permission) =>
    key === "voiceModerate" ? t("hub.mobile.hubAdmin.permissions.voiceModerate")
      : key === "viewAudit" ? t("hub.mobile.hubAdmin.permissions.viewAudit")
      : key === "manageRooms" ? t("hub.manageHub.roles.permissions.manageRooms.label")
      : key === "moderateMessages" ? t("hub.manageHub.roles.permissions.moderateMessages.label")
      : key === "moderateMembers" ? t("hub.manageHub.roles.permissions.moderateMembers.label")
      : t("hub.manageHub.roles.permissions.createInvites.label");
  const hubId = Number(id);
  const { token } = useSession();

  const [hub, setHub] = useState<Hub | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [roles, setRoles] = useState<CustomRole[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [assets, setAssets] = useState<HubAsset[]>([]);
  const [bots, setBots] = useState<HubBot[]>([]);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>(DEFAULT_HUB_CATEGORY);
  const [accent, setAccent] = useState("#7c5cff");
  const [tags, setTags] = useState("");
  const [slowMode, setSlowMode] = useState("0");
  const [memberRef, setMemberRef] = useState("");

  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleColor, setNewRoleColor] = useState("#62d6ff");
  const [newRolePermissions, setNewRolePermissions] = useState<Permission[]>([]);
  const [assetName, setAssetName] = useState("");
  const [newBotName, setNewBotName] = useState("");
  const [newBotToken, setNewBotToken] = useState("");

  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [roleMenuUserId, setRoleMenuUserId] = useState<string | null>(null);
  const [auditExpanded, setAuditExpanded] = useState(false);

  const isOwner = hub?.myRole === "owner";
  const [botBuilderAvailable, setBotBuilderAvailable] = useState(false);
  const canManage = hub?.myRole === "owner" || hub?.myRole === "admin";

  const loadFeatures = useCallback(async () => {
    if (!token || !hubId) return;
    const requests = await Promise.allSettled([
      apiJson<CustomRole[]>(`/api/servers/${hubId}/roles`, {}, token),
      apiJson<AuditEntry[]>(`/api/servers/${hubId}/audit`, {}, token),
      apiJson<HubAsset[]>(`/api/servers/${hubId}/assets`, {}, token),
      apiJson<HubBot[]>(`/api/servers/${hubId}/bots`, {}, token),
      // 404 when the bot builder is off, 403 without Manage Bots: either way the entry stays hidden.
      apiJson<unknown>(`/api/servers/${hubId}/bot-builder`, {}, token),
    ]);
    setBotBuilderAvailable(requests[4].status === "fulfilled");
    if (requests[0].status === "fulfilled") setRoles(Array.isArray(requests[0].value) ? requests[0].value : []);
    if (requests[1].status === "fulfilled") setAuditLog(Array.isArray(requests[1].value) ? requests[1].value : []);
    if (requests[2].status === "fulfilled") setAssets(Array.isArray(requests[2].value) ? requests[2].value : []);
    if (requests[3].status === "fulfilled") setBots(Array.isArray(requests[3].value) ? requests[3].value : []);
  }, [token, hubId]);

  const load = useCallback(async () => {
    if (!token || !hubId) return;
    setError("");
    setAuditExpanded(false);
    try {
      const [hubData, memberData] = await Promise.all([
        apiJson<Hub>(`/api/servers/${hubId}`, {}, token),
        apiJson<Member[]>(`/api/servers/${hubId}/members`, {}, token),
      ]);
      setHub(hubData);
      setMembers(Array.isArray(memberData) ? memberData : []);
      setName(hubData.name ?? "");
      setDescription(hubData.description ?? "");
      setCategory(hubData.category ?? DEFAULT_HUB_CATEGORY);
      setAccent(/^#[0-9a-fA-F]{6}$/.test(hubData.accent ?? "") ? hubData.accent! : "#7c5cff");
      setTags((hubData.tags ?? []).join(", "));
      setSlowMode(String(Math.max(0, Math.min(120, Number(hubData.slowModeSeconds ?? 0)))));
      void loadFeatures();
    } catch (cause) {
      setError(errorMessage(cause, t("hub.mobile.hubAdmin.loadFailed")));
    }
  }, [token, hubId, loadFeatures]);

  useEffect(() => { void load(); }, [load]);

  const saveDetails = async () => {
    if (!token || !hubId || !canManage || busy || !name.trim()) return;
    setBusy("save"); setError(""); setNotice("");
    try {
      await apiJson(`/api/servers/${hubId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), icon: hub?.icon ?? name.trim().slice(0, 1).toUpperCase() }),
      }, token);
      await apiJson(`/api/servers/${hubId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: description.trim(),
          accent: /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : "#7c5cff",
          category: category.trim() || DEFAULT_HUB_CATEGORY,
          tags: tags.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 6),
          slowModeSeconds: Math.max(0, Math.min(120, Number(slowMode) || 0)),
        }),
      }, token);
      setNotice(t("hub.mobile.hubAdmin.hubSettingsUpdated"));
      await load();
    } catch (cause) {
      setError(errorMessage(cause, t("hub.mobile.hubAdmin.updateFailed")));
    } finally { setBusy(""); }
  };

  const setVisibility = async (visibility: "public" | "private") => {
    if (!token || !isOwner) return;
    setBusy("visibility"); setError("");
    try {
      await apiJson(`/api/servers/${hubId}/visibility`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility }),
      }, token);
      await load();
    } catch (cause) {
      setError(errorMessage(cause, t("hub.mobile.hubAdmin.visibilityFailed")));
    } finally { setBusy(""); }
  };

  const addMember = async () => {
    if (!token || !isOwner || !memberRef.trim()) return;
    setBusy("add-member"); setError("");
    try {
      await apiJson(`/api/servers/${hubId}/members/${encodeURIComponent(memberRef.trim())}`, { method: "PUT" }, token);
      setMemberRef("");
      setNotice(t("hub.mobile.hubAdmin.memberAdded"));
      await load();
    } catch (cause) {
      setError(errorMessage(cause, t("hub.mobile.hubAdmin.addMemberFailed")));
    } finally { setBusy(""); }
  };

  const setRole = (member: Member, role: "admin" | "member") => {
    if (!token || !isOwner) return;
    const promoting = role === "admin";
    Alert.alert(
      promoting ? t("hub.mobile.hubAdmin.makeUsernameAnAdmin", { username: member.username }) : t("hub.mobile.hubAdmin.removeAdminAccessFromUsername", { username: member.username }),
      promoting
        ? t("hub.mobile.hubAdmin.adminsCanManageRoomsAnd")
        : t("hub.mobile.hubAdmin.theyWillBecomeARegular"),
      [
        { text: t("common.actions.cancel"), style: "cancel" },
        {
          text: promoting ? t("hub.mobile.hubAdmin.makeAdmin") : t("hub.mobile.hubAdmin.removeAdmin"),
          style: promoting ? "default" : "destructive",
          onPress: () => void (async () => {
            setBusy(`role:${member.userId}`); setError("");
            try {
              await apiJson(`/api/servers/${hubId}/members/${encodeURIComponent(member.userId)}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ role }),
              }, token);
              await load();
            } catch (cause) {
              setError(errorMessage(cause, t("hub.mobile.hubAdmin.roleFailed")));
            } finally { setBusy(""); }
          })(),
        },
      ],
    );
  };

  const removeMember = (member: Member) => Alert.alert(
    t("hub.mobile.hubAdmin.removeMember"),
    t("hub.mobile.hubAdmin.removeUsernameFromThisHub", { username: member.username }),
    [
      { text: t("common.actions.cancel"), style: "cancel" },
      { text: t("common.actions.remove"), style: "destructive", onPress: () => void (async () => {
        if (!token || !canManage) return;
        setBusy(`remove:${member.userId}`);
        try {
          await apiJson(`/api/servers/${hubId}/members/${encodeURIComponent(member.userId)}`, { method: "DELETE" }, token);
          await load();
        } catch (cause) {
          setError(errorMessage(cause, t("hub.mobile.hubAdmin.removeMemberFailed")));
        } finally { setBusy(""); }
      })() },
    ],
  );

  const moderateMember = (member: Member, action: "kick" | "ban" | "timeout") => {
    const label = action === "timeout" ? t("hub.mobile.hubAdmin.moderation.timeout") : action === "kick" ? t("hub.mobile.hubAdmin.kick") : t("hub.mobile.hubAdmin.ban");
    const title = action === "timeout"
      ? t("hub.mobile.hubAdmin.moderation.timeoutConfirm", { username: member.username })
      : action === "kick" ? t("hub.mobile.hubAdmin.moderation.kickConfirm", { username: member.username }) : t("hub.mobile.hubAdmin.moderation.banConfirm", { username: member.username });
    Alert.alert(title, action === "ban" ? t("hub.mobile.hubAdmin.thisRemovesTheMemberAnd") : t("hub.mobile.hubAdmin.thisActionIsRecordedIn"), [
      { text: t("common.actions.cancel"), style: "cancel" },
      { text: label, style: action === "timeout" ? "default" : "destructive", onPress: () => void (async () => {
        if (!token) return;
        setBusy(`${action}:${member.userId}`); setError("");
        try {
          await apiJson(`/api/servers/${hubId}/members/${encodeURIComponent(member.userId)}/${action}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(action === "timeout" ? { minutes: 10 } : { reason: "Mobile Hub moderation" }),
          }, token);
          await load();
        } catch (cause) {
          setError(errorMessage(cause, action === "timeout" ? t("hub.mobile.hubAdmin.moderation.timeoutFailed") : action === "kick" ? t("hub.mobile.hubAdmin.moderation.kickFailed") : t("hub.mobile.hubAdmin.moderation.banFailed")));
        } finally { setBusy(""); }
      })() },
    ]);
  };

  const createOneTimeInvite = async () => {
    if (!token || !canManage) return;
    setBusy("invite"); setError("");
    try {
      const data = await apiJson<Record<string, unknown>>(`/api/servers/${hubId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresHours: 24, maxUses: 1 }),
      }, token);
      const nested = data.invite && typeof data.invite === "object" ? data.invite as Record<string, unknown> : null;
      const raw = String(data.url ?? data.inviteUrl ?? data.code ?? nested?.url ?? nested?.code ?? "");
      if (!raw) throw new Error(t("hub.mobile.hubAdmin.inviteWasCreatedButThe"));
      const value = /^https?:/i.test(raw) ? raw : `https://app.de-cave.com/join/hub/${encodeURIComponent(raw)}`;
      await Share.share({ title: hub?.name ? t("hub.mobile.hubAdmin.inviteTitle", { hub: hub.name }) : t("hub.mobile.hubAdmin.inviteTitleFallback"), message: value });
      setNotice(t("hub.mobile.hubAdmin.oneTimeInviteCreated24"));
    } catch (cause) {
      setError(errorMessage(cause, t("hub.mobile.hubAdmin.inviteFailed")));
    } finally { setBusy(""); }
  };

  const setMediaShown = async (kind: "banner" | "chat-background", value: boolean) => {
    if (!token || !isOwner) return;
    setBusy(`show:${kind}`); setError("");
    try {
      await apiJson(`/api/servers/${hubId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind === "banner" ? { useBannerBackground: value } : { useChatBackground: value }),
      }, token);
      await load();
    } catch (cause) {
      setError(errorMessage(cause, t("hub.mobile.hubAdmin.artworkFailed")));
    } finally { setBusy(""); }
  };

  const removeMedia = (kind: "banner" | "chat-background") => {
    if (!token || !isOwner) return;
    Alert.alert(kind === "banner" ? t("hub.mobile.hubAdmin.removeBanner") : t("hub.mobile.hubAdmin.removeChatBackground"), t("hub.mobile.hubAdmin.theImageIsDeletedAnd"), [
      { text: t("common.actions.cancel"), style: "cancel" },
      { text: t("common.actions.remove"), style: "destructive", onPress: () => void (async () => {
        setBusy(`media-remove:${kind}`); setError("");
        try {
          await apiJson(`/api/servers/${hubId}/media/${kind}`, { method: "DELETE" }, token);
          setNotice(kind === "banner" ? t("hub.mobile.hubAdmin.sidebarBannerRemoved") : t("hub.mobile.hubAdmin.chatBackgroundRemoved"));
          await load();
        } catch (cause) {
          setError(errorMessage(cause, kind === "banner" ? t("hub.mobile.hubAdmin.removeBannerFailed") : t("hub.mobile.hubAdmin.removeChatBackgroundFailed")));
        } finally { setBusy(""); }
      })() },
    ]);
  };

  const uploadMedia = async (kind: "icon" | "banner" | "chat-background") => {
    if (!token || !isOwner) return;
    setError("");
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError(t("hub.mobile.hubAdmin.photoLibraryPermissionIsRequired")); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: kind === "icon" ? [1, 1] : kind === "banner" ? [3, 5] : [16, 9],
      quality: 0.9,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const mime = asset.mimeType || "image/jpeg";
    const local = await fetch(asset.uri);
    const blob = await local.blob();
    const limit = kind === "icon" ? 3 * 1024 * 1024 : 8 * 1024 * 1024;
    if (blob.size > limit) { setError(kind === "icon" ? t("hub.actions.media.iconTooLarge") : kind === "banner" ? t("hub.actions.media.bannerTooLarge") : t("hub.actions.media.chatBackgroundTooLarge")); return; }
    setBusy(`media:${kind}`);
    try {
      const response = await apiFetch(`/api/servers/${hubId}/media/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "X-File-Type": mime },
        body: blob as any,
      }, token);
      const data = await response.json().catch(() => ({})) as ApiErrorBody;
      if (!response.ok) throw new Error(apiErrorText(data, t("hub.mobile.hubAdmin.couldNotUploadHubImage")));
      setNotice(kind === "icon" ? t("hub.mobile.hubAdmin.iconUpdated") : kind === "banner" ? t("hub.mobile.hubAdmin.bannerUpdated") : t("hub.mobile.hubAdmin.chatBackgroundUpdated"));
      await load();
    } catch (cause) {
      setError(errorMessage(cause, t("hub.mobile.hubAdmin.uploadImageFailed")));
    } finally { setBusy(""); }
  };

  const toggleRolePermission = (permission: Permission) => {
    setNewRolePermissions((current) => current.includes(permission) ? current.filter((item) => item !== permission) : [...current, permission]);
  };

  const createCustomRole = async () => {
    if (!token || !isOwner || !newRoleName.trim()) return;
    setBusy("create-role"); setError("");
    try {
      await apiJson(`/api/servers/${hubId}/roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newRoleName.trim(),
          color: /^#[0-9a-fA-F]{6}$/.test(newRoleColor) ? newRoleColor : "#62d6ff",
          permissions: newRolePermissions,
        }),
      }, token);
      setNewRoleName(""); setNewRolePermissions([]);
      await loadFeatures();
    } catch (cause) {
      setError(errorMessage(cause, t("hub.mobile.hubAdmin.createRoleFailed")));
    } finally { setBusy(""); }
  };

  const toggleMemberCustomRole = async (member: Member, roleId: string) => {
    if (!token || !isOwner) return;
    const current = member.customRoleIds ?? [];
    const next = current.includes(roleId) ? current.filter((idValue) => idValue !== roleId) : [...current, roleId].slice(0, 8);
    setBusy(`custom:${member.userId}:${roleId}`); setError("");
    try {
      await apiJson(`/api/servers/${hubId}/members/${encodeURIComponent(member.userId)}/custom-roles`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleIds: next }),
      }, token);
      await load();
    } catch (cause) {
      setError(errorMessage(cause, t("hub.mobile.hubAdmin.assignRoleFailed")));
    } finally { setBusy(""); }
  };

  const uploadAsset = async (kind: "emote" | "sticker") => {
    if (!token || !canManage) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError(t("hub.mobile.hubAdmin.photoLibraryPermissionIsRequired")); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
    if (result.canceled || !result.assets[0]) return;
    const file = result.assets[0];
    const mime = file.mimeType || "image/png";
    const source = await fetch(file.uri);
    const blob = await source.blob();
    const limit = kind === "emote" ? 1024 * 1024 : 5 * 1024 * 1024;
    if (blob.size > limit) { setError(kind === "emote" ? t("hub.mobile.hubAdmin.emoteTooLarge") : t("hub.mobile.hubAdmin.stickerTooLarge")); return; }
    setBusy(`asset:${kind}`); setError("");
    try {
      const response = await apiFetch(`/api/servers/${hubId}/assets/${kind}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-File-Type": mime,
          "X-Asset-Name": encodeURIComponent(assetName.trim() || file.fileName?.replace(/\.[^.]+$/, "") || "custom"),
        },
        body: blob as any,
      }, token);
      const data = await response.json().catch(() => ({})) as ApiErrorBody;
      if (!response.ok) throw new Error(apiErrorText(data, kind === "emote" ? t("hub.mobile.hubAdmin.uploadEmoteFailed") : t("hub.mobile.hubAdmin.uploadStickerFailed")));
      setAssetName("");
      await loadFeatures();
    } catch (cause) {
      setError(errorMessage(cause, kind === "emote" ? t("hub.mobile.hubAdmin.uploadEmoteFailed") : t("hub.mobile.hubAdmin.uploadStickerFailed")));
    } finally { setBusy(""); }
  };

  const deleteAsset = (asset: HubAsset) => Alert.alert(t("hub.mobile.hubAdmin.deleteAsset"), t("hub.mobile.hubAdmin.deleteName", { name: asset.name }), [
    { text: t("common.actions.cancel"), style: "cancel" },
    { text: t("common.actions.delete"), style: "destructive", onPress: () => void (async () => {
      if (!token) return;
      setBusy(`asset-delete:${asset.id}`);
      try {
        await apiJson(`/api/servers/${hubId}/assets/${encodeURIComponent(asset.id)}`, { method: "DELETE" }, token);
        await loadFeatures();
      } catch (cause) { setError(errorMessage(cause, t("hub.mobile.hubAdmin.deleteAssetFailed"))); }
      finally { setBusy(""); }
    })() },
  ]);

  const createBot = async () => {
    if (!token || !isOwner || !newBotName.trim()) return;
    setBusy("create-bot"); setError(""); setNewBotToken("");
    try {
      const data = await apiJson<HubBot & { token?: string }>(`/api/servers/${hubId}/bots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newBotName.trim() }),
      }, token);
      setNewBotName("");
      setNewBotToken(data.token ?? "");
      await loadFeatures();
    } catch (cause) {
      setError(errorMessage(cause, t("hub.mobile.hubAdmin.createBotFailed")));
    } finally { setBusy(""); }
  };

  const toggleBot = async (bot: HubBot) => {
    if (!token || !isOwner) return;
    setBusy(`bot:${bot.id}`);
    try {
      await apiJson(`/api/servers/${hubId}/bots/${encodeURIComponent(bot.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !bot.enabled }),
      }, token);
      await loadFeatures();
    } catch (cause) { setError(errorMessage(cause, t("hub.mobile.hubAdmin.updateBotFailed"))); }
    finally { setBusy(""); }
  };

  const deleteHub = () => {
    if (!token || !hub || !isOwner || busy) return;
    const target = hub;
    Alert.alert(t("hub.manageHub.danger.delete"), t("hub.actions.delete.confirm", { name: target.name }), [
      { text: t("common.actions.cancel"), style: "cancel" },
      { text: t("common.actions.delete"), style: "destructive", onPress: () => void (async () => {
        setBusy("hub-delete");
        setError("");
        try {
          await apiJson(`/api/servers/${target.id}`, { method: "DELETE" }, token);
          forgetHub(token, target.id);
          void loadHubList("mine", token).catch(() => undefined);
          router.replace("/(tabs)/hubs" as any);
        } catch (cause) { setError(errorMessage(cause, t("hub.mobile.hubAdmin.deleteHubFailed"))); }
        finally { setBusy(""); }
      })() },
    ]);
  };

  const deleteBot = (bot: HubBot) => Alert.alert(t("hub.mobile.hubAdmin.deleteBot"), t("hub.mobile.hubAdmin.deleteName", { name: bot.name }), [
    { text: t("common.actions.cancel"), style: "cancel" },
    { text: t("common.actions.delete"), style: "destructive", onPress: () => void (async () => {
      if (!token || !isOwner) return;
      setBusy(`bot-delete:${bot.id}`);
      try {
        await apiJson(`/api/servers/${hubId}/bots/${encodeURIComponent(bot.id)}`, { method: "DELETE" }, token);
        await loadFeatures();
      } catch (cause) { setError(errorMessage(cause, t("hub.mobile.hubAdmin.deleteBotFailed"))); }
      finally { setBusy(""); }
    })() },
  ]);

  const sortedMembers = useMemo(() => [...members].sort((a, b) => {
    const rank: Record<HubRole, number> = { owner: 0, admin: 1, member: 2 };
    return rank[a.role] - rank[b.role] || a.username.localeCompare(b.username);
  }), [members]);

  if (!hub) {
    return <Screen><View style={styles.loading}><Text style={styles.muted}>{error || t("hub.mobile.hubAdmin.loadingHubManagement")}</Text></View></Screen>;
  }

  return (
    <Screen>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.actions.back")} style={styles.back} onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.cyan} /></Pressable>
        <View style={{ flex: 1 }}><Text maxFontSizeMultiplier={1.3} style={styles.kicker}>{t("hub.mobile.hubAdmin.hubControl")}</Text><Text style={styles.title} numberOfLines={1}>{t("hub.mobile.hubAdmin.manageName", { name: hub.name })}</Text><Text style={styles.roleLine}>{(hub.myRole ?? "member").toUpperCase()}</Text></View>
        <Ionicons name="construct-outline" size={21} color={colors.cyan} />
      </View>

      <ScrollView keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Section title={t("hub.mobile.hubAdmin.hubProfileDiscovery")}>
          <View style={styles.mediaRow}>
            <View style={styles.hubImage}>{assetUrl(hub.iconUrl) ? <Image source={{ uri: assetUrl(hub.iconUrl)! }} style={styles.hubImageFill} /> : <Text style={styles.hubInitial}>{(hub.name || "H").slice(0, 1).toUpperCase()}</Text>}</View>
            <View style={{ flex: 1, gap: 7 }}>
              <Pressable accessibilityRole="button" style={styles.smallButton} disabled={!isOwner || !!busy} onPress={() => void uploadMedia("icon")}><Ionicons name="image-outline" size={15} color={colors.cyan} /><Text style={styles.smallButtonText}>{t("hub.mobile.hubAdmin.changeHubImage")}</Text></Pressable>
            </View>
          </View>
          <MediaCard
            title={t("hub.manageHub.media.banner.title")}
            hint={t("hub.mobile.hubAdmin.fillsTheHubSidebarBehind")}
            shape="tall"
            url={assetUrl(hub.bannerUrl)}
            emptyLabel={t("hub.manageHub.media.banner.none")}
            addLabel={t("hub.manageHub.media.banner.add")}
            shown={hub.useBannerBackground === true}
            note={hub.bannerUrl ? t("hub.mobile.hubAdmin.bannerNote") : t("hub.mobile.hubAdmin.bannerNoteEmpty")}
            editable={isOwner}
            busy={!!busy}
            uploading={busy === "media:banner"}
            onChange={() => void uploadMedia("banner")}
            onRemove={() => removeMedia("banner")}
            onToggle={(value) => void setMediaShown("banner", value)}
          />
          <MediaCard
            title={t("hub.manageHub.media.chat.title")}
            hint={t("hub.mobile.hubAdmin.behindTheMessageListDimmed")}
            shape="wide"
            url={assetUrl(hub.chatBackgroundUrl)}
            emptyLabel={t("hub.manageHub.media.chat.none")}
            addLabel={t("hub.manageHub.media.chat.add")}
            shown={hub.useChatBackground === true}
            note={hub.chatBackgroundUrl ? t("hub.mobile.hubAdmin.chatNote") : t("hub.mobile.hubAdmin.chatNoteEmpty")}
            editable={isOwner}
            busy={!!busy}
            uploading={busy === "media:chat-background"}
            onChange={() => void uploadMedia("chat-background")}
            onRemove={() => removeMedia("chat-background")}
            onToggle={(value) => void setMediaShown("chat-background", value)}
          />
          <Field label={t("hub.createHub.nameLabel")} value={name} onChangeText={setName} />
          <Field label={t("hub.manageHub.profile.description")} value={description} onChangeText={setDescription} multiline />
          <Field label={t("hub.manageHub.profile.category")} value={hubCategoryField(category)} onChangeText={(text) => setCategory(hubCategoryInput(text))} />
          <Field label={t("hub.mobile.hubAdmin.accentRrggbb")} value={accent} onChangeText={setAccent} autoCapitalize="none" />
          <Field label={t("hub.mobile.hubAdmin.tagsCommaSeparatedMax6")} value={tags} onChangeText={setTags} />
          <Field label={t("hub.mobile.hubAdmin.slowModeSeconds0120")} value={slowMode} onChangeText={setSlowMode} keyboardType="number-pad" />
          {isOwner && <View style={styles.visibility}>
            <Pressable accessibilityRole="button" style={[styles.choice, hub.visibility === "public" && styles.choiceActive]} onPress={() => void setVisibility("public")}><Ionicons name="globe-outline" size={15} color={colors.cyan} /><Text style={styles.choiceText}>{t("hub.createHub.visibility.public.title")}</Text></Pressable>
            <Pressable accessibilityRole="button" style={[styles.choice, hub.visibility === "private" && styles.choiceActive]} onPress={() => void setVisibility("private")}><Ionicons name="lock-closed-outline" size={15} color={colors.cyan} /><Text style={styles.choiceText}>{t("hub.sidebar.private")}</Text></Pressable>
          </View>}
        </Section>

        <Section title={t("hub.mobile.hubAdmin.roomsPrivateAccess")}>
          <Pressable accessibilityRole="button" style={styles.actionRow} onPress={() => router.replace(`/hub/${hubId}` as any)}>
            <Ionicons name="grid-outline" size={19} color={colors.cyan} />
            <View style={{ flex: 1 }}><Text style={styles.actionTitle}>{t("hub.manageHub.roles.permissions.manageRooms.label")}</Text><Text style={styles.muted}>{t("hub.mobile.hubAdmin.createEditReorderOrDelete")}</Text></View>
            <Ionicons name="chevron-forward" size={18} color={colors.faint} />
          </Pressable>
        </Section>

        {botBuilderAvailable && (
          <Section title={t("hub.mobile.hubAdmin.botBuilder")}>
            <Pressable accessibilityRole="button" style={styles.actionRow} onPress={() => router.push(`/hub-bots/${hubId}` as any)}>
              <Ionicons name="sparkles-outline" size={19} color={colors.cyan} />
              <View style={{ flex: 1 }}><Text style={styles.actionTitle}>{t("hub.manageHub.nav.bots.label")}</Text><Text style={styles.muted}>{t("hub.mobile.hubAdmin.turnBotsOnOrOff")}</Text></View>
              <Ionicons name="chevron-forward" size={18} color={colors.faint} />
            </Pressable>
          </Section>
        )}

        <Section title={t("hub.mobile.hubAdmin.invites")}>
          <Pressable accessibilityRole="button" style={styles.actionRow} disabled={!canManage || !!busy} onPress={() => void createOneTimeInvite()}>
            <Ionicons name="link-outline" size={19} color={colors.cyan} />
            <View style={{ flex: 1 }}><Text style={styles.actionTitle}>{t("hub.mobile.hubAdmin.createOneTimeInvite")}</Text><Text style={styles.muted}>{t("hub.mobile.hubAdmin.expiresAfter24HoursAnd")}</Text></View>
            <Ionicons name="share-outline" size={18} color={colors.cyan} />
          </Pressable>
        </Section>

        <Section title={t("hub.mobile.hubAdmin.membersCount", { count: members.length })}>
          {isOwner && <View style={styles.addRow}><TextInput value={memberRef} onChangeText={setMemberRef} placeholder={t("hub.mobile.hubAdmin.usernameOrDecaveId")} placeholderTextColor={colors.faint} style={[styles.input, { flex: 1 }]} autoCapitalize="none" /><Pressable accessibilityRole="button" accessibilityLabel={t("hub.mobile.hubAdmin.addMember")} style={styles.plus} disabled={!!busy} onPress={() => void addMember()}><Ionicons name="person-add-outline" size={18} color="#061018" /></Pressable></View>}
          {sortedMembers.map((member) => (
            <View key={member.userId} style={styles.memberBlock}>
              <View style={styles.member}>
                <View style={styles.memberAvatar}>{assetUrl(member.avatarUrl) ? <Image source={{ uri: assetUrl(member.avatarUrl)! }} style={styles.hubImageFill} /> : <Text style={styles.memberAvatarText}>{member.username.slice(0, 1).toUpperCase()}</Text>}</View>
                <View style={{ flex: 1, minWidth: 0 }}><Text style={styles.memberName} numberOfLines={1}>{member.username}</Text><Text style={styles.memberRole}>{member.role.toUpperCase()}</Text></View>
                {isOwner && member.role !== "owner" && <Pressable style={[styles.roleSelect, roleMenuUserId === member.userId && styles.roleSelectOpen]} disabled={!!busy} accessibilityRole="button" accessibilityLabel={t("hub.mobile.hubAdmin.changeUsernameSRoleCurrent", { username: member.username, role: member.role })} accessibilityState={{ expanded: roleMenuUserId === member.userId }} onPress={() => setRoleMenuUserId((current) => current === member.userId ? null : member.userId)}><Text style={styles.roleSelectText}>{member.role === "admin" ? t("hub.manageHub.members.roles.admin") : t("hub.manageHub.members.columns.member")}</Text><Ionicons name={roleMenuUserId === member.userId ? "chevron-up" : "chevron-down"} size={13} color={colors.cyan} /></Pressable>}
                {canManage && member.role !== "owner" && <Pressable accessibilityRole="button" accessibilityLabel={t("hub.mobile.hubAdmin.removeUsername", { username: member.username })} style={styles.iconButtonDanger} disabled={!!busy} onPress={() => removeMember(member)}><Ionicons name="trash-outline" size={16} color={colors.red} /></Pressable>}
              </View>
              {isOwner && member.role !== "owner" && roleMenuUserId === member.userId && <View style={styles.roleDropdown} accessibilityRole="menu">
                {(["member", "admin"] as const).map((role) => { const selected = member.role === role; return <Pressable key={role} style={[styles.roleOption, selected && styles.roleOptionSelected]} disabled={!!busy} accessibilityRole="menuitem" accessibilityState={{ selected }} onPress={() => { setRoleMenuUserId(null); if (!selected) setRole(member, role); }}><Text style={[styles.roleOptionText, selected && styles.roleOptionTextSelected]}>{role === "admin" ? t("hub.manageHub.members.roles.admin") : t("hub.manageHub.members.columns.member")}</Text>{selected && <Ionicons name="checkmark" size={14} color={colors.cyan} />}</Pressable>; })}
              </View>}
              {member.role !== "owner" && <View style={styles.moderationRow}>
                <Pressable accessibilityRole="button" style={styles.miniAction} disabled={!!busy} onPress={() => moderateMember(member, "timeout")}><Text style={styles.miniActionText}>{t("hub.mobile.hubAdmin.n10mTimeout")}</Text></Pressable>
                <Pressable accessibilityRole="button" style={styles.miniAction} disabled={!!busy} onPress={() => moderateMember(member, "kick")}><Text style={styles.miniActionText}>{t("hub.mobile.hubAdmin.kick")}</Text></Pressable>
                <Pressable accessibilityRole="button" style={[styles.miniAction, styles.miniDanger]} disabled={!!busy} onPress={() => moderateMember(member, "ban")}><Text style={[styles.miniActionText, { color: colors.red }]}>{t("hub.mobile.hubAdmin.ban")}</Text></Pressable>
              </View>}
              {isOwner && roles.length > 0 && member.role !== "owner" && <View style={styles.chips}>{roles.map((role) => { const active=(member.customRoleIds ?? []).includes(role.id); return <Pressable accessibilityRole="button" key={role.id} style={[styles.chip, active && styles.chipActive]} disabled={!!busy} onPress={() => void toggleMemberCustomRole(member, role.id)}><View style={[styles.roleDot,{backgroundColor:role.color}]} /><Text style={[styles.chipText,active&&styles.chipTextActive]}>{role.name}</Text></Pressable>; })}</View>}
            </View>
          ))}
        </Section>

        {isOwner && <Section title={t("hub.mobile.hubAdmin.customRoles")}>
          <View style={styles.twoFields}><View style={{ flex: 1 }}><Field label={t("hub.mobile.hubAdmin.roleName")} value={newRoleName} onChangeText={setNewRoleName} /></View><View style={{ width: 115 }}><Field label={t("hub.manageHub.roles.color")} value={newRoleColor} onChangeText={setNewRoleColor} autoCapitalize="none" /></View></View>
          <View style={styles.chips}>{ROLE_PERMISSIONS.map((key) => { const label = permissionLabel(key); const active=newRolePermissions.includes(key); return <Pressable accessibilityRole="button" key={key} style={[styles.chip,active&&styles.chipActive]} onPress={() => toggleRolePermission(key)}><Text style={[styles.chipText,active&&styles.chipTextActive]}>{label}</Text></Pressable>; })}</View>
          <Pressable accessibilityRole="button" style={styles.primary} disabled={!!busy || !newRoleName.trim()} onPress={() => void createCustomRole()}><Text style={styles.primaryText}>{t("hub.manageHub.roles.create")}</Text></Pressable>
          {roles.map((role) => <View key={role.id} style={styles.simpleRow}><View style={[styles.roleDot,{backgroundColor:role.color}]} /><View style={{ flex: 1 }}><Text style={styles.actionTitle}>{role.name}</Text><Text style={styles.muted}>{role.permissions.length ? role.permissions.join(" · ") : t("hub.mobile.hubAdmin.noExtraPermissions")}</Text></View></View>)}
        </Section>}

        {canManage && <Section title={t("hub.mobile.hubAdmin.emotesStickers")}>
          <Field label={t("hub.mobile.hubAdmin.assetNameOptional")} value={assetName} onChangeText={setAssetName} autoCapitalize="none" />
          <View style={styles.visibility}><Pressable accessibilityRole="button" style={styles.choice} disabled={!!busy} onPress={() => void uploadAsset("emote")}><Ionicons name="happy-outline" size={16} color={colors.cyan} /><Text style={styles.choiceText}>{t("hub.manageHub.moderation.uploadEmote")}</Text></Pressable><Pressable accessibilityRole="button" style={styles.choice} disabled={!!busy} onPress={() => void uploadAsset("sticker")}><Ionicons name="sparkles-outline" size={16} color={colors.cyan} /><Text style={styles.choiceText}>{t("hub.manageHub.moderation.uploadSticker")}</Text></Pressable></View>
          {assets.length === 0 ? <Text style={styles.muted}>{t("hub.mobile.hubAdmin.noCustomAssets")}</Text> : assets.map((asset) => <View key={asset.id} style={styles.simpleRow}><View style={{ flex: 1 }}><Text style={styles.actionTitle}>{asset.name}</Text><Text style={styles.muted}>{asset.kind.toUpperCase()}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={t("hub.mobile.hubAdmin.deleteAsset2")} style={styles.iconButtonDanger} onPress={() => deleteAsset(asset)}><Ionicons name="trash-outline" size={16} color={colors.red} /></Pressable></View>)}
        </Section>}

        {isOwner && <Section title={t("hub.mobile.hubAdmin.hubBots")}>
          <View style={styles.addRow}><TextInput value={newBotName} onChangeText={setNewBotName} placeholder={t("hub.mobile.hubAdmin.botName")} placeholderTextColor={colors.faint} style={[styles.input,{flex:1}]} /><Pressable accessibilityRole="button" accessibilityLabel={t("hub.mobile.hubAdmin.createBot")} style={styles.plus} disabled={!!busy || !newBotName.trim()} onPress={() => void createBot()}><Ionicons name="add" size={20} color="#061018" /></Pressable></View>
          {!!newBotToken && <View style={styles.tokenBox}><Text style={styles.tokenTitle}>{t("hub.mobile.hubAdmin.copyThisTokenNowIt")}</Text><Text selectable style={styles.tokenText}>{newBotToken}</Text></View>}
          {bots.length === 0 ? <Text style={styles.muted}>{t("hub.mobile.hubAdmin.noHubBots")}</Text> : bots.map((bot) => <View key={bot.id} style={styles.simpleRow}><Ionicons name="hardware-chip-outline" size={17} color={bot.enabled?colors.green:colors.muted} /><View style={{flex:1}}><Text style={styles.actionTitle}>{bot.name}</Text><Text style={styles.muted}>{bot.enabled?t("hub.mobile.hubAdmin.enabled"):t("hub.mobile.hubAdmin.disabled")}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={bot.enabled ? t("hub.mobile.hubAdmin.pauseName", { name: bot.name }) : t("hub.mobile.hubAdmin.resumeName", { name: bot.name })} style={styles.iconButton} onPress={() => void toggleBot(bot)}><Ionicons name={bot.enabled?"pause-outline":"play-outline"} size={16} color={colors.cyan}/></Pressable><Pressable accessibilityRole="button" accessibilityLabel={t("hub.mobile.hubAdmin.deleteName2", { name: bot.name })} style={styles.iconButtonDanger} onPress={() => deleteBot(bot)}><Ionicons name="trash-outline" size={16} color={colors.red}/></Pressable></View>)}
        </Section>}

        {canManage && token && <Section title={t("hub.manageHub.importDiscord.title")}>
          <DiscordImportCard
            hubId={hubId}
            token={token}
            existingRooms={(hub.channels ?? []).map((room) => ({ id: room.id, name: room.name, type: room.type, category: room.category ?? "GENERAL" }))}
            existingRoles={roles.map((role) => ({ id: role.id, name: role.name, color: role.color }))}
            onChanged={() => void load()}
          />
        </Section>}

        {auditLog.length > 0 && <Section title={t("hub.mobile.hubAdmin.auditLog")}>
          <Pressable style={styles.auditToggle} accessibilityRole="button" accessibilityState={{ expanded: auditExpanded }} onPress={() => setAuditExpanded((value) => !value)}>
            <View style={styles.auditToggleIcon}><Ionicons name="document-text-outline" size={16} color={colors.cyan} /></View>
            <View style={{ flex: 1 }}><Text style={styles.actionTitle}>{t("hub.manageHub.roles.permissions.viewAudit.label")}</Text><Text style={styles.muted}>{t("hub.mobile.hubAdmin.recentEvents", { count: auditLog.length })}</Text></View>
            <Ionicons name={auditExpanded ? "chevron-up" : "chevron-down"} size={17} color={colors.faint} />
          </Pressable>
          {auditExpanded && auditLog.slice(0, 30).map((entry) => <View key={entry.id} style={styles.auditRow}><Text style={styles.actionTitle}>{entry.action}</Text><Text style={styles.muted}>{entry.actorUsername || entry.actorUserId || t("hub.mobile.hubAdmin.system")}{entry.targetUsername ? ` → ${entry.targetUsername}` : ""}{entry.detail ? ` · ${entry.detail}` : ""}</Text><Text style={styles.auditTime}>{new Date(entry.timestamp).toLocaleString(dateLocale())}</Text></View>)}
        </Section>}

        {isOwner && <Section title={t("hub.manageHub.nav.danger.label")}>
          <Pressable accessibilityRole="button" style={styles.actionRow} disabled={!!busy} onPress={deleteHub}>
            <View style={styles.iconButtonDanger}><Ionicons name="trash-outline" size={16} color={colors.red} /></View>
            <View style={{ flex: 1 }}><Text style={[styles.actionTitle, { color: colors.red }]}>{t("hub.manageHub.danger.delete")}</Text><Text style={styles.muted}>{t("hub.manageHub.danger.description")}</Text></View>
            {busy === "hub-delete" && <ActivityIndicator color={colors.red} />}
          </Pressable>
        </Section>}

        {!!notice && <Text style={styles.notice}>{notice}</Text>}
        {!!error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
      <View style={styles.saveFooter}>
        <Pressable accessibilityRole="button" style={styles.primary} disabled={!canManage || !!busy} onPress={() => void saveDetails()}><Text style={styles.primaryText}>{busy === "save" ? t("common.status.saving") : t("hub.mobile.hubAdmin.saveHubSettings")}</Text></Pressable>
      </View>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <View style={styles.section}><View style={styles.sectionHead} accessibilityRole="header"><Text maxFontSizeMultiplier={1.3} style={styles.sectionTitle}>{title}</Text><View style={styles.sectionRule} /></View><View style={styles.card}>{children}</View></View>;
}

function MediaCard({ title, hint, shape, url, emptyLabel, addLabel, shown, note, editable, busy, uploading, onChange, onRemove, onToggle }: {
  title: string;
  hint: string;
  shape: "tall" | "wide";
  url: string | null;
  emptyLabel: string;
  addLabel: string;
  shown: boolean;
  note: string;
  editable: boolean;
  busy: boolean;
  uploading: boolean;
  onChange: () => void;
  onRemove: () => void;
  onToggle: (value: boolean) => void;
}) {
  const { t } = useTranslation(["hub", "common"]);
  return (
    <View style={styles.mediaCard}>
      <View style={styles.mediaHead}>
        <View style={[styles.mediaPreview, shape === "tall" ? styles.mediaPreviewTall : styles.mediaPreviewWide]}>
          {url ? <Image source={{ uri: url }} style={styles.hubImageFill} resizeMode="cover" accessibilityLabel={t("hub.mobile.hubAdmin.mediaCurrent", { item: title.toLowerCase() })} /> : <Text style={styles.mediaEmpty}>{emptyLabel}</Text>}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.actionTitle}>{title}</Text>
          <Text style={styles.mediaHint}>{hint}</Text>
        </View>
      </View>
      <View style={styles.mediaActions}>
        <Pressable accessibilityRole="button" style={styles.mediaButton} disabled={!editable || busy} onPress={onChange}>
          <Ionicons name="image-outline" size={15} color={colors.cyan} />
          <Text style={styles.smallButtonText}>{uploading ? t("hub.manageHub.uploading") : url ? t("hub.manageHub.media.change") : addLabel}</Text>
        </Pressable>
        {!!url && <Pressable accessibilityRole="button" accessibilityLabel={t("hub.mobile.hubAdmin.mediaRemove", { item: title.toLowerCase() })} style={styles.mediaRemove} disabled={!editable || busy} onPress={onRemove}>
          <Text style={styles.mediaRemoveText}>{t("common.actions.remove")}</Text>
        </Pressable>}
        <View style={{ flex: 1 }} />
        <Text style={styles.mediaShow}>{t("hub.manageHub.media.show")}</Text>
        <Switch
          accessibilityLabel={t("hub.mobile.hubAdmin.mediaShow", { item: title.toLowerCase() })}
          value={shown && !!url}
          disabled={!editable || busy || !url}
          onValueChange={onToggle}
          trackColor={{ false: colors.panel2, true: colors.cyan }}
        />
      </View>
      <Text style={styles.mediaNote}>{note}</Text>
    </View>
  );
}

function Field({ label, value, onChangeText, multiline=false, autoCapitalize="sentences", keyboardType="default" }: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  multiline?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  keyboardType?: "default" | "number-pad";
}) {
  return <View style={{ gap: 5 }}><Text style={styles.label}>{label}</Text><TextInput value={value} onChangeText={onChangeText} multiline={multiline} autoCapitalize={autoCapitalize} keyboardType={keyboardType} placeholderTextColor={colors.faint} style={[styles.input, multiline && styles.multiline]} /></View>;
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, paddingBottom: 8 },
  back: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  kicker: { color: colors.cyan, fontSize: 11, fontWeight: "900", letterSpacing: 1.1 },
  title: { color: colors.text, fontSize: 19, fontWeight: "900", marginTop: 2 },
  roleLine: { color: colors.muted, fontSize: 13, fontWeight: "900", marginTop: 2 },
  scroll: { padding: 14, paddingBottom: 28 },
  section: { marginTop: 12 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 7, paddingHorizontal: 2 },
  sectionTitle: { color: colors.faint, fontSize: 10.5, fontWeight: "700", letterSpacing: 1.6, textTransform: "uppercase", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  sectionRule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  mediaCard: { padding: 10, borderRadius: 14, backgroundColor: colors.input, borderWidth: 1, borderColor: colors.border, gap: 9 },
  mediaHead: { flexDirection: "row", alignItems: "center", gap: 11 },
  mediaPreview: { borderRadius: 10, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.borderStrong },
  mediaPreviewTall: { width: 60, height: 100 },
  mediaPreviewWide: { width: 128, height: 72 },
  mediaEmpty: { color: colors.faint, fontSize: 10, fontWeight: "800", textAlign: "center", paddingHorizontal: 4 },
  mediaHint: { color: colors.muted, fontSize: 12, lineHeight: 16, marginTop: 3 },
  mediaActions: { flexDirection: "row", alignItems: "center", gap: 7 },
  mediaButton: { minHeight: 36, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 10, backgroundColor: colors.cyanSoft, borderWidth: 1, borderColor: colors.border },
  mediaRemove: { minHeight: 36, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: colors.redSoft },
  mediaRemoveText: { color: colors.red, fontSize: 13, fontWeight: "900" },
  mediaShow: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  mediaNote: { color: colors.faint, fontSize: 11 },
  card: { padding: 11, borderRadius: 17, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border, gap: 10 },
  mediaRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  hubImage: { width: 68, height: 68, borderRadius: 19, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.borderStrong },
  hubImageFill: { width: "100%", height: "100%" },
  hubInitial: { color: colors.text, fontSize: 27, fontWeight: "900" },
  smallButton: { minHeight: 39, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: 11, backgroundColor: colors.cyanSoft, borderWidth: 1, borderColor: colors.border },
  smallButtonText: { color: colors.cyan, fontSize: 13, fontWeight: "900" },
  label: { color: colors.muted, fontSize: 11, fontWeight: "800" },
  input: { minHeight: 42, borderRadius: 11, paddingHorizontal: 10, color: colors.text, backgroundColor: colors.input, borderWidth: 1, borderColor: colors.border },
  multiline: { minHeight: 82, paddingTop: 10, textAlignVertical: "top" },
  visibility: { flexDirection: "row", gap: 7 },
  choice: { flex: 1, minHeight: 41, borderRadius: 11, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.input, borderWidth: 1, borderColor: colors.border },
  choiceActive: { backgroundColor: colors.cyanSoft, borderColor: colors.cyan },
  choiceText: { color: colors.text, fontSize: 13, fontWeight: "900" },
  primary: { minHeight: 43, borderRadius: 12, backgroundColor: colors.cyan, alignItems: "center", justifyContent: "center" },
  primaryText: { color: "#061018", fontSize: 12, fontWeight: "900" },
  addRow: { flexDirection: "row", gap: 7 },
  plus: { width: 43, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: colors.cyan },
  memberBlock: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 7, gap: 6 },
  member: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: 7 },
  memberAvatar: { width: 35, height: 35, borderRadius: 11, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: colors.panel2 },
  memberAvatarText: { color: colors.text, fontSize: 12, fontWeight: "900" },
  memberName: { color: colors.text, fontSize: 12, fontWeight: "900" },
  memberRole: { color: colors.muted, fontSize: 13, fontWeight: "800", marginTop: 2 },
  iconButton: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel2 },
  roleSelect: { width: 82, height: 32, paddingHorizontal: 9, borderRadius: 9, flexDirection: "row", gap: 5, alignItems: "center", justifyContent: "space-between", backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  roleSelectOpen: { borderColor: colors.cyan, backgroundColor: colors.cyanSoft },
  roleSelectText: { color: colors.text, fontSize: 13, fontWeight: "900" },
  roleDropdown: { width: 118, alignSelf: "flex-end", marginTop: -4, marginRight: 41, marginBottom: 2, padding: 4, borderRadius: 10, gap: 2, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.borderStrong },
  roleOption: { minHeight: 32, paddingHorizontal: 9, borderRadius: 7, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  roleOptionSelected: { backgroundColor: colors.cyanSoft },
  roleOptionText: { color: colors.muted, fontSize: 13, fontWeight: "800" },
  roleOptionTextSelected: { color: colors.cyan },
  iconButtonDanger: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.redSoft },
  moderationRow: { flexDirection: "row", gap: 6 },
  miniAction: { paddingHorizontal: 9, minHeight: 30, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel2 },
  miniDanger: { backgroundColor: colors.redSoft },
  miniActionText: { color: colors.muted, fontSize: 13, fontWeight: "900" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { minHeight: 30, paddingHorizontal: 8, borderRadius: 9, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.input, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.cyanSoft, borderColor: colors.cyan },
  chipText: { color: colors.muted, fontSize: 11, fontWeight: "800" },
  chipTextActive: { color: colors.cyan },
  roleDot: { width: 8, height: 8, borderRadius: 4 },
  twoFields: { flexDirection: "row", gap: 8 },
  simpleRow: { minHeight: 49, flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 7 },
  actionRow: { minHeight: 59, flexDirection: "row", alignItems: "center", gap: 10 },
  actionTitle: { color: colors.text, fontSize: 12, fontWeight: "900" },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 12, marginTop: 2 },
  tokenBox: { padding: 10, borderRadius: 12, backgroundColor: colors.cyanSoft, borderWidth: 1, borderColor: colors.border },
  tokenTitle: { color: colors.yellow, fontSize: 13, fontWeight: "900", marginBottom: 6 },
  tokenText: { color: colors.text, fontSize: 13, lineHeight: 13 },
  auditRow: { paddingVertical: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  auditToggle: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 9 },
  auditToggleIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.cyanSoft },
  auditTime: { color: colors.faint, fontSize: 11, marginTop: 3 },
  saveFooter: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.bg },
  notice: { color: colors.green, fontSize: 12, lineHeight: 14, marginTop: 10 },
  error: { color: colors.red, fontSize: 12, lineHeight: 14, marginTop: 10 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
});
