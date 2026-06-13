/**
 * 21_Service_Msg.gs — Compose, Queue, History, Dashboard services.
 */

// =====================================================================
// ComposeService
// =====================================================================

const ComposeService = {
  /**
   * Generate previews from a template + filter.
   * @returns array of { student, template, rendered, teamsLink, wasAiAssisted }
   */
  generatePreview(input) {
    const { templateUuid, filter, params } = input || {};
    let template = null;
    if (templateUuid) {
      template = TemplateService.get(templateUuid);
      if (!template) throw new NotFoundError('Template not found');
    }

    const students = StudentService.list({
      active: true,
      course: (filter && filter.course) || null,
      batch:  (filter && filter.batch)  || null
    });

    if (!students.length) return [];

    return students.map(student => {
      const body = template ? template.Body : (params && params.adhocBody) || '';
      const rendered = TemplateService.render(body, student, params || {});
      TemplateService.validateLength(rendered);
      return {
        student: {
          UUID: student.UUID,
          Name: student.Name,
          FullName: student.FullName,
          TeamsEmail: student.TeamsEmail,
          Course: student.Course,
          Batch: student.Batch
        },
        template: template ? { UUID: template.UUID, Name: template.Name } : null,
        rendered,
        teamsLink: buildTeamsLink(student.TeamsEmail, rendered),
        wasAiAssisted: false,
        aiCallUuids: []
      };
    });
  },

  /**
   * Generate previews from an ad-hoc body (no saved template).
   * Used by "Draft with AI → use one-shot".
   */
  generateAdhocPreview(input) {
    return ComposeService.generatePreview({
      templateUuid: null,
      filter: input.filter,
      params: Object.assign({ adhocBody: input.body }, input.params || {})
    }).map(p => Object.assign(p, {
      wasAiAssisted: !!input.wasAiAssisted,
      aiCallUuids: input.aiCallUuids || []
    }));
  },

  /**
   * Commit previews to the Queue. Each becomes a Pending row.
   * Dedup check: same (StudentUUID, TemplateUUID, today) warns but does not block.
   */
  commitToQueue(input) {
    const { previews, templateUuid, campaignTag } = input || {};
    if (!previews || !previews.length) throw new ValidationError('Nothing to queue');

    const maxQueue = Number(ConfigService.get('limits.maxQueueSize', 200));
    const currentPending = QueueRepo.list(r => String(r.Status) === 'Pending').length;
    if (currentPending + previews.length > maxQueue) {
      throw new ValidationError('Queue capacity exceeded (max ' + maxQueue + ')');
    }

    const todayKey = todayIsoDate(ConfigService.get('system.timezone'));
    const existingToday = QueueRepo.list(r => {
      if (!r.CreatedAt) return false;
      return String(r.CreatedAt).slice(0, 10) === todayKey;
    });
    const dupSet = {};
    existingToday.forEach(r => {
      dupSet[r.StudentUUID + '|' + (r.TemplateUUID || '')] = true;
    });

    const out = [];
    const warnings = [];
    previews.forEach(p => {
      const k = p.student.UUID + '|' + (templateUuid || '');
      if (dupSet[k]) warnings.push('Possible duplicate for ' + p.student.Name);
      const row = QueueRepo.insert({
        StudentUUID: p.student.UUID,
        TemplateUUID: templateUuid || '',
        CampaignTag: campaignTag || '',
        RenderedMessage: p.rendered,
        WasAiAssisted: !!p.wasAiAssisted,
        AiCallUUIDs: (p.aiCallUuids || []).join(','),
        TeamsLink: p.teamsLink,
        Status: 'Pending',
        SentAt: '',
        SkipReason: ''
      });
      out.push(row);
    });

    if (templateUuid) {
      try { TemplateService.incrementUsage(templateUuid); } catch (_) {}
    }

    return { created: out.length, warnings };
  }
};

// =====================================================================
// QueueService
// =====================================================================

