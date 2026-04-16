export const SCOPES = {
  openid: "openid",
  email: "email",
  userinfoEmail: "https://www.googleapis.com/auth/userinfo.email",
  gmailReadonly: "https://www.googleapis.com/auth/gmail.readonly",
  calendarReadonly: "https://www.googleapis.com/auth/calendar.readonly",
  calendarEvents: "https://www.googleapis.com/auth/calendar.events",
} as const;

export type ScopeConfig = {
  gmailRead: boolean;
  calendarRead: boolean;
  calendarWrite?: boolean;
};

/**
 * Builds the OAuth scope list. OIDC scopes (openid, email, userinfo.email)
 * are always included so fetchUserEmail() can identify the authorized account.
 */
export function buildScopes(cfg: ScopeConfig): string[] {
  const scopes: string[] = [SCOPES.openid, SCOPES.email, SCOPES.userinfoEmail];
  if (cfg.gmailRead) scopes.push(SCOPES.gmailReadonly);
  if (cfg.calendarRead) scopes.push(SCOPES.calendarReadonly);
  if (cfg.calendarWrite) scopes.push(SCOPES.calendarEvents);
  return scopes;
}
