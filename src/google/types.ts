export type GoogleClientCredentials = {
  clientId: string;
  clientSecret: string;
  projectId?: string;
};

export type TokenSet = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix ms
  scopes: string[];
};

export type ParsedRedirect = {
  code: string;
  state: string;
  redirectUri: string; // scheme + host + port + path, no query
};

export type CompactEmail = {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  receivedAt: string;
  snippet: string;
  labels?: string[];
};

export type CompactEmailDetail = CompactEmail & {
  excerpt: string;
};

export type CompactCalendarEvent = {
  id: string;
  title: string;
  start: string;
  end?: string;
  location?: string;
  descriptionExcerpt?: string;
  calendarId?: string;
};
