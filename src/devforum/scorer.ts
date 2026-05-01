import type { DevForumScoreInput } from "./types.js";

export function calculateScore(
  input: DevForumScoreInput,
  sourceWeight: 0 | 1 | 2 | 3 | 4 = 0,
): number {
  let score = 0;

  // 1. Accepted Answer
  if (input.hasAcceptedAnswer) {
    score += 25;
  }

  // 2. Staff Reply
  if (input.hasStaffReply) {
    score += 20;
  }

  // 3. Contains Code
  if (input.hasCode) {
    score += 20;
  }

  // 4. Community Likes
  score += Math.min(input.likes, 20);

  // 5. Views
  score += Math.min(Math.floor(input.views / 300), 15);

  // 6. Replies
  score += Math.min(Math.floor(input.replyCount / 2), 10);

  // 7. Recent Bonus
  if (input.ageDays < 365) {
    score += 5;
  }

  // 8. Age Penalty
  if (input.ageDays > 365) {
    const penalty = Math.min(Math.floor((input.ageDays - 365) / 30), 10);
    score -= penalty;
  }

  // 9. Closed without answer penalty
  if (input.isClosed && !input.hasAcceptedAnswer) {
    score -= 10;
  }

  // 10. Source weight bonus
  score += Math.min(sourceWeight * 2, 8);

  return Math.max(0, Math.min(100, score));
}
