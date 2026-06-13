/**
 * 30_Service_Llm.gs — LLM orchestration.
 *
 * LlmService.generate(...)        — talks to providers, logs every call.
 * AiFeatureService.draft(...)     — feature: draft a template body.
 * AiFeatureService.paraphrase(...)— feature: rewrite a message.
 *
 * Pricing table lives here (too volatile/structural for Configs).
 */

// Per-million-token pricing. Update when providers change prices.
const PRICING_PER_1M_TOKENS = {
  groq: {
    'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
    'llama-3.1-8b-instant':    { input: 0.05, output: 0.08 }
  },
  openai: {
    'gpt-4o-mini':             { input: 0.15, output: 0.60 },
    'gpt-4o':                  { input: 2.50, output: 10.00 }
  },
  anthropic: {
    'claude-haiku-4-5':        { input: 1.00, output: 5.00 },
    'claude-sonnet-4-6':       { input: 3.00, output: 15.00 }
  },
  gemini: {
    'gemini-2.0-flash':        { input: 0.10, output: 0.40 },
    'gemini-2.5-pro':          { input: 1.25, output: 5.00 }
  },
  openrouter: {
    // OpenRouter returns actual cost in response; this is a fallback only.
  }
};

function computeCost(provider, model, usage) {
  const p = PRICING_PER_1M_TOKENS[provider] && PRICING_PER_1M_TOKENS[provider][model];
  if (!p) return 0;
  const inTok  = Number(usage && usage.inputTokens)  || 0;
  const outTok = Number(usage && usage.outputTokens) || 0;
  return ((inTok * p.input) + (outTok * p.output)) / 1000000;
}

// =====================================================================
// LlmService
// =====================================================================

const LlmService = {
  /**
   * @param {object} args
   * @param {string} args.prompt
   * @param {string} args.feature        — one of ENUMS.LlmFeature
   * @param {string=} args.relatedUuid   — optional FK
   * @param {object=} args.opts          — { provider, model, maxTokens, temperature }
   * @returns {{ text, usage, estCost, model, provider, callUuid }}
   */
  generate(args) {
    const { prompt, feature, relatedUuid } = args || {};
    const opts = (args && args.opts) || {};

    if (!ConfigService.get('features.ai.enabled')) {
      throw new ValidationError('AI is disabled in Settings');
    }
    LlmService._checkCostCap();

    const providerName = opts.provider || ConfigService.get('ai.defaultProvider', 'groq');
    if (ENUMS.LlmProvider.indexOf(providerName) === -1) {
      throw new ValidationError('Unknown provider: ' + providerName);
    }
    const model = opts.model || ConfigService.get('ai.model.' + providerName);
    if (!model) throw new ValidationError('No model configured for provider: ' + providerName);

    const provider = LlmProviders[providerName];
    if (!provider) throw new ValidationError('Provider not implemented: ' + providerName);

    const start = Date.now();
    let responseText = '';
    let usage = { inputTokens: 0, outputTokens: 0 };
    let actualCost = null; // OpenRouter returns this
    let status = 'success';
    let errorMessage = null;

    const maxTokens   = Number(opts.maxTokens   || ConfigService.get('ai.maxTokensOutput', 500));
    const temperature = Number(opts.temperature || ConfigService.get('ai.temperature', 0.7));

    try {
      const result = provider.generate({
        prompt: String(prompt || ''),
        model,
        opts: { maxTokens, temperature }
      });
      responseText = result.text || '';
      usage = result.usage || { inputTokens: 0, outputTokens: 0 };
      if (result.actualCost != null) actualCost = result.actualCost;
    } catch (e) {
      status = (e && e.code === 'TIMEOUT') ? 'timeout' : 'error';
      errorMessage = e && e.message ? e.message : String(e);
    }

    const latencyMs = Date.now() - start;
    const estCost = (actualCost != null) ? actualCost : computeCost(providerName, model, usage);

    const logRow = LlmCallRepo.insert({
      Feature: feature || 'other',
      Provider: providerName,
      Model: model,
      PromptHash: sha256Short(prompt),
      Prompt: truncate(prompt, 8000),
      Response: truncate(responseText, 8000),
      InputTokens: usage.inputTokens || 0,
      OutputTokens: usage.outputTokens || 0,
      EstCostUSD: Number(estCost.toFixed(6)),
      LatencyMs: latencyMs,
      Status: status,
      ErrorMessage: errorMessage || '',
      RelatedEntityUUID: relatedUuid || ''
    });

    if (status !== 'success') {
      throw new LlmError(errorMessage || 'LLM call failed');
    }

    return {
      text: responseText,
      usage,
      estCost,
      model,
      provider: providerName,
      latencyMs,
      callUuid: logRow.UUID
    };
  },

  _checkCostCap() {
    const cap = Number(ConfigService.get('ai.monthlyHardCapUSD', 20));
    if (!cap || cap <= 0) return;
    const spent = DashboardService.monthlyLlmSpend();
    if (spent >= cap) {
      // Log a blocked-by-cap row for transparency
      try {
        LlmCallRepo.insert({
          Feature: 'other', Provider: '', Model: '',
          PromptHash: '', Prompt: '', Response: '',
          InputTokens: 0, OutputTokens: 0, EstCostUSD: 0, LatencyMs: 0,
          Status: 'blocked-by-cap',
          ErrorMessage: 'Monthly hard cap $' + cap + ' reached (spent $' + spent.toFixed(2) + ')',
          RelatedEntityUUID: ''
        });
      } catch (_) {}
      throw new ValidationError('Monthly LLM cap reached ($' + cap + '). Raise it in Settings.');
    }
  }
};

