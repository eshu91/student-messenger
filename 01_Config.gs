/**
 * 01_Config.gs — constants, enums, column maps.
 * No business logic here. No reads from the spreadsheet here.
 */

const WORKBOOK_NAME = 'Everest Student Messenger DB';
const SCHEMA_VERSION = '1';

const TYPE_PREFIX = {
  Configs:   'cfg',
  Students:  'usr',
  Templates: 'tpl',
  Queue:     'que',
  History:   'his',
  LlmCalls:  'llm'
};

const LLM_KEY_NAMES = {
  groq:       'LLM_KEY_GROQ',
  openai:     'LLM_KEY_OPENAI',
  anthropic:  'LLM_KEY_ANTHROPIC',
  gemini:     'LLM_KEY_GEMINI',
  openrouter: 'LLM_KEY_OPENROUTER'
};

// Shared audit header — first 6 columns of every sheet.
const AUDIT_HEADERS = ['UUID', 'SN', 'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy'];

// Per-sheet headers (entity columns start at G == index 6).
const SHEET_HEADERS = {
  Configs: AUDIT_HEADERS.concat([
    'Category', 'Key', 'Value', 'Type', 'Description', 'Editable', 'EnumValues'
  ]),
  Students: AUDIT_HEADERS.concat([
    'Name', 'FullName', 'TeamsEmail', 'PersonalEmail', 'Phone',
    'Course', 'Batch', 'JoinedDate', 'Homework', 'Tags', 'Active', 'Notes'
  ]),
  Templates: AUDIT_HEADERS.concat([
    'Name', 'Description', 'Body', 'SupportedCourses', 'Source', 'Active', 'UsageCount'
  ]),
  Queue: AUDIT_HEADERS.concat([
    'StudentUUID', 'TemplateUUID', 'CampaignTag', 'RenderedMessage',
    'WasAiAssisted', 'AiCallUUIDs', 'TeamsLink', 'Status', 'SentAt', 'SkipReason'
  ]),
  History: AUDIT_HEADERS.concat([
    'StudentUUID', 'StudentName', 'StudentEmail', 'TemplateUUID', 'TemplateName',
    'CampaignTag', 'RenderedMessage', 'WasAiAssisted', 'FinalStatus', 'SkipReason'
  ]),
  LlmCalls: AUDIT_HEADERS.concat([
    'Feature', 'Provider', 'Model', 'PromptHash', 'Prompt', 'Response',
    'InputTokens', 'OutputTokens', 'EstCostUSD', 'LatencyMs',
    'Status', 'ErrorMessage', 'RelatedEntityUUID'
  ])
};

// Build a name → 0-based index map from a headers array.
function _colMap(headers) {
  const m = {};
  headers.forEach((h, i) => { m[h] = i; });
  return m;
}

const COL = {
  Configs:   _colMap(SHEET_HEADERS.Configs),
  Students:  _colMap(SHEET_HEADERS.Students),
  Templates: _colMap(SHEET_HEADERS.Templates),
  Queue:     _colMap(SHEET_HEADERS.Queue),
  History:   _colMap(SHEET_HEADERS.History),
  LlmCalls:  _colMap(SHEET_HEADERS.LlmCalls)
};

const ENUMS = {
  QueueStatus:  ['Pending', 'Sent', 'Skipped', 'Failed'],
  FinalStatus:  ['Sent', 'Skipped'],
  LlmFeature:   ['draft', 'paraphrase', 'personalize', 'translate', 'other'],
  LlmProvider:  ['groq', 'openai', 'anthropic', 'gemini', 'openrouter'],
  LlmStatus:    ['success', 'error', 'timeout', 'blocked-by-cap'],
  ConfigType:   ['string', 'number', 'boolean', 'json', 'enum'],
  TemplateSource: ['manual', 'ai-drafted']
};

