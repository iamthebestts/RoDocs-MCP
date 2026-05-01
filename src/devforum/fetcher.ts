import { devForumClient } from "./http.js";
import type { DevForumTopic, DevForumTopicDetail } from "./types.js";

const BASE_URL = "https://devforum.roblox.com";

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

type TopPeriod = "monthly" | "yearly" | "all";

const TOP_PATHS: Record<TopPeriod, string> = {
  monthly: "/top/monthly.json",
  yearly: "/top/yearly.json",
  all: "/top/all.json",
};

export class DevForumFetcher {
  async search(query: string): Promise<DevForumTopic[]> {
    const response = await devForumClient.get(
      `${BASE_URL}/search.json?q=${encodeURIComponent(query)}`,
    );
    return this.mapTopics(response.data.topics ?? []);
  }

  async getCategories(): Promise<Record<string, unknown>[]> {
    const response = await devForumClient.get(`${BASE_URL}/categories.json`);
    return response.data.category_list.categories as Record<string, unknown>[];
  }

  async getCategoryLatest(slug: string, id: number): Promise<DevForumTopic[]> {
    const response = await devForumClient.get(
      `${BASE_URL}/c/${slug}/${id}/l/latest.json`,
    );
    return this.mapTopics(response.data.topic_list?.topics ?? []);
  }

  async getCategoryTop(
    slug: string,
    id: number,
    period: "monthly" | "yearly",
  ): Promise<DevForumTopic[]> {
    const response = await devForumClient.get(
      `${BASE_URL}/c/${slug}/${id}/l/top.json?period=${period}`,
    );
    return this.mapTopics(response.data.topic_list?.topics ?? []);
  }

  async getTopMonthly(): Promise<DevForumTopic[]> {
    return this.fetchTop("monthly");
  }

  async getTopYearly(): Promise<DevForumTopic[]> {
    return this.fetchTop("yearly");
  }

  async getTopAllTime(): Promise<DevForumTopic[]> {
    return this.fetchTop("all");
  }

  async getTopicDetail(id: number): Promise<DevForumTopicDetail> {
    const response = await devForumClient.get(`${BASE_URL}/t/${id}.json`);
    const t = response.data as DiscourseTopicDetail;

    return {
      id: t.id,
      title: t.title,
      slug: t.slug,
      posts_count: t.posts_count,
      reply_count: t.reply_count,
      views: t.views,
      like_count: t.like_count,
      has_accepted_answer: t.has_accepted_answer ?? false,
      created_at: t.created_at,
      closed: t.closed ?? false,
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

  private async fetchTop(period: TopPeriod): Promise<DevForumTopic[]> {
    const response = await devForumClient.get(
      `${BASE_URL}${TOP_PATHS[period]}`,
    );
    return this.mapTopics(response.data.topic_list?.topics ?? []);
  }

  private mapTopics(topics: DiscourseTopic[]): DevForumTopic[] {
    return topics.map((t) => ({
      id: t.id,
      title: t.title,
      slug: t.slug,
      posts_count: t.posts_count,
      reply_count: t.reply_count,
      views: t.views,
      like_count: t.like_count,
      has_accepted_answer: t.has_accepted_answer ?? false,
      created_at: t.created_at,
      closed: t.closed ?? false,
      category_id: t.category_id,
      tags: t.tags,
    }));
  }
}
