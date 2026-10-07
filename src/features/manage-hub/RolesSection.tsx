import { useEffect, useId, useMemo, useState } from "react";
import { TypeToConfirmDialog } from "../shared/TypeToConfirmDialog";
import type { AuthorizedFetch, HubCustomRole, HubMemberRow, HubPermission } from "./types";

export const PERMISSION_GROUPS: Array<{
  id: string;
  label: string;
  items: Array<{ id: HubPermission; label: string; description: string }>;
}> = [
  {
    id: "general",
    label: "General",
    items: [
      {
        id: "manageRooms",
        label: "Manage rooms",
        description: "Create, edit, reorder and delete rooms, including private room access.",
      },
      { id: "manageEvents", label: "Manage events", description: "Create, edit and cancel Hub calendar events." },
      {
        id: "createInvites",
        label: "Create invites",
        description: "Generate invite links for people outside the Hub.",
      },
      {
        id: "viewAudit",
        label: "View audit log",
        description: "See who changed Hub settings, roles and moderation actions.",
      },
    ],
  },
  {
    id: "moderation",
    label: "Moderation",
    items: [
      {
        id: "moderateMessages",
        label: "Moderate messages",
        description: "Delete or pin other people’s messages and forum posts.",
      },
      {
        id: "moderateMembers",
        label: "Moderate members",
        description: "Time out, remove and ban members below the admin level.",
      },
    ],
  },
  {
    id: "voice",
    label: "Voice",
    items: [{ id: "voiceModerate", label: "Moderate voice", description: "Mute or disconnect people in voice rooms." }],
  },
];

type Draft = { name: string; color: string; icon: string; permissions: HubPermission[] };
const EMPTY_DRAFT: Draft = { name: "", color: "#62d6ff", icon: "", permissions: [] };
const NEW_ID = "__new__";

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
  const [selectedId, setSelectedId] = useState<string>(() => roles[0]?.id ?? NEW_ID);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
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
    const data = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!response.ok) throw new Error(data.error || "The role could not be saved.");
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
      setError(caught instanceof Error ? caught.message : "The role could not be saved.");
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
      setError(caught instanceof Error ? caught.message : "The role could not be deleted.");
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
        aria-label="Roles"
        aria-activedescendant={`${baseId}-${selectedId}`}
      >
        <div className="dch-roles-fixed">
          <span className="dch-role-row is-static">
            <i style={{ background: "var(--ds-warn)" }} aria-hidden="true" />
            Owner<small>All permissions</small>
          </span>
          <span className="dch-role-row is-static">
            <i style={{ background: "var(--ds-accent-2)" }} aria-hidden="true" />
            Admin<small>All except ownership</small>
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
            + Create role
          </button>
        )}
      </div>

      <div className="dch-roles-editor">
        {!isOwner && <div className="dcx-notice dcx-notice-info">Only the Hub owner can create or edit roles.</div>}
        {!selected && !isOwner ? (
          <p className="dcx-hint">This Hub has no custom roles yet.</p>
        ) : (
          <fieldset disabled={!isOwner || busy} className="dch-fieldset">
            <legend className="dcx-sr-only">{selected ? `Edit ${selected.name}` : "New role"}</legend>
            <section className="dcx-card">
              <div className="dcx-card-head">
                <h4>{selected ? "Role details" : "New role"}</h4>
                {selected && (
                  <p>
                    {memberCounts.get(selected.id) ?? 0} member{(memberCounts.get(selected.id) ?? 0) === 1 ? "" : "s"}{" "}
                    have this role. Assign it from Members.
                  </p>
                )}
              </div>
              <div className="dch-role-fields">
                <label className="dch-field">
                  <span>Name</span>
                  <input
                    className="dcx-input"
                    value={draft.name}
                    maxLength={32}
                    placeholder="Moderator"
                    onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  />
                </label>
                <label className="dch-field dch-field-color">
                  <span>Color</span>
                  <input
                    type="color"
                    value={draft.color}
                    onChange={(event) => setDraft((current) => ({ ...current, color: event.target.value }))}
                  />
                </label>
                <label className="dch-field dch-field-icon">
                  <span>Icon</span>
                  <input
                    className="dcx-input"
                    value={draft.icon}
                    maxLength={8}
                    placeholder="🛡️"
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, icon: Array.from(event.target.value).slice(0, 4).join("") }))
                    }
                  />
                </label>
              </div>
              {iconChoices.length > 0 && (
                <div className="dch-role-icons" role="group" aria-label="Suggested role icons">
                  {iconChoices.map((icon) => (
                    <button
                      type="button"
                      key={icon}
                      className={`dcr-icon-choice${draft.icon === icon ? " is-selected" : ""}`}
                      aria-pressed={draft.icon === icon}
                      aria-label={`Use ${icon} as role icon`}
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
                  <h4 id={`${baseId}-group-${group.id}`}>{group.label}</h4>
                </div>
                {group.items.map((item) => (
                  <div className="dcx-row" key={item.id}>
                    <div className="dcx-row-copy">
                      <label htmlFor={`${baseId}-perm-${item.id}`}>{item.label}</label>
                      <small id={`${baseId}-perm-${item.id}-d`}>{item.description}</small>
                    </div>
                    <div className="dcx-row-control">
                      <label className="dcx-switch">
                        <input
                          id={`${baseId}-perm-${item.id}`}
                          type="checkbox"
                          aria-describedby={`${baseId}-perm-${item.id}-d`}
                          checked={draft.permissions.includes(item.id)}
                          onChange={() => togglePermission(item.id)}
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
                  Delete role
                </button>
              </div>
            )}
          </fieldset>
        )}
        {isOwner && (dirty || !selected) && (
          <div className="dcx-dirtybar" role="region" aria-label={selected ? "Unsaved role changes" : "Create role"}>
            <span>{selected ? "Unsaved role changes" : "New role draft"}</span>
            <div>
              {selected && (
                <button
                  type="button"
                  className="dcx-btn dcx-btn-ghost"
                  disabled={busy}
                  onClick={() => setDraft(original)}
                >
                  Reset
                </button>
              )}
              <button
                type="button"
                className="dcx-btn dcx-btn-primary"
                disabled={busy || !draft.name.trim()}
                onClick={() => void save()}
              >
                {busy ? "Saving…" : selected ? "Save role" : "Create role"}
              </button>
            </div>
          </div>
        )}
      </div>

      {confirmDelete && selected && (
        <TypeToConfirmDialog
          title={`Delete ${selected.name}?`}
          description="Members lose this role and its permissions immediately. Forum posting rules that use it will stop matching anyone."
          confirmText={selected.name}
          actionLabel="Delete role"
          busy={busy}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void remove()}
        />
      )}
    </div>
  );
}
