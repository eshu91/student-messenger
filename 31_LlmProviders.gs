/**
 * 31_LlmProviders.gs — provider plugins.
 *
 * Every provider exposes the same shape:
 *   generate({ prompt, model, opts }) → { text, usage: { inputTokens, outputTokens }, actualCost? }
 *
 * Errors bubble as LlmError so LlmService can log status='error'.
 */

function _apiKeyFor(providerName) {
  const propName = LLM_KEY_NAMES[providerName];
  if (!propName) throw new LlmError('Unknown provider: ' + providerName);
  const key = PropertiesService.getScriptProperties().getProperty(propName);
  if (!key) throw new LlmError(providerName + ' API key not set. Add it in Settings.');
  return key;
}

function _fetchWithTimeout(url, options) {
  // UrlFetchApp doesn't expose per-request timeout, but the script runtime
  // caps execution at 6 minutes total. We rely on muteHttpExceptions and
  // surface non-2xx as LlmError.
  const opts = Object.assign({ muteHttpExceptions: true }, options || {});
  let res;
  try {
    res = UrlFetchApp.fetch(url, opts);
  } catch (e) {
    throw new LlmError('Network error: ' + (e && e.message ? e.message : e));
  }
  return res;
}

const LlmProviders = {

  // ---------- Groq ----------
  groq: {
    generate(args) {
      const { prompt, model, opts } = args;
      const apiKey = _apiKeyFor('groq');
      const res = _fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + apiKey },
        payload: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: opts.maxTokens,
          temperature: opts.temperature
        })
      });
      const code = res.getResponseCode();
      const data = safeJsonParse(res.getContentText(), {});
      if (code >= 400) {
        throw new LlmError('Groq error (' + code + '): ' + ((data.error && data.error.message) || res.getContentText().slice(0, 300)));
      }
      const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      const usage = data.usage || {};
      return {
        text: text || '',
        usage: {
          inputTokens:  usage.prompt_tokens     || 0,
          outputTokens: usage.completion_tokens || 0
        }
      };
    }
  },

  // ---------- OpenAI ----------
  openai: {
    generate(args) {
      const { prompt, model, opts } = args;
      const apiKey = _apiKeyFor('openai');
      const res = _fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + apiKey },
        payload: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: opts.maxTokens,
          temperature: opts.temperature
        })
      });
      const code = res.getResponseCode();
      const data = safeJsonParse(res.getContentText(), {});
      if (code >= 400) {
        throw new LlmError('OpenAI error (' + code + '): ' + ((data.error && data.error.message) || res.getContentText().slice(0, 300)));
      }
      const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      const usage = data.usage || {};
      return {
        text: text || '',
        usage: {
          inputTokens:  usage.prompt_tokens     || 0,
          outputTokens: usage.completion_tokens || 0
        }
      };
    }
  },

  // ---------- Anthropic ----------
  anthropic: {
    generate(args) {
      const { prompt, model, opts } = args;
      const apiKey = _apiKeyFor('anthropic');
      const res = _fetchWithTimeout('https://api.anthropic.com/v1/messages', {
        method: 'post',
        contentType: 'application/json',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        payload: JSON.stringify({
          model,
          max_tokens: opts.maxTokens, // REQUIRED for Anthropic
          temperature: opts.temperature,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      const code = res.getResponseCode();
      const data = safeJsonParse(res.getContentText(), {});
      if (code >= 400) {
        throw new LlmError('Anthropic error (' + code + '): ' + ((data.error && data.error.message) || res.getContentText().slice(0, 300)));
      }
      // content is an array of blocks; concatenate text-type blocks
      const blocks = data.content || [];
      const text = blocks
        .filter(b => b && b.type === 'text')
        .map(b => b.text)
        .join('');
      const usage = data.usage || {};
      return {
        text,
        usage: {
          inputTokens:  usage.input_tokens  || 0,
          outputTokens: usage.output_tokens || 0
        }
      };
    }
  },

  // ---------- Gemini ----------
  gemini: {
    generate(args) {
      const { prompt, model, opts } = args;
      const apiKey = _apiKeyFor('gemini');
      const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
                  encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey);
      const res = _fetchWithTimeout(url, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: opts.maxTokens,
            temperature: opts.temperature
          }
        })
      });
      const code = res.getResponseCode();
      const data = safeJsonParse(res.getContentText(), {});
      if (code >= 400) {
        throw new LlmError('Gemini error (' + code + '): ' + ((data.error && data.error.message) || res.getContentText().slice(0, 300)));
      }
      const cand = data.candidates && data.candidates[0];
      if (!cand) throw new LlmError('Gemini returned no candidates');
      if (cand.finishReason && cand.finishReason !== 'STOP' && cand.finishReason !== 'MAX_TOKENS') {
        throw new LlmError('Gemini finishReason: ' + cand.finishReason);
      }
      const parts = (cand.content && cand.content.parts) || [];
      const text = parts.map(p => p.text || '').join('');
      const u = data.usageMetadata || {};
      return {
        text,
        usage: {
          inputTokens:  u.promptTokenCount     || 0,
          outputTokens: u.candidatesTokenCount || 0
        }
      };
    }
  },

  // ---------- OpenRouter ----------
  openrouter: {
    generate(args) {
      const { prompt, model, opts } = args;
      const apiKey = _apiKeyFor('openrouter');
      const res = _fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
        method: 'post',
        contentType: 'application/json',
        headers: {
          Authorization: 'Bearer ' + apiKey,
          'HTTP-Referer': 'https://script.google.com',
          'X-Title': 'Everest Student Messenger'
        },
        payload: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: opts.maxTokens,
          temperature: opts.temperature
        })
      });
      const code = res.getResponseCode();
      const data = safeJsonParse(res.getContentText(), {});
      if (code >= 400) {
        throw new LlmError('OpenRouter error (' + code + '): ' + ((data.error && data.error.message) || res.getContentText().slice(0, 300)));
      }
      const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      const usage = data.usage || {};
      const out = {
        text: text || '',
        usage: {
          inputTokens:  usage.prompt_tokens     || 0,
          outputTokens: usage.completion_tokens || 0
        }
      };
      // OpenRouter sometimes includes actual cost
      if (usage.total_cost != null) out.actualCost = Number(usage.total_cost);
      return out;
    }
  }
};
