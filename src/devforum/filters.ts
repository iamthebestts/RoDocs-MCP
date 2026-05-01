import type { DevForumTopic } from "./types.js";

const REJECTED_TITLE_PATTERNS = [
  /please add/i,
  /should roblox/i,
  /roblox should/i,
  /i need help with/i, // too generic
  /looking for/i, // recruitment
  /hiring/i, // recruitment
  /paying/i, // recruitment
  /robux/i, // often recruitment/payment
];

const REJECTED_CATEGORIES = [
  "recruitment",
  "off-topic",
  "collaboration",
  "forum-feedback",
  "lounge",
];

export function shouldRejectTopic(topic: DevForumTopic, source?: string): boolean {
  // 1. Reject closed topics without accepted answer (with soft exception for gold sources)
  if (topic.closed && !topic.has_accepted_answer) {
    if (source?.startsWith("category-top:")) {
      if (topic.like_count < 10) return true;
    } else {
      return true;
    }
  }

  // Soft demotion for non-technical announcements
  if (source === "category-latest:announcements") {
    const isTechnical = [
      "release-notes",
      "engine",
      "feature",
      "studio",
      "luau",
      "performance",
      "platform",
      "engineers",
    ].some((tag) => topic.tags?.includes(tag));
    if (
      !isTechnical &&
      /what are you working on|community challenge|share your|show off|wip|introduce yourself/i.test(
        topic.title,
      )
    ) {
      return true;
    }
  }

  // 2. Reject by title patterns
  if (REJECTED_TITLE_PATTERNS.some((p) => p.test(topic.title))) {
    return true;
  }

  // 3. Reject old topics with low engagement
  const ageInDays = (Date.now() - new Date(topic.created_at).getTime()) / (1000 * 60 * 60 * 24);
  if (ageInDays > 365 && topic.like_count < 5 && topic.reply_count < 3) {
    return true;
  }

  // 4. Reject by tags (if available)
  if (topic.tags) {
    if (topic.tags.some((t) => REJECTED_CATEGORIES.includes(t.toLowerCase()))) {
      return true;
    }
  }

  return false;
}

export function isTechnicalCategory(_categoryName: string, categorySlug: string): boolean {
  const technicalSlugs = [
    "scripting-support",
    "community-resources",
    "community-tutorials",
    "engine-features", // We'll filter non-technical ones via title
    "technical-base",
    "help-and-feedback",
  ];

  const slug = categorySlug.toLowerCase();
  return technicalSlugs.some((s) => slug.includes(s));
}
