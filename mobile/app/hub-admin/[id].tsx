import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
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
import { API_BASE, apiFetch, apiJson } from "@/src/lib/api";
import { useSession } from "@/src/providers/SessionProvider";
import { colors } from "@/src/theme";

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
  channels?: Array<{ id: number; name: string; type: string; private?: boolean }>;
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

const ROLE_PERMISSIONS: Array<{ key: Permission; label: string }> = [
  { key: "manageRooms", label: "Manage rooms" },
  { key: "moderateMessages", label: "Moderate messages" },
  { key: "moderateMembers", label: "Moderate members" },
  { key: "voiceModerate", label: "Voice moderation" },
  { key: "createInvites", label: "Create invites" },
  { key: "viewAudit", label: "View audit" },
];

function assetUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^(https?:|data:|file:)/i.test(value)) return value;
  return `${API_BASE}${value.startsWith("/") ? "" : "/"}${value}`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default function HubAdminScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
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
  const [category, setCategory] = useState("Gaming");
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
  const canManage = hub?.myRole === "owner" || hub?.myRole === "admin";

  const loadFeatures = useCallback(async () => {
    if (!token || !hubId) return;
    const requests = await Promise.allSettled([
      apiJson<CustomRole[]>(`/api/servers/${hubId}/roles`, {}, token),
      apiJson<AuditEntry[]>(`/api/servers/${hubId}/audit`, {}, token),
      apiJson<HubAsset[]>(`/api/servers/${hubId}/assets`, {}, token),
      apiJson<HubBot[]>(`/api/servers/${hubId}/bots`, {}, token),
    ]);
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
      setCategory(hubData.category ?? "Gaming");
      setAccent(/^#[0-9a-fA-F]{6}$/.test(hubData.accent ?? "") ? hubData.accent! : "#7c5cff");
      setTags((hubData.tags ?? []).join(", "));
      setSlowMode(String(Math.max(0, Math.min(120, Number(hubData.slowModeSeconds ?? 0)))));
      void loadFeatures();
    } catch (cause) {
      setError(errorMessage(cause, "Could not load Hub management."));
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
          category: category.trim() || "Gaming",
          tags: tags.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 6),
          slowModeSeconds: Math.max(0, Math.min(120, Number(slowMode) || 0)),
        }),
      }, token);
      setNotice("Hub settings updated.");
      await load();
    } catch (cause) {
      setError(errorMessage(cause, "Could not update Hub."));
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
      setError(errorMessage(cause, "Could not update Hub visibility."));
    } finally { setBusy(""); }
  };

  const addMember = async () => {
    if (!token || !isOwner || !memberRef.trim()) return;
    setBusy("add-member"); setError("");
    try {
      await apiJson(`/api/servers/${hubId}/members/${encodeURIComponent(memberRef.trim())}`, { method: "PUT" }, token);
      setMemberRef("");
      setNotice("Member added.");
      await load();
    } catch (cause) {
      setError(errorMessage(cause, "Could not add member."));
    } finally { setBusy(""); }
  };

  const setRole = (member: Member, role: "admin" | "member") => {
    if (!token || !isOwner) return;
    const promoting = role === "admin";
    Alert.alert(
      promoting ? `Make ${member.username} an admin?` : `Remove admin access from ${member.username}?`,
      promoting
        ? "Admins can manage rooms and moderate Hub members."
        : "They will become a regular member and lose Hub management permissions.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: promoting ? "Make Admin" : "Remove Admin",
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
              setError(errorMessage(cause, "Could not update role."));
            } finally { setBusy(""); }
          })(),
        },
      ],
    );
  };

  const removeMember = (member: Member) => Alert.alert(
    "Remove member?",
    `Remove ${member.username} from this Hub?`,
    [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void (async () => {
        if (!token || !canManage) return;
        setBusy(`remove:${member.userId}`);
        try {
          await apiJson(`/api/servers/${hubId}/members/${encodeURIComponent(member.userId)}`, { method: "DELETE" }, token);
          await load();
        } catch (cause) {
          setError(errorMessage(cause, "Could not remove member."));
        } finally { setBusy(""); }
      })() },
    ],
  );

  const moderateMember = (member: Member, action: "kick" | "ban" | "timeout") => {
    const label = action === "timeout" ? "Timeout 10 minutes" : action === "kick" ? "Kick" : "Ban";
    Alert.alert(`${label} ${member.username}?`, action === "ban" ? "This removes the member and blocks rejoining until unbanned." : "This action is recorded in the Hub audit log.", [
      { text: "Cancel", style: "cancel" },
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
          setError(errorMessage(cause, `Could not ${action} member.`));
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
      if (!raw) throw new Error("Invite was created but the server returned no link/code.");
      const value = /^https?:/i.test(raw) ? raw : `https://app.de-cave.com/join/hub/${encodeURIComponent(raw)}`;
      await Share.share({ title: `Join ${hub?.name ?? "my Hub"} on DeCave`, message: value });
      setNotice("One-time invite created (24 hours, one use). ");
    } catch (cause) {
      setError(errorMessage(cause, "Could not create invite."));
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
      setError(errorMessage(cause, "Could not update Hub artwork."));
    } finally { setBusy(""); }
  };

  const removeMedia = (kind: "banner" | "chat-background") => {
    if (!token || !isOwner) return;
    const label = kind === "banner" ? "sidebar banner" : "chat background";
    Alert.alert(`Remove ${label}?`, "The image is deleted and hidden for everyone in this Hub.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void (async () => {
        setBusy(`media-remove:${kind}`); setError("");
        try {
          await apiJson(`/api/servers/${hubId}/media/${kind}`, { method: "DELETE" }, token);
          setNotice(kind === "banner" ? "Sidebar banner removed." : "Chat background removed.");
          await load();
        } catch (cause) {
          setError(errorMessage(cause, `Could not remove ${label}.`));
        } finally { setBusy(""); }
      })() },
    ]);
  };

  const uploadMedia = async (kind: "icon" | "banner" | "chat-background") => {
    if (!token || !isOwner) return;
    setError("");
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError("Photo library permission is required."); return; }
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
    if (blob.size > limit) { setError(`${kind === "icon" ? "Icon" : kind === "banner" ? "Banner" : "Chat background"} is too large.`); return; }
    setBusy(`media:${kind}`);
    try {
      const response = await apiFetch(`/api/servers/${hubId}/media/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "X-File-Type": mime },
        body: blob as any,
      }, token);
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not upload Hub image.");
      setNotice(`${kind === "icon" ? "Hub profile image" : kind === "banner" ? "Sidebar banner" : "Chat background"} updated.`);
      await load();
    } catch (cause) {
      setError(errorMessage(cause, "Could not upload Hub image."));
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
      setError(errorMessage(cause, "Could not create custom role."));
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
      setError(errorMessage(cause, "Could not assign custom role."));
    } finally { setBusy(""); }
  };

  const uploadAsset = async (kind: "emote" | "sticker") => {
    if (!token || !canManage) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError("Photo library permission is required."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
    if (result.canceled || !result.assets[0]) return;
    const file = result.assets[0];
    const mime = file.mimeType || "image/png";
    const source = await fetch(file.uri);
    const blob = await source.blob();
    const limit = kind === "emote" ? 1024 * 1024 : 5 * 1024 * 1024;
    if (blob.size > limit) { setError(`${kind === "emote" ? "Emote" : "Sticker"} is too large.`); return; }
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
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error || `Could not upload ${kind}.`);
      setAssetName("");
      await loadFeatures();
    } catch (cause) {
      setError(errorMessage(cause, `Could not upload ${kind}.`));
    } finally { setBusy(""); }
  };

  const deleteAsset = (asset: HubAsset) => Alert.alert("Delete asset?", `Delete ${asset.name}?`, [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: () => void (async () => {
      if (!token) return;
      setBusy(`asset-delete:${asset.id}`);
      try {
        await apiJson(`/api/servers/${hubId}/assets/${encodeURIComponent(asset.id)}`, { method: "DELETE" }, token);
        await loadFeatures();
      } catch (cause) { setError(errorMessage(cause, "Could not delete asset.")); }
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
      setError(errorMessage(cause, "Could not create Hub bot."));
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
    } catch (cause) { setError(errorMessage(cause, "Could not update bot.")); }
    finally { setBusy(""); }
  };

  const deleteBot = (bot: HubBot) => Alert.alert("Delete bot?", `Delete ${bot.name}?`, [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: () => void (async () => {
      if (!token || !isOwner) return;
      setBusy(`bot-delete:${bot.id}`);
      try {
        await apiJson(`/api/servers/${hubId}/bots/${encodeURIComponent(bot.id)}`, { method: "DELETE" }, token);
        await loadFeatures();
      } catch (cause) { setError(errorMessage(cause, "Could not delete bot.")); }
      finally { setBusy(""); }
    })() },
  ]);

  const sortedMembers = useMemo(() => [...members].sort((a, b) => {
    const rank: Record<HubRole, number> = { owner: 0, admin: 1, member: 2 };
    return rank[a.role] - rank[b.role] || a.username.localeCompare(b.username);
  }), [members]);

  if (!hub) {
    return <Screen><View style={styles.loading}><Text style={styles.muted}>{error || "Loading Hub management…"}</Text></View></Screen>;
  }

  return (
    <Screen>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={styles.back} onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.cyan} /></Pressable>
        <View style={{ flex: 1 }}><Text maxFontSizeMultiplier={1.3} style={styles.kicker}>HUB CONTROL</Text><Text style={styles.title} numberOfLines={1}>Manage {hub.name}</Text><Text style={styles.roleLine}>{(hub.myRole ?? "member").toUpperCase()}</Text></View>
        <Ionicons name="construct-outline" size={21} color={colors.cyan} />
      </View>

      <ScrollView keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Section title="HUB PROFILE & DISCOVERY">
          <View style={styles.mediaRow}>
            <View style={styles.hubImage}>{assetUrl(hub.iconUrl) ? <Image source={{ uri: assetUrl(hub.iconUrl)! }} style={styles.hubImageFill} /> : <Text style={styles.hubInitial}>{(hub.name || "H").slice(0, 1).toUpperCase()}</Text>}</View>
            <View style={{ flex: 1, gap: 7 }}>
              <Pressable accessibilityRole="button" style={styles.smallButton} disabled={!isOwner || !!busy} onPress={() => void uploadMedia("icon")}><Ionicons name="image-outline" size={15} color={colors.cyan} /><Text style={styles.smallButtonText}>Change Hub image</Text></Pressable>
            </View>
          </View>
          <MediaCard
            title="Sidebar banner"
            hint="Fills the Hub sidebar behind the room list."
            shape="tall"
            url={assetUrl(hub.bannerUrl)}
            emptyLabel="No banner"
            addLabel="Add banner"
            shown={hub.useBannerBackground === true}
            note={hub.bannerUrl ? "Dimmed for readability." : "Add a banner to turn this on."}
            editable={isOwner}
            busy={!!busy}
            uploading={busy === "media:banner"}
            onChange={() => void uploadMedia("banner")}
            onRemove={() => removeMedia("banner")}
            onToggle={(value) => void setMediaShown("banner", value)}
          />
          <MediaCard
            title="Chat background"
            hint="Behind the message list, dimmed automatically."
            shape="wide"
            url={assetUrl(hub.chatBackgroundUrl)}
            emptyLabel="No photo"
            addLabel="Add photo"
            shown={hub.useChatBackground === true}
            note={hub.chatBackgroundUrl ? "Shown in every room of this Hub." : "Add a photo to turn this on."}
            editable={isOwner}
            busy={!!busy}
            uploading={busy === "media:chat-background"}
            onChange={() => void uploadMedia("chat-background")}
            onRemove={() => removeMedia("chat-background")}
            onToggle={(value) => void setMediaShown("chat-background", value)}
          />
          <Field label="Hub name" value={name} onChangeText={setName} />
          <Field label="Description" value={description} onChangeText={setDescription} multiline />
          <Field label="Category" value={category} onChangeText={setCategory} />
          <Field label="Accent (#RRGGBB)" value={accent} onChangeText={setAccent} autoCapitalize="none" />
          <Field label="Tags (comma separated, max 6)" value={tags} onChangeText={setTags} />
          <Field label="Slow mode seconds (0–120)" value={slowMode} onChangeText={setSlowMode} keyboardType="number-pad" />
          {isOwner && <View style={styles.visibility}>
            <Pressable accessibilityRole="button" style={[styles.choice, hub.visibility === "public" && styles.choiceActive]} onPress={() => void setVisibility("public")}><Ionicons name="globe-outline" size={15} color={colors.cyan} /><Text style={styles.choiceText}>Public</Text></Pressable>
            <Pressable accessibilityRole="button" style={[styles.choice, hub.visibility === "private" && styles.choiceActive]} onPress={() => void setVisibility("private")}><Ionicons name="lock-closed-outline" size={15} color={colors.cyan} /><Text style={styles.choiceText}>Private</Text></Pressable>
          </View>}
        </Section>

        <Section title="ROOMS & PRIVATE ACCESS">
          <Pressable accessibilityRole="button" style={styles.actionRow} onPress={() => router.replace(`/hub/${hubId}` as any)}>
            <Ionicons name="grid-outline" size={19} color={colors.cyan} />
            <View style={{ flex: 1 }}><Text style={styles.actionTitle}>Manage rooms</Text><Text style={styles.muted}>Create, edit, reorder or delete text, voice and forum rooms, set room icons, and choose members for private rooms.</Text></View>
            <Ionicons name="chevron-forward" size={18} color={colors.faint} />
          </Pressable>
        </Section>

        <Section title="INVITES">
          <Pressable accessibilityRole="button" style={styles.actionRow} disabled={!canManage || !!busy} onPress={() => void createOneTimeInvite()}>
            <Ionicons name="link-outline" size={19} color={colors.cyan} />
            <View style={{ flex: 1 }}><Text style={styles.actionTitle}>Create one-time invite</Text><Text style={styles.muted}>Expires after 24 hours and can be consumed once.</Text></View>
            <Ionicons name="share-outline" size={18} color={colors.cyan} />
          </Pressable>
        </Section>

        <Section title={`MEMBERS · ${members.length}`}>
          {isOwner && <View style={styles.addRow}><TextInput value={memberRef} onChangeText={setMemberRef} placeholder="Username or DeCave ID" placeholderTextColor={colors.faint} style={[styles.input, { flex: 1 }]} autoCapitalize="none" /><Pressable accessibilityRole="button" accessibilityLabel="Add member" style={styles.plus} disabled={!!busy} onPress={() => void addMember()}><Ionicons name="person-add-outline" size={18} color="#061018" /></Pressable></View>}
          {sortedMembers.map((member) => (
            <View key={member.userId} style={styles.memberBlock}>
              <View style={styles.member}>
                <View style={styles.memberAvatar}>{assetUrl(member.avatarUrl) ? <Image source={{ uri: assetUrl(member.avatarUrl)! }} style={styles.hubImageFill} /> : <Text style={styles.memberAvatarText}>{member.username.slice(0, 1).toUpperCase()}</Text>}</View>
                <View style={{ flex: 1, minWidth: 0 }}><Text style={styles.memberName} numberOfLines={1}>{member.username}</Text><Text style={styles.memberRole}>{member.role.toUpperCase()}</Text></View>
                {isOwner && member.role !== "owner" && <Pressable style={[styles.roleSelect, roleMenuUserId === member.userId && styles.roleSelectOpen]} disabled={!!busy} accessibilityRole="button" accessibilityLabel={`Change ${member.username}'s role. Current role: ${member.role}`} accessibilityState={{ expanded: roleMenuUserId === member.userId }} onPress={() => setRoleMenuUserId((current) => current === member.userId ? null : member.userId)}><Text style={styles.roleSelectText}>{member.role === "admin" ? "Admin" : "Member"}</Text><Ionicons name={roleMenuUserId === member.userId ? "chevron-up" : "chevron-down"} size={13} color={colors.cyan} /></Pressable>}
                {canManage && member.role !== "owner" && <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${member.username}`} style={styles.iconButtonDanger} disabled={!!busy} onPress={() => removeMember(member)}><Ionicons name="trash-outline" size={16} color={colors.red} /></Pressable>}
              </View>
              {isOwner && member.role !== "owner" && roleMenuUserId === member.userId && <View style={styles.roleDropdown} accessibilityRole="menu">
                {(["member", "admin"] as const).map((role) => { const selected = member.role === role; return <Pressable key={role} style={[styles.roleOption, selected && styles.roleOptionSelected]} disabled={!!busy} accessibilityRole="menuitem" accessibilityState={{ selected }} onPress={() => { setRoleMenuUserId(null); if (!selected) setRole(member, role); }}><Text style={[styles.roleOptionText, selected && styles.roleOptionTextSelected]}>{role === "admin" ? "Admin" : "Member"}</Text>{selected && <Ionicons name="checkmark" size={14} color={colors.cyan} />}</Pressable>; })}
              </View>}
              {member.role !== "owner" && <View style={styles.moderationRow}>
                <Pressable accessibilityRole="button" style={styles.miniAction} disabled={!!busy} onPress={() => moderateMember(member, "timeout")}><Text style={styles.miniActionText}>10m timeout</Text></Pressable>
                <Pressable accessibilityRole="button" style={styles.miniAction} disabled={!!busy} onPress={() => moderateMember(member, "kick")}><Text style={styles.miniActionText}>Kick</Text></Pressable>
                <Pressable accessibilityRole="button" style={[styles.miniAction, styles.miniDanger]} disabled={!!busy} onPress={() => moderateMember(member, "ban")}><Text style={[styles.miniActionText, { color: colors.red }]}>Ban</Text></Pressable>
              </View>}
              {isOwner && roles.length > 0 && member.role !== "owner" && <View style={styles.chips}>{roles.map((role) => { const active=(member.customRoleIds ?? []).includes(role.id); return <Pressable accessibilityRole="button" key={role.id} style={[styles.chip, active && styles.chipActive]} disabled={!!busy} onPress={() => void toggleMemberCustomRole(member, role.id)}><View style={[styles.roleDot,{backgroundColor:role.color}]} /><Text style={[styles.chipText,active&&styles.chipTextActive]}>{role.name}</Text></Pressable>; })}</View>}
            </View>
          ))}
        </Section>

        {isOwner && <Section title="CUSTOM ROLES">
          <View style={styles.twoFields}><View style={{ flex: 1 }}><Field label="Role name" value={newRoleName} onChangeText={setNewRoleName} /></View><View style={{ width: 115 }}><Field label="Color" value={newRoleColor} onChangeText={setNewRoleColor} autoCapitalize="none" /></View></View>
          <View style={styles.chips}>{ROLE_PERMISSIONS.map(({ key, label }) => { const active=newRolePermissions.includes(key); return <Pressable accessibilityRole="button" key={key} style={[styles.chip,active&&styles.chipActive]} onPress={() => toggleRolePermission(key)}><Text style={[styles.chipText,active&&styles.chipTextActive]}>{label}</Text></Pressable>; })}</View>
          <Pressable accessibilityRole="button" style={styles.primary} disabled={!!busy || !newRoleName.trim()} onPress={() => void createCustomRole()}><Text style={styles.primaryText}>Create role</Text></Pressable>
          {roles.map((role) => <View key={role.id} style={styles.simpleRow}><View style={[styles.roleDot,{backgroundColor:role.color}]} /><View style={{ flex: 1 }}><Text style={styles.actionTitle}>{role.name}</Text><Text style={styles.muted}>{role.permissions.length ? role.permissions.join(" · ") : "No extra permissions"}</Text></View></View>)}
        </Section>}

        {canManage && <Section title="EMOTES & STICKERS">
          <Field label="Asset name (optional)" value={assetName} onChangeText={setAssetName} autoCapitalize="none" />
          <View style={styles.visibility}><Pressable accessibilityRole="button" style={styles.choice} disabled={!!busy} onPress={() => void uploadAsset("emote")}><Ionicons name="happy-outline" size={16} color={colors.cyan} /><Text style={styles.choiceText}>Upload emote</Text></Pressable><Pressable accessibilityRole="button" style={styles.choice} disabled={!!busy} onPress={() => void uploadAsset("sticker")}><Ionicons name="sparkles-outline" size={16} color={colors.cyan} /><Text style={styles.choiceText}>Upload sticker</Text></Pressable></View>
          {assets.length === 0 ? <Text style={styles.muted}>No custom assets.</Text> : assets.map((asset) => <View key={asset.id} style={styles.simpleRow}><View style={{ flex: 1 }}><Text style={styles.actionTitle}>{asset.name}</Text><Text style={styles.muted}>{asset.kind.toUpperCase()}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Delete asset" style={styles.iconButtonDanger} onPress={() => deleteAsset(asset)}><Ionicons name="trash-outline" size={16} color={colors.red} /></Pressable></View>)}
        </Section>}

        {isOwner && <Section title="HUB BOTS">
          <View style={styles.addRow}><TextInput value={newBotName} onChangeText={setNewBotName} placeholder="Bot name" placeholderTextColor={colors.faint} style={[styles.input,{flex:1}]} /><Pressable accessibilityRole="button" accessibilityLabel="Create bot" style={styles.plus} disabled={!!busy || !newBotName.trim()} onPress={() => void createBot()}><Ionicons name="add" size={20} color="#061018" /></Pressable></View>
          {!!newBotToken && <View style={styles.tokenBox}><Text style={styles.tokenTitle}>COPY THIS TOKEN NOW — IT IS SHOWN ONCE</Text><Text selectable style={styles.tokenText}>{newBotToken}</Text></View>}
          {bots.length === 0 ? <Text style={styles.muted}>No Hub bots.</Text> : bots.map((bot) => <View key={bot.id} style={styles.simpleRow}><Ionicons name="hardware-chip-outline" size={17} color={bot.enabled?colors.green:colors.muted} /><View style={{flex:1}}><Text style={styles.actionTitle}>{bot.name}</Text><Text style={styles.muted}>{bot.enabled?"ENABLED":"DISABLED"}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={bot.enabled ? `Pause ${bot.name}` : `Resume ${bot.name}`} style={styles.iconButton} onPress={() => void toggleBot(bot)}><Ionicons name={bot.enabled?"pause-outline":"play-outline"} size={16} color={colors.cyan}/></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Delete ${bot.name}`} style={styles.iconButtonDanger} onPress={() => deleteBot(bot)}><Ionicons name="trash-outline" size={16} color={colors.red}/></Pressable></View>)}
        </Section>}

        {auditLog.length > 0 && <Section title="AUDIT LOG">
          <Pressable style={styles.auditToggle} accessibilityRole="button" accessibilityState={{ expanded: auditExpanded }} onPress={() => setAuditExpanded((value) => !value)}>
            <View style={styles.auditToggleIcon}><Ionicons name="document-text-outline" size={16} color={colors.cyan} /></View>
            <View style={{ flex: 1 }}><Text style={styles.actionTitle}>View audit log</Text><Text style={styles.muted}>{auditLog.length} recent {auditLog.length === 1 ? "event" : "events"}</Text></View>
            <Ionicons name={auditExpanded ? "chevron-up" : "chevron-down"} size={17} color={colors.faint} />
          </Pressable>
          {auditExpanded && auditLog.slice(0, 30).map((entry) => <View key={entry.id} style={styles.auditRow}><Text style={styles.actionTitle}>{entry.action}</Text><Text style={styles.muted}>{entry.actorUsername || entry.actorUserId || "System"}{entry.targetUsername ? ` → ${entry.targetUsername}` : ""}{entry.detail ? ` · ${entry.detail}` : ""}</Text><Text style={styles.auditTime}>{new Date(entry.timestamp).toLocaleString()}</Text></View>)}
        </Section>}

        {!!notice && <Text style={styles.notice}>{notice}</Text>}
        {!!error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
      <View style={styles.saveFooter}>
        <Pressable accessibilityRole="button" style={styles.primary} disabled={!canManage || !!busy} onPress={() => void saveDetails()}><Text style={styles.primaryText}>{busy === "save" ? "Saving…" : "Save Hub settings"}</Text></Pressable>
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
  return (
    <View style={styles.mediaCard}>
      <View style={styles.mediaHead}>
        <View style={[styles.mediaPreview, shape === "tall" ? styles.mediaPreviewTall : styles.mediaPreviewWide]}>
          {url ? <Image source={{ uri: url }} style={styles.hubImageFill} resizeMode="cover" accessibilityLabel={`Current ${title.toLowerCase()}`} /> : <Text style={styles.mediaEmpty}>{emptyLabel}</Text>}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.actionTitle}>{title}</Text>
          <Text style={styles.mediaHint}>{hint}</Text>
        </View>
      </View>
      <View style={styles.mediaActions}>
        <Pressable accessibilityRole="button" style={styles.mediaButton} disabled={!editable || busy} onPress={onChange}>
          <Ionicons name="image-outline" size={15} color={colors.cyan} />
          <Text style={styles.smallButtonText}>{uploading ? "Uploading…" : url ? "Change" : addLabel}</Text>
        </Pressable>
        {!!url && <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${title.toLowerCase()}`} style={styles.mediaRemove} disabled={!editable || busy} onPress={onRemove}>
          <Text style={styles.mediaRemoveText}>Remove</Text>
        </Pressable>}
        <View style={{ flex: 1 }} />
        <Text style={styles.mediaShow}>Show</Text>
        <Switch
          accessibilityLabel={`Show ${title.toLowerCase()}`}
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
