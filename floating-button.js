class GrokFloatingButton {
  constructor() {
    this.isVisible = false;
    this.isDragging = false;
    this.panelOpen = false;
    this.enabled = true;
    this.init();
  }

  async init() {
    if (document.getElementById("grokai-floating-root")) return;

    const { floatingEnabled } = await chrome.storage.sync.get({
      floatingEnabled: true
    });
    this.enabled = floatingEnabled !== false;
    if (!this.enabled) return;

    this.createButton();
    this.loadPosition();
  }

  createButton() {
    const root = document.createElement("div");
    root.id = "grokai-floating-root";
    root.style.cssText = `
      position: fixed;
      right: 20px;
      top: 50%;
      z-index: 2147483646;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    `;

    const btn = document.createElement("button");
    btn.className = "grokai-floating-main-btn";
    btn.title = "GrokAI";
    btn.innerHTML = `
      <img src="${chrome.runtime.getURL("icons/icon48.png")}" width="28" height="28" alt="GrokAI" style="border-radius:50%;" />
    `;
    btn.style.cssText = `
      width: 52px;
      height: 52px;
      border: none;
      border-radius: 50%;
      background: #111;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(0,0,0,0.25);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.2s, box-shadow 0.2s;
    `;

    const panel = document.createElement("div");
    panel.className = "grokai-floating-panel";
    panel.style.cssText = `
      display: none;
      position: absolute;
      right: 64px;
      top: 50%;
      transform: translateY(-50%);
      width: 260px;
      max-height: 420px;
      overflow-y: auto;
      background: #fff;
      border-radius: 14px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.18);
      padding: 12px;
      border: 1px solid #e5e5e5;
      font-size: 13px;
      color: #111;
    `;

    // Header
    const header = document.createElement("div");
    header.style.cssText = "font-weight:600;font-size:14px;margin-bottom:8px;color:#111;display:flex;align-items:center;justify-content:space-between;";
    header.innerHTML = `<span>GrokAI</span>`;

    // Actions container
    this.actionsContainer = document.createElement("div");
    this.actionsContainer.innerHTML = `
      <button data-action="summarize" style="${this.btnStyle()}">Summarize page</button>
      <button data-action="comment" style="${this.btnStyle()}">Generate comment</button>
      <button data-action="post" style="${this.btnStyle()}">Craft new post</button>
      <button data-action="ask" style="${this.btnStyle()}">Ask about selection</button>
      <button data-action="chat" style="${this.btnStyle()}">Open chat panel</button>
    `;

    // Results container (populated dynamically)
    this.resultsContainer = document.createElement("div");
    this.resultsContainer.style.display = "none";

    // Tone selector (affects comment generation)
    this.toneContainer = document.createElement('div');
    this.toneContainer.style.cssText = 'margin-bottom:10px;';

    panel.appendChild(header);
    panel.appendChild(this.toneContainer);
    panel.appendChild(this.actionsContainer);
    panel.appendChild(this.resultsContainer);

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.togglePanel();
    });

    this.actionsContainer.querySelectorAll("button[data-action]").forEach((actionBtn) => {
      actionBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const act = actionBtn.dataset.action;
        // For comment and post we show results inline in float (no forced sidepanel)
        if (act === "comment" || act === "post") {
          this.handleAction(act);
          // Do not auto-hide; keep panel open to show results
        } else {
          this.handleAction(act);
          this.hidePanel();
        }
      });
    });

    document.addEventListener("click", () => this.hidePanel());
    panel.addEventListener("click", (e) => e.stopPropagation());

    btn.addEventListener("mouseenter", () => {
      btn.style.transform = "scale(1.06)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.transform = "scale(1)";
    });

    this.setupDrag(root, btn);

    root.appendChild(btn);
    root.appendChild(panel);
    document.body.appendChild(root);

    this.root = root;
    this.btn = btn;
    this.panel = panel;
    this.isVisible = true;
    this.selectedTone = 'auto';

    // Build tone selector UI
    this.createToneSelector();

    // Load saved tone preference (works for both comments and posts)
    chrome.storage.local.get({ selectedTone: 'auto' }).then((data) => {
      this.selectedTone = data.selectedTone || 'auto';
      this.updateToneUI();
    });

    // When page context changes (new tweet, new post, navigation), clear previous generated results
    // so we start afresh for the new context.
    // We are conservative: only auto-clear on "significant" changes (different tweet/status).
    // This prevents clearing while the user is still reading/copying on the current tweet.
    document.addEventListener("grokai-context-changed", (e) => {
      if (!this.resultsContainer || this.resultsContainer.style.display === "none") return;

      const newCtx = e.detail || {};
      const currentResultsCtx = this.resultsData && this.resultsData.ctx;

      // If we have results data, only clear if we can confirm it's for a meaningfully different context
      if (currentResultsCtx) {
        const oldUrl = currentResultsCtx.url || "";
        const newUrl = newCtx.url || "";
        const oldId = (oldUrl.match(/\/status\/(\d+)/) || [])[1];
        const newId = (newUrl.match(/\/status\/(\d+)/) || [])[1];

        // Same tweet? Do not clear (user might still be copying).
        if (oldId && newId && oldId === newId) return;

        // Same URL base and similar content? skip
        if (oldUrl === newUrl) return;
      }

      // Significant change (different tweet or page) → clear so we start afresh
      if (newCtx._significantChange !== false) {
        this.clearResults();
      }
    });

    // Expose for debugging / advanced use
    window.__grokaiFloating = this;
  }

  btnStyle() {
    return `
      display: block;
      width: 100%;
      margin-bottom: 8px;
      padding: 10px 12px;
      border: 1px solid #e5e5e5;
      border-radius: 10px;
      background: #fafafa;
      color: #111;
      font-size: 13px;
      cursor: pointer;
      text-align: left;
    `;
  }

  async handleAction(action) {
    const ctx = window.GrokContent?.getPageContext?.() || {
      content: window.getSelection()?.toString()?.trim() || document.title
    };

    if (action === "chat") {
      await chrome.runtime.sendMessage({
        type: "OPEN_PANEL",
        intent: "chat",
        payload: ctx
      });
      this.hidePanel();
      return;
    }

    // For quick comment / post: generate directly and display results in the floating panel
    if (action === "comment" || action === "post") {
      // Ensure the floating panel is visible so user can immediately see the results without scrolling sidepanel
      this.panel.style.display = "block";
      this.panelOpen = true;
      this.showLoading(action);
      try {
        const payload = {
          type: "GENERATE",
          action,
          content: ctx.content || ctx.selection || "",
          context: {
            ...ctx,
            title: ctx.title || document.title,
            url: ctx.url || location.href
          }
        };
        const usedTone = this.selectedTone || 'auto';
        payload.tone = usedTone;
        const response = await chrome.runtime.sendMessage(payload);

        if (response && response.content) {
          this.showResults(response.content, action, ctx, usedTone);
        } else if (response && response.error) {
          this.showResultsError(response.error);
        } else {
          this.showResultsError("No result returned. Check your API key in settings.");
        }
      } catch (err) {
        this.showResultsError(err.message || "Generation failed");
      }
      return;
    }

    // Other actions (summarize, ask, etc.) still go through sidepanel
    await chrome.runtime.sendMessage({
      type: "OPEN_PANEL",
      intent: action,
      payload: ctx
    });
  }

  togglePanel() {
    if (!this.panel) return;
    this.panelOpen = !this.panelOpen;
    this.panel.style.display = this.panelOpen ? "block" : "none";
  }

  hidePanel() {
    if (!this.panel) return;
    this.panelOpen = false;
    this.panel.style.display = "none";
  }

  setupDrag(root, btn) {
    let startY = 0;
    let initialTop = 0;

    const onStart = (clientY, target) => {
      if (target.closest(".grokai-floating-panel")) return;
      this.isDragging = true;
      startY = clientY;
      initialTop = parseInt(window.getComputedStyle(root).top, 10) || window.innerHeight / 2;
      root.style.transition = "none";
    };

    const onMove = (clientY) => {
      if (!this.isDragging) return;
      const delta = clientY - startY;
      const newTop = Math.max(40, Math.min(window.innerHeight - 40, initialTop + delta));
      root.style.top = `${newTop}px`;
    };

    const onEnd = () => {
      if (!this.isDragging) return;
      this.isDragging = false;
      root.style.transition = "";
      const top = parseInt(root.style.top, 10) || window.innerHeight / 2;
      chrome.storage.local.set({ floatingButtonTop: top });
    };

    btn.addEventListener("mousedown", (e) => onStart(e.clientY, e.target));
    document.addEventListener("mousemove", (e) => onMove(e.clientY));
    document.addEventListener("mouseup", onEnd);

    btn.addEventListener("touchstart", (e) => {
      onStart(e.touches[0].clientY, e.target);
      e.preventDefault();
    }, { passive: false });
    document.addEventListener("touchmove", (e) => onMove(e.touches[0].clientY), { passive: true });
    document.addEventListener("touchend", onEnd);
  }

  async loadPosition() {
    const { floatingButtonTop } = await chrome.storage.local.get("floatingButtonTop");
    if (this.root && floatingButtonTop) {
      this.root.style.top = `${floatingButtonTop}px`;
    }
  }

  // Tone / Style selector for comments
  createToneSelector() {
    if (!this.toneContainer) return;

    const tones = [
      { key: 'auto', label: 'Auto' },
      { key: 'witty', label: 'Witty' },
      { key: 'casual', label: 'Casual' },
      { key: 'punchy', label: 'Punchy' },
      { key: 'edgy', label: 'Edgy' },
      { key: 'supportive', label: 'Supportive' },
      { key: 'sarcastic', label: 'Sarcastic' }
    ];

    this.toneContainer.innerHTML = `
      <div style="font-size:10px;color:#666;margin-bottom:4px;">Tone</div>
      <div class="grokai-tone-pills"></div>
    `;

    const pillsContainer = this.toneContainer.querySelector('.grokai-tone-pills');
    pillsContainer.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';

    tones.forEach(tone => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.textContent = tone.label;
      pill.dataset.tone = tone.key;
      pill.className = 'grokai-tone-pill';
      pill.style.cssText = `
        font-size:10px;
        padding:3px 8px;
        border:1px solid #ddd;
        background:#f8f8f8;
        color:#333;
        border-radius:999px;
        cursor:pointer;
        line-height:1;
      `;
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setCommentTone(tone.key);
      });
      pillsContainer.appendChild(pill);
    });

    this.tonePills = Array.from(pillsContainer.children);
    // Set initial visual state (will be corrected by async load)
    this.updateToneUI();
  }

  setCommentTone(tone) {
    this.selectedTone = tone;
    this.updateToneUI();

    // Persist preference
    chrome.storage.local.set({ selectedTone: tone });
  }

  updateToneUI() {
    if (!this.tonePills) return;
    this.tonePills.forEach(pill => {
      if (pill.dataset.tone === this.selectedTone) {
        pill.style.background = '#111';
        pill.style.color = '#fff';
        pill.style.borderColor = '#111';
      } else {
        pill.style.background = '#f8f8f8';
        pill.style.color = '#333';
        pill.style.borderColor = '#ddd';
      }
    });
  }

  // ---------- Results UI in floating panel (no more sidepanel scrolling to see comments) ----------

  showLoading(action) {
    this.ensureStyles();
    this.actionsContainer.style.display = "none";
    this.resultsContainer.style.display = "block";
    this.resultsContainer.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 4px;">
        <div style="width:14px;height:14px;border:2px solid #ccc;border-top-color:#111;border-radius:50%;animation: grokai-spin 0.8s linear infinite;"></div>
        <span style="font-size:13px;color:#333;">Generating ${action === "comment" ? "comments" : "posts"}...</span>
      </div>
    `;
    this.panel.style.width = "300px";
  }

  showResultsError(msg) {
    this.resultsContainer.innerHTML = `
      <div style="color:#b91c1c;font-size:12px;padding:6px 4px;">
        ${msg}
      </div>
      <div style="margin-top:8px;">
        <button class="grokai-float-btn" style="padding:6px 10px;font-size:12px;">Close</button>
      </div>
    `;
    const close = this.resultsContainer.querySelector("button");
    if (close) close.onclick = () => this.clearResults();
  }

  showResults(rawContent, action, ctx, usedTone = 'auto') {
    this.ensureStyles();
    this.actionsContainer.style.display = "none";
    this.resultsContainer.style.display = "block";
    this.panel.style.width = "340px";

    const parsed = this.parseGenerated(rawContent);
    const title = action === "comment" ? "Comments" : "Post ideas";
    const ctxLabel = action === "comment" ? "tweet" : "topic";
    const toneLabel = (usedTone && usedTone !== 'auto')
      ? ` • ${usedTone.charAt(0).toUpperCase() + usedTone.slice(1)} tone`
      : '';

    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div style="font-weight:600;font-size:13px;">${title}<span style="font-weight:400;color:#666;font-size:11px;">(for this ${ctxLabel}${toneLabel})</span></div>
        <button class="grokai-float-reset" title="Reset / clear results" style="font-size:11px;padding:2px 8px;border:1px solid #ddd;background:#fff;border-radius:6px;cursor:pointer;">Reset</button>
      </div>
    `;

    if (parsed.items.length === 0) {
      html += `<div style="font-size:12px;color:#555;white-space:pre-wrap;padding:6px 4px;border:1px solid #eee;border-radius:6px;">${this.escapeHtml(rawContent).slice(0, 900)}</div>`;
    } else {
      const effectiveBest = (parsed.bestIdx >= 0 ? parsed.bestIdx : (parsed.bestPick ? 0 : -1));
      html += `<div class="grokai-results-list" style="display:flex;flex-direction:column;gap:8px;max-height:280px;overflow:auto;padding-right:4px;">`;
      parsed.items.forEach((item, idx) => {
        const text = item.text || item;  // backward compat if strings
        const score = item.score || null;
        const isBest = idx === effectiveBest;
        const bg = isBest ? "#f0f0f0" : "#fafafa";
        const border = isBest ? "1.5px solid #222" : "1px solid #e5e5e5";
        const badge = isBest ? `<span style="font-size:10px;background:#222;color:#fff;padding:1px 6px;border-radius:4px;margin-left:auto;">★ best</span>` : "";
        const num = `<span style="font-size:10px;color:#888;margin-right:6px;">${idx + 1}.</span>`;

        let scoreHtml = '';
        if (score) {
          const s = score.value;
          const color = s >= 8 ? '#166534' : (s >= 6 ? '#854d0e' : '#9f1239');
          const bgColor = s >= 8 ? '#dcfce7' : (s >= 6 ? '#fef9c3' : '#fee2e2');
          scoreHtml = `<span style="font-size:10px;padding:1px 6px;border-radius:4px;background:${bgColor};color:${color};margin-left:6px;" title="${this.escapeHtml(score.reason)}">${s}/10</span>`;
        }

        html += `
          <div class="grokai-result-item" style="background:${bg};border:${border};border-radius:10px;padding:10px 12px;">
            <div style="display:flex;align-items:flex-start;gap:4px;">
              ${num}
              <div style="flex:1;font-size:13px;white-space:pre-wrap;line-height:1.4;color:#111;">${this.escapeHtml(text)}</div>
            </div>
            <div style="margin-top:8px;display:flex;justify-content:space-between;align-items:center;gap:6px;">
              <div>${scoreHtml}</div>
              <div style="display:flex;align-items:center;gap:6px;">
                <button class="grokai-float-btn copy-single" data-idx="${idx}" style="padding:4px 12px;font-size:11px;font-weight:500;">Copy</button>
                ${badge}
              </div>
            </div>
          </div>
        `;
      });
      html += `</div>`;
    }

    if (parsed.bestPick) {
      html += `<div style="font-size:11px;color:#555;margin:6px 2px 4px;padding-left:2px;">${this.escapeHtml(parsed.bestPick)}</div>`;
    }

    html += `
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
        <button class="grokai-float-btn copy-best" style="padding:5px 10px;font-size:11px;">Copy best</button>
        <button class="grokai-float-btn copy-all" style="padding:5px 10px;font-size:11px;">Copy all</button>
        <button class="grokai-float-btn regenerate" style="padding:5px 10px;font-size:11px;">Regenerate</button>
        <button class="grokai-float-btn open-side" style="padding:5px 10px;font-size:11px;">Open sidepanel</button>
      </div>
    `;

    this.resultsContainer.innerHTML = html;
    this.resultsData = { raw: rawContent, action, parsed, ctx, tone: usedTone };

    // Wire up
    const resetBtn = this.resultsContainer.querySelector(".grokai-float-reset");
    if (resetBtn) resetBtn.addEventListener("click", () => this.clearResults());

    this.resultsContainer.querySelectorAll(".copy-single").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const idx = parseInt(e.currentTarget.dataset.idx, 10);
        const it = parsed.items[idx];
        const text = (it && it.text) ? it.text : it;
        if (text) await this.copyText(text, btn);
      });
    });

    const copyBest = this.resultsContainer.querySelector(".copy-best");
    if (copyBest) {
      copyBest.addEventListener("click", async () => {
        const effBest = (parsed.bestIdx >= 0 ? parsed.bestIdx : 0);
        const it = parsed.items[effBest];
        const toCopy = (it && it.text ? it.text : it) || parsed.bestText || rawContent;
        await this.copyText(toCopy, copyBest);
      });
    }

    const copyAll = this.resultsContainer.querySelector(".copy-all");
    if (copyAll) {
      copyAll.addEventListener("click", async () => {
        const all = parsed.items.map(it => (it && it.text) ? it.text : it).join("\n\n");
        await this.copyText(all || rawContent, copyAll);
      });
    }

    const regen = this.resultsContainer.querySelector(".regenerate");
    if (regen) {
      regen.addEventListener("click", async () => {
        if (!this.resultsData) return;
        this.showLoading(this.resultsData.action);
        const freshCtx = window.GrokContent?.getPageContext?.() || this.resultsData.ctx;
        const regenTone = this.selectedTone || 'auto';
        try {
          const msg = {
            type: "GENERATE",
            action: this.resultsData.action,
            content: freshCtx.content || "",
            context: freshCtx
          };
          msg.tone = regenTone;
          const resp = await chrome.runtime.sendMessage(msg);
          if (resp?.content) {
            this.showResults(resp.content, this.resultsData.action, freshCtx, regenTone);
          } else {
            this.showResultsError("Regenerate failed");
          }
        } catch (e) {
          this.showResultsError(e.message || "Failed");
        }
      });
    }

    const openSide = this.resultsContainer.querySelector(".open-side");
    if (openSide) {
      openSide.addEventListener("click", async () => {
        const payload = this.resultsData?.ctx || ctx;
        await chrome.runtime.sendMessage({ type: "OPEN_PANEL", intent: "chat", payload });
      });
    }
  }

  clearResults() {
    if (this.resultsContainer) {
      this.resultsContainer.style.display = "none";
      this.resultsContainer.innerHTML = "";
    }
    if (this.actionsContainer) this.actionsContainer.style.display = "block";
    if (this.panel) this.panel.style.width = "260px";
    this.resultsData = null;
  }

  async copyText(text, btnEl) {
    try {
      await navigator.clipboard.writeText(text);
      const orig = btnEl.textContent;
      btnEl.textContent = "Copied!";
      setTimeout(() => {
        if (btnEl && btnEl.isConnected) btnEl.textContent = orig;
      }, 1400);
    } catch (_) {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      const orig = btnEl.textContent;
      btnEl.textContent = "Copied!";
      setTimeout(() => { if (btnEl && btnEl.isConnected) btnEl.textContent = orig; }, 1400);
    }
  }

  parseGenerated(raw) {
    if (!raw) return { items: [], bestPick: null, bestIdx: -1, bestText: null, hasScores: false };

    // Strip any code fence wrappers the model sometimes adds
    let text = raw.replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, "")).trim();

    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const items = [];
    let bestPick = null;
    let hasScores = false;

    for (const line of lines) {
      // Match quoted text, optionally followed by [Score: X/10 - reason]
      const scoreMatch = line.match(/^["“”](.+?)["“”]\s*\[Score:\s*(\d+)\/10\s*-\s*(.+?)\]/i);
      if (scoreMatch) {
        hasScores = true;
        const itemText = scoreMatch[1].trim();
        const scoreVal = Math.max(1, Math.min(10, parseInt(scoreMatch[2], 10)));
        const reason = scoreMatch[3].trim();
        items.push({ text: itemText, score: { value: scoreVal, reason } });
        continue;
      }

      // Fallback plain quote
      const m = line.match(/^["“”](.+?)["“”]$/);
      if (m && m[1].length > 2) {
        items.push({ text: m[1].trim(), score: null });
        continue;
      }

      if (/^best pick:/i.test(line)) {
        bestPick = line;
      }
    }

    // Determine best index
    let bestIdx = -1;
    if (bestPick) {
      const numMatch = bestPick.match(/Option\s*(\d+)/i) || bestPick.match(/\b(\d+)\b/);
      if (numMatch) {
        const n = parseInt(numMatch[1], 10) - 1;
        if (n >= 0 && n < items.length) bestIdx = n;
      }
      if (bestIdx === -1 && items.length) {
        // Try fuzzy match on beginning of a quote
        for (let i = 0; i < items.length; i++) {
          const short = items[i].text.slice(0, 28).toLowerCase();
          if (bestPick.toLowerCase().includes(short)) {
            bestIdx = i;
            break;
          }
        }
      }
    }

    // Fallback: pick highest scored if no bestPick match
    if (bestIdx < 0 && items.length > 0) {
      let maxScore = -1;
      let maxI = 0;
      items.forEach((it, i) => {
        if (it.score && it.score.value > maxScore) {
          maxScore = it.score.value;
          maxI = i;
        }
      });
      if (maxScore >= 0) bestIdx = maxI;
    }

    const bestText = bestIdx >= 0 ? items[bestIdx].text : (items[0] ? items[0].text : null);

    return { items, bestPick, bestIdx, bestText, hasScores };
  }

  escapeHtml(str) {
    return str.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  ensureStyles() {
    if (document.getElementById("grokai-float-styles")) return;
    const style = document.createElement("style");
    style.id = "grokai-float-styles";
    style.textContent = `
      @keyframes grokai-spin { to { transform: rotate(360deg); } }
      .grokai-float-btn {
        border: 1px solid #d1d5db;
        background: #f8f8f8;
        color: #111;
        border-radius: 6px;
        cursor: pointer;
        transition: background .1s;
      }
      .grokai-float-btn:hover { background: #eee; }
      .grokai-results-list {
        max-height: 280px;
        overflow-y: auto;
        scrollbar-width: thin;
      }
      .grokai-result-item {
        box-shadow: 0 1px 2px rgba(0,0,0,0.03);
      }
      .grokai-tone-pill:hover {
        filter: brightness(0.95);
      }
      .grokai-tone-pill:active {
        transform: scale(0.97);
      }
    `;
    document.head.appendChild(style);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => new GrokFloatingButton());
} else {
  new GrokFloatingButton();
}