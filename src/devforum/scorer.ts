import type { DevForumScoreInput } from "./types.js";

export function calculateScore(input: DevForumScoreInput): number {
  let score = 0;

  // 1. Accepted Answer (High quality signal)
  if (input.hasAcceptedAnswer) {
    score += 30;
  }

  // 2. Staff Reply (Expert confirmation)
  if (input.hasStaffReply) {
    score += 25;
  }

  // 3. Contains Code (Practical value)
  if (input.hasCode) {
    score += 15;
  }

  // 4. Community Likes
  score += Math.min(input.likes, 15);

  // 5. Views (Popularity)
  score += Math.min(Math.floor(input.views / 500), 10);

  // 6. Replies (Engagement)
  score += Math.min(Math.floor(input.replyCount / 2), 5);

  // 7. Age Penalty (Decay)
  if (input.ageDays > 365) {
    const penalty = Math.min(Math.floor((input.ageDays - 365) / 30), 10);
    score -= penalty;
  }

  // 8. Closed without solution penalty
  if (input.isClosed && !input.hasAcceptedAnswer) {
    score -= 10;
  }

  return Math.max(0, Math.min(100, score));
}
