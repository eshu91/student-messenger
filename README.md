# Everest Student Messenger

A Google Apps Script web app for sending Microsoft Teams messages to students at the
**Everest IT Training Institute**, with multi-LLM AI assistance for drafting and
paraphrasing messages.

Built for **Ishwari** as a part-time-instructor-friendly tool: pick a template,
filter students by course/batch, preview each message, open the chat in Teams with
one click, mark it sent.

---

## What it does

- **Students** — manage your roster (CSV import/export supported).
- **Templates** — reusable message bodies with placeholders like `{name}`, `{course}`, `{homework}`, `{signature}`.
- **Compose** — pick a template (or draft one with AI), filter recipients, preview each rendered message, and queue them.
- **Queue** — for each pending message: click **Open in Teams** → message is pre-typed in Teams → after sending click **Mark sent**.
- **History** — every sent or skipped message is logged, exportable to CSV.
- **AI features** — Draft with AI (5 providers: Groq, OpenAI, Anthropic, Gemini, OpenRouter), Paraphrase (single or batch), with full cost tracking and a monthly hard cap.
- **Backup** — full workspace JSON export.
- **Audit trail** — every row in every sheet has UUID, CreatedAt, CreatedBy, UpdatedAt, UpdatedBy columns.

All data lives in a single Google Sheets workbook the app creates on first run.

---

## Repository layout

```
everest-messenger/
├── README.md                    ← you are here
├── .clasp.json.template         ← copy + edit to use clasp
└── src/                         ← everything that gets pushed to Apps Script
    ├── appsscript.json          ← manifest (timezone, V8, web-app config)
    ├── 00_Main.gs               ← doGet / doPost / include / menu
    ├── 01_Config.gs             ← constants, headers, enums, seeds
    ├── 02_Utils.gs              ← helpers, errors, Teams deep-link builder
    ├── 10_Repo.gs               ← sheet I/O (BaseRepo + per-sheet repos)
    ├── 20_Service_Core.gs       ← ConfigService / StudentService / TemplateService
    ├── 21_Service_Msg.gs        ← ComposeService / QueueService / HistoryService / DashboardService
    ├── 30_Service_Llm.gs        ← LlmService + AiFeatureService + pricing
    ├── 31_LlmProviders.gs       ← 5 provider implementations
    ├── 40_Api.gs                ← RPC layer (every api_* function)
    ├── 50_Bootstrap.gs          ← first-run workbook + seed setup
    ├── Index.html               ← SPA shell
    ├── Styles.html              ← CSS
    ├── Components.html          ← UI primitives (modal, toast, etc)
    ├── App.html                 ← router + State + Api wrapper
    ├── View_Dashboard.html
    ├── View_Students.html
    ├── View_Templates.html
    ├── View_Compose.html
    ├── View_Queue.html
    ├── View_History.html
    ├── View_LlmUsage.html
    ├── View_Settings.html
    └── View_ImportExport.html
```

> File naming matters: the numeric prefixes on `.gs` files (`00_`, `01_`, …)
> control the order Apps Script loads them. Don't rename them.

---

## Deployment — two paths

