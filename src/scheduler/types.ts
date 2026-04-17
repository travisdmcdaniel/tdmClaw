/**
 * A row from the scheduled_jobs table.
 * prompt and chat_id are stored in payload_json as { prompt, chatId }.
 */
export type ScheduledJob = {
  id: string;
  name: string;
  type: string;         // informational only; always "prompt" for jobs.json-sourced jobs
  cronExpr: string;
  timezone: string;
  enabled: boolean;
  payloadJson: string;  // JSON: { prompt: string; chatId: string }
  lastRunAt?: string;
  nextRunAt: string;
  claimedAt?: string;
  claimToken?: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Shape of the payload stored in scheduled_jobs.payload_json for prompt-driven jobs.
 */
export type PromptJobPayload = {
  prompt: string;
  chatId: string;
};

/**
 * A job definition as written in jobs.json.
 */
export type JobDefinition = {
  id: string;
  name: string;
  cronExpr: string;
  timezone: string;
  enabled: boolean;
  chatId: string;
  prompt: string;
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
