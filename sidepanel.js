const messagesEl = document.getElementById("messages");
const promptEl = document.getElementById("prompt");
const sendBtn = document.getElementById("send-btn");
const statusEl = document.getElementById("status");
const pageContextEl = document.getElementById("page-context");
const settingsBtn = document.getElementById("settings-btn");

let chatHistory = [];
let pageContext = {
  title: "",
  url: "",
  platform: "",
  content: ""
};
let contextWatchTimer = null;

settingsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());

sendBtn.addEventListener("click", () => sendMessage());
promptEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

document.querySelectorAll(".quick-actions button").forEach((btn) => {
  btn.addEventListener("click", () => runIntent(btn.dataset.intent));
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "CONTEXT_UPDATE") {
    applyPageContext(message.payload, { announce: true });
    return;
  }

  if (message.type !== "PANEL_DATA") return;

  chrome.runtime.sendMessage({
    type: "PANEL_DELIVER_ACK",
    requestId: message.requestId
  });

  applyPageContext(message.payload);
  runIntent(message.intent || "chat", message.payload);
});

window.addEventListener("beforeunload", () => {
  if (contextWatchTimer) clearInterval(contextWatchTimer);
});

init();

async function init() {
  const settings = await send("GET_SETTINGS");
  if (!settings.apiKey) {
    addMessage(
      "system",
      "Add your xAI API key in Settings to start using Grok."
    );
  }

  await refreshPageContext({ announce: false });
  startContextWatch();
}

function startContextWatch() {
  if (contextWatchTimer) clearInterval(contextWatchTimer);
  contextWatchTimer = setInterval(() => {
    refreshPageContext({ announce: false });
  }, 2500);
}

function contextFingerprint(ctx) {
  return `${ctx.url || ""}::${(ctx.content || "").slice(0, 200)}`;
}

function applyPageContext(payload = {}, options = {}) {
  const { announce = false } = options;
  const next = {
    title: payload.title || payload.pageTitle || "",
    url: payload.url || payload.pageUrl || "",
    platform: payload.platform || "",
    content:
      payload.content ||
      payload.selection ||
      payload.selectionText ||
      payload.postContent ||
      payload.pageText ||
      ""
  };

  if (!next.content && !next.url) return;

  const urlChanged = next.url && next.url !== pageContext.url;
  const fingerprintChanged = contextFingerprint(next) !== contextFingerprint(pageContext);

  pageContext = next;
  updatePageContext();

  // Only clear sidepanel history on strong context changes (URL change).
  // This avoids wiping results/chat mid-use due to minor page mutations (likes, etc.).
  if (urlChanged) {
    chatHistory = [];
    if (messagesEl) messagesEl.innerHTML = "";
  }

  if (urlChanged && announce) {
    const label = pageContext.title || shortenUrl(pageContext.url);
    addMessage("system", `Now on: ${label}`);
  } else if (!urlChanged && fingerprintChanged && announce) {
    // Light update only
  }
}

function shortenUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname.length > 48
      ? `${parsed.pathname.slice(0, 48)}...`
      : parsed.pathname || parsed.hostname;
  } catch (_) {
    return url;
  }
}

async function refreshPageContext(options = {}) {
  try {
    const page = await send("EXTRACT_PAGE");
    if (page?.content || page?.url) {
      applyPageContext(page, options);
    }
  } catch (_) {}
}

function updatePageContext() {
  const label = pageContext.title || shortenUrl(pageContext.url) || "Ready";
  pageContextEl.textContent = label;
  pageContextEl.title = pageContext.url || label;
}

function addMessage(role, content) {
  const el = document.createElement("div");
  el.className = `message ${role}`;
  el.textContent = content;

  if (role === "assistant") {
    const copyBtn = document.createElement("button");
    copyBtn.textContent = "Copy";
    copyBtn.className = "copy-btn";
    copyBtn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(content);
      copyBtn.textContent = "Copied!";
      setTimeout(() => {
        copyBtn.textContent = "Copy";
      }, 1500);
    });
    el.appendChild(copyBtn);
  }

  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setLoading(isLoading, text = "") {
  sendBtn.disabled = isLoading;
  statusEl.textContent = text;
}

