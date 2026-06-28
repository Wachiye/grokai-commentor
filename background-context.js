(function initGrokAIContext(global) {
  "use strict";

  async function pushContextUpdate(payload) {
    if (!payload?.url && !payload?.content) return;
    chrome.runtime.sendMessage({ type: "CONTEXT_UPDATE", payload }).catch(() => {});
  }

  async function broadcastContextUpdate(tabId) {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab?.id || activeTab.id !== tabId) return;
      const page = await extractPageContent(tabId);
      await pushContextUpdate(page);
    } catch (_) {}
  }

  async function extractPageContent(tabId) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { action: "extractContent" });
      if (response?.success) return response;
    } catch (_) {}

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const selection = window.getSelection()?.toString()?.trim() || "";
        const host = location.hostname;
        const isTwitter = host.includes("twitter.com") || host.includes("x.com");

        let platform = "web";
        if (isTwitter) platform = "twitter";
        else if (host.includes("linkedin.com")) platform = "linkedin";
        else if (host.includes("reddit.com")) platform = "reddit";
        else if (host.includes("facebook.com")) platform = "facebook";
        else if (host.includes("youtube.com")) platform = "youtube";

        let root =
          document.querySelector('article[data-testid="tweet"]') ||
          document.querySelector('[role="article"]') ||
          document.querySelector("article") ||
          document.querySelector("main") ||
          document.body;

        if (isTwitter) {
          const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
          if (articles.length) root = articles[0];
        }

        const clone = root.cloneNode(true);
        clone
          .querySelectorAll("script, style, nav, footer, aside, iframe, noscript, button, [role='button']")
          .forEach((el) => el.remove());

        let text = (clone.innerText || clone.textContent || "").replace(/\s+/g, " ").trim().slice(0, 12000);
        const extras = [];

        if (isTwitter && root) {
          const alts = Array.from(root.querySelectorAll('img[alt]'))
            .map((img) => (img.alt || "").trim())
            .filter((alt) => alt.length > 4 && !alt.toLowerCase().includes("profile"))
            .slice(0, 3);
          if (alts.length) extras.push(`[Attached image hint: ${alts.join(" | ")}]`);
          if (root.querySelector('video, [data-testid*="video" i]')) extras.push("[Contains video / GIF / animated media]");
          const tweetTexts = root.querySelectorAll('[data-testid="tweetText"]');
          if (tweetTexts.length > 1) {
            const quoted = tweetTexts[tweetTexts.length - 1].innerText?.trim();
            if (quoted) extras.push(`[Quoted / linked context: ${quoted}]`);
          }
        }

        if (extras.length) text = `${text}\n${extras.join("\n")}`;

        return {
          title: document.title,
          url: location.href,
          platform,
          selection,
          content: selection || text,
          hasMedia: extras.some((item) => /Attached image|Contains video/i.test(item)),
          quotedContent: extras.find((item) => item.startsWith("[Quoted")) || "",
          mediaSummary: extras.filter((item) => /Attached image|Contains video/i.test(item)).join(" ")
        };
      }
    });

    return { success: true, ...result };
  }

  global.GrokAIContext = { pushContextUpdate, broadcastContextUpdate, extractPageContent };
})(self);
