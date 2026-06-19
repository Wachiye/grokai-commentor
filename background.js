importScripts("comment-prompt.js", "post-prompt.js");

const GROK_API_URL = "https://api.x.ai/v1/chat/completions";
const GROK_MODELS_URL = "https://api.x.ai/v1/models";
const DEFAULT_MODEL = "grok-4.3";
const FALLBACK_MODELS = [
  "grok-4.3",
  "grok-3-fast",
  "grok-3",
  "grok-3-mini"
];

// Pricing per 1M tokens (approx, update as needed from console.x.ai)
const MODEL_PRICING = {
  "grok-4.3": { input: 1.25, output: 2.50 },
  "grok-3": { input: 2.00, output: 6.00 },
  "grok-3-fast": { input: 0.20, output: 0.50 },
  "grok-3-mini": { input: 0.10, output: 0.30 },
  default: { input: 1.25, output: 2.50 }
};

const USAGE_STORAGE_KEY = "usageStats";
const MAX_RECENT_CALLS = 20;

const pendingPanelRequests = new Map();
const panelDeliveryTimers = new Map();

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (err) {
    console.error("Failed to open side panel:", err);
  }
});

try {
  chrome.action.setPopup({ popup: "" });
} catch (_) {}

chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.action.setPopup({ popup: "" });
  } catch (_) {}

  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "grok-ask-selection",
      title: "Ask Grok about selection",
      contexts: ["selection"]
    });
    chrome.contextMenus.create({
      id: "grok-summarize-page",
      title: "Summarize page with Grok",
      contexts: ["page"]
    });
    chrome.contextMenus.create({
      id: "grok-generate-comment",
      title: "Generate comment with Grok",
      contexts: ["selection", "page"]
    });
    chrome.contextMenus.create({
      id: "grok-craft-post",
      title: "Craft new post with Grok",
      contexts: ["selection", "page"]
    });
    chrome.contextMenus.create({
      id: "grok-explain",
      title: "Explain with Grok",
      contexts: ["selection"]
    });
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    broadcastContextUpdate(tabId);
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  broadcastContextUpdate(tabId);
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  const intentMap = {
    "grok-ask-selection": "ask",
    "grok-summarize-page": "summarize",
    "grok-generate-comment": "comment",
    "grok-craft-post": "post",
    "grok-explain": "explain"
  };

  const intent = intentMap[info.menuItemId];
  if (!intent) return;

  let payload = {
    selectionText: info.selectionText || "",
    pageUrl: tab.url || "",
    pageTitle: tab.title || ""
  };

  if (!info.selectionText && tab.id) {
    try {
      const page = await extractPageContent(tab.id);
      payload = { ...payload, ...page };
    } catch (_) {}
  } else if (info.selectionText) {
    payload.content = info.selectionText;
  }

  await openPanelWithPayload(tab, intent, payload);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err) => sendResponse({ success: false, error: err.message }));
  return true;
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case "OPEN_PANEL": {
      const tab = sender.tab || (await getActiveTab());
      return openPanelWithPayload(
        tab,
        message.intent || "chat",
        message.payload || {}
      );
    }

    case "PANEL_DELIVER_ACK":
      clearPanelDelivery(message.requestId);
      return { success: true };

    case "GET_SETTINGS":
      return getSettings();

    case "SAVE_SETTINGS": {
      const apiKey = normalizeApiKey(message.apiKey);
      if (apiKey) validateApiKey(apiKey);

      // Small/syncable settings
      await chrome.storage.sync.set({
        apiKey,
        model: message.model || DEFAULT_MODEL,
        systemPrompt: message.systemPrompt || ""
      });

      // Large prompt text goes to local storage (avoids sync 8KB/item limit)
      const commentP = message.commentPrompt != null ? message.commentPrompt : "";
      const postP = message.postPrompt != null ? message.postPrompt : "";
      await chrome.storage.local.set({
        commentPrompt: commentP,
        postPrompt: postP
      });

      // Clean legacy large values from sync to free quota
      try {
        await chrome.storage.sync.remove(["commentPrompt", "postPrompt"]);
      } catch (_) {}

      return { success: true };
    }

    case "CHAT":
      return chatWithGrok(message.messages, message.options);

    case "GENERATE":
      return generateWithGrok(message.action, message.content, message.context, message.tone);

    case "TEST_API":
      return testApiConnection(message.apiKey, message.model);

    case "FETCH_MODELS":
      return fetchAvailableModels(message.apiKey);

    case "GET_USAGE_STATS":
      return getUsageStats();

    case "RESET_USAGE_STATS":
      return resetUsageStats();

    case "EXTRACT_PAGE": {
      const tabId = message.tabId || sender.tab?.id || (await getActiveTab())?.id;
      if (!tabId) throw new Error("No active tab");
      return extractPageContent(tabId);
    }

    case "PAGE_CONTEXT_CHANGED":
      await pushContextUpdate(message.payload);
      return { success: true };

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

