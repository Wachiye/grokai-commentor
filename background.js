importScripts(
  "comment-prompt.js",
  "post-prompt.js",
  "background-config.js",
  "background-storage.js",
  "background-api.js",
  "background-generators.js",
  "background-panel.js",
  "background-context.js"
);

const Storage = self.GrokAIStorage;
const Api = self.GrokAIApi;
const Generators = self.GrokAIGenerators;
const Panel = self.GrokAIPanel;
const Context = self.GrokAIContext;

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
    [
      ["grok-ask-selection", "Ask Grok about selection", ["selection"]],
      ["grok-summarize-page", "Summarize page with Grok", ["page"]],
      ["grok-generate-comment", "Generate comment with Grok", ["selection", "page"]],
      ["grok-craft-post", "Craft new post with Grok", ["selection", "page"]],
      ["grok-explain", "Explain with Grok", ["selection"]]
    ].forEach(([id, title, contexts]) => chrome.contextMenus.create({ id, title, contexts }));
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === "complete") Context.broadcastContextUpdate(tabId);
});

chrome.tabs.onActivated.addListener(({ tabId }) => Context.broadcastContextUpdate(tabId));

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

  if (!info.selectionText) {
    try {
      payload = { ...payload, ...(await Context.extractPageContent(tab.id)) };
    } catch (_) {}
  } else {
    payload.content = info.selectionText;
  }

  await Panel.openPanelWithPayload(tab, intent, payload);
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
      const tab = sender.tab || (await Panel.getActiveTab());
      return Panel.openPanelWithPayload(tab, message.intent || "chat", message.payload || {});
    }

    case "PANEL_DELIVER_ACK":
      Panel.clearPanelDelivery(message.requestId);
      return { success: true };

    case "GET_SETTINGS":
      return Storage.getSettings();

    case "SAVE_SETTINGS":
      return Storage.saveSettings(message);

    case "CHAT":
      return Api.chatWithGrok(message.messages || [], message.options || {});

    case "GENERATE":
      return Generators.generateWithGrok(
        message.action,
        message.content || "",
        message.context || {},
        message.tone || null
      );

    case "TEST_API":
      return Api.testApiConnection(message.xaiCredential, message.model);

    case "FETCH_MODELS":
      return Api.fetchAvailableModels(message.xaiCredential);

    case "GET_USAGE_STATS":
      return Storage.getUsageStats();

    case "RESET_USAGE_STATS":
      return Storage.resetUsageStats();

    case "EXTRACT_PAGE": {
      const tabId = message.tabId || sender.tab?.id || (await Panel.getActiveTab())?.id;
      if (!tabId) throw new Error("No active tab");
      return Context.extractPageContent(tabId);
    }

    case "PAGE_CONTEXT_CHANGED":
      await Context.pushContextUpdate(message.payload);
      return { success: true };

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}
