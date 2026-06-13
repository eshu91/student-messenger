/**
 * 00_Main.gs — entry points
 * doGet serves the SPA. doPost reserved for future REST dispatch.
 */

function doGet(e) {
  // Ensure DB exists on first visit
  try {
    Bootstrap.ensureWorkbook();
  } catch (err) {
    return HtmlService.createHtmlOutput(
      '<h2>Setup error</h2><pre>' + (err && err.message ? err.message : err) + '</pre>' +
      '<p>Run <code>Bootstrap.run()</code> from the Apps Script editor once, then reload.</p>'
    );
  }

  const t = HtmlService.createTemplateFromFile('Index');
  return t.evaluate()
    .setTitle('Everest Student Messenger')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function doPost(e) {
  // Phase 3 — REST dispatch lives here.
  return ContentService
    .createTextOutput(JSON.stringify({ ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'doPost not yet supported' } }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Apps Script template include helper.
 * Used inside Index.html as <?!= include('FileName'); ?>
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Bound spreadsheet menu (only fires if script is container-bound; harmless otherwise).
 */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('Everest Messenger')
      .addItem('Run bootstrap (create sheets + seed configs)', 'Bootstrap_run')
      .addItem('Open dashboard URL (console)', 'Bootstrap_printUrl')
      .addToUi();
  } catch (e) { /* not bound */ }
}

function Bootstrap_run() { Bootstrap.run(); }
function Bootstrap_printUrl() { Bootstrap.printDeploymentHint(); }
