/**
 * 20_Service_Core.gs — Configs / Students / Templates services.
 * Business rules and orchestration. Reads/writes via repos only.
 */

// =====================================================================
// ConfigService — typed read/write over Configs sheet, with caching.
// =====================================================================

const ConfigService = (function () {
  let _cache = null;

  function _loadAll() {
    if (_cache) return _cache;
    const rows = ConfigRepo.list();
    const map = {};
    rows.forEach(r => {
      const k = r.Category + '.' + r.Key;
      map[k] = r;
    });
    _cache = map;
    return _cache;
  }

  return {
    get(fullKey, fallback) {
      const cache = _loadAll();
      const row = cache[fullKey];
      if (!row) return (fallback === undefined ? null : fallback);
      return coerceConfigValue(row.Value, row.Type);
    },

    getRaw(fullKey) {
      const cache = _loadAll();
      return cache[fullKey] || null;
    },

    list() {
      _cache = null;
      return ConfigRepo.list();
    },

    set(fullKey, newValue) {
      _cache = null;
      const parts = fullKey.split('.');
      const category = parts.shift();
      const key = parts.join('.');
      const existing = ConfigRepo.findByCategoryKey(category, key);
      if (!existing) throw new NotFoundError('Config not found: ' + fullKey);
      if (existing.Editable === false || existing.Editable === 'FALSE' || existing.Editable === 'false') {
        throw new ValidationError('Config is not editable: ' + fullKey);
      }
      if (existing.Type === 'enum') {
        const allowed = String(existing.EnumValues || '').split(',').map(s => s.trim()).filter(Boolean);
        if (allowed.length && allowed.indexOf(String(newValue)) === -1) {
          throw new ValidationError('Value must be one of: ' + allowed.join(', '));
        }
      }
      if (existing.Type === 'number' && isNaN(Number(newValue))) {
        throw new ValidationError('Value must be a number');
      }
      if (existing.Type === 'boolean' &&
          ['true', 'false', '0', '1'].indexOf(String(newValue).toLowerCase()) === -1) {
        throw new ValidationError('Value must be boolean');
      }
      ConfigRepo.update(existing.UUID, { Value: String(newValue) });
      _cache = null;
      return this.getRaw(fullKey);
    },

    invalidate() { _cache = null; }
  };
})();

// =====================================================================
// StudentService
// =====================================================================

