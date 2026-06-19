const form = document.getElementById("settings-form");
const saveStatus = document.getElementById("save-status");
const testStatus = document.getElementById("test-status");
const testBtn = document.getElementById("test-btn");

const DEFAULT_COMMENT_PROMPT_FALLBACK =
  "Kenyan X/Twitter reply writer prompt not loaded. Reload the extension.";
const DEFAULT_POST_PROMPT_FALLBACK =
  "Kenyan X/Twitter post writer prompt not loaded. Reload the extension.";

const fields = {
  apiKey: document.getElementById("apiKey"),
  model: document.getElementById("model"),
  systemPrompt: document.getElementById("systemPrompt"),
  commentPrompt: document.getElementById("commentPrompt"),
  postPrompt: document.getElementById("postPrompt"),
  floatingEnabled: document.getElementById("floatingEnabled")
};

loadSettings();
setupUsageUI();

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  saveStatus.textContent = "";
  testStatus.textContent = "";
  testStatus.className = "test-status";

  const apiKey = fields.apiKey.value.trim();
  const validationError = getApiKeyValidationError(apiKey);
  if (validationError) {
    saveStatus.textContent = validationError;
    saveStatus.style.color = "#dc2626";
    return;
  }

  try {
    const commentPrompt = fields.commentPrompt.value.trim();
    const postPrompt = fields.postPrompt.value.trim();

    // Small/syncable settings
    await chrome.storage.sync.set({
      apiKey,
      model: fields.model.value,
      systemPrompt: fields.systemPrompt.value.trim(),
      floatingEnabled: fields.floatingEnabled.checked
    });

    // Prompts to local (supports very long custom instructions)
    await chrome.storage.local.set({
      commentPrompt,
      postPrompt
    });

    // Remove legacy prompt keys from sync (frees quota if previously stored there)
    try {
      await chrome.storage.sync.remove(["commentPrompt", "postPrompt"]);
    } catch (_) {}

    saveStatus.style.color = "#16a34a";
    saveStatus.textContent = "Saved!";
    setTimeout(() => {
      saveStatus.textContent = "";
    }, 2000);
  } catch (err) {
    saveStatus.style.color = "#dc2626";
    saveStatus.textContent = "Save failed: " + (err && err.message ? err.message : "storage error");
  }
});

testBtn.addEventListener("click", async () => {
  testStatus.className = "test-status";
  testStatus.textContent = "Testing connection...";
  testBtn.disabled = true;

  const apiKey = fields.apiKey.value.trim();
  const validationError = getApiKeyValidationError(apiKey);
  if (validationError) {
    testStatus.className = "test-status err";
    testStatus.textContent = validationError;
    testBtn.disabled = false;
    return;
  }

  try {
    const result = await sendMessage({
      type: "TEST_API",
      apiKey,
      model: fields.model.value
    });

    if (result.success) {
      testStatus.className = "test-status ok";
      testStatus.textContent = result.message;
      if (result.models?.length) {
        populateModels(result.models, result.model);
      }
      if (result.model && result.model !== fields.model.value) {
        fields.model.value = result.model;
      }
      loadUsageStats();  // refresh after test call
    } else {
      testStatus.className = "test-status err";
      testStatus.textContent = result.error || "Connection failed.";
      if (result.models?.length) {
        populateModels(result.models);
      }
    }
  } catch (err) {
    testStatus.className = "test-status err";
    testStatus.textContent = err.message;
  } finally {
    testBtn.disabled = false;
  }
});

function getApiKeyValidationError(apiKey) {
  if (!apiKey) return "Enter your xAI API key first.";
  if (apiKey.startsWith("eyJ")) {
    return "This is a Grok login token, not an API key. Use a key from console.x.ai that starts with xai-.";
  }
  if (!apiKey.startsWith("xai-")) {
    return "xAI API keys start with xai-.";
  }
  return "";
}

