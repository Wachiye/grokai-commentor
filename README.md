# GrokAI - AI Browser Assistant

**GrokAI** is a powerful Chrome (and Edge) browser extension powered by xAI's Grok models. It helps you engage with any webpage — especially on X (Twitter) — by generating high-engagement comments, crafting original posts, summarizing content, and more.

Optimized for scroll-stopping, quotable, and "massively" engaging output with features like **tone selection** and **per-comment virality scoring**.

## ✨ Features

- **Floating Action Button** — Draggable quick-access button on any page
- **Smart Comment Generation**
  - Select **Tone/Style**: Auto, Witty, Casual, Punchy, Edgy, Supportive, Sarcastic
  - **Engagement Scorer** — Every comment is rated 1-10 with a short reason for virality potential (likes, quotes, replies)
  - Individual "Copy" buttons + Copy Best / Copy All
- **Original Post Crafting** — Full tone selection support for creating new posts
- **Inline Results** — View and copy results directly in the floating panel (no more scrolling side panels)
- **Side Panel** — Full chat interface, history, and additional tools (Summarize, Explain, Analyze)
- **Context Awareness** — Automatically adapts to the current tweet/post/page
- **Customizable Prompts** — Advanced users can edit system prompts in Settings
- **Context Menu** — Right-click anywhere for quick actions
- Works on X/Twitter, LinkedIn, Reddit, and any website

## 📦 Installation

### Windows Quick Install

1. Download/clone this repository.
2. Right-click `install.ps1` → **Run with PowerShell**.
3. Follow the on-screen steps (it opens `chrome://extensions` and copies the path).

### Manual Installation (Chrome / Microsoft Edge)

1. Open your browser and go to `chrome://extensions` (or `edge://extensions`).
2. Toggle **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select the folder containing this extension (the folder with `manifest.json`).
5. The GrokAI icon should appear in your toolbar.

### First-Time Setup

1. Get an **xAI API key**:
   - Go to [https://console.x.ai](https://console.x.ai)
   - Create a new API key (it must start with `xai-`)
   - Grant the key permissions: `api-key:endpoint:*` and `api-key:model:*`
   - Make sure your team has billing/credits enabled

2. Open extension **Options**:
   - Right-click the GrokAI icon → **Options**, or
   - Go to `chrome://extensions` → click **Details** → **Extension options**

3. Paste your API key.
4. (Recommended) Select model `grok-4.3`.
5. Click **Test Connection**.

> **⚠️ Warning**: Do **not** use a Grok.com login session token. Only use API keys from console.x.ai.

## 🚀 Usage

### Quick Generation (Recommended)

1. Navigate to any page (especially an X/Twitter post).
2. Click the floating GrokAI button (you can drag it).
3. Choose your desired **Tone**.
4. Click **Generate comment** or **Craft new post**.
5. Scores appear on comments. Click **Copy** on any block.

### Other Actions

- **Summarize page**
- **Ask about selection**
- **Open chat panel** for full conversation

### Keyboard / Context Menu

Right-click selected text or the page for quick Grok actions.

### Regenerate with Different Tone

While results are visible, simply change the **Tone** pill and click **Regenerate**.

## ⚙️ Configuration

Visit the Options page to configure:

- xAI API Key
- Model (grok-4.3 recommended)
- System Prompt (general behavior)
- Custom Comment Generator Prompt
- Custom Post Generator Prompt
- Floating button toggle

Long prompts are fully supported.

## 🛠️ Development

1. Make your changes to the source files.
2. Go to `chrome://extensions`.
3. Click the **Reload** icon on the GrokAI card.
4. Test your changes.

The extension uses Manifest V3 and communicates with `https://api.x.ai/v1/chat/completions`.

## 📁 Project Structure

```
.
├── background.js          # API calls + prompt logic
├── comment-prompt.js      # Default comment system prompt
├── post-prompt.js         # Default post system prompt
├── content.js             # Page context extraction
├── floating-button.js     # Floating UI + results + tone selector
├── sidepanel.*            # Full chat side panel
├── options.*              # Settings page
├── manifest.json
└── icons/
```

## ❓ Troubleshooting

- **403 Forbidden**: See the "Fixing 403 Forbidden" section in Options.
- Extension not appearing: Make sure you loaded the correct folder and Developer mode is on.
- Low quality output: Try a different tone or update your custom prompts.
- Scores not showing: The model sometimes needs to be prompted clearly — regenerate or try a different tone.

## 📝 License

This project is provided as-is for personal use.

---

Made with ❤️ for high-engagement content creators on X.

**Repo**: https://github.com/Wachiye/grokai-commentor