const StudentService = {
  create(input) {
    const rec = StudentService._validate(input, false);
    const dup = StudentRepo.list(s => String(s.TeamsEmail).toLowerCase() === rec.TeamsEmail.toLowerCase());
    if (dup.length) throw new ConflictError('A student with that Teams email already exists');
    return StudentRepo.insert(rec);
  },

  update(uuid, patch) {
    const existing = StudentRepo.findByUuid(uuid);
    if (!existing) throw new NotFoundError('Student not found');
    const merged = Object.assign({}, existing, patch);
    const rec = StudentService._validate(merged, true);
    if (rec.TeamsEmail.toLowerCase() !== String(existing.TeamsEmail).toLowerCase()) {
      const dup = StudentRepo.list(s =>
        s.UUID !== uuid &&
        String(s.TeamsEmail).toLowerCase() === rec.TeamsEmail.toLowerCase());
      if (dup.length) throw new ConflictError('Another student already uses that Teams email');
    }
    return StudentRepo.update(uuid, rec);
  },

  softDelete(uuid) {
    return StudentRepo.update(uuid, { Active: false });
  },

  list(filter) {
    const f = filter || {};
    return StudentRepo.list(s => {
      if (f.active === true  && !asBool(s.Active)) return false;
      if (f.active === false &&  asBool(s.Active)) return false;
      if (f.course && String(s.Course) !== String(f.course)) return false;
      if (f.batch  && String(s.Batch)  !== String(f.batch))  return false;
      if (f.q) {
        const q = String(f.q).toLowerCase();
        const hay = [s.Name, s.FullName, s.TeamsEmail, s.Phone, s.Tags, s.Notes]
          .map(x => String(x || '').toLowerCase()).join(' ');
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  },

  get(uuid) { return StudentRepo.findByUuid(uuid); },

  courses() {
    const set = {};
    StudentRepo.list().forEach(s => { if (s.Course) set[s.Course] = true; });
    return Object.keys(set).sort();
  },

  batches() {
    const set = {};
    StudentRepo.list().forEach(s => { if (s.Batch) set[s.Batch] = true; });
    return Object.keys(set).sort();
  },

  _validate(s, isUpdate) {
    const rec = {
      Name:          requireString(s.Name, 'Name'),
      FullName:      (s.FullName || '').toString(),
      TeamsEmail:    requireEmail(s.TeamsEmail, 'Teams email'),
      PersonalEmail: s.PersonalEmail ? (isEmail(s.PersonalEmail) ? String(s.PersonalEmail).trim() : (function(){throw new ValidationError('Personal email is invalid');})()) : '',
      Phone:         (s.Phone || '').toString(),
      Course:        requireString(s.Course, 'Course'),
      Batch:         requireString(s.Batch, 'Batch'),
      JoinedDate:    s.JoinedDate ? String(s.JoinedDate) : '',
      Homework:      (s.Homework || '').toString(),
      Tags:          (s.Tags || '').toString(),
      Active:        s.Active === undefined ? true : asBool(s.Active),
      Notes:         (s.Notes || '').toString()
    };
    return rec;
  },

  // ----- CSV import / export -----

  importCsv(csvText, options) {
    const opts = options || {};
    const rows = Utilities.parseCsv(csvText);
    if (!rows || !rows.length) throw new ValidationError('CSV is empty');
    const header = rows[0].map(h => String(h).trim());
    const required = ['Name', 'TeamsEmail', 'Course', 'Batch'];
    required.forEach(r => {
      if (header.indexOf(r) === -1) throw new ValidationError('Missing required column: ' + r);
    });
    const results = { created: 0, updated: 0, skipped: 0, errors: [] };
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every(c => !String(c).trim())) continue;
      const obj = {};
      header.forEach((h, idx) => { obj[h] = row[idx]; });
      try {
        const existing = StudentRepo.list(s =>
          String(s.TeamsEmail).toLowerCase() === String(obj.TeamsEmail || '').toLowerCase());
        if (existing.length) {
          if (opts.updateExisting) {
            StudentService.update(existing[0].UUID, obj);
            results.updated++;
          } else {
            results.skipped++;
          }
        } else {
          StudentService.create(obj);
          results.created++;
        }
      } catch (e) {
        results.errors.push({ row: i + 1, message: e.message });
      }
    }
    return results;
  },

  exportCsv() {
    const rows = StudentRepo.list();
    const header = SHEET_HEADERS.Students;
    const out = [header.join(',')];
    rows.forEach(r => {
      out.push(header.map(h => _csvEscape(r[h])).join(','));
    });
    return out.join('\n');
  }
};

function _csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// =====================================================================
// TemplateService
// =====================================================================

const TemplateService = {
  KNOWN_PLACEHOLDERS: ['name', 'fullname', 'course', 'batch', 'homework', 'date', 'time', 'signature'],

  create(input) {
    const rec = TemplateService._validate(input);
    const dup = TemplateRepo.list(t => String(t.Name).toLowerCase() === rec.Name.toLowerCase());
    if (dup.length) throw new ConflictError('Template name already exists');
    return TemplateRepo.insert(rec);
  },

  update(uuid, patch) {
    const existing = TemplateRepo.findByUuid(uuid);
    if (!existing) throw new NotFoundError('Template not found');
    const merged = Object.assign({}, existing, patch);
    const rec = TemplateService._validate(merged);
    if (rec.Name.toLowerCase() !== String(existing.Name).toLowerCase()) {
      const dup = TemplateRepo.list(t =>
        t.UUID !== uuid &&
        String(t.Name).toLowerCase() === rec.Name.toLowerCase());
      if (dup.length) throw new ConflictError('Another template already uses that name');
    }
    return TemplateRepo.update(uuid, rec);
  },

  remove(uuid) { return TemplateRepo.remove(uuid); },
  get(uuid)    { return TemplateRepo.findByUuid(uuid); },
  list(filter) {
    const f = filter || {};
    return TemplateRepo.list(t => {
      if (f.active === true  && !asBool(t.Active)) return false;
      if (f.active === false &&  asBool(t.Active)) return false;
      return true;
    });
  },

  incrementUsage(uuid) {
    const t = TemplateRepo.findByUuid(uuid);
    if (!t) return;
    const n = Number(t.UsageCount || 0) + 1;
    TemplateRepo.update(uuid, { UsageCount: n });
  },

  validateLength(text) {
    const cap = Number(ConfigService.get('limits.maxMessageLength', 1500));
    if (String(text || '').length > cap) {
      throw new ValidationError('Message exceeds max length of ' + cap + ' characters');
    }
    return true;
  },

  validatePlaceholders(body) {
    const found = findPlaceholders(body);
    const unknown = found.filter(p => TemplateService.KNOWN_PLACEHOLDERS.indexOf(p) === -1);
    return { found, unknown };
  },

/**
   * Render a template body against a student record + extra params.
   * Substitution priority (last wins):
   *   1. Built-ins:  {date}, {time}, {signature}
   *   2. Student fields: {name}, {fullname}, {course}, {batch}, {homework}, {phone}, {tags}
   *   3. Extra params (Assignment variables + ad-hoc overrides)
   * Unknown placeholders are left in place as {whatever}.
   */
  render(body, student, params) {
    const tz = ConfigService.get('system.timezone', 'Asia/Kathmandu');
    const now = new Date();
    const ctx = {
      date:      Utilities.formatDate(now, tz, 'yyyy-MM-dd'),
      time:      Utilities.formatDate(now, tz, 'HH:mm'),
      signature: ConfigService.get('branding.signature', '')
    };
    if (student) {
      ctx.name     = student.Name     || '';
      ctx.fullname = student.FullName || student.Name || '';
      ctx.course   = student.Course   || '';
      ctx.batch    = student.Batch    || '';
      ctx.homework = student.Homework || '';
      ctx.phone    = student.Phone    || '';
      ctx.tags     = student.Tags     || '';
    }
    if (params && typeof params === 'object') {
      Object.keys(params).forEach(k => {
        const v = params[k];
        if (v !== undefined && v !== null && v !== '') {
          ctx[String(k).toLowerCase()] = String(v);
        }
      });
    }
    return String(body || '').replace(/\{(\w+)\}/g, function (m, key) {
      const k = key.toLowerCase();
      return (k in ctx) ? ctx[k] : m;
    });
  },

  _validate(t) {
    const rec = {
      Name:             requireString(t.Name, 'Name'),
      Description:      (t.Description || '').toString(),
      Body:             requireString(t.Body, 'Body'),
      SupportedCourses: (t.SupportedCourses || '*').toString(),
      Source:           (t.Source || 'manual').toString(),
      Active:           t.Active === undefined ? true : asBool(t.Active),
      UsageCount:       Number(t.UsageCount || 0)
    };
    if (ENUMS.TemplateSource.indexOf(rec.Source) === -1) rec.Source = 'manual';
    TemplateService.validateLength(rec.Body);
    return rec;
  }
};


// =====================================================================
// AssignmentService — reusable per-send context (homework, room, etc.)
// =====================================================================

const AssignmentService = {
  list(filter) {
    const f = filter || {};
    return AssignmentRepo.list(a => {
      if (f.active === true  && !asBool(a.Active)) return false;
      if (f.active === false &&  asBool(a.Active)) return false;
      // Course/batch matching: '*' or empty = matches any.
      if (f.course && a.Course && String(a.Course) !== '*' && String(a.Course) !== String(f.course)) return false;
      if (f.batch  && a.Batch  && String(a.Batch)  !== '*' && String(a.Batch)  !== String(f.batch))  return false;
      return true;
    });
  },

  get(uuid) { return AssignmentRepo.findByUuid(uuid); },

  create(rec) {
    const v = AssignmentService._validate(rec, false);
    return AssignmentRepo.insert(v);
  },

  update(uuid, patch) {
    const existing = AssignmentRepo.findByUuid(uuid);
    if (!existing) throw new NotFoundError('Assignment not found');
    const merged = Object.assign({}, existing, patch);
    const v = AssignmentService._validate(merged, true);
    return AssignmentRepo.update(uuid, v);
  },

  remove(uuid) { return AssignmentRepo.remove(uuid); },

  /** Parse the Variables column (JSON string) into a plain object. */
  parseVariables(raw) {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(String(raw)) || {}; }
    catch (_) { return {}; }
  },

  /**
   * Get full merged variables for an assignment, including built-ins
   * derived from the row (currently just {duedate}).
   */
  resolvedVariables(assignment) {
    if (!assignment) return {};
    const vars = AssignmentService.parseVariables(assignment.Variables);
    if (assignment.DueDate) vars.duedate = String(assignment.DueDate);
    return vars;
  },

  _validate(rec, isUpdate) {
    const v = {
      Name:        requireString(rec.Name, 'Name'),
      Description: String(rec.Description || ''),
      Course:      String(rec.Course || ''),
      Batch:       String(rec.Batch  || ''),
      DueDate:     String(rec.DueDate || ''),
      Variables:   '{}',
      Active:      rec.Active === undefined ? true : asBool(rec.Active)
    };
    // Variables: accept object (preferred) or JSON string.
    if (rec.Variables == null || rec.Variables === '') {
      v.Variables = '{}';
    } else if (typeof rec.Variables === 'object') {
      v.Variables = JSON.stringify(rec.Variables);
    } else {
      const s = String(rec.Variables);
      try { JSON.parse(s); v.Variables = s; }
      catch (_) { throw new ValidationError('Variables must be valid JSON'); }
    }
    return v;
  }
};
