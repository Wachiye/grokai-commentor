/* global DEFAULT_COMMENT_PROMPT, DEFAULT_POST_PROMPT */
(function initGrokAIConfig(global) {
  "use strict";

  const DEFAULT_SYSTEM_PROMPT =
    "You are Grok, a helpful AI assistant embedded in the browser. Be concise, accurate, and actionable.";

  global.GrokAIConfig = Object.freeze({
    apiUrl: "https://api.x.ai/v1/chat/completions",
    modelsUrl: "https://api.x.ai/v1/models",
    defaultModel: "grok-4.3",
    fallbackModels: ["grok-4.3", "grok-3-fast", "grok-3", "grok-3-mini"],
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    defaultCommentPrompt:
      typeof DEFAULT_COMMENT_PROMPT !== "undefined" ? DEFAULT_COMMENT_PROMPT : "",
    defaultPostPrompt:
      typeof DEFAULT_POST_PROMPT !== "undefined" ? DEFAULT_POST_PROMPT : "",
    usageStorageKey: "usageStats",
    rateLimitStorageKey: "rateLimitStats",
    maxRecentCalls: 20,
    rateLimit: {
      // Local browser-side guardrail to prevent accidental runaway usage.
      perMinute: 12,
      perHour: 80
    },
    modelPricing: {
      // Approximate USD pricing per 1M tokens. Keep this synced with xAI console if prices change.
      "grok-4.3": { input: 1.25, output: 2.5 },
      "grok-3": { input: 2.0, output: 6.0 },
      "grok-3-fast": { input: 0.2, output: 0.5 },
      "grok-3-mini": { input: 0.1, output: 0.3 },
      default: { input: 1.25, output: 2.5 }
    },
    toneDescriptions: {
      witty: "witty, clever and sharp",
      casual: "casual, friendly and conversational",
      punchy: "short, punchy and direct",
      edgy: "edgy, bold and unfiltered (still respectful)",
      supportive: "supportive, encouraging and positive",
      sarcastic: "sarcastic, dry and a bit roasting"
    }
  });
})(self);
