// State of the platform owner dashboard: loaded data, filters, the selected
// account and the moderation form inputs.

import { useState } from "react";
import type {
  AdminDashboardSummary,
  AdminAccountSummary,
  AdminSecurityEvent,
  AdminAuditEvent,
  SquadGameSuggestion,
  AdminAccountDetail,
} from "../types";

export function useAdminDashboardState() {
  const [adminDashboardSummary, setAdminDashboardSummary] = useState<AdminDashboardSummary | null>(null);
  const [adminAccounts, setAdminAccounts] = useState<AdminAccountSummary[]>([]);
  const [adminSecurityEvents, setAdminSecurityEvents] = useState<AdminSecurityEvent[]>([]);
  const [adminAuditEvents, setAdminAuditEvents] = useState<AdminAuditEvent[]>([]);
  const [adminGameSuggestions, setAdminGameSuggestions] = useState<SquadGameSuggestion[]>([]);
  const [adminAccountSearch, setAdminAccountSearch] = useState("");
  const [adminAccountRoleFilter, setAdminAccountRoleFilter] = useState<"all" | "owner" | "admin" | "user">("all");
  const [adminAccountStateFilter, setAdminAccountStateFilter] = useState<
    "all" | "active" | "suspended" | "reset" | "deletion" | "erased" | "unverified"
  >("all");
  const [adminSecurityFilter, setAdminSecurityFilter] = useState("");
  const [adminAuditFilter, setAdminAuditFilter] = useState("");
  const [adminSecuritySeverity, setAdminSecuritySeverity] = useState<"all" | "high" | "medium" | "info">("all");
  const [adminEventRange, setAdminEventRange] = useState<"all" | "24h" | "7d" | "30d">("7d");
  const [adminDashboardBusy, setAdminDashboardBusy] = useState(false);
  const [adminDashboardNotice, setAdminDashboardNotice] = useState("");
  const [adminUsageFrom, setAdminUsageFrom] = useState(() => {
    const value = new Date();
    value.setDate(value.getDate() - 6);
    return value.toISOString().slice(0, 10);
  });
  const [adminUsageTo, setAdminUsageTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [selectedAdminAccount, setSelectedAdminAccount] = useState<AdminAccountDetail | null>(null);
  const [adminActionReason, setAdminActionReason] = useState("");
  const [adminSuspendDuration, setAdminSuspendDuration] = useState("7");
  const [adminEraseConfirmation, setAdminEraseConfirmation] = useState("");
  const [adminTransferTarget, setAdminTransferTarget] = useState("");
  const [adminPlatformRoleChoice, setAdminPlatformRoleChoice] = useState<"user" | "admin" | "owner">("user");
  const [adminCorrectionBirthDate, setAdminCorrectionBirthDate] = useState("");

  return {
    adminDashboardSummary,
    setAdminDashboardSummary,
    adminAccounts,
    setAdminAccounts,
    adminSecurityEvents,
    setAdminSecurityEvents,
    adminAuditEvents,
    setAdminAuditEvents,
    adminGameSuggestions,
    setAdminGameSuggestions,
    adminAccountSearch,
    setAdminAccountSearch,
    adminAccountRoleFilter,
    setAdminAccountRoleFilter,
    adminAccountStateFilter,
    setAdminAccountStateFilter,
    adminSecurityFilter,
    setAdminSecurityFilter,
    adminAuditFilter,
    setAdminAuditFilter,
    adminSecuritySeverity,
    setAdminSecuritySeverity,
    adminEventRange,
    setAdminEventRange,
    adminDashboardBusy,
    setAdminDashboardBusy,
    adminDashboardNotice,
    setAdminDashboardNotice,
    adminUsageFrom,
    setAdminUsageFrom,
    adminUsageTo,
    setAdminUsageTo,
    selectedAdminAccount,
    setSelectedAdminAccount,
    adminActionReason,
    setAdminActionReason,
    adminSuspendDuration,
    setAdminSuspendDuration,
    adminEraseConfirmation,
    setAdminEraseConfirmation,
    adminTransferTarget,
    setAdminTransferTarget,
    adminPlatformRoleChoice,
    setAdminPlatformRoleChoice,
    adminCorrectionBirthDate,
    setAdminCorrectionBirthDate,
  };
}

export type AdminDashboardState = ReturnType<typeof useAdminDashboardState>;
