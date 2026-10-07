import { Icon, type IconName } from "../../components/Icon";

type HubActionIconKind = "overview" | "members" | "calendar" | "manage";

export function HubActionIcon({ kind }: { kind: HubActionIconKind }) {
  const names: Record<HubActionIconKind, IconName> = {
    overview: "layout-dashboard",
    members: "users",
    calendar: "calendar-days",
    manage: "sliders",
  };
  return (
    <span className="dc-hub-action-icon" aria-hidden="true">
      <Icon name={names[kind]} />
    </span>
  );
}
