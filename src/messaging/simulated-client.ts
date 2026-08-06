import type { MessagingClient, MessagingClientEvents } from './messaging-client.js';
import type { InteractiveMenuPayload, SelectableMenuPayload } from './messaging-client.js';
export type SentMessage = {
  chatId: string;
  text: string;
  replyToMessageId?: string;
  mentionIds?: string[];
};
export type SentMedia = {
  chatId: string;
  absolutePath: string;
  caption: string;
};