async function loadSettings() {
  const [syncData, localData] = await Promise.all([
    chrome.storage.sync.get({
      apiKey: "",
      model: "grok-4.3",
      systemPrompt:
        "You are Grok, a helpful AI assistant embedded in the browser. Be concise, accurate, and actionable.",
      commentPrompt: "",
      postPrompt: "",
      floatingEnabled: true
    }),
    chrome.storage.local.get({ commentPrompt: "", postPrompt: "" })
  ]);

  fields.apiKey.value = syncData.apiKey || "";
  fields.model.value = syncData.model || "grok-4.3";
  fields.systemPrompt.value = syncData.systemPrompt || "";
  fields.floatingEnabled.checked = syncData.floatingEnabled !== false;

  // Prompts: prefer local, fall back to sync (legacy), then leave blank to trigger default load below
  const commentFromStorage = localData.commentPrompt || syncData.commentPrompt || "";
  const postFromStorage = localData.postPrompt || syncData.postPrompt || "";

  fields.commentPrompt.value = commentFromStorage;
  fields.postPrompt.value = postFromStorage;

  const needsDefaultLoad = !commentFromStorage || !postFromStorage;

  if (needsDefaultLoad) {
    try {
      const defaults = await sendMessage({ type: "GET_SETTINGS" });
      if (!commentFromStorage && defaults.commentPrompt) {
        fields.commentPrompt.value = defaults.commentPrompt;
      }
      if (!postFromStorage && defaults.postPrompt) {
        fields.postPrompt.value = defaults.postPrompt;
      }
    } catch (_) {
      if (!commentFromStorage) {
        fields.commentPrompt.placeholder = DEFAULT_COMMENT_PROMPT_FALLBACK;
      }
      if (!postFromStorage) {
        fields.postPrompt.placeholder = DEFAULT_POST_PROMPT_FALLBACK;
      }
    }
  }

  if (syncData.apiKey) {
    try {
      const result = await sendMessage({
        type: "FETCH_MODELS",
        apiKey: syncData.apiKey
      });
      if (result.models?.length) {
        populateModels(result.models, syncData.model);
      }
    } catch (_) {}
  }
}

function populateModels(models, selected) {
  const current = selected || fields.model.value;
  const existing = new Set(
    Array.from(fields.model.options).map((option) => option.value)
  );

  for (const model of models) {
    if (!existing.has(model)) {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      fields.model.appendChild(option);
    }
  }

  if (models.includes(current)) {
    fields.model.value = current;
  }
}

function sendMessage(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response) {
        reject(new Error("No response from background worker"));
        return;
      }
      if (response.success === false) {
        resolve(response);
        return;
      }
      resolve(response);
    });
  });
}

// --- Credits / Usage Stats ---

async function loadUsageStats() {
  const container = document.getElementById("usage-stats");
  if (!container) return;

  try {
    const result = await sendMessage({ type: "GET_USAGE_STATS" });
    const stats = result.stats || {};
    const recent = stats.recentCalls || [];

    const fmtCost = (c) => (c || 0).toFixed(4);
    const fmtNum = (n) => (n || 0).toLocaleString();

    let html = `
      <strong>Total calls:</strong> ${fmtNum(stats.callCount)}<br>
      <strong>Prompt tokens:</strong> ${fmtNum(stats.totalPromptTokens)}<br>
      <strong>Completion tokens:</strong> ${fmtNum(stats.totalCompletionTokens)}<br>
      <strong>Est. total cost:</strong> $${fmtCost(stats.totalCost)}<br>
    `;

    if (recent.length > 0) {
      html += `<div style="margin-top:8px;font-size:11px;"><strong>Recent calls:</strong></div>`;
      html += `<div style="max-height:120px;overflow:auto;font-size:11px;line-height:1.3;">`;
      recent.slice(0, 5).forEach(call => {
        const date = new Date(call.timestamp).toLocaleTimeString();
        html += `${date} • ${call.model} • ${call.promptTokens}+${call.completionTokens} tokens • ~$${fmtCost(call.estimatedCost)}<br>`;
      });
      html += `</div>`;
    }

    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = `<span style="color:#c00;">Failed to load usage: ${e.message}</span>`;
  }
}

async function resetUsage() {
  if (!confirm("Reset all local usage statistics? (This only clears browser estimates)")) return;
  await sendMessage({ type: "RESET_USAGE_STATS" });
  await loadUsageStats();
}

function setupUsageUI() {
  const refreshBtn = document.getElementById("refresh-usage-btn");
  const billingBtn = document.getElementById("open-billing-btn");
  const usageBtn = document.getElementById("open-usage-btn");
  const resetBtn = document.getElementById("reset-usage-btn");

  if (refreshBtn) refreshBtn.addEventListener("click", loadUsageStats);
  if (billingBtn) billingBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: "https://console.x.ai/team/default/billing" });
  });
  if (usageBtn) usageBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: "https://console.x.ai/team/default/usage" });
  });
  if (resetBtn) resetBtn.addEventListener("click", resetUsage);

  // Load on open
  loadUsageStats();
}