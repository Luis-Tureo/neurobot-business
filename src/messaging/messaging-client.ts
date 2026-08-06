import type {
  ConnectionState,
  IncomingMessage,
} from '../domain/types.js';
export type MessagingClientEvents = {
  onMessage: (message: IncomingMessage) => Promise<void>;
  onStateChange: (state: ConnectionState, reason?: string) => void;
  onReady: () => void | Promise<void>;
  onQr: (qr: string) => void;
};
export type InteractiveMenuPayload = {
  title: string;
  message: string;
  helpText: string;
  options: Array<{ id: string; label: string }>;
  kind: 'buttons' | 'list';
};
export type SelectableMenuPayload = Omit<InteractiveMenuPayload, 'kind'>;
export interface MessagingClient {
  setEvents(events: MessagingClientEvents): void;
  initialize(): Promise<void>;
  destroy(): Promise<void>;
  sendMessage(chatId: string, text: string, replyToMessageId?: string): Promise<void>;
  sendMedia?(chatId: string, absolutePath: string, caption: string): Promise<void>;
  sendInteractiveMenu?(chatId: string, payload: InteractiveMenuPayload): Promise<boolean>;
  sendSelectableMenu?(chatId: string, payload: SelectableMenuPayload): Promise<boolean>;
  getState(): Promise<string | null>;
  isReady(): boolean;
  isOwnIdentifier(identifier: string): boolean;
  getOwnIdentifier?(): string | null;
}
