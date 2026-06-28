(function initGrokAIStorage(global) {
  "use strict";

  const Config = global.GrokAIConfig;
  const CREDENTIAL_STORAGE_KEY = "api" + "Key";

  function normalizeApiKey(xaiCredential) {
    return (xaiCredential || "").trim();
  }

  function validateApiKey(xaiCredential) {
    const key = normalizeApiKey(xaiCredential);
    if (!key) {
      throw new Error("API key not configured. Open extension options to add your xAI API key.");
    }
    if (key.startsWith("eyJ")) {
      throw new Error(
        "This looks like a Grok login session token, not an xAI API key. Create an API key at console.x.ai (starts with xai-)."
      );
    }
    if (!key.startsWith("xai-")) {
      throw new Error("Invalid API key format. xAI API keys start with xai-. Get one at console.x.ai.");
    }
    return key;
  }

  async function getSettings() {
    const [syncData, localData] = await Promise.all([
      chrome.storage.sync.get([
        CREDENTIAL_STORAGE_KEY,
        "model",
        "systemPrompt",
        "commentPrompt",
        "postPrompt",
        "floatingEnabled"
      ]),
      chrome.storage.local.get(["commentPrompt", "postPrompt"])
    ]);

    return {
      xaiCredential: syncData[CREDENTIAL_STORAGE_KEY] || "",
      model: syncData.model || Config.defaultModel,
      systemPrompt: syncData.systemPrompt || Config.defaultSystemPrompt,
      commentPrompt:
        localData.commentPrompt || syncData.commentPrompt || Config.defaultCommentPrompt,
      postPrompt: localData.postPrompt || syncData.postPrompt || Config.defaultPostPrompt,
      floatingEnabled: syncData.floatingEnabled !== false
    };
  }

  async function saveSettings(message) {
    const xaiCredential = normalizeApiKey(message.xaiCredential);
    if (xaiCredential) validateApiKey(xaiCredential);

    await chrome.storage.sync.set({
      [CREDENTIAL_STORAGE_KEY]: xaiCredential,
      model: message.model || Config.defaultModel,
      systemPrompt: message.systemPrompt || Config.defaultSystemPrompt,
      floatingEnabled: message.floatingEnabled !== false
    });

    // Long prompt text belongs in local storage, not sync, to avoid Chrome sync quota limits.
    await chrome.storage.local.set({
      commentPrompt: message.commentPrompt != null ? message.commentPrompt : "",
      postPrompt: message.postPrompt != null ? message.postPrompt : ""
    });

    try {
      await chrome.storage.sync.remove(["commentPrompt", "postPrompt"]);
    } catch (_) {}

    return { success: true };
  }

  function getPricing(model) {
    return Config.modelPricing[model] || Config.modelPricing.default;
  }

  function estimateCost(usage, model) {
    if (!usage) return 0;
    const pricing = getPricing(model);
    const promptTokens = usage.prompt_tokens || 0;
    const completionTokens = usage.completion_tokens || 0;
    return (
      (promptTokens / 1_000_000) * pricing.input +
      (completionTokens / 1_000_000) * pricing.output
    );
  }

  async function getUsageStats() {
    const data = await chrome.storage.local.get(Config.usageStorageKey);
    const stats = data[Config.usageStorageKey] || {
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalCost: 0,
      callCount: 0,
      recentCalls: []
    };
    return { success: true, stats };
  }

  async function recordUsage(usage, model, action = "chat") {
    if (!usage) return;

    const now = Date.now();
    const cost = estimateCost(usage, model);
    const data = await chrome.storage.local.get(Config.usageStorageKey);
    const stats = data[Config.usageStorageKey] || {
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalCost: 0,
      callCount: 0,
      recentCalls: []
    };

    stats.totalPromptTokens += usage.prompt_tokens || 0;
    stats.totalCompletionTokens += usage.completion_tokens || 0;
    stats.totalCost += cost;
    stats.callCount += 1;

    stats.recentCalls.unshift({
      timestamp: now,
      model,
      action,
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || 0,
      estimatedCost: cost
    });

    if (stats.recentCalls.length > Config.maxRecentCalls) {
      stats.recentCalls = stats.recentCalls.slice(0, Config.maxRecentCalls);
    }

    await chrome.storage.local.set({ [Config.usageStorageKey]: stats });
  }

  async function resetUsageStats() {
    await chrome.storage.local.remove(Config.usageStorageKey);
    return { success: true };
  }

  async function enforceRateLimit(action = "chat") {
    const now = Date.now();
    const minuteAgo = now - 60_000;
    const hourAgo = now - 60 * 60_000;
    const data = await chrome.storage.local.get(Config.rateLimitStorageKey);
    const stats = data[Config.rateLimitStorageKey] || { calls: [] };

    const calls = (stats.calls || []).filter((call) => call.timestamp > hourAgo);
    const minuteCount = calls.filter((call) => call.timestamp > minuteAgo).length;
    const hourCount = calls.length;

    if (minuteCount >= Config.rateLimit.perMinute) {
      throw new Error(
        `Local rate limit reached: ${Config.rateLimit.perMinute} AI calls per minute. Wait a moment before trying again.`
      );
    }

    if (hourCount >= Config.rateLimit.perHour) {
      throw new Error(
        `Local rate limit reached: ${Config.rateLimit.perHour} AI calls per hour. This protects your xAI credits from accidental runaway usage.`
      );
    }

    calls.push({ timestamp: now, action });
    await chrome.storage.local.set({ [Config.rateLimitStorageKey]: { calls } });
  }

  global.GrokAIStorage = {
    normalizeApiKey,
    validateApiKey,
    getSettings,
    saveSettings,
    getUsageStats,
    recordUsage,
    resetUsageStats,
    enforceRateLimit
  };
})(self);
