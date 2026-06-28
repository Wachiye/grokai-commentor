(function initGrokAIPanel(global) {
  "use strict";

  const pendingPanelRequests = new Map();
  const panelDeliveryTimers = new Map();

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  async function openPanelWithPayload(tab, intent, payload) {
    if (!tab?.id) return { success: false, error: "No tab available" };

    const requestId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const windowId = tab.windowId;

    if (windowId) {
      try {
        await chrome.sidePanel.open({ windowId });
      } catch (err) {
        if (!err?.message?.includes("user gesture")) throw err;
      }
    }

    queuePanelDelivery({ tabId: tab.id, requestId, intent, payload });
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
    if (timer) clearInterval(timer);
    panelDeliveryTimers.delete(requestId);
    pendingPanelRequests.delete(requestId);
  }

  global.GrokAIPanel = { getActiveTab, openPanelWithPayload, clearPanelDelivery };
})(self);