// =====================================================================
// AiFeatureService
// =====================================================================

const AiFeatureService = {
  draft(input) {
    if (!ConfigService.get('features.ai.draft')) {
      throw new ValidationError('Draft with AI is disabled in Settings');
    }
    const brief = requireString(input && input.brief, 'Brief');
    const prompt = buildDraftPrompt({
      brief,
      course: input.course || '',
      batch:  input.batch  || '',
      tone:   input.tone   || 'friendly'
    });
    const out = LlmService.generate({ prompt, feature: 'draft', opts: input.opts || {} });
    return {
      draftBody: cleanTemplateBody(out.text),
      callUuid: out.callUuid,
      provider: out.provider,
      model: out.model,
      usage: out.usage,
      estCost: out.estCost,
      latencyMs: out.latencyMs
    };
  },

  paraphrase(input) {
    if (!ConfigService.get('features.ai.paraphrase')) {
      throw new ValidationError('Paraphrase is disabled in Settings');
    }
    const text = requireString(input && input.text, 'Text');
    const tone = input.tone || 'friendly';
    const targetLanguage = input.targetLanguage || '';
    const prompt = buildParaphrasePrompt({ text, tone, targetLanguage });
    const out = LlmService.generate({ prompt, feature: 'paraphrase', opts: input.opts || {} });
    const cleaned = cleanTemplateBody(out.text);
    // Validate placeholder preservation
    const originalPh = findPlaceholders(text).sort().join(',');
    const newPh      = findPlaceholders(cleaned).sort().join(',');
    return {
      paraphrased: cleaned,
      placeholdersChanged: originalPh !== newPh,
      originalPlaceholders: findPlaceholders(text),
      newPlaceholders: findPlaceholders(cleaned),
      callUuid: out.callUuid,
      provider: out.provider,
      model: out.model,
      usage: out.usage,
      estCost: out.estCost,
      latencyMs: out.latencyMs
    };
  },

  /**
   * Paraphrase a batch of texts sharing the same tone.
   * Done one-by-one (Phase 1 simplicity); could be batched in Phase 2.
   */
  paraphraseBatch(input) {
    const texts = (input && input.texts) || [];
    if (!texts.length) throw new ValidationError('No texts to paraphrase');
    const tone = input.tone || 'friendly';
    const targetLanguage = input.targetLanguage || '';
    const results = [];
    for (let i = 0; i < texts.length; i++) {
      try {
        const r = AiFeatureService.paraphrase({ text: texts[i], tone, targetLanguage, opts: input.opts });
        results.push({ ok: true, index: i, result: r });
      } catch (e) {
        results.push({ ok: false, index: i, error: { message: e.message, code: e.code } });
        // Stop early if it's a cap or AI-disabled failure
        if (e.code === 'VALIDATION') break;
      }
    }
    return { results };
  }
};

// =====================================================================
// Prompts
// =====================================================================

function buildDraftPrompt(args) {
  const { brief, course, batch, tone } = args;
  return [
    'You are helping a part-time instructor draft a Microsoft Teams message to students at Everest IT Training Institute in Nepal.',
    '',
    'Course: ' + (course || 'unspecified'),
    'Batch: '  + (batch  || 'unspecified'),
    'Tone: '   + (tone   || 'friendly'),
    '',
    'Brief from instructor: ' + brief,
    '',
    'Write a short message (under 1500 characters) using the placeholders {name}, {course}, {batch}, {homework} where appropriate. Do not invent specifics. End the message naturally — do not add a signature; one will be appended automatically.',
    '',
    'Return ONLY the message body. No preamble, no explanation, no quotes around the message.'
  ].join('\n');
}

function buildParaphrasePrompt(args) {
  const { text, tone, targetLanguage } = args;
  const langClause = targetLanguage
    ? 'Translate to ' + targetLanguage + ' while keeping all {placeholder} tokens unchanged.'
    : 'Keep the same language.';
  return [
    'Rewrite this message in a ' + (tone || 'friendly') + ' tone. ' + langClause,
    '',
    'Preserve all {placeholder} tokens exactly. Keep under 1500 characters.',
    '',
    'Original:',
    text,
    '',
    'Return ONLY the rewritten message. No preamble, no explanation, no quotes.'
  ].join('\n');
}

/**
 * Strip preambles, trailing quotes, code fences. LLMs love adding them.
 */
function cleanTemplateBody(s) {
  if (!s) return '';
  let out = String(s).trim();
  // Strip surrounding code fences
  out = out.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '');
  // Strip surrounding quotes (single or double, straight or curly)
  out = out.replace(/^["'“”‘’](.*)["'“”‘’]$/s, '$1');
  // Strip common preambles
  out = out.replace(/^(here(?:'s| is)\s+(?:the\s+)?(?:rewritten|paraphrased|drafted)\s+message[:\s]*)/i, '');
  return out.trim();
}