async function getSettings() {
  // Prompts use local (supports long text); other settings use sync.
  // Fall back to sync for prompts (legacy migration).
  const [syncData, localData] = await Promise.all([
    chrome.storage.sync.get([
      "apiKey",
      "model",
      "systemPrompt",
      "commentPrompt",
      "postPrompt"
    ]),
    chrome.storage.local.get(["commentPrompt", "postPrompt"])
  ]);

  const commentPrompt =
    localData.commentPrompt || syncData.commentPrompt || DEFAULT_COMMENT_PROMPT;
  const postPrompt =
    localData.postPrompt || syncData.postPrompt || DEFAULT_POST_PROMPT;

  return {
    apiKey: syncData.apiKey || "",
    model: syncData.model || DEFAULT_MODEL,
    systemPrompt:
      syncData.systemPrompt ||
      "You are Grok, a helpful AI assistant embedded in the browser. Be concise, accurate, and actionable.",
    commentPrompt,
    postPrompt
  };
}

async function openPanelWithPayload(tab, intent, payload) {
  if (!tab?.id) {
    return { success: false, error: "No tab available" };
  }

  const requestId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const windowId = tab.windowId;

  if (windowId) {
    try {
      await chrome.sidePanel.open({ windowId });
    } catch (err) {
      if (!err?.message?.includes("user gesture")) {
        throw err;
      }
    }
  }

  queuePanelDelivery({
    tabId: tab.id,
    requestId,
    intent,
    payload
  });

  return { success: true, requestId };
}

function queuePanelDelivery(request) {
  pendingPanelRequests.set(request.requestId, request);
  deliverToPanel(request);

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (attempts >= 25 || !pendingPanelRequests.has(request.requestId)) {
      clearInterval(timer);
      panelDeliveryTimers.delete(request.requestId);
      pendingPanelRequests.delete(request.requestId);
      return;
    }
    deliverToPanel(request);
  }, 400);

  panelDeliveryTimers.set(request.requestId, timer);
}

function deliverToPanel(request) {
  chrome.runtime
    .sendMessage({
      type: "PANEL_DATA",
      requestId: request.requestId,
      intent: request.intent,
      payload: request.payload
    })
    .catch(() => {});
}

function clearPanelDelivery(requestId) {
  const timer = panelDeliveryTimers.get(requestId);
  if (timer) {
    clearInterval(timer);
    panelDeliveryTimers.delete(requestId);
  }
  pendingPanelRequests.delete(requestId);
}

function normalizeApiKey(apiKey) {
  return (apiKey || "").trim();
}

function validateApiKey(apiKey) {
  const key = normalizeApiKey(apiKey);
  if (!key) {
    throw new Error("API key not configured. Open extension options to add your xAI API key.");
  }
  if (key.startsWith("eyJ")) {
    throw new Error(
      "This looks like a Grok login session token, not an xAI API key. Create an API key at console.x.ai (starts with xai-)."
    );
  }
  if (!key.startsWith("xai-")) {
    throw new Error(
      "Invalid API key format. xAI API keys start with xai-. Get one at console.x.ai."
    );
  }
  return key;
}

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
      "In console.x.ai → API Keys, edit the key and grant:",
      "  • api-key:endpoint:*",
      "  • api-key:model:*",
      "Also ensure billing/credits are enabled and try model grok-4.3."
    ].join(" ");
  }

  return message;
}