You can deploy with **clasp** (Google's official CLI; faster after the first time)
or **manually** (no install required; easiest for first-timers). Either path
ends with the same result: a private web app URL you bookmark and use.

### Path A — Manual (recommended for first deployment)

This takes about **10 minutes**.

#### 1. Create the Apps Script project

1. Go to [script.google.com](https://script.google.com) (sign in with the Google
   account you want to own the app — likely `ishwari.raut@everestitt.com`).
2. Click **New project** (top left).
3. Rename the project (top of page) to **Everest Student Messenger**.

#### 2. Copy the manifest

1. In the editor, click the **gear icon** (Project Settings) in the left sidebar.
2. Check **Show "appsscript.json" manifest file in editor**.
3. Back in the **Editor** (`< >` icon), open `appsscript.json`.
4. Replace its contents with the contents of `src/appsscript.json` from this zip.
5. Press **Ctrl/Cmd + S** to save.

#### 3. Add the 10 `.gs` files

For each `.gs` file in the `src/` folder, in this exact order:

`00_Main.gs`, `01_Config.gs`, `02_Utils.gs`, `10_Repo.gs`, `20_Service_Core.gs`,
`21_Service_Msg.gs`, `30_Service_Llm.gs`, `31_LlmProviders.gs`, `40_Api.gs`, `50_Bootstrap.gs`

1. In the Apps Script editor, click the **+** next to **Files** → **Script**.
2. Name it exactly as the filename **without the `.gs` extension** (e.g. `00_Main`).
3. Delete the default `function myFunction() { }` content.
4. Open the matching file from the zip, copy its full contents, paste it in.
5. Save (Ctrl/Cmd + S).
6. Repeat for the remaining `.gs` files.

> ⚠ Apps Script will auto-add `.gs` to the filename, so don't type the extension yourself.

#### 4. Add the 13 `.html` files

For each file ending in `.html` in `src/`:

`Index.html`, `Styles.html`, `Components.html`, `App.html`, `View_Dashboard.html`,
`View_Students.html`, `View_Templates.html`, `View_Compose.html`, `View_Queue.html`,
`View_History.html`, `View_LlmUsage.html`, `View_Settings.html`, `View_ImportExport.html`

1. **+** → **HTML**.
2. Name it exactly as the filename **without the `.html` extension** (e.g. `Index`).
3. Delete the default boilerplate, paste in the file contents.
4. Save.

#### 5. Run Bootstrap (creates the workbook)

1. In the file list, click **`50_Bootstrap`**.
2. At the top of the editor, find the **function selector dropdown** (between
   "Debug" and "Run"). Pick **`Bootstrap_run`**.
3. Click **Run**.
4. Google will ask for permissions:
   - "**Authorization required**" → **Review permissions** → pick your account → "Advanced" → "Go to Everest Student Messenger (unsafe)" → **Allow**.
   - (This is normal for a personal Apps Script. The app is "unverified" because it's yours.)
5. The function will run and the **Execution log** at the bottom will print
   something like:
   ```
   Workbook ID: 1a2b3c…
   Schema version: 1
   To deploy as a web app: Deploy → New deployment → Web app
   ```

#### 6. Deploy as a web app

1. Top-right **Deploy** → **New deployment**.
2. Click the **gear icon** next to "Select type" → choose **Web app**.
3. Fill in:
   - **Description:** `v1`
   - **Execute as:** **Me** (`your-email@…`)
   - **Who has access:** **Only myself**
4. Click **Deploy**.
5. Copy the **Web app URL** — that's the URL you'll bookmark.
6. Click **Done**.

#### 7. First-time launch

1. Open the Web app URL in a new tab.
2. The dashboard loads with empty data.
3. Click **Settings** → scroll to **AI provider keys**.
4. Set at least one key (recommended: **Groq** — free tier at
   [console.groq.com](https://console.groq.com)).
5. Go to **Students** → add a student or import a CSV.
6. Go to **Compose** → pick the seeded "Homework reminder" template → preview →
   commit.
7. Go to **Queue** → click **Open in Teams** on a row → Teams opens with the
   message pre-typed → press Enter in Teams → return and click **Mark sent**.

---

### Path B — clasp (Google Apps Script CLI)

This takes a bit of one-time setup but makes future updates a single command.

#### 1. Install clasp

```bash
npm install -g @google/clasp
clasp login              # opens a browser to authorize
```

> Requires **Node.js 18+**. If you don't have Node, install it from
> [nodejs.org](https://nodejs.org).

#### 2. Enable the Apps Script API

Go to <https://script.google.com/home/usersettings> and **enable** the
"Google Apps Script API" toggle. (Required once per Google account.)

#### 3. Create an empty Apps Script project

```bash
mkdir everest-messenger-deploy
cd everest-messenger-deploy
clasp create --title "Everest Student Messenger" --type webapp
```

This creates a `.clasp.json` file and a default `appsscript.json`. **Note the
script ID it prints** — you'll need it.

#### 4. Drop in the source

1. Copy **every file** from this zip's `src/` directory into the
   `everest-messenger-deploy/` directory (replace the auto-generated
   `appsscript.json`).
2. Open `.clasp.json` and make sure `"rootDir"` is set to your current
   directory (or omit it, and run `clasp push` from this folder directly).
   A working `.clasp.json` looks like:
   ```json
   {
     "scriptId": "your-script-id-here",
     "rootDir": "."
   }
   ```

Alternatively, if you already have the script ID, copy `.clasp.json.template`
in this repo to `.clasp.json` and fill in the ID. Then:

```bash
clasp push -f
```

The `-f` flag bypasses the file-overwrite prompt.

#### 5. Bootstrap and deploy

```bash
clasp open                      # opens the editor in your browser
```

Then in the editor, do **steps 5–7 from Path A above** (run `Bootstrap_run`,
deploy as a web app, etc.).

#### 6. Pushing future updates

Edit any source file locally, then:

```bash
clasp push -f                   # pushes code
clasp deploy --description "v2" # creates a new versioned deployment (optional)
```

For minor changes you can also just push and re-test against the existing
deployment URL.

---

## AI provider API keys

The app calls LLM APIs **directly from Apps Script** using the key you store in
Script Properties via the Settings page. Keys are never written to the workbook
or to backup exports.

| Provider     | Where to get a key                          | Notes                                                  |
|--------------|---------------------------------------------|--------------------------------------------------------|
| **Groq**     | [console.groq.com](https://console.groq.com) | **Recommended for free use.** Generous free tier, very fast. |
| OpenAI       | [platform.openai.com](https://platform.openai.com) | Pay-as-you-go. Quality default.                    |
| Anthropic    | [console.anthropic.com](https://console.anthropic.com) | Claude models. Excellent paraphrasing.         |
| Gemini       | [aistudio.google.com](https://aistudio.google.com) | Has a free tier.                                  |
| OpenRouter   | [openrouter.ai](https://openrouter.ai)       | Aggregator. Lets you try many models on one bill.      |

You only need **one** key. Default provider is set in Settings → AI features.

### Monthly cost controls

In **Settings → AI features**:
- **Monthly warning (USD)** — non-blocking; the dashboard shows a warning above this.
- **Monthly hard cap (USD)** — once your *month-to-date* AI spend exceeds this, all
  new AI calls are blocked until the next month or until you raise the cap.

Defaults are $5 warning, $20 hard cap. Spend tracking lives in the `LlmCalls`
sheet of the workbook and is summarised on the **LLM usage** page.

---

## Templates and placeholders

A template body can contain these placeholders, which are substituted at preview time:

| Placeholder    | Comes from                                |
|----------------|-------------------------------------------|
| `{name}`       | Student.Name                              |
| `{fullname}`   | Student.FullName                          |
| `{course}`     | Student.Course                            |
| `{batch}`      | Student.Batch                             |
| `{homework}`   | Student.Homework                          |
| `{date}`       | Today, formatted in the workspace timezone |
| `{time}`       | Now, formatted in the workspace timezone   |
| `{signature}`  | `branding.signature` config value          |

Unknown placeholders are left in place and surfaced as a validation warning in
the Templates editor.

---

## How "send" actually works

This tool does **not** send messages via the Teams API. Instead, each pending
queue row holds a **Teams deep link** that pre-fills the chat:

```
https://teams.microsoft.com/l/chat/0/0?users=<email>&message=<encoded-body>
```

You click **Open in Teams**, Teams opens, the message is pre-typed, you press
Enter, you return and click **Mark sent**.

This works because both you and your students are on `@everestitt.com`
Microsoft 365 — the deep link opens the chat in your authenticated Teams
session. No bot, no service account, no admin consent needed.

---

## Backing up & moving the data

- **JSON backup**: Import / Export page → **Download backup JSON**. This
  includes students, templates, configs, queue, and history — **not** the
  full LLM prompts/responses, and **not** API keys.
- **Direct workbook access**: in your Google Drive, find the spreadsheet named
  **`Everest Student Messenger DB`** — every sheet is human-readable.
- **Move to another Google account**: copy the spreadsheet to the new account,
  redeploy the Apps Script, and update `WORKBOOK_ID` in Script Properties
  (Settings page of the script editor → Script properties).

---

## Troubleshooting

**"Setup error" on first load**
Run `Bootstrap_run` once from the Apps Script editor (Path A, step 5).

**"This app isn't verified"**
Click **Advanced** → **Go to Everest Student Messenger (unsafe)** → **Allow**.
"Unsafe" just means Google hasn't reviewed your private app — which is correct.

**"AI feature is disabled"**
Settings → AI features → toggle **Enable AI features (master switch)** on, and
toggle the specific feature (Draft / Paraphrase) on.

**"Monthly LLM cap reached"**
Settings → AI features → raise **Monthly hard cap (USD)**, or wait until next month.

**Teams link does nothing**
Make sure you're signed in to Microsoft Teams in the **same browser** you opened
the link in. Also check the student's `TeamsEmail` is correct.

**"Queue capacity exceeded"**
Settings → General → raise **Max queue size**, or clear sent messages from the
queue first.

**API quota errors during long compose runs**
Apps Script enforces per-execution time limits (~6 minutes) and per-day URL fetch
quotas (~20,000/day for personal Google accounts). Paraphrase batches above ~50
recipients may need to be split.

---

## Privacy notes

- All data stays in **your** Google account: your Apps Script project, your
  spreadsheet.
- LLM calls are sent from Apps Script directly to the chosen provider, using
  the key you stored. Anthropic does not see your data; OpenAI does not see
  your data — **only the provider you picked, for that one call** does.
- API keys are stored in Script Properties (the same secret store as `clasp`-managed
  credentials) and never appear in the workbook, the UI source, or backups.

---

## Schema version

Current schema version: **1**.

If a future version adds columns, Bootstrap will detect missing headers and
add them. Old data is preserved.

---

## License

Personal use by Everest IT Training Institute / Ishwari. Not for redistribution.
