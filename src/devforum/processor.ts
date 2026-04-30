import * as cheerio from "cheerio";
import { calculateScore } from "./scorer.js";
import type { DevForumRecord, DevForumTopicDetail } from "./types.js";

const MAX_WORDS = 500;

export function processTopic(topic: DevForumTopicDetail): DevForumRecord {
  const posts = topic.post_stream.posts;
  if (posts.length === 0) {
    throw new Error(`Topic ${topic.id} has no posts`);
  }

  const firstPost = posts[0];
  if (!firstPost) {
    throw new Error(`Topic ${topic.id} first post is undefined`);
  }

  const acceptedAnswerPost = posts.find((p) => p.post_number === topic.accepted_answer_post_number);
  const staffPosts = posts.slice(1).filter((p) => p.staff);

  const codeSnippets: string[] = [];
  const cleanPosts: string[] = [];

  // Process first post
  const { content: firstContent, code: firstCode } = cleanContent(firstPost.cooked);
  cleanPosts.push(firstContent);
  codeSnippets.push(...firstCode);

  // Process accepted answer
  let acceptedAnswer: string | undefined;
  if (acceptedAnswerPost) {
    const { content: ansContent, code: ansCode } = cleanContent(acceptedAnswerPost.cooked);
    acceptedAnswer = ansContent;
    codeSnippets.push(...ansCode);
  }

  // Process staff replies
  const staffReplies: string[] = [];
  for (const sp of staffPosts) {
    const { content: sContent, code: sCode } = cleanContent(sp.cooked);
    staffReplies.push(sContent);
    codeSnippets.push(...sCode);
  }

  // Combine content for the main record
  let finalContent = cleanPosts.join("\n\n");
  if (finalContent.split(/\s+/).length > MAX_WORDS) {
    finalContent = `${finalContent.split(/\s+/).slice(0, MAX_WORDS).join(" ")}...`;
  }

  const hasCode = codeSnippets.length > 0;
  const ageDays = (Date.now() - new Date(topic.created_at).getTime()) / (1000 * 60 * 60 * 24);

  const score = calculateScore({
    views: topic.views,
    likes: topic.like_count,
    hasAcceptedAnswer: !!acceptedAnswer,
    hasStaffReply: staffReplies.length > 0,
    hasCode,
    replyCount: topic.reply_count,
    ageDays,
    isClosed: topic.closed,
  });

  return {
    id: topic.id,
    title: topic.title,
    url: `https://devforum.roblox.com/t/${topic.slug}/${topic.id}`,
    content: finalContent,
    acceptedAnswer,
    staffReplies,
    codeSnippets: Array.from(new Set(codeSnippets)), // Unique snippets
    tags: topic.tags || [],
    score,
    lastSyncAt: Date.now(),
  };
}

function cleanContent(cooked: string): { content: string; code: string[] } {
  const $ = cheerio.load(cooked);

  const code: string[] = [];
  $("pre code").each((_, el) => {
    code.push($(el).text().trim());
  });

  // Remove quotes, signatures, social talk (simplified)
  $("aside.quote").remove();
  $(".signature").remove();

  // Get text but keep some structure
  const text = $("body")
    .text()
    .trim()
    .replace(/\n\s*\n/g, "\n\n") // Normalize newlines
    .replace(/\t/g, " ");

  return { content: text, code };
}
