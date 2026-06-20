/**
 * 40_Api.gs — RPC surface for the frontend.
 * Naming: api_{entity}_{action}.
 * Every handler is thin: just calls a service and lets wrapApi format the response.
 */

function wrapApi(fn) {
  try {
    return { ok: true, data: fn() };
  } catch (e) {
    const code = (e && e.code) || 'INTERNAL';
    const message = (e && e.message) || String(e);
    const details = (e && e.details) || null;
    // Log to Stackdriver for debugging
    console.error('API error [' + code + ']: ' + message + (e && e.stack ? '\n' + e.stack : ''));
    return { ok: false, error: { code, message, details } };
  }
}

// ---------- Auth / bootstrap ----------

function api_auth_me() {
  return wrapApi(() => ({
    email: currentUserEmail(),
    timezone: ConfigService.get('system.timezone', 'Asia/Kathmandu'),
    schemaVersion: ConfigService.get('system.schemaVersion', SCHEMA_VERSION)
  }));
}

function api_bootstrap_status() {
  return wrapApi(() => Bootstrap.status());
}

// ---------- Configs ----------

function api_configs_list()          { return wrapApi(() => ConfigService.list()); }
function api_configs_set(p)          { return wrapApi(() => ConfigService.set(p.key, p.value)); }

// ---------- Students ----------

function api_students_list(p)        { return wrapApi(() => StudentService.list(p || {})); }
function api_students_get(p)         { return wrapApi(() => StudentService.get(p.uuid)); }
function api_students_create(p)      { return wrapApi(() => StudentService.create(p)); }
function api_students_update(p)      { return wrapApi(() => StudentService.update(p.uuid, p.patch || {})); }
function api_students_softDelete(p)  { return wrapApi(() => StudentService.softDelete(p.uuid)); }
function api_students_courses()      { return wrapApi(() => StudentService.courses()); }
function api_students_batches()      { return wrapApi(() => StudentService.batches()); }
function api_students_importCsv(p)   { return wrapApi(() => StudentService.importCsv(p.csv, p.options || {})); }
function api_students_exportCsv()    { return wrapApi(() => StudentService.exportCsv()); }

// ---------- Templates ----------

function api_templates_list(p)       { return wrapApi(() => TemplateService.list(p || {})); }
function api_templates_get(p)        { return wrapApi(() => TemplateService.get(p.uuid)); }
function api_templates_create(p)     { return wrapApi(() => TemplateService.create(p)); }
function api_templates_update(p)     { return wrapApi(() => TemplateService.update(p.uuid, p.patch || {})); }
function api_templates_remove(p)     { return wrapApi(() => TemplateService.remove(p.uuid)); }
function api_templates_validate(p)   { return wrapApi(() => TemplateService.validatePlaceholders(p.body)); }
function api_templates_renderPreview(p) {
  return wrapApi(() => {
    const sampleStudent = (StudentService.list({ active: true })[0]) || {
      Name: 'Sample', FullName: 'Sample Student', Course: 'Sample',
      Batch: 'Morning', TeamsEmail: 'sample@example.com', Homework: 'Assignment 1'
    };
    return {
      rendered: TemplateService.render(p.body, sampleStudent, p.params || {}),
      length: TemplateService.render(p.body, sampleStudent, p.params || {}).length,
      maxLength: Number(ConfigService.get('limits.maxMessageLength', 1500)),
      sampleStudent
    };
  });
}

// ---------- Compose ----------

function api_compose_preview(p)      { return wrapApi(() => ComposeService.generatePreview(p)); }
function api_compose_previewAdhoc(p) { return wrapApi(() => ComposeService.generateAdhocPreview(p)); }
function api_compose_commit(p)       { return wrapApi(() => ComposeService.commitToQueue(p)); }

// ---------- Queue ----------

function api_queue_list()            { return wrapApi(() => QueueService.list()); }
function api_queue_edit(p)           { return wrapApi(() => QueueService.editMessage(p.uuid, p.body)); }
function api_queue_markSent(p)       { return wrapApi(() => QueueService.markSent(p.uuid)); }
function api_queue_skip(p)           { return wrapApi(() => QueueService.skip(p.uuid, p.reason)); }
function api_queue_clear()           { return wrapApi(() => QueueService.clearAll()); }

