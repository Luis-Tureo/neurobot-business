import type {
  ConnectionState,
  IncomingMessage,
  MetaMessageStatus,
  OutboundMessageAccepted,
} from '../domain/types.js';

export type MessagingClientEvents = {
  onMessage: (message: IncomingMessage) => Promise<void>;
  onStateChange: (state: ConnectionState, reason?: string) => void;
  onReady: () => void | Promise<void>;
  onDeliveryStatus?: (status: MetaMessageStatus) => void | Promise<void>;
  onOutboundMessage?: (message: OutboundMessageAccepted) => void | Promise<void>;
};

export type InteractiveMenuPayload = {
  title: string;
  message: string;
  helpText: string;
  options: Array<{ id: string; label: string }>;
  kind: 'buttons' | 'list';
};

export interface MessagingClient {
  setEvents(events: MessagingClientEvents): void;
  initialize(): Promise<void>;
  destroy(): Promise<void>;
  sendMessage(chatId: string, text: string, replyToMessageId?: string): Promise<void>;
  sendMedia?(chatId: string, absolutePath: string, caption: string): Promise<void>;
  sendInteractiveMenu?(chatId: string, payload: InteractiveMenuPayload): Promise<boolean>;
  getState(): Promise<string | null>;
  isReady(): boolean;
}
