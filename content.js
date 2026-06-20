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

    const host = location.hostname;
    const isTwitter = host.includes("twitter.com") || host.includes("x.com");

    if (isTwitter) {
      const rich = this.extractTwitterRichPost(element);
      if (rich) return rich;
    }

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

  // Rich extractor for X/Twitter posts: captures text + media (images/video) + quoted tweets (link-to-context) + link previews.
  // This fixes awkward comments on media-heavy or quote-tweet posts.
  extractTwitterRichPost(article) {
    if (!article) return "";

    // If we were passed an inner node (e.g. the text block), climb to the containing tweet article
    if (article.getAttribute && article.getAttribute('data-testid') === 'tweetText') {
      article = article.closest('article[data-testid="tweet"]') || article;
    }
    if (article.closest && !article.matches?.('article[data-testid="tweet"], [role="article"]')) {
      const found = article.closest('article[data-testid="tweet"]') || article.closest('[role="article"]');
      if (found) article = found;
    }

    // Main tweet text (first tweetText is almost always the poster's own)
    const textNodes = Array.from(article.querySelectorAll('[data-testid="tweetText"]'));
    let mainText = textNodes.length > 0 ? textNodes[0].innerText.trim() : "";
    if (!mainText) {
      // fallback to article text minus controls
      mainText = (article.innerText || "").trim();
    }

    const parts = [mainText].filter(Boolean);

    // --- MEDIA: images (prefer alt text), videos ---
    const mediaNotes = [];

    // Tweet photos / images
    const photoImgs = Array.from(
      article.querySelectorAll('img[alt], [data-testid="tweetPhoto"] img, a[href*="/photo/"] img')
    );
    const seenAlts = new Set();
    const alts = [];
    for (const img of photoImgs) {
      let alt = (img.getAttribute("alt") || "").trim();
      const inPhotoContainer = !!img.closest('[data-testid*="photo" i], [data-testid="tweetPhoto"], a[href*="/photo/"]');
      const isAvatar = !!img.closest('[data-testid="UserAvatar"], [data-testid*="avatar" i]');
      const tooSmall = ((img.width || img.clientWidth || 0) < 80) && ((img.height || img.clientHeight || 0) < 80);
      const isAvatarLike = alt.length < 3 || isAvatar || (!inPhotoContainer && tooSmall);
      // Accept if it has a real alt or lives in a known photo container
      if ((alt && !isAvatarLike) || inPhotoContainer) {
        if (alt && !seenAlts.has(alt)) {
          seenAlts.add(alt);
          alts.push(alt);
        } else if (!alt && inPhotoContainer) {
          alts.push("photo");
        }
      }
    }
    if (alts.length) {
      const displayAlts = alts.slice(0, 3).join(" | ");
      mediaNotes.push(`[Attached image${alts.length > 1 ? "s" : ""}: ${displayAlts}]`);
    }

    // Videos / GIFs / animated
    const hasVideo = !!article.querySelector("video") ||
      !!article.querySelector('[data-testid*="video" i], [data-testid="videoPlayer"], [aria-label*="video" i], [role="progressbar"]');
    if (hasVideo) {
      mediaNotes.push("[Contains video / GIF / animated media]");
    }

    // Link preview cards (external context)
    const card = article.querySelector('[data-testid*="card"], [data-testid="card.wrapper"], [data-testid="card.layout"]');
    if (card) {
      const cardText = (card.innerText || "").replace(/\s+/g, " ").trim().slice(0, 220);
      if (cardText && cardText.length > 8) {
        mediaNotes.push(`[Link preview: ${cardText}]`);
      }
    }

    // External http links mentioned
    const extLinks = Array.from(article.querySelectorAll('a[href^="http"]'))
      .map(a => a.href)
      .filter(h => !h.includes("x.com") && !h.includes("twitter.com") && !/\/status\//.test(h) && !/\/photo\//.test(h))
      .slice(0, 2);
    if (extLinks.length) {
      mediaNotes.push(`[Links in post: ${extLinks.join(", ")}]`);
    }

    if (mediaNotes.length) {
      parts.push(mediaNotes.join(" "));
    }

    // --- QUOTED TWEET / linked context (the key missing piece) ---
    let quotedText = "";

    // Primary: multiple tweetText nodes inside the same article => second/last is usually the quoted one
    if (textNodes.length >= 2) {
      const candidate = textNodes[textNodes.length - 1].innerText.trim();
      if (candidate && candidate !== mainText) {
        quotedText = candidate;
      }
    }

    // Secondary: dedicated quote container or nested status link block
    if (!quotedText) {
      const quoteSelectors = [
        '[data-testid="quoteTweet"]',
        'div[role="link"][href*="/status/"]',
        'a[role="link"][href*="/status/"]',
        // Sometimes wrapped
        'article[data-testid="tweet"] [data-testid="tweetText"]'
      ];
      for (const sel of quoteSelectors) {
        const qEls = article.querySelectorAll(sel);
        for (const qEl of qEls) {
          // ignore the primary text node
          if (textNodes[0] && (qEl === textNodes[0] || textNodes[0].contains(qEl))) continue;
          const t = (qEl.innerText || "").trim();
          if (t && t !== mainText && t.length > 3) {
            quotedText = t;
            break;
          }
        }
        if (quotedText) break;
      }
    }

    // Fallback: any inner article that is not the root of this article
    if (!quotedText) {
      const innerTweets = article.querySelectorAll('article[data-testid="tweet"]');
      if (innerTweets.length > 1) {
        const qText = innerTweets[innerTweets.length - 1].querySelector('[data-testid="tweetText"]');
        if (qText) {
          const t = qText.innerText.trim();
          if (t && t !== mainText) quotedText = t;
        }
      }
    }

    if (quotedText) {
      parts.push(`[Quoted / linked context: ${quotedText}]`);
    }

    // Replying-to indicator (helps for thread context)
    const replyTo = article.querySelector('[data-testid="reply"]') || article.textContent.match(/Replying to @\w+/i);
    if (replyTo) {
      const rt = typeof replyTo === "string" ? replyTo : (replyTo.textContent || "").trim();
      if (rt) parts.push(`[Replying to: ${rt.slice(0, 80)}]`);
    }

    return parts.join("\n").trim();
  },

  // Extra: pull the actual main tweet on a status page for better comment context
  extractMainTweetText() {
    const statusMatch = location.pathname.match(/\/status\/(\d+)/);
    if (!statusMatch) return "";

    // Prefer the first (main) tweet on conversation view
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    if (articles.length > 0) {
      // Use rich twitter extraction directly (media + quoted)
      return this.extractTwitterRichPost(articles[0]) || this.extractPostContent(articles[0]);
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
          // On status page, articles[0] is typically the root/main tweet for the URL.
          // But also scan for a "focused" or highlighted tweet (some reply UIs).
          let main = articles[0];
          // Prefer one that looks selected / has focus ring or is the largest text block
          for (const a of articles) {
            if (a.getAttribute("aria-selected") === "true" ||
                a.querySelector('[aria-current="true"]') ||
                a.querySelector('[data-testid="tweetText"]')?.closest('div[tabindex="0"]')) {
              main = a;
              break;
            }
          }
          return this.extractTwitterRichPost(main) || this.extractPostContent(main);
        }
      }

      const column =
        document.querySelector('[aria-label="Timeline: Conversation"]') ||
        document.querySelector('[data-testid="primaryColumn"]');
      const focused = column?.querySelector('article[data-testid="tweet"]');
      if (focused) {
        return this.extractTwitterRichPost(focused) || this.extractPostContent(focused);
      }
    }

    const active = document.activeElement;
    const postEl = active?.closest?.(
      '[role="article"], article, .post, [data-testid*="tweet"], [data-testid*="post"]'
    );
    if (postEl) {
      const host = location.hostname;
      if (host.includes("twitter.com") || host.includes("x.com")) {
        return this.extractTwitterRichPost(postEl) || this.extractPostContent(postEl);
      }
      return this.extractPostContent(postEl);
    }

    const article =
      document.querySelector('article[data-testid="tweet"]') ||
      document.querySelector("article");
    if (article) {
      const host = location.hostname;
      if (host.includes("twitter.com") || host.includes("x.com")) {
        return this.extractTwitterRichPost(article) || this.extractPostContent(article);
      }
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

    const ctx = {
      platform,
      title: document.title,
      url: location.href,
      selection,
      postContent,
      pageText,
      content: selection || postContent || pageText
    };

    // Expose parsed rich hints for twitter (helps prompts + sidepanel)
    if (platform === "twitter" && postContent) {
      ctx.hasMedia = /\[Attached image|\[Contains video/i.test(postContent);
      const qMatch = postContent.match(/\[Quoted \/ linked context:([^\]]+)\]/i);
      if (qMatch) ctx.quotedContent = qMatch[1].trim();
      const mMatch = postContent.match(/\[Attached image[^\]]*\]/i);
      if (mMatch) ctx.mediaSummary = mMatch[0];
    }

    return ctx;
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