const QueueService = {
  list() {
    const all = QueueRepo.list(r => String(r.Status) === 'Pending');
    const students = {};
    StudentRepo.list().forEach(s => { students[s.UUID] = s; });
    return all.map(r => Object.assign({}, r, {
      _student: students[r.StudentUUID] || null
    })).sort((a, b) => Number(a.SN) - Number(b.SN));
  },

  get(uuid) { return QueueRepo.findByUuid(uuid); },

  editMessage(uuid, newBody) {
    const row = QueueRepo.findByUuid(uuid);
    if (!row) throw new NotFoundError('Queue row not found');
    TemplateService.validateLength(newBody);
    const student = StudentRepo.findByUuid(row.StudentUUID);
    if (!student) throw new NotFoundError('Student missing for this queue row');
    return QueueRepo.update(uuid, {
      RenderedMessage: newBody,
      TeamsLink: buildTeamsLink(student.TeamsEmail, newBody)
    });
  },

  markSent(uuid) {
    const row = QueueRepo.findByUuid(uuid);
    if (!row) throw new NotFoundError('Queue row not found');
    const student = StudentRepo.findByUuid(row.StudentUUID);
    const template = row.TemplateUUID ? TemplateRepo.findByUuid(row.TemplateUUID) : null;
    HistoryRepo.insert({
      StudentUUID: row.StudentUUID,
      StudentName: student ? student.Name : '',
      StudentEmail: student ? student.TeamsEmail : '',
      TemplateUUID: row.TemplateUUID || '',
      TemplateName: template ? template.Name : (row.TemplateUUID ? '(deleted)' : 'AI ad-hoc'),
      CampaignTag: row.CampaignTag || '',
      RenderedMessage: row.RenderedMessage,
      WasAiAssisted: asBool(row.WasAiAssisted),
      FinalStatus: 'Sent',
      SkipReason: ''
    });
    QueueRepo.remove(uuid);
    return true;
  },

  skip(uuid, reason) {
    const row = QueueRepo.findByUuid(uuid);
    if (!row) throw new NotFoundError('Queue row not found');
    const student = StudentRepo.findByUuid(row.StudentUUID);
    const template = row.TemplateUUID ? TemplateRepo.findByUuid(row.TemplateUUID) : null;
    HistoryRepo.insert({
      StudentUUID: row.StudentUUID,
      StudentName: student ? student.Name : '',
      StudentEmail: student ? student.TeamsEmail : '',
      TemplateUUID: row.TemplateUUID || '',
      TemplateName: template ? template.Name : (row.TemplateUUID ? '(deleted)' : 'AI ad-hoc'),
      CampaignTag: row.CampaignTag || '',
      RenderedMessage: row.RenderedMessage,
      WasAiAssisted: asBool(row.WasAiAssisted),
      FinalStatus: 'Skipped',
      SkipReason: reason || ''
    });
    QueueRepo.remove(uuid);
    return true;
  },

  clearAll() {
    const rows = QueueRepo.list();
    rows.forEach(r => QueueRepo.remove(r.UUID));
    return rows.length;
  }
};

// =====================================================================
// HistoryService
// =====================================================================

