export function setCsrfToken(value: unknown): void;
export function clearCsrfToken(): void;
export function setOrganizationTypeAliases(aliases: unknown): void;
export function normalizeOrganizationType(value: unknown): unknown;
export function normalizeOrganizationTypePayload(body: unknown): unknown;
export function friendlyApiError(
  payload: unknown,
  response: { status: number },
): { technicalMessage: string; message: string };
export function api(path: string, options?: Record<string, unknown>): Promise<unknown>;
