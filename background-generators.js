(function initGrokAIGenerators(global) {
  "use strict";

  const Config = global.GrokAIConfig;
  const Storage = global.GrokAIStorage;
  const Api = global.GrokAIApi;

  function toneInstruction(tone) {
    if (!tone || tone === "auto") return "";
    const desc = Config.toneDescriptions[tone] || tone;
    return `Tone/style: Use a ${desc} style. Make this the dominant voice.`;
  }

  function buildContextBlock(context = {}) {
    const lines = [];
    if (context.url) lines.push(`URL: ${context.url}`);
    if (context.title) lines.push(`Title: ${context.title}`);
    if (context.hasMedia) lines.push("Media: This post includes image/video/GIF context.");
    if (context.mediaSummary) lines.push(`Media details: ${context.mediaSummary}`);
    if (context.quotedContent) lines.push(`Quoted/linked context: ${context.quotedContent}`);
    if (context.linkPreview) lines.push(`Link preview: ${context.linkPreview}`);
    if (context.replyingTo) lines.push(`Replying to: ${context.replyingTo}`);
    return lines.length ? lines.join("\n") : "No extra metadata.";
  }

  function buildCommentPrompt(content, context = {}, tone = null) {
    const platform = context.platform || "web";
    const target = platform === "twitter" ? "tweet" : "post";
    const toneLine = toneInstruction(tone);

    return `${toneLine ? `${toneLine}\n\n` : ""}Generate up to 5 high-engagement reply options for this ${target}.

Goal: create replies that have a real chance of getting likes, quotes, and reply chains.
Prioritize sharp, specific callbacks to the exact content and visible context.

IMPORTANT CONTEXT RULES:
- The content may include markers like [Attached image], [Contains video], [Quoted / linked context], [Link preview], or [Replying to]. Use them when they make the reply sharper.
- Avoid generic replies that could fit any post.
- Each reply must be copy-paste ready.

Output format:
Use this exact format for every reply:
"reply text" [Score: 9/10 - short reason]
Best pick: Option X — reason

Context metadata:
${buildContextBlock(context)}

Content:
${content}`;
  }

  function buildPostPrompt(content, context = {}, tone = null) {
    const platform = context.platform || "web";
    const postLabel = platform === "twitter" ? "tweets" : "posts";
    const topic = (context.topic || "").trim();
    const toneLine = toneInstruction(tone);
    const parts = [];

    if (toneLine) parts.push(toneLine);
    parts.push(`Craft original ${postLabel} optimized for real views and engagement.`);
    if (topic) parts.push(`Topic/direction: ${topic}`);
    if (content) {
      parts.push(
        `Use this as inspiration or context. Do not reply to it; write standalone ${postLabel} inspired by it:`,
        content
      );
    }
    parts.push(`Context metadata:\n${buildContextBlock(context)}`);
    parts.push(
      "Every post must open with a strong hook, feel current, and stay under 280 characters. Generate up to 5 options and mark the best one."
    );
    if (!topic && !content) {
      parts.push(
        "No specific topic: create timely, sharp original posts that would feel native to current Kenyan X and can reach beyond followers."
      );
    }
    parts.push('Output format: Use clean quoted options and a Best pick line.');

    return parts.join("\n\n");
  }

  async function generateWithGrok(action, content, context = {}, tone = null) {
    const settings = await Storage.getSettings();

    if (action === "comment") {
      return Api.chatWithGrok([{ role: "user", content: buildCommentPrompt(content, context, tone) }], {
        systemPrompt: settings.commentPrompt,
        temperature: 0.92,
        maxTokens: 2800,
        action: "comment"
      });
    }

    if (action === "post") {
      return Api.chatWithGrok([{ role: "user", content: buildPostPrompt(content, context, tone) }], {
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
      analyze: `Analyze the following content. Identify main themes, sentiment, and actionable insights.\n\nContent:\n${content}`
    };

    return Api.chatWithGrok([{ role: "user", content: prompts[action] || content }], {
      action: action || "chat"
    });
  }

  global.GrokAIGenerators = { generateWithGrok };
})(self);
