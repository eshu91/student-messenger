/**
 * 10_Repo.gs — sheet I/O. The ONLY layer that touches SpreadsheetApp.
 *
 * Each repo extends BaseRepo and supplies:
 *   - sheetKey : Configs key whose value is the sheet name (e.g. 'system.sheetName.students')
 *   - prefix   : UUID prefix (e.g. 'usr')
 *   - colMap   : { ColumnName: zeroBasedIndex }
 *   - headers  : ordered header array (used for object<->row)
 */

class BaseRepo {
  constructor(sheetKey, prefix, colMap, headers) {
    this.sheetKey = sheetKey;
    this.prefix   = prefix;
    this.colMap   = colMap;
    this.headers  = headers;
  }

  _sheet() {
    const name = ConfigService.get(this.sheetKey);
    const ss = SpreadsheetApp.openById(_workbookId());
    const sh = ss.getSheetByName(name);
    if (!sh) throw new AppError('Sheet not found: ' + name, 'INTERNAL');
    return sh;
  }

_rowToObject(row) {
    const obj = {};
    this.headers.forEach((h, i) => {
      let v = row[i];
      // google.script.run returns the WHOLE response as null if any nested
      // field is a Date object. Sheets auto-parses date-looking text into
      // Date, so normalise every cell to a JSON-safe type here.
      if (v instanceof Date) v = v.toISOString();
      else if (v === null || v === undefined) v = '';
      obj[h] = v;
    });
    return obj;
  }

  _objectToRow(obj) {
    return this.headers.map(h => {
      const v = obj[h];
      if (v === undefined || v === null) return '';
      if (typeof v === 'boolean') return v;
      if (v instanceof Date) return v.toISOString();
      return v;
    });
  }

  _readAll() {
    const sh = this._sheet();
    const last = sh.getLastRow();
    if (last < 2) return [];
    const values = sh.getRange(2, 1, last - 1, this.headers.length).getValues();
    return values.map(r => this._rowToObject(r));
  }

  list(filterFn) {
    const rows = this._readAll();
    return filterFn ? rows.filter(filterFn) : rows;
  }

  findByUuid(uuid) {
    const rows = this._readAll();
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].UUID === uuid) return rows[i];
    }
    return null;
  }

  _findRowNumberByUuid(uuid) {
    const sh = this._sheet();
    const last = sh.getLastRow();
    if (last < 2) return -1;
    const uuids = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < uuids.length; i++) {
      if (uuids[i][0] === uuid) return i + 2;
    }
    return -1;
  }

  insert(record) {
    const sh = this._sheet();
    const sn = Math.max(0, sh.getLastRow() - 1) + 1;
    const now = nowIso();
    const user = currentUserEmail();
    const full = Object.assign({
      UUID: newId(this.prefix),
      SN: sn,
      CreatedAt: now,
      CreatedBy: user,
      UpdatedAt: now,
      UpdatedBy: user
    }, record);
    sh.appendRow(this._objectToRow(full));
    return full;
  }

  update(uuid, patch) {
    const sh = this._sheet();
    const rowNum = this._findRowNumberByUuid(uuid);
    if (rowNum < 0) throw new NotFoundError('Record not found: ' + uuid);
    const range = sh.getRange(rowNum, 1, 1, this.headers.length);
    const existing = this._rowToObject(range.getValues()[0]);
    const merged = Object.assign({}, existing, patch, {
      UUID: existing.UUID,
      SN: existing.SN,
      CreatedAt: existing.CreatedAt,
      CreatedBy: existing.CreatedBy,
      UpdatedAt: nowIso(),
      UpdatedBy: currentUserEmail()
    });
    range.setValues([this._objectToRow(merged)]);
    return merged;
  }

  remove(uuid) {
    const sh = this._sheet();
    const rowNum = this._findRowNumberByUuid(uuid);
    if (rowNum < 0) throw new NotFoundError('Record not found: ' + uuid);
    sh.deleteRow(rowNum);
    return true;
  }

  count() {
    const sh = this._sheet();
    return Math.max(0, sh.getLastRow() - 1);
  }
}

// ---------- Workbook resolver ----------

function _workbookId() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('WORKBOOK_ID');
  if (id) return id;
  // Fallback: try the active spreadsheet (works when script is bound).
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) {
    id = active.getId();
    props.setProperty('WORKBOOK_ID', id);
    return id;
  }
  throw new AppError('Workbook not initialized. Run Bootstrap.run() first.', 'NOT_INITIALIZED');
}

// ---------- Concrete repos ----------

const ConfigRepo   = new BaseRepo('__configs__', TYPE_PREFIX.Configs,
                                  COL.Configs,   SHEET_HEADERS.Configs);
// Special-case: ConfigRepo cannot resolve its own sheet name via ConfigService (chicken/egg).
ConfigRepo._sheet = function () {
  const ss = SpreadsheetApp.openById(_workbookId());
  const sh = ss.getSheetByName('Configs');
  if (!sh) throw new AppError('Configs sheet missing', 'INTERNAL');
  return sh;
};

const StudentRepo  = new BaseRepo('system.sheetName.students',  TYPE_PREFIX.Students,  COL.Students,  SHEET_HEADERS.Students);
const TemplateRepo = new BaseRepo('system.sheetName.templates', TYPE_PREFIX.Templates, COL.Templates, SHEET_HEADERS.Templates);
const QueueRepo    = new BaseRepo('system.sheetName.queue',     TYPE_PREFIX.Queue,     COL.Queue,     SHEET_HEADERS.Queue);
const HistoryRepo  = new BaseRepo('system.sheetName.history',   TYPE_PREFIX.History,   COL.History,   SHEET_HEADERS.History);
const LlmCallRepo  = new BaseRepo('system.sheetName.llmCalls',  TYPE_PREFIX.LlmCalls,  COL.LlmCalls,  SHEET_HEADERS.LlmCalls);

const AssignmentRepo = new BaseRepo(
  'system.sheetName.assignments',
  TYPE_PREFIX.Assignments,
  COL.Assignments,
  SHEET_HEADERS.Assignments
);

// Convenience: find a config row by (Category, Key)
ConfigRepo.findByCategoryKey = function (category, key) {
  const all = this.list();
  for (let i = 0; i < all.length; i++) {
    if (all[i].Category === category && all[i].Key === key) return all[i];
  }
  return null;
};