async function grokRequest(url, apiKey, payload) {
  const key = validateApiKey(apiKey);
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
  } catch (_) {
    data = {};
  }

  if (!response.ok) {
    const error = new Error(parseApiError(response.status, data));
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

async function chatWithGrok(messages, options = {}) {
  const settings = await getSettings();
  const requestedModel = options.model || settings.model || DEFAULT_MODEL;
  const action = options.action || "chat";

  const systemPrompt = options.systemPrompt || settings.systemPrompt;

  const body = {
    model: requestedModel,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages
    ],
    temperature: options.temperature ?? 0.7,
    max_completion_tokens: options.maxTokens ?? 2048
  };

  try {
    const data = await grokRequest(GROK_API_URL, settings.apiKey, body);
    const content = data.choices?.[0]?.message?.content || "";
    if (data.usage) {
      await recordUsage(data.usage, requestedModel, action);
    }
    return {
      success: true,
      content,
      usage: data.usage,
      model: requestedModel
    };
  } catch (err) {
    if (err.status === 403 || err.status === 404) {
      for (const fallbackModel of FALLBACK_MODELS) {
        if (fallbackModel === requestedModel) continue;
        try {
          const data = await grokRequest(GROK_API_URL, settings.apiKey, {
            ...body,
            model: fallbackModel
          });
          const content = data.choices?.[0]?.message?.content || "";
          if (data.usage) {
            await recordUsage(data.usage, fallbackModel, action);
          }
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

async function fetchAvailableModels(apiKey) {
  const settings = await getSettings();
  const key = apiKey || settings.apiKey;
  const data = await grokRequest(GROK_MODELS_URL, key);
  const models = (data.data || [])
    .map((item) => item.id)
    .filter(Boolean)
    .sort();
  return { success: true, models };
}

async function testApiConnection(apiKey, model) {
  const settings = await getSettings();
  const key = apiKey || settings.apiKey;
  const targetModel = model || settings.model || DEFAULT_MODEL;

  validateApiKey(key);

  let models = [];
  try {
    const listed = await fetchAvailableModels(key);
    models = listed.models || [];
  } catch (err) {
    return {
      success: false,
      error: `Could not list models: ${err.message}`
    };
  }

  const probeOrder = [
    targetModel,
    ...FALLBACK_MODELS.filter((m) => m !== targetModel)
  ];

  for (const candidate of probeOrder) {
    try {
      const data = await grokRequest(GROK_API_URL, key, {
        model: candidate,
        messages: [{ role: "user", content: "Reply with OK" }],
        max_completion_tokens: 8
      });
      return {
        success: true,
        model: candidate,
        models,
        message: `Connected successfully using ${candidate}.`
      };
    } catch (err) {
      if (candidate === probeOrder[probeOrder.length - 1]) {
        return {
          success: false,
          models,
          error: err.message,
          status: err.status
        };
      }
    }
  }

  return {
    success: false,
    models,
    error: "Connection test failed."
  };
}

async function generateWithGrok(action, content, context = {}, tone = null) {
  const settings = await getSettings();

  if (action === "comment") {
    const platform = context.platform || "web";

    // Build optional tone instruction
    let tonePrefix = '';
    if (tone && tone !== 'auto') {
      const toneDescriptions = {
        witty: 'witty, clever and sharp',
        casual: 'casual, friendly and conversational',
        punchy: 'short, punchy and direct',
        edgy: 'edgy, bold and unfiltered (still respectful)',
        supportive: 'supportive, encouraging and positive',
        sarcastic: 'sarcastic, dry and a bit roasting'
      };
      const desc = toneDescriptions[tone] || tone;
      tonePrefix = `Tone: Use a ${desc} style for the replies. Make this the dominant voice. `;
    }

    const userPrompt = `${tonePrefix}Generate up to 5 high-engagement reply options for this ${platform === "twitter" ? "tweet" : "post"}.

Goal: create replies that have a real chance of going massively (likes, quotes, long threads).
Prioritize:
- Sharp, specific callbacks to the exact content
- Strong first line that stops people in the replies
- Mix of funny, validating, bold, and conversation-starting angles
- At least one option with serious "this could blow up" energy

For EACH reply, rate its potential for massive engagement (likes, quote tweets, reply chains) on a scale of 1-10.
Use this exact format for every reply:
"reply text here" [Score: 9/10 - short reason focused on virality]

URL: ${context.url || "Unknown"}
Title: ${context.title || ""}

Content:
${content}

Write fresh human-sounding replies only. Include the score block for each. No other labels except the required "Best pick" at the end.`;

    return chatWithGrok([{ role: "user", content: userPrompt }], {
      systemPrompt: settings.commentPrompt,
      temperature: 0.92,
      maxTokens: 2800,
      action: "comment"
    });
  }

  if (action === "post") {
    const platform = context.platform || "web";
    const postLabel = platform === "twitter" ? "tweets" : "posts";
    const topic = (context.topic || "").trim();
    const parts = [];

    // Tone instruction for posts
    if (tone && tone !== 'auto') {
      const toneDescriptions = {
        witty: 'witty, clever and sharp',
        casual: 'casual, friendly and conversational',
        punchy: 'short, punchy and direct',
        edgy: 'edgy, bold and unfiltered (still respectful)',
        supportive: 'supportive, encouraging and positive',
        sarcastic: 'sarcastic, dry and a bit roasting'
      };
      const desc = toneDescriptions[tone] || tone;
      parts.push(`Tone/style: Craft posts in a ${desc} tone. Lean strongly into this style.`);
    }

    parts.push(`Craft original ${postLabel} optimized for real views and engagement (not low-impression filler).`);

    if (topic) {
      parts.push(`Topic/direction: ${topic}`);
    }

    if (content) {
      parts.push(
        `Use this as inspiration or context (do not reply to it — write new original ${postLabel} inspired by it):`,
        content
      );
    }

    if (context.url) parts.push(`URL: ${context.url}`);
    if (context.title) parts.push(`Page title: ${context.title}`);

    parts.push(
      "CRITICAL: Every post must open with a strong hook. Focus on scroll-stopping first lines, emotional resonance, quotability, and angles that can reach beyond followers. Prioritize posts that feel current and worth sharing/quoting. Generate up to 5 options. Mark the single best one for maximum reach."
    );

    if (!topic && !content) {
      parts.push(
        "No specific topic — create timely, sharp, culturally sharp original posts that would actually perform on current Kenyan (and broader) X right now."
      );
    }

    return chatWithGrok([{ role: "user", content: parts.join("\n\n") }], {
      systemPrompt: settings.postPrompt,
      temperature: 0.92,
      maxTokens: 2800,
      action: "post"
    });
  }

  const prompts = {
    summarize: `Summarize the following webpage content in 3-5 bullet points. Focus on key takeaways.\n\nTitle: ${context.title || "Unknown"}\nURL: ${context.url || ""}\n\nContent:\n${content}`,
    explain: `Explain the following text clearly and concisely. Use simple language and examples where helpful.\n\nText:\n${content}`,
    ask: content,
    analyze: `Analyze the following content. Identify main themes, sentiment, and any actionable insights.\n\nContent:\n${content}`
  };

  const prompt = prompts[action] || content;
  return chatWithGrok([{ role: "user", content: prompt }]);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  return tab;
}

async function pushContextUpdate(payload) {
  if (!payload?.url && !payload?.content) return;
  chrome.runtime
    .sendMessage({ type: "CONTEXT_UPDATE", payload })
    .catch(() => {});
}

async function broadcastContextUpdate(tabId) {
  try {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });
    if (!activeTab?.id || activeTab.id !== tabId) return;
    const page = await extractPageContent(tabId);
    await pushContextUpdate(page);
  } catch (_) {}
}

async function extractPageContent(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      action: "extractContent"
    });
    if (response?.success) {
      return response;
    }
  } catch (_) {}

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const selection = window.getSelection()?.toString()?.trim() || "";
      const article =
        document.querySelector("article") ||
        document.querySelector('[role="article"]') ||
        document.querySelector("main") ||
        document.body;

      const clone = article.cloneNode(true);
      clone
        .querySelectorAll("script, style, nav, footer, aside, iframe, noscript")
        .forEach((el) => el.remove());

      const text = (clone.innerText || clone.textContent || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 12000);

      const host = location.hostname;
      let platform = "web";
      if (host.includes("twitter.com") || host.includes("x.com")) platform = "twitter";
      else if (host.includes("linkedin.com")) platform = "linkedin";
      else if (host.includes("reddit.com")) platform = "reddit";
      else if (host.includes("facebook.com")) platform = "facebook";

      return {
        title: document.title,
        url: location.href,
        platform,
        selection,
        content: selection || text
      };
    }
  });

  return { success: true, ...result };
}