// ---------- History ----------

function api_history_list(p)         { return wrapApi(() => HistoryService.list(p || {})); }
function api_history_exportCsv(p)    { return wrapApi(() => HistoryService.exportCsv(p || {})); }

// ---------- Dashboard ----------

function api_dashboard_summary()     { return wrapApi(() => DashboardService.summary()); }

// ---------- AI ----------

function api_ai_draft(p)             { return wrapApi(() => AiFeatureService.draft(p)); }
function api_ai_paraphrase(p)        { return wrapApi(() => AiFeatureService.paraphrase(p)); }
function api_ai_paraphraseBatch(p)   { return wrapApi(() => AiFeatureService.paraphraseBatch(p)); }

// ---------- LLM Usage ----------

function api_llmusage_summary(p)     { return wrapApi(() => DashboardService.llmUsageSummary(p || {})); }
function api_llmusage_detail(p)      { return wrapApi(() => DashboardService.llmCallDetail(p.uuid)); }

// ---------- Settings: AI keys ----------

function api_settings_aiKeyStatus() {
  return wrapApi(() => {
    const props = PropertiesService.getScriptProperties();
    const out = {};
    Object.keys(LLM_KEY_NAMES).forEach(provider => {
      const k = props.getProperty(LLM_KEY_NAMES[provider]);
      out[provider] = {
        set: !!k,
        masked: k ? maskKey(k) : ''
      };
    });
    return out;
  });
}

function api_settings_setApiKey(p) {
  return wrapApi(() => {
    if (!p || !p.provider || !LLM_KEY_NAMES[p.provider]) {
      throw new ValidationError('Unknown provider');
    }
    if (!p.key || !String(p.key).trim()) {
      throw new ValidationError('Key cannot be empty');
    }
    PropertiesService.getScriptProperties()
      .setProperty(LLM_KEY_NAMES[p.provider], String(p.key).trim());
    return { ok: true };
  });
}

function api_settings_clearApiKey(p) {
  return wrapApi(() => {
    if (!p || !p.provider || !LLM_KEY_NAMES[p.provider]) {
      throw new ValidationError('Unknown provider');
    }
    PropertiesService.getScriptProperties().deleteProperty(LLM_KEY_NAMES[p.provider]);
    return { ok: true };
  });
}

// ---------- Import / Export ----------

function api_workspace_backup() {
  return wrapApi(() => ({
    schemaVersion: SCHEMA_VERSION,
    exportedAt: nowIso(),
    students: StudentRepo.list(),
    templates: TemplateRepo.list(),
    history: HistoryRepo.list(),
    queue: QueueRepo.list(),
    configs: ConfigRepo.list()
    // Keys and full LlmCalls prompts/responses are NOT included.
  }));
}

// ---------- Assignments ----------

function api_assignments_list(p)       { return wrapApi(() => AssignmentService.list(p || {})); }
function api_assignments_get(p)        { return wrapApi(() => AssignmentService.get(p.uuid)); }
function api_assignments_create(p)     { return wrapApi(() => AssignmentService.create(p)); }
function api_assignments_update(p)     { return wrapApi(() => AssignmentService.update(p.uuid, p.patch || {})); }
function api_assignments_remove(p)     { return wrapApi(() => AssignmentService.remove(p.uuid)); }

/**
 * Bundle of context for the Compose "Parameters" step.
 * Input: { course, batch }
 * Output: { assignments: [...matching, active...], lastUsed: 'asn_…' | '' }
 */
function api_compose_paramContext(p) {
  return wrapApi(() => {
    const opts = p || {};
    const assignments = AssignmentService.list({
      active: true,
      course: opts.course || null,
      batch:  opts.batch  || null
    }).map(a => ({
      UUID: a.UUID,
      Name: a.Name,
      Description: a.Description,
      Course: a.Course,
      Batch: a.Batch,
      DueDate: a.DueDate,
      Variables: AssignmentService.parseVariables(a.Variables)
    }));
    const lastUsed = _getLastAssignment(opts.course || '', opts.batch || '');
    return { assignments, lastUsed };
  });
}