async function runIntent(intent, payload = {}) {
  await refreshPageContext({ announce: false });

  const topic = promptEl.value.trim();
  const content =
    payload.content ||
    payload.selection ||
    payload.selectionText ||
    pageContext.content;

  if (intent === "post") {
    const label = topic
      ? `Craft posts about: ${topic}`
      : content
        ? "Craft new posts inspired by this"
        : "Craft new posts";
    addMessage("user", label);
    if (topic) promptEl.value = "";

    // If user typed their own topic/idea, generate fresh posts of their own.
    // Don't base it entirely on the current tweet by default.
    const genContent = topic ? "" : (content || "");
    await generate("post", genContent, { topic });
    return;
  }

  if (!content && intent !== "chat") {
    addMessage("error", "No page content found. Select text or navigate to a page first.");
    return;
  }

  const prompts = {
    summarize: "Summarize this page",
    comment: "Generate social comments for this",
    explain: "Explain this content",
    analyze: "Analyze this content",
    ask: payload.selectionText || content,
    chat: null
  };

  const userText = prompts[intent];
  if (userText) {
    addMessage("user", userText);
    await generate(intent, content);
    return;
  }

  if (content) {
    addMessage(
      "system",
      `Loaded context from ${pageContext.title || "current page"}`
    );
  }
}

async function sendMessage() {
  await refreshPageContext({ announce: false });

  const text = promptEl.value.trim();
  if (!text) return;

  promptEl.value = "";
  addMessage("user", text);
  chatHistory.push({ role: "user", content: buildUserPrompt(text) });

  setLoading(true, "Grok is thinking...");
  try {
    const result = await send("CHAT", { messages: chatHistory });
    chatHistory.push({ role: "assistant", content: result.content });
    addMessage("assistant", result.content);
    if (result.usedFallbackModel) {
      addMessage("system", `Used fallback model: ${result.model}`);
    }
    if (result.usage) {
      const u = result.usage;
      const p = u.prompt_tokens || 0;
      const c = u.completion_tokens || 0;
      addMessage("system", `Usage: ${p} prompt + ${c} completion tokens`);
    }
  } catch (err) {
    addMessage("error", err.message);
  } finally {
    setLoading(false, "");
  }
}

async function generate(action, content, extraContext = {}) {
  setLoading(true, "Grok is thinking...");
  try {
    const genPayload = {
      action,
      content,
      context: {
        title: pageContext.title,
        url: pageContext.url,
        platform: pageContext.platform,
        hasMedia: pageContext.hasMedia,
        quotedContent: pageContext.quotedContent,
        mediaSummary: pageContext.mediaSummary,
        ...extraContext
      }
    };
    if (action === 'comment' || action === 'post') {
      // Try to use last selected tone from storage for consistency with floating UI
      try {
        const { selectedTone } = await chrome.storage.local.get({ selectedTone: 'auto' });
        if (selectedTone) genPayload.tone = selectedTone;
      } catch (_) {}
    }
    const result = await send("GENERATE", genPayload);
    addMessage("assistant", result.content);
    if (result.usedFallbackModel) {
      addMessage("system", `Used fallback model: ${result.model}`);
    }
    if (result.usage) {
      const u = result.usage;
      const p = u.prompt_tokens || 0;
      const c = u.completion_tokens || 0;
      addMessage("system", `Usage: ${p} prompt + ${c} completion tokens`);
    }
    chatHistory.push(
      { role: "user", content: buildUserPrompt(content) },
      { role: "assistant", content: result.content }
    );
  } catch (err) {
    addMessage("error", err.message);
  } finally {
    setLoading(false, "");
  }
}

function buildUserPrompt(text) {
  const contextBits = [];
  if (pageContext.title) contextBits.push(`Page title: ${pageContext.title}`);
  if (pageContext.url) contextBits.push(`URL: ${pageContext.url}`);
  if (pageContext.hasMedia) contextBits.push("Note: Post contains media (images/video) described in context below.");
  if (pageContext.quotedContent) contextBits.push(`Quoted context: ${pageContext.quotedContent}`);
  if (pageContext.content && !text.includes(pageContext.content.slice(0, 200))) {
    contextBits.push(`Page context:\n${pageContext.content.slice(0, 4000)}`);
  }
  if (!contextBits.length) return text;
  return `${text}\n\n---\n${contextBits.join("\n")}`;
}

function send(type, extra = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...extra }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response) {
        reject(new Error("No response from background"));
        return;
      }
      if (response.success === false) {
        reject(new Error(response.error || "Request failed"));
        return;
      }
      resolve(response);
    });
  });
}