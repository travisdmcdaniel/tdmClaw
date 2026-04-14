export type JobType = "daily_briefing" | "email_digest" | "calendar_briefing";

export type ScheduledJob = {
  id: string;
  name: string;
  type: JobType;
  cronExpr: string;
  timezone: string;
  enabled: boolean;
  payloadJson: string;
  lastRunAt?: string;
  nextRunAt: string;
  claimedAt?: string;
  claimToken?: string;
  createdAt: string;
  updatedAt: string;
};

export type JobRunStatus = "success" | "failure" | "running";

export type JobRun = {
  id: string;
  jobId: string;
  startedAt: string;
  finishedAt?: string;
  status: JobRunStatus;
  resultSummary?: string;
  errorText?: string;
};

export type JobHandler = (
  job: ScheduledJob,
  payload: unknown
) => Promise<{ summary: string }>;
