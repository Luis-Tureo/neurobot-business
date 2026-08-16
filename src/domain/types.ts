export type ConnectionState =
  | 'disconnected'
  | 'initializing'
  | 'authenticated'
  | 'loading_chats'
  | 'connected'
  | 'auth_failure'
  | 'reconnecting'
  | 'resetting';

export type IncomingMessage = {
  id: string;
  replyToMessageId?: string;
  businessPhoneNumberId?: string;
  receivedAt?: string;
  chatId: string;
  customerId: string;
  messageType?: string;
  visibleText?: string;
  caption?: string;
  contactName?: string;
  body: string;
  hasMedia: boolean;
  isReplyToBot: boolean;
};

export type MetaMessageStatus = {
  eventId: string;
  messageId: string;
  phoneNumberId: string;
  recipientId: string | null;
  status: 'sent' | 'delivered' | 'read' | 'failed' | 'deleted' | 'unknown';
  occurredAt: string;
  conversationId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type OutboundMessageAccepted = {
  messageId: string | null;
  phoneNumberId: string;
  recipientId: string;
  messageType: string;
  text: string | null;
  caption: string | null;
  acceptedAt: string;
};

export type ConnectionSnapshot = {
  state: ConnectionState;
  lastConnectedAt: string | null;
  reconnectAttempt: number;
  lastErrorCode: string | null;
};

export type OrganizationType =
  | 'Comercio'
  | 'Restaurante'
  | 'Servicios'
  | 'Salud'
  | 'Belleza'
  | 'Turismo'
  | 'Transporte'
  | 'Educación'
  | 'Profesional independiente'
  | 'Otro';

export type BusinessStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ERROR';

export type Business = {
  id: string;
  slug: string;
  name: string;
  description: string;
  language: string;
  timezone: string;
  status: BusinessStatus;
  createdAt: string;
  updatedAt: string;
};

export type AssistantChannel = 'WHATSAPP';

export type AIProviderId = 'groq' | 'disabled';

export type AssistantProfile = {
  id: number;
  internalName: string;
  organizationName: string;
  botName: string;
  description: string;
  organizationType: OrganizationType;
  industry: string;
  objective: string;
  allowedTopics: string[];
  excludedTopics: string[];
  tone: string;
  outOfScopeMessage: string;
  noInformationMessage: string;
  limitMessage: string;
  aiErrorMessage: string;
  medicalMessage: string;
  contactInformation: string;
  businessHours: string;
  address: string | null;
  logoPath: string | null;
  primaryColor: string;
  secondaryColor: string;
  timezone: string;
  active: boolean;
  applicationName: string;
  headerText: string;
  footerText: string;
  supportInformation: string;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeCategory = {
  id: number;
  profileId: number;
  name: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeEntry = {
  id: number;
  profileId: number;
  categoryId: number;
  categoryName: string;
  title: string;
  content: string;
  keywords: string[];
  synonyms: string[];
  enabled: boolean;
  priority: number;
  internalSource: string | null;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeFragment = {
  entryId: number;
  title: string;
  category: string;
  content: string;
  relevance: number;
  keywords: string[];
  internalSource: string | null;
  updatedAt: string;
};

export type CachedAnswerStatus =
  'AUTO_VERIFIED' | 'ADMIN_APPROVED' | 'ADMIN_EDITED' | 'DISABLED' | 'INVALIDATED';

export type CachedAnswerSourceType = 'AI_GENERATED' | 'ADMIN_FAQ' | 'MANUAL';

export type CachedAnswer = {
  id: number;
  botId: string;
  canonicalQuestion: string;
  normalizedQuestionHash: string;
  answer: string;
  category: string;
  knowledgeSourceIds: number[];
  knowledgeVersion: string;
  promptVersion: string;
  status: CachedAnswerStatus;
  sourceType: CachedAnswerSourceType;
  confidence: number;
  hitCount: number;
  apiCallsSaved: number;
  variants: string[];
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  invalidatedAt: string | null;
  invalidationReason: string | null;
};

export type AISettings = {
  profileId: number;
  enabled: boolean;
  provider: AIProviderId;
  model: string;
  providerConfig: { model?: string };
  questionMaxChars: number;
  contextMaxTokens: number;
  inputMaxTokens: number;
  responseMaxTokens: number;
  responseMaxChars: number;
  responseMaxLines: number;
  temperature: number;
  userHourlyLimit: number;
  userDailyLimit: number;
  userCooldownSeconds: number;
  interactionHourlyLimit: number;
  interactionCooldownSeconds: number;
  duplicateQueryWindowSeconds: number;
  conversationHourlyLimit: number;
  conversationDailyLimit: number;
  globalDailyLimit: number;
  globalMonthlyLimit: number;
  globalDailyTokenLimit: number;
  globalMonthlyTokenLimit: number;
  timeoutMs: number;
  updatedAt: string;
};

export type AIUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type AIUsageSummary = AIUsage & {
  requests: number;
  failedRequests: number;
  dailyBudgetPercent: number;
  monthlyBudgetPercent: number;
};

export type AIQueueSettings = {
  maxConcurrent: number;
  maxQueueSize: number;
  maxQueueWaitSeconds: number;
  providerTimeoutSeconds: number;
  maxRetries: number;
  initialRetryDelaySeconds: number;
  maximumRetryDelaySeconds: number;
  waitNoticeSeconds: number;
  userCooldownSeconds: number;
  duplicateWindowSeconds: number;
  singleFlightWindowSeconds: number;
  outboundMessageIntervalMs: number;
  suggestedRetrySeconds: number;
};

export type AIQueueMetrics = {
  queuedCount: number;
  processedCount: number;
  completedCount: number;
  failedCount: number;
  expiredCount: number;
  rejectedCount: number;
  timeoutCount: number;
  rateLimitCount: number;
  retryCount: number;
  coalescedCount: number;
  duplicateSuppressedCount: number;
  cacheBypassCount: number;
  averageWaitMs: number;
  maximumWaitMs: number;
};

export type AIProviderHealthState =
  'AVAILABLE' | 'BUSY' | 'RATE_LIMITED' | 'DEGRADED' | 'UNAVAILABLE' | 'NOT_CONFIGURED';

export type AIProviderStatus = {
  configured: boolean;
  enabled: boolean;
  provider: string;
  model: string;
  connection: 'not_tested' | 'successful' | 'failed';
  lastCheckedAt: string | null;
  lastErrorCode: string | null;
};

export type AIReservation = {
  id: string;
  profileId: number;
  estimatedInputTokens: number;
  reservedOutputTokens: number;
};

export type AILimitCode =
  | 'AI_LIMIT_USER_HOURLY_REACHED'
  | 'AI_LIMIT_USER_DAILY_REACHED'
  | 'AI_LIMIT_USER_COOLDOWN'
  | 'AI_LIMIT_CONVERSATION_HOURLY_REACHED'
  | 'AI_LIMIT_CONVERSATION_DAILY_REACHED'
  | 'AI_LIMIT_DAILY_REACHED'
  | 'AI_LIMIT_MONTHLY_REACHED'
  | 'AI_LIMIT_DAILY_TOKENS_REACHED'
  | 'AI_LIMIT_MONTHLY_TOKENS_REACHED';

export type AIReservationDecision =
  { allowed: true; reservation: AIReservation } | { allowed: false; code: AILimitCode };

export type MenuType = 'automatic' | 'native_buttons' | 'native_list' | 'numbered';
export type ConnectorType = 'WHATSAPP_CLOUD_API';
export type AssistantLifecycleStatus =
  | 'DRAFT'
  | 'UNLINKED'
  | 'LINKING'
  | 'CONNECTED'
  | 'DUPLICATE_CONFIGURATION'
  | 'DISABLED'
  | 'ARCHIVED'
  | 'PENDING_DELETION'
  | 'DELETED';

export type BotCapabilities = {
  privateChatsEnabled: boolean;
  conversationContinuationEnabled: boolean;
  interactiveMenusEnabled: boolean;
  numericMenuRepliesEnabled: boolean;
  catalogEnabled: boolean;
  humanAssistanceEnabled: boolean;
};

export type BotRecord = {
  id: string;
  businessId: string;
  businessName: string;
  businessDescription: string;
  businessLanguage: string;
  businessStatus: BusinessStatus;
  channel: AssistantChannel;
  isPrimary: boolean;
  internalIdentifier: string;
  clientId: string;
  connectorType: ConnectorType;
  lifecycleStatus: AssistantLifecycleStatus;
  deletionLocked: boolean;
  deletedAt: string | null;
  scheduledPermanentDeletionAt: string | null;
  activeConnectorId: number | null;
  capabilities: BotCapabilities;
  enabled: boolean;
  profileId: number;
  organizationName: string;
  botName: string;
  organizationType: OrganizationType;
  timezone: string;
  whatsappStatus: string;
  maskedNumber: string | null;
  lastConnectedAt: string | null;
  continuedConversationsEnabled: boolean;
  menuType: MenuType;
  createdAt: string;
  updatedAt: string;
};

export type WhatsAppSetupMode = 'EXISTING' | 'NEW_CUSTOMER' | 'NEW_PLATFORM';
export type WhatsAppWebhookStatus = 'NOT_CONFIGURED' | 'PENDING' | 'ACTIVE' | 'ERROR';

export type WhatsAppConnection = {
  id: number;
  businessId: string;
  assistantId: string;
  provider: 'META_CLOUD_API';
  setupMode: WhatsAppSetupMode;
  phoneNumberIdConfigured: boolean;
  wabaIdConfigured: boolean;
  displayPhoneNumber: string | null;
  status: 'DRAFT' | 'UNLINKED' | 'LINKING' | 'CONNECTED' | 'CONFLICT' | 'DISABLED' | 'ARCHIVED';
  webhookStatus: WhatsAppWebhookStatus;
  credentialReference: string | null;
  connectedAt: string | null;
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AssistantBehaviorSettings = {
  assistantId: string;
  showInitialMenuOnGreeting: boolean;
  allowFreeQuestions: boolean;
  useAIForUnmatched: boolean;
  useBusinessKnowledge: boolean;
  allowDynamicButtons: boolean;
  allowDynamicLists: boolean;
  allowBusinessDataQueries: boolean;
  showAISuggestedActions: boolean;
  allowWriteTools: boolean;
  fallbackMessage: string;
  humanHandoffReady: boolean;
  updatedAt: string;
};

export type AssistantReadiness = {
  whatsapp: 'NOT_CONFIGURED' | 'CONFIGURING' | 'CONNECTED' | 'ERROR';
  ai: 'NOT_CONFIGURED' | 'GROQ_CONNECTED' | 'ERROR';
  knowledge: 'EMPTY' | 'CONFIGURED';
  assistant: 'DRAFT' | 'READY_TO_TEST' | 'OPERATIONAL' | 'PAUSED' | 'ERROR';
  canActivate: boolean;
  missingRequirements: string[];
};

export type MenuDefinition = {
  id: number;
  botId: string;
  parentMenuId: number | null;
  title: string;
  message: string;
  helpText: string;
  presentation: 'AUTOMATIC' | 'BUTTONS' | 'LIST';
  listButtonLabel: string;
  enabled: boolean;
  isInitial: boolean;
  expirationMinutes: number;
  createdAt: string;
  updatedAt: string;
};

export type MenuActionType =
  | 'text'
  | 'catalog_item'
  | 'catalog_category'
  | 'media'
  | 'submenu'
  | 'knowledge'
  | 'ai'
  | 'hours'
  | 'address'
  | 'payments'
  | 'shipping'
  | 'human_assistance'
  | 'reservation_request'
  | 'back'
  | 'exit';

export type MenuOption = {
  id: number;
  botId: string;
  menuId: number;
  label: string;
  description: string;
  section: string;
  aliases: string[];
  order: number;
  actionType: MenuActionType;
  actionPayload: Record<string, string | number | boolean | null>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ToolPermission = 'READ' | 'SUGGEST' | 'EXECUTE';

export type ToolAvailability = 'AVAILABLE' | 'FUTURE';

export type AssistantToolConfiguration = {
  assistantId: string;
  businessId: string;
  toolId: string;
  enabled: boolean;
  permissions: ToolPermission[];
  updatedAt: string;
};

export type ToolResultItem = {
  resourceId: string;
  label: string;
  description?: string;
  section?: string;
  volatile: boolean;
};

export type ToolExecutionResult = {
  toolId: string;
  executionId: string;
  message: string;
  items: ToolResultItem[];
  resultCount: number;
  source: 'BUSINESS_DATA';
};

export type SemanticPresentationPreference = 'text' | 'buttons' | 'list' | 'automatic';

export type SemanticToolRequest = {
  name: string;
  arguments: Record<string, string | number | boolean | null>;
};

export type SemanticResponse = {
  message: string;
  intent: string;
  presentationPreference: SemanticPresentationPreference;
  suggestedActions: string[];
  toolRequest: SemanticToolRequest | null;
};

export type ResponseOption = {
  id: string;
  label: string;
  description?: string;
  section?: string;
  source: 'PERSISTENT' | 'TOOL';
};

export type ConversationResponse =
  | { presentation: 'text'; message: string; options: [] }
  | { presentation: 'buttons'; message: string; options: ResponseOption[] }
  | {
      presentation: 'list';
      title: string;
      message: string;
      buttonLabel: string;
      options: ResponseOption[];
    };

export type EphemeralInteractionStatus = 'ACTIVE' | 'CONSUMED' | 'EXPIRED';

export type EphemeralInteraction = {
  id: string;
  businessId: string;
  assistantId: string;
  conversationHash: string;
  toolId: string;
  actionId: string;
  resourceId: string;
  label: string;
  volatile: boolean;
  status: EphemeralInteractionStatus;
  expiresAt: string;
  createdAt: string;
  consumedAt: string | null;
};

export type ConversationState = {
  botId: string;
  chatHash: string;
  userHash: string;
  activeFlow: string;
  currentMenuId: number | null;
  previousMenuId: number | null;
  currentStep: string;
  expiresAt: string;
  updatedAt: string;
};

export type CatalogCategory = {
  id: number;
  botId: string;
  name: string;
  description: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CatalogItem = {
  id: number;
  botId: string;
  categoryId: number | null;
  name: string;
  code: string;
  description: string;
  priceAmount: number | null;
  offerPriceAmount: number | null;
  currency: string;
  presentation: string;
  size: string;
  variants: string[];
  availability: string;
  informedStock: number | null;
  primaryMediaId: number | null;
  authorizedLink: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MediaAsset = {
  id: number;
  botId: string;
  internalName: string;
  relativePath: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  byteSize: number;
  sha256: string;
  caption: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type BusinessHour = {
  id: number;
  botId: string;
  weekday: number | null;
  localDate: string | null;
  openingTime: string | null;
  closingTime: string | null;
  closed: boolean;
  label: string;
  createdAt: string;
  updatedAt: string;
};

export type HumanAssistanceRequest = {
  id: number;
  botId: string;
  chatHash: string;
  userHash: string;
  requestedInterval: string;
  localDate: string;
  status: 'pending' | 'confirmed' | 'rejected' | 'attended' | 'cancelled';
  note: string;
  createdAt: string;
  updatedAt: string;
};