// --- Usage / Credits Tracking ---

function getPricing(model) {
  return MODEL_PRICING[model] || MODEL_PRICING.default;
}

function estimateCost(usage, model) {
  if (!usage) return 0;
  const p = getPricing(model);
  const promptCost = ((usage.prompt_tokens || 0) / 1_000_000) * p.input;
  const completionCost = ((usage.completion_tokens || 0) / 1_000_000) * p.output;
  return promptCost + completionCost;
}

async function getUsageStats() {
  const data = await chrome.storage.local.get(USAGE_STORAGE_KEY);
  const stats = data[USAGE_STORAGE_KEY] || {
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

  const data = await chrome.storage.local.get(USAGE_STORAGE_KEY);
  let stats = data[USAGE_STORAGE_KEY] || {
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

  const call = {
    timestamp: now,
    model,
    action,
    promptTokens: usage.prompt_tokens || 0,
    completionTokens: usage.completion_tokens || 0,
    totalTokens: usage.total_tokens || 0,
    estimatedCost: cost
  };

  stats.recentCalls.unshift(call);
  if (stats.recentCalls.length > MAX_RECENT_CALLS) {
    stats.recentCalls.pop();
  }

  await chrome.storage.local.set({ [USAGE_STORAGE_KEY]: stats });
}

async function resetUsageStats() {
  await chrome.storage.local.remove(USAGE_STORAGE_KEY);
  return { success: true };
}