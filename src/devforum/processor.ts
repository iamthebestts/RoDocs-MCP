import * as cheerio from "cheerio";
import { calculateScore } from "./scorer.js";
import type { DevForumRecord, DevForumTopicDetail } from "./types.js";

const MAX_WORDS = 500;
const MAX_STAFF_REPLIES = 3;
const MAX_CODE_SNIPPETS = 10;
const MAX_CODE_SNIPPET_LEN = 2000;
const MAX_REPLY_WORDS = 200;

const NOISE_SELECTORS = [
  "aside.quote",
  "aside.onebox",
  ".onebox",
  ".signature",
  ".poll",
  ".lightbox-wrapper",
  ".meta",
  ".small-action",
  "nav",
].join(", ");

export function processTopic(
  topic: DevForumTopicDetail,
  sourceWeight: 0 | 1 | 2 | 3 | 4 = 0,
): DevForumRecord {
  const posts = topic.post_stream.posts;
  const firstPost = posts[0];
  if (!firstPost) {
    throw new Error(`Topic ${topic.id} has no posts`);
  }

  const codeSet = new Set<string>();
  const pushCode = (snippets: string[]) => {
    for (const s of snippets) {
      if (codeSet.size >= MAX_CODE_SNIPPETS) break;
      const trimmed =
        s.length > MAX_CODE_SNIPPET_LEN
          ? `${s.slice(0, MAX_CODE_SNIPPET_LEN)}…`
          : s;
      if (trimmed.length > 0) codeSet.add(trimmed);
    }
  };

  const { content: firstContent, code: firstCode } = cleanContent(
    firstPost.cooked,
  );
  pushCode(firstCode);

  const acceptedPostNumber = topic.accepted_answer_post_number;
  const acceptedAnswerPost =
    acceptedPostNumber != null
      ? posts.find((p) => p.post_number === acceptedPostNumber)
      : undefined;

  let acceptedAnswer: string | undefined;
  if (acceptedAnswerPost) {
    const { content, code } = cleanContent(acceptedAnswerPost.cooked);
    acceptedAnswer = truncateWords(content, MAX_REPLY_WORDS);
    pushCode(code);
  }

  const acceptedId = acceptedAnswerPost?.id;
  const staffPosts = posts
    .slice(1)
    .filter((p) => p.staff && p.id !== acceptedId)
    .slice(0, MAX_STAFF_REPLIES);

  const staffReplies: string[] = [];
  for (const sp of staffPosts) {
    const { content, code } = cleanContent(sp.cooked);
    staffReplies.push(truncateWords(content, MAX_REPLY_WORDS));
    pushCode(code);
  }

  const finalContent = truncateWords(firstContent, MAX_WORDS);
  const hasCode = codeSet.size > 0;

  const ageDays = safeAgeDays(topic.created_at, topic.id);

  const score = calculateScore(
    {
      views: topic.views,
      likes: topic.like_count,
      hasAcceptedAnswer: topic.has_accepted_answer,
      hasStaffReply:
        staffReplies.length > 0 || (acceptedAnswerPost?.staff ?? false),
      hasCode,
      replyCount: topic.reply_count,
      ageDays,
      isClosed: topic.closed,
    },
    sourceWeight,
  );

  return {
    id: topic.id,
    title: topic.title,
    url: `https://devforum.roblox.com/t/${topic.slug}/${topic.id}`,
    content: finalContent,
    acceptedAnswer,
    staffReplies,
    codeSnippets: Array.from(codeSet),
    tags: topic.tags || [],
    score,
    source: "",
    lastSyncAt: Date.now(),
  };
}

function truncateWords(text: string, max: number): string {
  const words = text.split(/\s+/);
  if (words.length <= max) return text;
  return `${words.slice(0, max).join(" ")}...`;
}

function safeAgeDays(createdAt: string | undefined, topicId: number): number {
  if (!createdAt) {
    console.warn(`[DevForum] Missing created_at for topic ${topicId}`);
    return 0;
  }
  const ms = Date.now() - new Date(createdAt).getTime();
  if (Number.isNaN(ms)) {
    console.warn(
      `[DevForum] Invalid created_at="${createdAt}" for topic ${topicId}`,
    );
    return 0;
  }
  return ms / 86_400_000;
}

function cleanContent(cooked: string): { content: string; code: string[] } {
  const $ = cheerio.load(cooked || "");

  const code: string[] = [];
  $("pre code").each((_, el) => {
    const text = $(el).text().trim();
    if (text.length > 0) code.push(text);
  });

  // remove code blocks before extracting text so code doesn't leak into prose
  $("pre").remove();
  $(NOISE_SELECTORS).remove();

  const text = $("body")
    .text()
    .trim()
    .replace(/\n\s*\n/g, "\n\n")
    .replace(/\t/g, " ")
    .replace(/ {2,}/g, " ");

  return { content: text, code };
}
