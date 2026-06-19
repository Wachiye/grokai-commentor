const GrokContent = {
  getPlatform() {
    const host = location.hostname;
    if (host.includes("linkedin.com")) return "linkedin";
    if (host.includes("twitter.com") || host.includes("x.com")) return "twitter";
    if (host.includes("reddit.com")) return "reddit";
    if (host.includes("facebook.com")) return "facebook";
    if (host.includes("youtube.com")) return "youtube";
    if (host.includes("medium.com") || host.endsWith(".medium.com")) return "medium";
    return "web";
  },

  extractPostContent(element) {
    if (!element) return "";

    const selectors = [
      '[data-testid="tweetText"]',
      '[data-testid="post_message"]',
      ".feed-shared-update-v2__description",
      ".update-components-text",
      '[data-test-id="post-content"]',
      ".md",
      "article p",
      '[role="article"]'
    ];

    for (const selector of selectors) {
      const node = element.querySelector?.(selector) || element.closest?.(selector);
      if (node?.innerText?.trim()) {
        return node.innerText.trim();
      }
    }

    return element.innerText?.trim() || "";
  },

  // Extra: pull the actual main tweet on a status page for better comment context
  extractMainTweetText() {
    const statusMatch = location.pathname.match(/\/status\/(\d+)/);
    if (!statusMatch) return "";

    // Prefer the first (main) tweet on conversation view
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    if (articles.length > 0) {
      return this.extractPostContent(articles[0]);
    }
    return "";
  },

  extractPrimaryPostContent() {
    const platform = this.getPlatform();

    if (platform === "twitter") {
      const statusMatch = location.pathname.match(/\/status\/(\d+)/);
      if (statusMatch) {
        const articles = document.querySelectorAll('article[data-testid="tweet"]');
        if (articles.length) {
          return this.extractPostContent(articles[0]);
        }
      }

      const column =
        document.querySelector('[aria-label="Timeline: Conversation"]') ||
        document.querySelector('[data-testid="primaryColumn"]');
      const focused = column?.querySelector('article[data-testid="tweet"]');
      if (focused) {
        return this.extractPostContent(focused);
      }
    }

    const active = document.activeElement;
    const postEl = active?.closest?.(
      '[role="article"], article, .post, [data-testid*="tweet"], [data-testid*="post"]'
    );
    if (postEl) {
      return this.extractPostContent(postEl);
    }

    const article =
      document.querySelector('article[data-testid="tweet"]') ||
      document.querySelector("article");
    if (article) {
      return this.extractPostContent(article);
    }

    return "";
  },

  getPageContext() {
    const selection = window.getSelection()?.toString()?.trim() || "";
    let postContent = this.extractPrimaryPostContent();

    // On a single tweet page, strongly prefer the exact main tweet for comment generation
    const platform = this.getPlatform();
    if (platform === "twitter" && location.pathname.includes("/status/")) {
      const mainTweet = this.extractMainTweetText();
      if (mainTweet) postContent = mainTweet;
    }

    const main =
      document.querySelector('[data-testid="primaryColumn"]') ||
      document.querySelector("article") ||
      document.querySelector("main") ||
      document.body;

    const pageText = (main.innerText || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 8000);

    return {
      platform,
      title: document.title,
      url: location.href,
      selection,
      postContent,
      pageText,
      content: selection || postContent || pageText
    };
  },

  showNotification(message, type = "info") {
    const existing = document.getElementById("grokai-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "grokai-toast";
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483647;
      padding: 12px 18px;
      border-radius: 10px;
      font: 14px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: #fff;
      background: ${type === "error" ? "#dc2626" : "#111"};
      box-shadow: 0 8px 24px rgba(0,0,0,0.2);
      transition: opacity 0.3s;
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 300);
    }, 2800);
  },

  debounce(fn, wait) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  },

  async sendToSidebar(content, intent = "chat") {
    const context = this.getPageContext();
    const response = await chrome.runtime.sendMessage({
      type: "OPEN_PANEL",
      intent,
      payload: {
        content: content || context.content,
        ...context
      }
    });

    if (!response?.success) {
      this.showNotification(response?.error || "Failed to open Grok panel", "error");
    }
  }
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "generateComments") {
    const text =
      message.selectionText ||
      GrokContent.getPageContext().content;
    GrokContent.sendToSidebar(text, "comment");
    sendResponse({ success: true });
    return true;
  }

  if (message.action === "extractContent") {
    sendResponse({ success: true, ...GrokContent.getPageContext() });
    return true;
  }

  if (message.action === "getSelection") {
    sendResponse({
      success: true,
      selection: window.getSelection()?.toString()?.trim() || ""
    });
    return true;
  }

  return false;
});

document.addEventListener(
  "mouseup",
  GrokContent.debounce(() => {
    const selection = window.getSelection()?.toString()?.trim();
    if (selection && selection.length > 20) {
      window.__grokaiLastSelection = selection;
    }
  }, 300)
);

window.GrokContent = GrokContent;

(function setupContextWatcher() {
  let lastContextKey = "";
  let lastCoreTweetId = null;

  function contextKey(ctx) {
    return `${ctx.url}::${(ctx.postContent || ctx.content || "").slice(0, 160)}`;
  }

  function getCoreTweetId(url) {
    const m = (url || "").match(/\/status\/(\d+)/);
    return m ? m[1] : null;
  }

  function notifyContextChange(isNavigation = false) {
    const ctx = GrokContent.getPageContext();
    const key = contextKey(ctx);
    if (!ctx.content || key === lastContextKey) return;

    const currentTweetId = getCoreTweetId(ctx.url || location.href);
    const tweetChanged = currentTweetId && currentTweetId !== lastCoreTweetId;

    lastContextKey = key;
    lastCoreTweetId = currentTweetId || lastCoreTweetId;

    chrome.runtime
      .sendMessage({ type: "PAGE_CONTEXT_CHANGED", payload: ctx })
      .catch(() => {});

    // Only dispatch the "clear results" signal for the floating button on:
    // - Real navigation events, OR
    // - When the main tweet (status ID) actually changed.
    // This prevents the mutation observer from wiping results while the user is still on the same tweet.
    if (isNavigation || tweetChanged) {
      try {
        document.dispatchEvent(new CustomEvent("grokai-context-changed", {
          detail: { ...ctx, _significantChange: true }
        }));
      } catch (_) {}
    }
  }

  const debouncedNotify = GrokContent.debounce(() => notifyContextChange(false), 800);

  let lastUrl = location.href;
  function onNavigation() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    lastContextKey = "";
    lastCoreTweetId = null; // force re-eval on nav
    setTimeout(() => notifyContextChange(true), 350);
  }

  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    onNavigation();
  };
  history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    onNavigation();
  };

  window.addEventListener("popstate", onNavigation);
  window.addEventListener("hashchange", onNavigation);

  const observer = new MutationObserver(() => debouncedNotify());
  const startObserver = () => {
    if (!document.body) return;
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
    // Initial notify does NOT count as navigation for clearing results
    debouncedNotify();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startObserver);
  } else {
    startObserver();
  }
})();