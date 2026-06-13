/**
 * 50_Bootstrap.gs — first-run setup.
 *
 * Bootstrap.run()        — interactive run from the editor; creates workbook if needed.
 * Bootstrap.ensureWorkbook() — called by doGet on every page load; idempotent.
 */

const Bootstrap = {

  run() {
    const result = Bootstrap.ensureWorkbook();
    Bootstrap.printDeploymentHint();
    return result;
  },

  status() {
    const props = PropertiesService.getScriptProperties();
    const id = props.getProperty('WORKBOOK_ID');
    return {
      workbookId: id,
      hasWorkbook: !!id,
      schemaVersion: id ? ConfigService.get('system.schemaVersion', null) : null
    };
  },

  ensureWorkbook() {
    const props = PropertiesService.getScriptProperties();
    let id = props.getProperty('WORKBOOK_ID');
    let ss;

    if (id) {
      try {
        ss = SpreadsheetApp.openById(id);
      } catch (e) {
        // Stale ID — recreate.
        id = null;
      }
    }

    if (!ss) {
      const active = SpreadsheetApp.getActiveSpreadsheet();
      if (active) {
        ss = active;
      } else {
        ss = SpreadsheetApp.create(WORKBOOK_NAME);
      }
      id = ss.getId();
      props.setProperty('WORKBOOK_ID', id);
      console.info('Workbook created/linked: ' + id);
    }

    Bootstrap._ensureSheets(ss);
    Bootstrap._seedConfigs();
    Bootstrap._seedTemplatesIfEmpty();
    ConfigService.invalidate();
    return { workbookId: id, url: ss.getUrl() };
  },

  _ensureSheets(ss) {
    Object.keys(SHEET_HEADERS).forEach(name => {
      let sh = ss.getSheetByName(name);
      if (!sh) sh = ss.insertSheet(name);
      const headers = SHEET_HEADERS[name];
      const existing = sh.getRange(1, 1, 1, Math.max(1, headers.length)).getValues()[0] || [];
      const isEmpty = existing.every(v => v === '' || v == null);
      if (isEmpty) {
        sh.getRange(1, 1, 1, headers.length).setValues([headers]);
        sh.setFrozenRows(1);
        sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
        sh.setColumnWidths(1, headers.length, 140);
      }
    });

    // Hide default "Sheet1" if present and empty
    const def = ss.getSheetByName('Sheet1');
    if (def && def.getLastRow() === 0 && def.getLastColumn() <= 1) {
      try { ss.deleteSheet(def); } catch (_) {}
    }
  },

  _seedConfigs() {
    // Direct sheet I/O — ConfigRepo would loop us into ConfigService recursion.
    const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('WORKBOOK_ID'));
    const sh = ss.getSheetByName('Configs');
    const last = sh.getLastRow();
    const existing = {};
    if (last >= 2) {
      const cm = COL.Configs;
      const data = sh.getRange(2, 1, last - 1, SHEET_HEADERS.Configs.length).getValues();
      data.forEach(row => {
        const cat = row[cm.Category];
        const key = row[cm.Key];
        if (cat && key) existing[cat + '.' + key] = true;
      });
    }

    const toInsert = [];
    SEED_CONFIGS.forEach(c => {
      const fk = c[0] + '.' + c[1];
      if (existing[fk]) return;
      const now = nowIso();
      const user = currentUserEmail();
      const sn = Math.max(0, sh.getLastRow() - 1) + 1 + toInsert.length;
      toInsert.push([
        newId(TYPE_PREFIX.Configs),
        sn,
        now, user, now, user,
        c[0], c[1], c[2], c[3], c[4],
        c[5] === true, // Editable boolean
        c[6] || ''
      ]);
    });

    if (toInsert.length) {
      sh.getRange(sh.getLastRow() + 1, 1, toInsert.length, SHEET_HEADERS.Configs.length).setValues(toInsert);
      console.info('Seeded ' + toInsert.length + ' configs');
    }
  },

  _seedTemplatesIfEmpty() {
    if (TemplateRepo.count() > 0) return;
    SEED_TEMPLATES.forEach(t => {
      try { TemplateRepo.insert(t); } catch (e) { console.warn('Seed template failed: ' + e.message); }
    });
  },

  printDeploymentHint() {
    const id = PropertiesService.getScriptProperties().getProperty('WORKBOOK_ID');
    let url = '';
    if (id) {
      try { url = SpreadsheetApp.openById(id).getUrl(); } catch (_) {}
    }
    console.info('--- Everest Student Messenger ---');
    console.info('Workbook ID : ' + (id || '(not set)'));
    console.info('Workbook URL: ' + (url || '(unavailable)'));
    console.info('To deploy: Apps Script → Deploy → New deployment → Web app');
    console.info('Execute as: Me. Who has access: Only myself.');
  }
};
