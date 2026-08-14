import type {
  MessagingClient,
  MessagingClientEvents,
  InteractiveMenuPayload,
} from './messaging-client.js';

export type SentMessage = {
  chatId: string;
  text: string;
  replyToMessageId?: string;
};

export type SentMedia = { chatId: string; absolutePath: string; caption: string };

export class SimulatedMessagingClient implements MessagingClient {
  public readonly sentMessages: SentMessage[] = [];
  public readonly sentMedia: SentMedia[] = [];
  public readonly sentInteractiveMenus: Array<{ chatId: string; payload: InteractiveMenuPayload }> =
    [];
  public interactiveSupported = false;
  public initializeCalls = 0;
  public destroyCalls = 0;
  public failSending = false;
  public ready = true;
  public connectionState: string | null = 'CONNECTED';
  private events: MessagingClientEvents | null = null;

  public setEvents(events: MessagingClientEvents): void {
    this.events = events;
  }

  public async initialize(): Promise<void> {
    this.initializeCalls += 1;
  }

  public async destroy(): Promise<void> {
    this.destroyCalls += 1;
    this.ready = false;
    this.connectionState = null;
  }

  public async sendMessage(chatId: string, text: string, replyToMessageId?: string): Promise<void> {
    if (this.failSending) throw new Error('Fallo simulado');
    this.sentMessages.push({
      chatId,
      text,
      ...(replyToMessageId === undefined ? {} : { replyToMessageId }),
    });
  }

  public async sendMedia(chatId: string, absolutePath: string, caption: string): Promise<void> {
    if (this.failSending) throw new Error('Fallo simulado');
    this.sentMedia.push({ chatId, absolutePath, caption });
  }

  public async sendInteractiveMenu(
    chatId: string,
    payload: InteractiveMenuPayload,
  ): Promise<boolean> {
    if (!this.interactiveSupported) return false;
    this.sentInteractiveMenus.push({ chatId, payload });
    return true;
  }

  public async getState(): Promise<string | null> {
    return this.connectionState;
  }

  public isReady(): boolean {
    return this.ready;
  }

  public emitState(
    state: Parameters<MessagingClientEvents['onStateChange']>[0],
    reason?: string,
  ): void {
    this.events?.onStateChange(state, reason);
  }

  public emitReady(): void {
    this.ready = true;
    this.connectionState = 'CONNECTED';
    void this.events?.onReady();
  }

  public async emitMessage(
    message: Parameters<MessagingClientEvents['onMessage']>[0],
  ): Promise<void> {
    await this.events?.onMessage(message);
  }
}
