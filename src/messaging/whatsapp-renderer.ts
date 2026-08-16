import type { ConversationResponse } from '../domain/types.js';
import type { InteractiveMenuPayload, MessagingClient } from './messaging-client.js';

export type WhatsAppRenderableMessage =
  { type: 'text'; text: string } | { type: 'interactive'; interactive: InteractiveMenuPayload };

export class WhatsAppRenderer {
  public render(response: ConversationResponse): WhatsAppRenderableMessage {
    if (response.presentation === 'text') {
      return { type: 'text', text: response.message.slice(0, 4096) };
    }
    const kind = response.presentation === 'buttons' ? 'buttons' : 'list';
    const maximum = kind === 'buttons' ? 3 : 10;
    if (response.options.length < 1 || response.options.length > maximum) {
      throw new Error('WHATSAPP_INTERACTIVE_OPTION_COUNT_INVALID');
    }
    return {
      type: 'interactive',
      interactive: {
        title:
          response.presentation === 'list' ? response.title.slice(0, 60) : 'Opciones disponibles',
        message: response.message.slice(0, 1024),
        helpText: '',
        ...(response.presentation === 'list'
          ? { listButtonLabel: response.buttonLabel.slice(0, 20) }
          : {}),
        options: response.options.map((option) => ({
          id: validInteractiveId(option.id),
          label: option.label.slice(0, kind === 'buttons' ? 20 : 24),
          ...(option.description === undefined
            ? {}
            : { description: option.description.slice(0, 72) }),
          ...(option.section === undefined ? {} : { section: option.section.slice(0, 24) }),
        })),
        kind,
      },
    };
  }

  public async send(
    client: MessagingClient,
    chatId: string,
    response: ConversationResponse,
  ): Promise<'text' | 'buttons' | 'list' | 'numbered'> {
    const rendered = this.render(response);
    if (rendered.type === 'text') {
      await client.sendMessage(chatId, rendered.text);
      return 'text';
    }
    if (client.sendInteractiveMenu !== undefined) {
      const sent = await client.sendInteractiveMenu(chatId, rendered.interactive);
      if (sent) return rendered.interactive.kind;
    }
    await client.sendMessage(
      chatId,
      [
        rendered.interactive.message,
        '',
        ...rendered.interactive.options.map((option, index) => `${index + 1}. ${option.label}`),
      ]
        .join('\n')
        .slice(0, 4096),
    );
    return 'numbered';
  }
}

function validInteractiveId(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_.:-]{1,200}$/u.test(normalized)) {
    throw new Error('WHATSAPP_INTERACTIVE_ID_INVALID');
  }
  return normalized;
}
