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

export type GoogleTokenSet = {
  accessToken: string;
  refreshToken?: string;
  expiryDate?: number;
  scope?: string;
  tokenType?: string;
};
