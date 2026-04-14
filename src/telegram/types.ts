export type TelegramInboundRequest = {
  messageId: number;
  chatId: string;
  userId: string;
  username?: string;
  text: string;
  receivedAt: string;
  replyToMessageId?: number;
};

export type TelegramSendOptions = {
  replyToMessageId?: number;
  parseMode?: "HTML" | "MarkdownV2";
};
