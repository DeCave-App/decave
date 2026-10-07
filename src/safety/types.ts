export const REPORT_CATEGORIES = [
  "HARASSMENT_BULLYING",
  "HATE_SPEECH",
  "SEXUAL_INAPPROPRIATE",
  "SUSPECTED_GROOMING",
  "CHILD_SAFETY",
  "THREATS_VIOLENCE",
  "SPAM_SCAM",
  "IMPERSONATION",
  "UNDERAGE_USER",
  "INAPPROPRIATE_MEDIA",
  "SELF_HARM",
  "OTHER",
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const REPORT_URGENCIES = ["critical", "high", "medium", "low", "spam_invalid"] as const;

export type ReportUrgency = (typeof REPORT_URGENCIES)[number];

export type ReportTargetType = "user" | "message" | "content" | "attachment" | "profile" | "voice_participant";

export type SafetyReportTarget = {
  targetType: ReportTargetType;
  targetId: string;
  subjectUserId?: string;
  subjectUsername?: string;
  contextType?: string;
  contextId?: string;
  contextLabel?: string;
  hubId?: number;
  roomId?: number;
  evidenceType?: "message" | "attachment" | "profile" | "context" | "voice_participant";
  evidenceText?: string;
  evidenceLabel?: string;
};

export type SafetyReport = {
  id: string;
  caseId: string;
  caseNumber: string | null;
  targetType: ReportTargetType;
  targetId: string;
  targetUsername: string | null;
  subjectUserId: string | null;
  subjectUsername: string | null;
  contextType: string | null;
  contextId: string | null;
  contextLabel: string | null;
  category: ReportCategory;
  description: string;
  urgencyRecommended: ReportUrgency;
  urgency: ReportUrgency;
  urgencySource: "system" | "reporter" | "owner";
  status:
    | "submitted"
    | "under_review"
    | "awaiting_information"
    | "action_taken"
    | "no_violation"
    | "escalated"
    | "appealed"
    | "closed";
  submittedAt: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
};

export type SafetyProfile = {
  ageStatus: "unconfirmed" | "eligible" | "ineligible" | "review";
  ageBand: "unknown" | "teen" | "adult";
  teenSafetyMode: boolean;
  agePolicyVersion: string;
  ageAcknowledgedAt: string | null;
  ageVerifiedAt: string | null;
  ageGateRequired: boolean;
};
