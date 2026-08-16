import { z } from 'zod';
import type { AIUsage, SemanticResponse } from '../domain/types.js';
import type { ToolDescriptor } from '../core/tool-registry.js';
import { AIProviderError, type AIProvider } from './ai-provider.js';

const semanticResponseSchema = z
  .object({
    message: z.string().trim().min(1).max(2000),
    intent: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{1,79}$/u),
    presentation_preference: z.enum(['text', 'buttons', 'list', 'automatic']).default('automatic'),
    suggested_actions: z
      .array(
        z
          .string()
          .trim()
          .regex(/^[a-z][a-z0-9_]{1,79}$/u),
      )
      .max(10)
      .default([]),
    tool_request: z
      .object({
        name: z
          .string()
          .trim()
          .regex(/^[a-z][a-z0-9_]{2,63}$/u),
        arguments: z.record(
          z.string(),
          z.union([z.string().max(500), z.number().finite(), z.boolean(), z.null()]),
        ),
      })
      .strict()
      .nullable()
      .default(null),
  })
  .strict();

export type AIOrchestratorResult = {
  semantic: SemanticResponse;
  usage: AIUsage;
  provider: string;
  model: string;
};

export class AIOrchestrator {
  public constructor(private readonly provider: AIProvider) {}

  public async orchestrate(input: {
    question: string;
    stableKnowledge: string;
    availableTools: ToolDescriptor[];
    maximumOutputTokens: number;
    timeoutMs: number;
    businessInstruction?: string;
  }): Promise<AIOrchestratorResult> {
    const tools = input.availableTools
      .filter((tool) => tool.availability === 'AVAILABLE' && tool.state === 'ENABLED')
      .map((tool) => ({
        id: tool.id,
        description: tool.description,
        input_schema: tool.inputSchema,
      }));
    const generated = await this.provider.generateGroundedResponse({
      systemInstruction: systemInstruction(tools, input.businessInstruction),
      question: input.question,
      context: input.stableKnowledge,
      maximumOutputTokens: Math.min(600, Math.max(80, input.maximumOutputTokens)),
      temperature: 0,
      timeoutMs: input.timeoutMs,
    });
    const semantic = parseSemanticResponse(generated.text);
    const model = this.provider.getModelInformation();
    return {
      semantic,
      usage: generated.usage,
      provider: model.provider,
      model: model.model,
    };
  }
}

export function parseSemanticResponse(value: string): SemanticResponse {
  const candidate = extractJSONObject(value);
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new AIProviderError(
      'AI_INVALID_RESPONSE',
      'La respuesta semántica del proveedor no es JSON válido.',
    );
  }
  const validated = semanticResponseSchema.safeParse(parsed);
  if (!validated.success) {
    throw new AIProviderError(
      'AI_INVALID_RESPONSE',
      'La respuesta semántica no cumple el contrato interno.',
    );
  }
  return {
    message: validated.data.message,
    intent: validated.data.intent,
    presentationPreference: validated.data.presentation_preference,
    suggestedActions: [...new Set(validated.data.suggested_actions)],
    toolRequest:
      validated.data.tool_request === null
        ? null
        : {
            name: validated.data.tool_request.name,
            arguments: validated.data.tool_request.arguments,
          },
  };
}

function extractJSONObject(value: string): string {
  const normalized = value
    .trim()
    .replace(/^```(?:json)?\s*/iu, '')
    .replace(/\s*```$/u, '');
  const start = normalized.indexOf('{');
  const end = normalized.lastIndexOf('}');
  return start >= 0 && end > start ? normalized.slice(start, end + 1) : normalized;
}

function systemInstruction(
  tools: Array<Record<string, unknown>>,
  businessInstruction: string | undefined,
): string {
  return [
    ...(businessInstruction === undefined
      ? []
      : ['REGLAS DEL ASISTENTE Y DEL NEGOCIO:', businessInstruction]),
    'Eres el planificador semántico de Don Gato Digital.',
    'Devuelve solamente un objeto JSON con message, intent, presentation_preference, suggested_actions y tool_request.',
    'Nunca construyas payloads de WhatsApp o Meta Cloud API.',
    'Nunca inventes horarios, precios, stock, productos, servicios, reservas ni opciones operativas.',
    'Cuando la respuesta requiera datos empresariales, solicita exactamente una herramienta disponible y no inventes su resultado.',
    'Si ninguna herramienta disponible aporta los datos, usa tool_request=null y explica brevemente que falta una fuente real.',
    `HERRAMIENTAS DISPONIBLES: ${JSON.stringify(tools)}`,
  ].join('\n');
}
