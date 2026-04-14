export const GMAIL_READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const CALENDAR_READ_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
export const CALENDAR_WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events";

export function buildScopeList(options: {
  gmailRead: boolean;
  calendarRead: boolean;
  calendarWrite?: boolean;
}): string[] {
  const scopes: string[] = [];
  if (options.gmailRead) scopes.push(GMAIL_READ_SCOPE);
  if (options.calendarRead) scopes.push(CALENDAR_READ_SCOPE);
  if (options.calendarWrite) scopes.push(CALENDAR_WRITE_SCOPE);
  return scopes;
}
