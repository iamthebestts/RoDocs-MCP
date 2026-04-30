import axios from "axios";
import type { DevForumTopic, DevForumTopicDetail } from "./types.js";

const BASE_URL = "https://devforum.roblox.com";
const RATE_LIMIT_DELAY = 1000; // 1 second between requests

interface DiscoursePost {
  id: number;
  username: string;
  cooked: string;
  post_number: number;
  created_at: string;
  staff: boolean;
  trust_level: number;
}

interface DiscourseTopicDetail {
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
  category_id?: number;
  tags?: string[];
  accepted_answer_post_number?: number;
  post_stream: {
    posts: DiscoursePost[];
  };
}

interface DiscourseTopic {
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
  category_id?: number;
  tags?: string[];
}

export class DevForumFetcher {
  private async wait(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY));
  }

  async search(query: string): Promise<DevForumTopic[]> {
    const url = `${BASE_URL}/search.json?q=${encodeURIComponent(query)}`;
    const response = await axios.get(url);

    const topics = (response.data.topics as DiscourseTopic[]) || [];
    return topics.map((t) => ({
      id: t.id,
      title: t.title,
      slug: t.slug,
      posts_count: t.posts_count,
      reply_count: t.reply_count,
      views: t.views,
      like_count: t.like_count,
      has_accepted_answer: !!t.has_accepted_answer,
      created_at: t.created_at,
      closed: !!t.closed,
      category_id: t.category_id,
      tags: t.tags,
    }));
  }

  async getTopicDetail(id: number): Promise<DevForumTopicDetail> {
    await this.wait();
    const url = `${BASE_URL}/t/${id}.json`;
    const response = await axios.get(url);
    const t = response.data as DiscourseTopicDetail;

    return {
      id: t.id,
      title: t.title,
      slug: t.slug,
      posts_count: t.posts_count,
      reply_count: t.reply_count,
      views: t.views,
      like_count: t.like_count,
      has_accepted_answer: t.has_accepted_answer,
      created_at: t.created_at,
      closed: t.closed,
      category_id: t.category_id,
      tags: t.tags,
      accepted_answer_post_number: t.accepted_answer_post_number,
      post_stream: {
        posts: t.post_stream.posts.map((p) => ({
          id: p.id,
          username: p.username,
          cooked: p.cooked,
          post_number: p.post_number,
          created_at: p.created_at,
          staff: !!p.staff || p.trust_level >= 4,
          trust_level: p.trust_level,
        })),
      },
    };
  }

  async getCategories(): Promise<Record<string, unknown>[]> {
    const url = `${BASE_URL}/categories.json`;
    const response = await axios.get(url);
    return response.data.category_list.categories as Record<string, unknown>[];
  }

  async getCategoryLatest(slug: string, id: number): Promise<DevForumTopic[]> {
    await this.wait();
    const url = `${BASE_URL}/c/${slug}/${id}/l/latest.json`;
    const response = await axios.get(url);
    const topics = (response.data.topic_list.topics as DiscourseTopic[]) || [];
    return topics.map((t) => ({
      id: t.id,
      title: t.title,
      slug: t.slug,
      posts_count: t.posts_count,
      reply_count: t.reply_count,
      views: t.views,
      like_count: t.like_count,
      has_accepted_answer: !!t.has_accepted_answer,
      created_at: t.created_at,
      closed: !!t.closed,
      category_id: t.category_id,
      tags: t.tags,
    }));
  }
}
