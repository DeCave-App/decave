import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiErrorMessage, type ApiErrorBody } from "../../i18n/apiError";
import { TypeToConfirmDialog } from "../shared/TypeToConfirmDialog";
import { BotApiError, createBotsApi } from "../bots/api";
import type { AuthorizedFetch, HubCustomRole, HubMemberRow, HubPermission } from "./types";

// Labels: hub.manageHub.roles.groups.<id> and hub.manageHub.roles.permissions.<id>.label / .description.
export const PERMISSION_GROUPS: Array<{
  id: "general" | "moderation" | "voice";
  items: HubPermission[];
}> = [
  { id: "general", items: ["manageRooms", "manageEvents", "manageBots", "createInvites", "viewAudit"] },
  { id: "moderation", items: ["moderateMessages", "moderateMembers"] },
  { id: "voice", items: ["voiceModerate"] },
];

type Draft = { name: string; color: string; icon: string; permissions: HubPermission[] };
const EMPTY_DRAFT: Draft = { name: "", color: "#62d6ff", icon: "", permissions: [] };
const NEW_ID = "__new__";
const ROLE_ICON_PLACEHOLDER = "🛡️";

type RolesSectionProps = {
  hubId: number;
  apiBaseUrl: string;
  authorizedFetch: AuthorizedFetch;
  isOwner: boolean;
  roles: readonly HubCustomRole[];
  iconChoices: readonly string[];
  members: readonly HubMemberRow[];
  onRolesChanged: () => Promise<void> | void;
};

function sameDraft(a: Draft, b: Draft) {
  return (
    a.name === b.name &&
    a.color === b.color &&
    a.icon === b.icon &&
    [...a.permissions].sort().join() === [...b.permissions].sort().join()
  );
}

