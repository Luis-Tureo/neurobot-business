import { createHmac, timingSafeEqual } from 'node:crypto';
import { PassThrough } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import type { MultiBotManager } from '../core/multi-bot-manager.js';
import { phoneNumberIdsFromWebhook } from './meta-cloud-api-client.js';

export type MetaWebhookRouteOptions = {
  verifyToken?: string;
  appSecret?: string;
  path?: string;
};

export function registerMetaWebhookRoutes(
  server: FastifyInstance,
  manager: MultiBotManager,
  logger: Logger,
  options: MetaWebhookRouteOptions,
): void {
  const routePath = options.path ?? '/webhooks/meta/whatsapp';
  const rawBodies = new WeakMap<object, Buffer>();

  server.addHook('preParsing', async (request, _reply, payload) => {
    if (request.method !== 'POST' || request.url.split('?')[0] !== routePath) return payload;
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    payload.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buffer);
      output.write(buffer);
    });
    payload.on('end', () => {
      rawBodies.set(request.raw, Buffer.concat(chunks));
      output.end();
    });
    payload.on('error', (error) => output.destroy(error));
    return output;
  });

  server.get(routePath, async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const mode = query['hub.mode'];
    const verifyToken = query['hub.verify_token'];
    const challenge = query['hub.challenge'];
    if (options.verifyToken === undefined || options.verifyToken.trim() === '') {
      return reply.code(503).send({ error: 'El webhook de Meta todavía no está configurado.' });
    }
    if (mode !== 'subscribe' || verifyToken !== options.verifyToken || typeof challenge !== 'string') {
      return reply.code(403).send({ error: 'La verificación del webhook no es válida.' });
    }
    return reply.type('text/plain').send(challenge);
  });

  server.post(routePath, async (request, reply) => {
    if (options.appSecret === undefined || options.appSecret.trim() === '') {
      return reply.code(503).send({ error: 'META_APP_SECRET no está configurado.' });
    }
    const rawBody = rawBodies.get(request.raw) ?? Buffer.from(JSON.stringify(request.body));
    const signatureHeader = request.headers['x-hub-signature-256'];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    if (!isValidSignature(rawBody, signature, options.appSecret)) {
      logger.warn({ operation: 'META_WEBHOOK_SIGNATURE_REJECTED' }, 'Webhook de Meta rechazado');
      return reply.code(401).send({ error: 'Firma de Meta inválida.' });
    }

    const phoneNumberIds = phoneNumberIdsFromWebhook(request.body);
    if (phoneNumberIds.length === 0) return reply.code(200).send({ received: true });

    let receivedMessages = 0;
    let statusUpdates = 0;
    for (const phoneNumberId of phoneNumberIds) {
      const client = manager.metaCloudClientForPhoneNumberId(phoneNumberId);
      if (client === null) {
        logger.warn(
          { operation: 'META_WEBHOOK_UNKNOWN_PHONE_NUMBER', phoneNumberId },
          'No existe un asistente configurado para el número de Meta recibido',
        );
        continue;
      }
      const result = await client.handleWebhook(request.body);
      receivedMessages += result.receivedMessages;
      statusUpdates += result.statusUpdates;
    }

    return reply.code(200).send({ received: true, receivedMessages, statusUpdates });
  });
}

function isValidSignature(body: Buffer, signature: string | undefined, appSecret: string): boolean {
  if (signature === undefined || !signature.startsWith('sha256=')) return false;
  const received = Buffer.from(signature.slice('sha256='.length), 'hex');
  const expected = createHmac('sha256', appSecret).update(body).digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}