const HistoryService = {
  list(filter) {
    const f = filter || {};
    return HistoryRepo.list(r => {
      if (f.dateFrom && String(r.CreatedAt).slice(0, 10) < f.dateFrom) return false;
      if (f.dateTo   && String(r.CreatedAt).slice(0, 10) > f.dateTo)   return false;
      if (f.status   && String(r.FinalStatus) !== String(f.status))   return false;
      if (f.template && String(r.TemplateUUID) !== String(f.template)) return false;
      if (f.aiAssisted === true  && !asBool(r.WasAiAssisted)) return false;
      if (f.aiAssisted === false &&  asBool(r.WasAiAssisted)) return false;
      if (f.q) {
        const q = String(f.q).toLowerCase();
        const hay = [r.StudentName, r.StudentEmail, r.RenderedMessage, r.TemplateName, r.CampaignTag]
          .map(x => String(x || '').toLowerCase()).join(' ');
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    }).sort((a, b) => String(b.CreatedAt).localeCompare(String(a.CreatedAt)));
  },

  exportCsv(filter) {
    const rows = HistoryService.list(filter);
    const header = SHEET_HEADERS.History;
    const out = [header.join(',')];
    rows.forEach(r => out.push(header.map(h => _csvEscape(r[h])).join(',')));
    return out.join('\n');
  }
};

// =====================================================================
// DashboardService
// =====================================================================

const DashboardService = {
  summary() {
    const tz = ConfigService.get('system.timezone', 'Asia/Kathmandu');
    const today = todayIsoDate(tz);
    const students = StudentRepo.list();
    const templates = TemplateRepo.list();
    const queue = QueueRepo.list();
    const history = HistoryRepo.list();
    const llmCalls = LlmCallRepo.list();

    const activeStudents = students.filter(s => asBool(s.Active)).length;
    const pendingQueue  = queue.filter(q => String(q.Status) === 'Pending').length;
    const sentToday     = history.filter(h =>
      String(h.FinalStatus) === 'Sent' &&
      String(h.CreatedAt).slice(0, 10) === today).length;
    const activeTemplates = templates.filter(t => asBool(t.Active)).length;

    const todayLlm = llmCalls.filter(c => String(c.CreatedAt).slice(0, 10) === today);
    const todayLlmCost = todayLlm.reduce((s, c) => s + (Number(c.EstCostUSD) || 0), 0);

    const recentSent = history.slice(0, 50).slice(0, 10).map(h => ({
      when: h.CreatedAt,
      student: h.StudentName,
      template: h.TemplateName,
      status: h.FinalStatus
    }));

    return {
      kpis: {
        activeStudents,
        pendingQueue,
        sentToday,
        activeTemplates,
        aiTodayCalls: todayLlm.length,
        aiTodayCost: todayLlmCost
      },
      aiEnabled: !!ConfigService.get('features.ai.enabled'),
      recent: recentSent
    };
  },

  monthlyLlmSpend() {
    const tz = ConfigService.get('system.timezone', 'Asia/Kathmandu');
    const ym = Utilities.formatDate(new Date(), tz, 'yyyy-MM');
    return LlmCallRepo.list()
      .filter(c => String(c.CreatedAt).slice(0, 7) === ym)
      .reduce((s, c) => s + (Number(c.EstCostUSD) || 0), 0);
  },

  llmUsageSummary(input) {
    const opts = input || {};
    const daysBack = Number(opts.days || 30);
    const tz = ConfigService.get('system.timezone', 'Asia/Kathmandu');
    const cutoff = new Date(Date.now() - daysBack * 24 * 3600 * 1000);
    const cutoffStr = Utilities.formatDate(cutoff, tz, 'yyyy-MM-dd');

    const all = LlmCallRepo.list()
      .filter(c => String(c.CreatedAt).slice(0, 10) >= cutoffStr)
      .sort((a, b) => String(b.CreatedAt).localeCompare(String(a.CreatedAt)));

    const totals = { calls: all.length, inputTokens: 0, outputTokens: 0, cost: 0, errors: 0 };
    const byProvider = {};
    const byFeature  = {};
    const byDay      = {};

    all.forEach(c => {
      const cost = Number(c.EstCostUSD) || 0;
      totals.inputTokens  += Number(c.InputTokens)  || 0;
      totals.outputTokens += Number(c.OutputTokens) || 0;
      totals.cost += cost;
      if (String(c.Status) !== 'success') totals.errors++;
      const p = c.Provider || 'unknown';
      const f = c.Feature  || 'other';
      byProvider[p] = byProvider[p] || { calls: 0, cost: 0 };
      byProvider[p].calls++;
      byProvider[p].cost += cost;
      byFeature[f] = byFeature[f] || { calls: 0, cost: 0 };
      byFeature[f].calls++;
      byFeature[f].cost += cost;
      const day = String(c.CreatedAt).slice(0, 10);
      byDay[day] = (byDay[day] || 0) + 1;
    });

    const recent = all.slice(0, 50).map(c => ({
      UUID: c.UUID,
      when: c.CreatedAt,
      feature: c.Feature,
      provider: c.Provider,
      model: c.Model,
      inputTokens: c.InputTokens,
      outputTokens: c.OutputTokens,
      cost: c.EstCostUSD,
      status: c.Status,
      latencyMs: c.LatencyMs,
      errorMessage: c.ErrorMessage
    }));

    return {
      totals,
      byProvider,
      byFeature,
      byDay,
      recent,
      monthlySpend: DashboardService.monthlyLlmSpend(),
      monthlyWarningUSD: Number(ConfigService.get('ai.monthlyWarningUSD', 5)),
      monthlyHardCapUSD: Number(ConfigService.get('ai.monthlyHardCapUSD', 20))
    };
  },

  llmCallDetail(uuid) {
    const c = LlmCallRepo.findByUuid(uuid);
    if (!c) throw new NotFoundError('LLM call not found');
    return c;
  }
};