export function RolesSection({
  hubId,
  apiBaseUrl,
  authorizedFetch,
  isOwner,
  roles,
  iconChoices,
  members,
  onRolesChanged,
}: RolesSectionProps) {
  const { t } = useTranslation(["hub"]);
  const [selectedId, setSelectedId] = useState<string>(() => roles[0]?.id ?? NEW_ID);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  // "Manage bots" only means something when the server has the bot builder:
  // the same 404 signal the Bots tab uses.
  const [botsAvailable, setBotsAvailable] = useState(false);
  useEffect(() => {
    let live = true;
    createBotsApi(apiBaseUrl, authorizedFetch, hubId)
      .overview()
      .then(
        () => live && setBotsAvailable(true),
        (caught) => live && setBotsAvailable(!(caught instanceof BotApiError && caught.status === 404)),
      );
    return () => {
      live = false;
    };
  }, [apiBaseUrl, authorizedFetch, hubId]);
  const baseId = useId();

  const selected = roles.find((role) => role.id === selectedId) ?? null;
  const original: Draft = selected
    ? { name: selected.name, color: selected.color, icon: selected.icon, permissions: [...selected.permissions] }
    : EMPTY_DRAFT;
  const dirty = !sameDraft(draft, original);

  // Re-seed the editor when the selection (or its saved data) changes.
  useEffect(() => {
    setDraft(
      selected
        ? { name: selected.name, color: selected.color, icon: selected.icon, permissions: [...selected.permissions] }
        : EMPTY_DRAFT,
    );
    setError("");
  }, [selectedId, selected?.name, selected?.color, selected?.icon, selected?.permissions.join()]);

  useEffect(() => {
    if (selectedId !== NEW_ID && !roles.some((role) => role.id === selectedId)) setSelectedId(roles[0]?.id ?? NEW_ID);
  }, [roles, selectedId]);

  const memberCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const member of members)
      for (const id of member.customRoleIds ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
    return counts;
  }, [members]);

  const request = async (path: string, method: string, body?: unknown) => {
    const response = await authorizedFetch(`${apiBaseUrl}/api/servers/${hubId}/roles${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await response.json().catch(() => ({}))) as { id?: string } & ApiErrorBody;
    if (!response.ok) {
      throw new Error(
        data.code || data.error ? apiErrorMessage(data, "common.unknown") : t("hub.manageHub.roles.saveFailed"),
      );
    }
    return data;
  };

  const save = async () => {
    if (!draft.name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const payload = { name: draft.name.trim(), color: draft.color, icon: draft.icon, permissions: draft.permissions };
      if (selected) {
        await request(`/${encodeURIComponent(selected.id)}`, "PATCH", payload);
        await onRolesChanged();
      } else {
        const created = await request("", "POST", payload);
        await onRolesChanged();
        if (created.id) setSelectedId(created.id);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("hub.manageHub.roles.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await request(`/${encodeURIComponent(selected.id)}`, "DELETE");
      setConfirmDelete(false);
      setSelectedId(NEW_ID);
      await onRolesChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("hub.manageHub.roles.deleteFailed"));
    } finally {
      setBusy(false);
    }
  };

  const togglePermission = (permission: HubPermission) =>
    setDraft((current) => ({
      ...current,
      permissions: current.permissions.includes(permission)
        ? current.permissions.filter((item) => item !== permission)
        : [...current.permissions, permission],
    }));

  return (
    <div className="dch-roles">
      <div
        className="dch-roles-list"
        role="listbox"
        aria-label={t("hub.manageHub.roles.listLabel")}
        aria-activedescendant={`${baseId}-${selectedId}`}
      >
        <div className="dch-roles-fixed">
          <span className="dch-role-row is-static">
            <i style={{ background: "var(--ds-warn)" }} aria-hidden="true" />
            {t("hub.manageHub.roles.owner")}
            <small>{t("hub.manageHub.roles.ownerHint")}</small>
          </span>
          <span className="dch-role-row is-static">
            <i style={{ background: "var(--ds-accent-2)" }} aria-hidden="true" />
            {t("hub.manageHub.roles.admin")}
            <small>{t("hub.manageHub.roles.adminHint")}</small>
          </span>
        </div>
        {roles.map((role) => (
          <button
            type="button"
            role="option"
            id={`${baseId}-${role.id}`}
            aria-selected={role.id === selectedId}
            key={role.id}
            className={`dch-role-row${role.id === selectedId ? " is-active" : ""}`}
            onClick={() => setSelectedId(role.id)}
          >
            <i style={{ background: role.color }} aria-hidden="true" />
            <span>
              {role.icon ? `${role.icon} ` : ""}
              {role.name}
            </span>
            <small>{memberCounts.get(role.id) ?? 0}</small>
          </button>
        ))}
        {isOwner && (
          <button
            type="button"
            role="option"
            id={`${baseId}-${NEW_ID}`}
            aria-selected={selectedId === NEW_ID}
            className={`dch-role-row dch-role-new${selectedId === NEW_ID ? " is-active" : ""}`}
            onClick={() => setSelectedId(NEW_ID)}
          >
            {t("hub.manageHub.roles.createNew")}
          </button>
        )}
      </div>

      <div className="dch-roles-editor">
        {!isOwner && <div className="dcx-notice dcx-notice-info">{t("hub.manageHub.roles.ownerOnly")}</div>}
        {!selected && !isOwner ? (
          <p className="dcx-hint">{t("hub.manageHub.roles.empty")}</p>
        ) : (
          <fieldset disabled={!isOwner || busy} className="dch-fieldset">
            <legend className="dcx-sr-only">
              {selected ? t("hub.manageHub.roles.editRole", { name: selected.name }) : t("hub.manageHub.roles.newRole")}
            </legend>
            <section className="dcx-card">
              <div className="dcx-card-head">
                <h4>{selected ? t("hub.manageHub.roles.details") : t("hub.manageHub.roles.newRole")}</h4>
                {selected && (
                  <p>{t("hub.manageHub.roles.memberCount", { count: memberCounts.get(selected.id) ?? 0 })}</p>
                )}
              </div>
              <div className="dch-role-fields">
                <label className="dch-field">
                  <span>{t("hub.manageHub.roles.name")}</span>
                  <input
                    className="dcx-input"
                    value={draft.name}
                    maxLength={32}
                    placeholder={t("hub.manageHub.roles.namePlaceholder")}
                    onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  />
                </label>
                <label className="dch-field dch-field-color">
                  <span>{t("hub.manageHub.roles.color")}</span>
                  <input
                    type="color"
                    value={draft.color}
                    onChange={(event) => setDraft((current) => ({ ...current, color: event.target.value }))}
                  />
                </label>
                <label className="dch-field dch-field-icon">
                  <span>{t("hub.manageHub.roles.icon")}</span>
                  <input
                    className="dcx-input"
                    value={draft.icon}
                    maxLength={8}
                    placeholder={ROLE_ICON_PLACEHOLDER}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, icon: Array.from(event.target.value).slice(0, 4).join("") }))
                    }
                  />
                </label>
              </div>
              {iconChoices.length > 0 && (
                <div className="dch-role-icons" role="group" aria-label={t("hub.manageHub.roles.suggestedIcons")}>
                  {iconChoices.map((icon) => (
                    <button
                      type="button"
                      key={icon}
                      className={`dcr-icon-choice${draft.icon === icon ? " is-selected" : ""}`}
                      aria-pressed={draft.icon === icon}
                      aria-label={t("hub.manageHub.roles.useIcon", { icon })}
                      onClick={() => setDraft((current) => ({ ...current, icon }))}
                    >
                      {icon}
                    </button>
                  ))}
                </div>
              )}
            </section>
            {PERMISSION_GROUPS.map((group) => (
              <section className="dcx-card" key={group.id} aria-labelledby={`${baseId}-group-${group.id}`}>
                <div className="dcx-card-head">
                  <h4 id={`${baseId}-group-${group.id}`}>{t(`hub.manageHub.roles.groups.${group.id}`)}</h4>
                </div>
                {group.items
                  .filter((item) => item !== "manageBots" || botsAvailable)
                  .map((item) => (
                    <div className="dcx-row" key={item}>
                      <div className="dcx-row-copy">
                        <label htmlFor={`${baseId}-perm-${item}`}>
                          {t(`hub.manageHub.roles.permissions.${item}.label`)}
                        </label>
                        <small id={`${baseId}-perm-${item}-d`}>
                          {t(`hub.manageHub.roles.permissions.${item}.description`)}
                        </small>
                      </div>
                      <div className="dcx-row-control">
                        <label className="dcx-switch">
                          <input
                            id={`${baseId}-perm-${item}`}
                            type="checkbox"
                            aria-describedby={`${baseId}-perm-${item}-d`}
                            checked={draft.permissions.includes(item)}
                            onChange={() => togglePermission(item)}
                          />
                          <span aria-hidden="true" />
                        </label>
                      </div>
                    </div>
                  ))}
              </section>
            ))}
            {error && (
              <div className="dcx-notice dcx-notice-error" role="alert">
                {error}
              </div>
            )}
            {selected && isOwner && (
              <div className="dch-role-delete">
                <button
                  type="button"
                  className="dcx-btn dcx-btn-danger dcx-btn-sm"
                  onClick={() => setConfirmDelete(true)}
                >
                  {t("hub.manageHub.roles.delete")}
                </button>
              </div>
            )}
          </fieldset>
        )}
        {isOwner && (dirty || !selected) && (
          <div
            className="dcx-dirtybar"
            role="region"
            aria-label={selected ? t("hub.manageHub.roles.unsaved") : t("hub.manageHub.roles.create")}
          >
            <span>{selected ? t("hub.manageHub.roles.unsaved") : t("hub.manageHub.roles.draft")}</span>
            <div>
              {selected && (
                <button
                  type="button"
                  className="dcx-btn dcx-btn-ghost"
                  disabled={busy}
                  onClick={() => setDraft(original)}
                >
                  {t("hub.manageHub.reset")}
                </button>
              )}
              <button
                type="button"
                className="dcx-btn dcx-btn-primary"
                disabled={busy || !draft.name.trim()}
                onClick={() => void save()}
              >
                {busy
                  ? t("hub.manageHub.saving")
                  : selected
                    ? t("hub.manageHub.roles.save")
                    : t("hub.manageHub.roles.create")}
              </button>
            </div>
          </div>
        )}
      </div>

      {confirmDelete && selected && (
        <TypeToConfirmDialog
          title={t("hub.manageHub.roles.confirmTitle", { name: selected.name })}
          description={t("hub.manageHub.roles.confirmDescription")}
          confirmText={selected.name}
          actionLabel={t("hub.manageHub.roles.delete")}
          busy={busy}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void remove()}
        />
      )}
    </div>
  );
}
