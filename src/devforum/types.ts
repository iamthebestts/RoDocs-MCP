import { z } from "zod";

export const DevForumScoreInputSchema = z.object({
  views: z.number(),
  likes: z.number(),
  hasAcceptedAnswer: z.boolean(),
  hasStaffReply: z.boolean(),
  hasCode: z.boolean(),
  replyCount: z.number(),
  ageDays: z.number(),
  isClosed: z.boolean(),
});

export type DevForumScoreInput = z.infer<typeof DevForumScoreInputSchema>;

export interface DevForumTopic {
  id: number;
  title: string;
  slug: string;
  posts_count: number;
  reply_count: number;
  views: number;
  like_count: number;
  has_accepted_answer: boolean;
  created_at: string;
  closed: boolean;
  category_id: number | undefined;
  tags: string[] | undefined;
}

export interface DevForumPost {
  id: number;
  username: string;
  cooked: string;
  post_number: number;
  created_at: string;
  staff: boolean;
  trust_level: number;
}

export interface DevForumTopicDetail extends DevForumTopic {
  accepted_answer_post_number: number | undefined;
  post_stream: {
    posts: DevForumPost[];
  };
}

export interface DevForumRecord {
  id: number;
  title: string;
  url: string;
  content: string;
  acceptedAnswer: string | undefined;
  staffReplies: string[];
  codeSnippets: string[];
  tags: string[];
  score: number;
  source: string;
  lastSyncAt: number;
}
