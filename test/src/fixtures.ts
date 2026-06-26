import {
  request as playwrightRequest,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import type { ScenarioSetup } from "./scenarioSchema";
import { scenarioDate } from "./values";

type UserResponse = {
  id: string;
  email: string;
  display_name: string;
};

type GroupResponse = {
  id: string;
  name: string;
  created_by_user_id: string;
};

type CatalogSourceResponse = {
  id: string;
  name: string;
};

type DailyFeedResponse = {
  id: string;
  name: string;
};

type SetupAccount = NonNullable<ScenarioSetup["accounts"]>[number];
type SetupGroup = NonNullable<ScenarioSetup["groups"]>[number];
type SetupCatalogSource = NonNullable<ScenarioSetup["catalogSources"]>[number];
type SetupDailyFeed = NonNullable<ScenarioSetup["dailyFeeds"]>[number];
type SetupFeedPost = NonNullable<ScenarioSetup["feedPosts"]>[number];

type SetupState = {
  accounts: Map<string, SetupAccount & { user: UserResponse }>;
  groups: Map<string, SetupGroup & { group: GroupResponse }>;
  catalogSources: Map<
    string,
    SetupCatalogSource & { source: CatalogSourceResponse }
  >;
  dailyFeeds: Map<string, SetupDailyFeed & { feed: DailyFeedResponse }>;
};

export async function applyScenarioSetup(
  page: Page,
  setup: ScenarioSetup | undefined,
  baseURL: string,
): Promise<void> {
  if (setup === undefined) {
    return;
  }

  const state: SetupState = {
    accounts: new Map(),
    groups: new Map(),
    catalogSources: new Map(),
    dailyFeeds: new Map(),
  };

  for (const account of setup.accounts ?? []) {
    const api = await playwrightRequest.newContext({ baseURL });
    try {
      const user = await postJSON<UserResponse>(api, "/api/auth/signup", {
        display_name: account.displayName,
        email: account.email,
        password: account.password,
        remember_me: account.rememberMe ?? false,
      });
      state.accounts.set(account.id, { ...account, user });
    } finally {
      await api.dispose();
    }
  }

  for (const group of setup.groups ?? []) {
    const owner = state.accounts.get(group.owner);
    if (owner === undefined) {
      throw new Error(
        `setup group "${group.id}" references unknown owner "${group.owner}"`,
      );
    }

    const api = await loggedInRequest(baseURL, owner);
    try {
      const created = await postJSON<GroupResponse>(api, "/api/groups", {
        name: group.name,
        ...(group.slug === undefined ? {} : { slug: group.slug }),
        ...(group.description === undefined
          ? {}
          : { description: group.description }),
        ...(group.visibility === undefined
          ? {}
          : { visibility: group.visibility }),
      });
      state.groups.set(group.id, { ...group, group: created });
    } finally {
      await api.dispose();
    }
  }

  for (const source of setup.catalogSources ?? []) {
    const group = state.groups.get(source.group);
    if (group === undefined) {
      throw new Error(
        `setup catalog source "${source.name}" references unknown group "${source.group}"`,
      );
    }
    const owner = state.accounts.get(group.owner);
    if (owner === undefined) {
      throw new Error(
        `setup group "${group.id}" references unknown owner "${group.owner}"`,
      );
    }

    const api = await loggedInRequest(baseURL, owner);
    try {
      const created = await postJSON<CatalogSourceResponse>(
        api,
        `/api/groups/${encodeURIComponent(group.group.id)}/catalog-sources`,
        {
          name: source.name,
          ...(source.template === undefined
            ? {}
            : { template: source.template }),
          ...(source.preset === undefined ? {} : { preset: source.preset }),
          fields: (source.fields ?? []).map((field, index) => ({
            key: field.key,
            label: field.label,
            value_type: field.value_type,
            is_array: field.is_array ?? false,
            display_order: field.display_order ?? index,
          })),
          items: source.items ?? [],
        },
      );
      if (source.id !== undefined) {
        state.catalogSources.set(source.id, { ...source, source: created });
      }
    } finally {
      await api.dispose();
    }
  }

  for (const feed of setup.dailyFeeds ?? []) {
    const group = requireSetupGroup(state, feed.group);
    const owner = requireSetupAccount(state, group.owner);
    const api = await loggedInRequest(baseURL, owner);
    try {
      const created = await postJSON<DailyFeedResponse>(
        api,
        `/api/groups/${encodeURIComponent(group.group.id)}/daily-feeds`,
        dailyFeedPayload(state, feed),
      );
      state.dailyFeeds.set(feed.id, { ...feed, feed: created });
    } finally {
      await api.dispose();
    }
  }

  for (const post of setup.feedPosts ?? []) {
    await createSetupFeedPost(baseURL, state, post);
  }

  if (setup.loginAs !== undefined) {
    const account = state.accounts.get(setup.loginAs);
    if (account === undefined) {
      throw new Error(
        `setup loginAs references unknown account "${setup.loginAs}"`,
      );
    }

    await postJSON(
      page.context().request,
      absoluteURL(baseURL, "/api/auth/login"),
      {
        email: account.email,
        password: account.password,
        remember_me: account.rememberMe ?? false,
      },
    );
  }
}

function requireSetupAccount(
  state: SetupState,
  id: string,
): SetupAccount & { user: UserResponse } {
  const account = state.accounts.get(id);
  if (account === undefined) {
    throw new Error(`setup references unknown account "${id}"`);
  }
  return account;
}

function requireSetupGroup(
  state: SetupState,
  id: string,
): SetupGroup & { group: GroupResponse } {
  const group = state.groups.get(id);
  if (group === undefined) {
    throw new Error(`setup references unknown group "${id}"`);
  }
  return group;
}

function dailyFeedPayload(
  state: SetupState,
  feed: SetupDailyFeed,
): Record<string, unknown> {
  const kind = feed.kind ?? "catalog_daily";
  const payload: Record<string, unknown> = {
    name: feed.name,
    kind,
    enabled: feed.enabled ?? true,
    schedule: {
      starts_at: "2020-01-01T00:00:00.000Z",
      timezone: "UTC",
      interval_seconds: 86400,
    },
  };

  if (feed.description !== undefined) {
    payload.description = feed.description;
  }

  if (kind === "catalog_daily") {
    if (feed.source === undefined) {
      throw new Error(`setup daily feed "${feed.id}" requires source`);
    }
    const source = state.catalogSources.get(feed.source);
    if (source === undefined) {
      throw new Error(
        `setup daily feed "${feed.id}" references unknown catalog source "${feed.source}"`,
      );
    }
    payload.source_id = source.source.id;
    payload.item_count = feed.itemCount ?? 1;
    payload.filters = [];
  }

  return payload;
}

async function createSetupFeedPost(
  baseURL: string,
  state: SetupState,
  post: SetupFeedPost,
): Promise<void> {
  const group = requireSetupGroup(state, post.group);
  const author = requireSetupAccount(state, post.author);
  const feed = state.dailyFeeds.get(post.feed);
  if (feed === undefined) {
    throw new Error(`setup feed post references unknown feed "${post.feed}"`);
  }

  const api = await loggedInRequest(baseURL, author);
  try {
    await postJSON(
      api,
      `/api/groups/${encodeURIComponent(group.group.id)}/daily-feeds/${encodeURIComponent(feed.feed.id)}/outputs/${encodeURIComponent(scenarioDate(post.date))}/posts`,
      {
        evidence_kind: "text",
        evidence_text: post.evidenceText,
        ...(post.caption === undefined ? {} : { caption: post.caption }),
      },
    );
  } finally {
    await api.dispose();
  }
}

async function loggedInRequest(
  baseURL: string,
  account: SetupAccount & { user: UserResponse },
): Promise<APIRequestContext> {
  const api = await playwrightRequest.newContext({ baseURL });
  await postJSON(api, "/api/auth/login", {
    email: account.email,
    password: account.password,
    remember_me: account.rememberMe ?? false,
  });
  return api;
}

async function postJSON<T>(
  api: APIRequestContext,
  url: string,
  data: unknown,
): Promise<T> {
  const response = await api.post(url, { data });
  if (!response.ok()) {
    const body = await response.text().catch(() => "");
    throw new Error(`POST ${url} returned ${response.status()}: ${body}`);
  }
  return (await response.json()) as T;
}

function absoluteURL(baseURL: string, pathname: string): string {
  return new URL(pathname, baseURL).toString();
}
