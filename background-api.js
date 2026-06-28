(function initGrokAIApi(global) {
  "use strict";

  const Config = global.GrokAIConfig;
  const Storage = global.GrokAIStorage;

  function parseApiError(status, data) {
    const err = data?.error;
    const message =
      (typeof err === "string" && err) ||
      err?.message ||
      data?.message ||
      data?.code ||
      `Grok API error (${status})`;

    if (status === 401) {
      return `${message} Check that your API key is correct and active at console.x.ai.`;
    }

    if (status === 402) {
      return `${message} Credits exhausted or payment required. Check your balance and usage at console.x.ai → Billing.`;
    }

    if (status === 403) {
      return [
        message,
        "Your API key is valid but lacks permission for this model or endpoint.",
        "In console.x.ai → API Keys, grant api-key:endpoint:* and api-key:model:*.",
        "Also ensure billing/credits are enabled."
      ].join(" ");
    }

    if (status === 404) {
      return `${message} The selected model may not be available to your xAI account. Try fetching models in Settings.`;
    }

    if (status === 429) {
      return `${message} xAI rate limit reached. Wait briefly, then retry.`;
    }

    return message;
  }

  async function grokRequest(url, xaiCredential, payload) {
    const key = Storage.validateApiKey(xaiCredential);
    const response = await fetch(url, {
      method: payload ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: payload ? JSON.stringify(payload) : undefined
    });

    let data = {};
    try {
      data = await response.json();
    } catch (_) {}

    if (!response.ok) {
      const error = new Error(parseApiError(response.status, data));
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  }

  async function chatWithGrok(messages, options = {}) {
    const settings = await Storage.getSettings();
    const requestedModel = options.model || settings.model || Config.defaultModel;
    const action = options.action || "chat";
    const systemPrompt = options.systemPrompt || settings.systemPrompt || Config.defaultSystemPrompt;

    await Storage.enforceRateLimit(action);

    const body = {
      model: requestedModel,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      temperature: options.temperature ?? 0.7,
      max_completion_tokens: options.maxTokens ?? 2048
    };

    try {
      const data = await grokRequest(Config.apiUrl, settings.xaiCredential, body);
      const content = data.choices?.[0]?.message?.content || "";
      if (data.usage) await Storage.recordUsage(data.usage, requestedModel, action);
      return { success: true, content, usage: data.usage, model: requestedModel };
    } catch (err) {
      if (err.status === 403 || err.status === 404) {
        for (const fallbackModel of Config.fallbackModels) {
          if (fallbackModel === requestedModel) continue;
          try {
            const data = await grokRequest(Config.apiUrl, settings.xaiCredential, {
              ...body,
              model: fallbackModel
            });
            const content = data.choices?.[0]?.message?.content || "";
            if (data.usage) await Storage.recordUsage(data.usage, fallbackModel, action);
            return {
              success: true,
              content,
              usage: data.usage,
              model: fallbackModel,
              usedFallbackModel: true
            };
          } catch (_) {}
        }
      }
      throw err;
    }
  }

  async function fetchAvailableModels(xaiCredential) {
    const settings = await Storage.getSettings();
    const key = xaiCredential || settings.xaiCredential;
    const data = await grokRequest(Config.modelsUrl, key);
    const models = (data.data || []).map((item) => item.id).filter(Boolean).sort();
    return { success: true, models };
  }

  async function testApiConnection(xaiCredential, model) {
    const settings = await Storage.getSettings();
    const key = xaiCredential || settings.xaiCredential;
    const targetModel = model || settings.model || Config.defaultModel;

    Storage.validateApiKey(key);

    let models = [];
    try {
      const listed = await fetchAvailableModels(key);
      models = listed.models || [];
    } catch (err) {
      return { success: false, error: `Could not list models: ${err.message}` };
    }

    const probeOrder = [targetModel, ...Config.fallbackModels.filter((m) => m !== targetModel)];
    for (const candidate of probeOrder) {
      try {
        const data = await grokRequest(Config.apiUrl, key, {
          model: candidate,
          messages: [{ role: "user", content: "Reply with OK" }],
          max_completion_tokens: 8
        });
        if (data.usage) await Storage.recordUsage(data.usage, candidate, "test");
        return {
          success: true,
          model: candidate,
          models,
          message: `Connected successfully using ${candidate}.`
        };
      } catch (err) {
        if (candidate === probeOrder[probeOrder.length - 1]) {
          return { success: false, models, error: err.message, status: err.status };
        }
      }
    }

    return { success: false, models, error: "Connection test failed." };
  }

  global.GrokAIApi = { chatWithGrok, fetchAvailableModels, testApiConnection };
})(self);