// Seeded configs — written by Bootstrap on first run.
// Shape: [Category, Key, Value, Type, Description, Editable, EnumValues]
const SEED_CONFIGS = [
  ['branding', 'signature', '— Ishwari | Everest IT', 'string', 'Appended to messages when {signature} placeholder is used', true, ''],
  ['branding', 'fromName',  'Ishwari', 'string', 'Sender display name', true, ''],

  ['system', 'timezone', 'Asia/Kathmandu', 'string', 'Timezone for dates and triggers (NPT)', true, ''],
  ['system', 'locale',   'en-NP', 'string', 'Locale for formatting', true, ''],
  ['system', 'sheetName.students',  'Students',  'string', 'Sheet name for students',  false, ''],
  ['system', 'sheetName.templates', 'Templates', 'string', 'Sheet name for templates', false, ''],
  ['system', 'sheetName.queue',     'Queue',     'string', 'Sheet name for queue',     false, ''],
  ['system', 'sheetName.history',   'History',   'string', 'Sheet name for history',   false, ''],
  ['system', 'sheetName.llmCalls',  'LlmCalls',  'string', 'Sheet name for LLM calls', false, ''],
  ['system', 'schemaVersion', SCHEMA_VERSION, 'number', 'Internal schema version', false, ''],

  ['limits', 'maxMessageLength',     '1500', 'number', 'Hard cap on rendered message length',           true, ''],
  ['limits', 'maxQueueSize',         '200',  'number', 'Maximum simultaneous Pending rows in queue',    true, ''],
  ['limits', 'historyRetentionDays', '365',  'number', 'Days to keep history rows (informational)',     true, ''],

  ['features', 'ai.enabled',          'true',  'boolean', 'Global on/off for all AI features',          true, ''],
  ['features', 'ai.draft',            'true',  'boolean', 'Enable Draft with AI',                       true, ''],
  ['features', 'ai.paraphrase',       'true',  'boolean', 'Enable Paraphrase',                          true, ''],
  ['features', 'ai.personalize',      'false', 'boolean', 'Per-student personalization (Phase 2)',      true, ''],
  ['features', 'ai.translate',        'false', 'boolean', 'Translate (Phase 2)',                        true, ''],
  ['features', 'scheduledTriggers',   'false', 'boolean', 'Time-driven triggers (Phase 2)',             true, ''],

  ['ai', 'defaultProvider',  'groq', 'enum',   'Default LLM provider', true, 'groq,openai,anthropic,gemini,openrouter'],
  ['ai', 'model.groq',       'llama-3.3-70b-versatile', 'string', 'Default Groq model',       true, ''],
  ['ai', 'model.openai',     'gpt-4o-mini',             'string', 'Default OpenAI model',     true, ''],
  ['ai', 'model.anthropic',  'claude-haiku-4-5',        'string', 'Default Anthropic model',  true, ''],
  ['ai', 'model.gemini',     'gemini-2.0-flash',        'string', 'Default Gemini model',     true, ''],
  ['ai', 'model.openrouter', 'meta-llama/llama-3.3-70b-instruct', 'string', 'Default OpenRouter model', true, ''],
  ['ai', 'maxTokensOutput',  '500', 'number', 'Maximum output tokens per call', true, ''],
  ['ai', 'temperature',      '0.7', 'number', 'Sampling temperature',           true, ''],
  ['ai', 'monthlyWarningUSD','5',   'number', 'Soft warning when monthly spend exceeds this',  true, ''],
  ['ai', 'monthlyHardCapUSD','20',  'number', 'Hard block on new calls when monthly spend exceeds this', true, ''],
  ['ai', 'timeoutSec',       '30',  'number', 'Per-call timeout in seconds',    true, ''],

  ['defaults', 'courseFilter', '', 'string', 'Default course filter on Compose', true, ''],
  ['defaults', 'batchFilter',  '', 'string', 'Default batch filter on Compose',  true, '']
];

// One seed template so a new install isn't empty.
const SEED_TEMPLATES = [
  {
    Name: 'Homework reminder',
    Description: 'Friendly reminder to complete pending homework',
    Body: 'Hello {name},\n\nA quick reminder to complete your {course} homework: {homework}.\n\nLet me know if you need any help.\n\n{signature}',
    SupportedCourses: '*',
    Source: 'manual',
    Active: true,
    UsageCount: 0
  }
];
