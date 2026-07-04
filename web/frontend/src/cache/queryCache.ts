type QueryKeyPart = string | number | boolean | null;
type QueryKey = readonly QueryKeyPart[];
type QueryArgs = readonly QueryKeyPart[];

export type QueryFetcherOptions = {
  signal?: AbortSignal;
};

type QueryDefinition<Args extends QueryArgs, Result> = {
  key: (...args: Args) => QueryKey;
  fetch: (...args: [...Args, QueryFetcherOptions]) => Promise<Result>;
  staleMs: number;
  expiresMs: number;
  dependsOn?: (...args: Args) => readonly QueryKey[];
};

type CacheEntry<Result> = {
  key: QueryKey;
  hasData: boolean;
  data?: Result;
  promise?: Promise<Result>;
  fetchedAt: number;
  staleAt: number;
  expiresAt: number;
  generation: number;
  dependencies: QueryKey[];
  error?: unknown;
};

export function defineQuery<Args extends QueryArgs, Result>(
  definition: QueryDefinition<Args, Result>,
): QueryDefinition<Args, Result> {
  return definition;
}

function isPrefix(prefix: QueryKey, key: QueryKey): boolean {
  if (prefix.length > key.length) {
    return false;
  }
  return prefix.every((part, index) => key[index] === part);
}

function intersects(a: QueryKey, b: QueryKey): boolean {
  return isPrefix(a, b) || isPrefix(b, a);
}

class QueryCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private generation = 0;

  read<Args extends QueryArgs, Result>(
    definition: QueryDefinition<Args, Result>,
    ...argsAndOptions: [...Args] | [...Args, QueryFetcherOptions]
  ): Promise<Result> {
    const { args, options } = splitArgsAndOptions(argsAndOptions);
    const key = copyKey(definition.key(...args));
    const id = serializeKey(key);
    const now = Date.now();
    this.evictExpired(now);

    const existing = this.entries.get(id) as CacheEntry<Result> | undefined;
    if (existing !== undefined) {
      if (existing.hasData && existing.staleAt > now) {
        return Promise.resolve(existing.data as Result);
      }
      if (existing.promise !== undefined) {
        return existing.promise;
      }
    }

    const dependencies = dependenciesFor(definition, args);
    const entry =
      existing ??
      ({
        key,
        hasData: false,
        fetchedAt: 0,
        staleAt: 0,
        expiresAt: now + definition.expiresMs,
        generation: this.nextGeneration(),
        dependencies,
      } satisfies CacheEntry<Result>);

    entry.dependencies = dependencies;
    this.entries.set(id, entry);
    const startedGeneration = entry.generation;

    const promise = definition
      .fetch(...args, options)
      .then((data) => {
        const current = this.entries.get(id);
        if (current === entry && entry.generation === startedGeneration) {
          const fetchedAt = Date.now();
          entry.data = data;
          entry.hasData = true;
          entry.fetchedAt = fetchedAt;
          entry.staleAt = fetchedAt + definition.staleMs;
          entry.expiresAt = fetchedAt + definition.expiresMs;
          entry.dependencies = dependencies;
          delete entry.promise;
          delete entry.error;
        }
        return data;
      })
      .catch((error: unknown) => {
        const current = this.entries.get(id);
        if (current === entry && entry.generation === startedGeneration) {
          const fetchedAt = Date.now();
          entry.fetchedAt = fetchedAt;
          entry.staleAt = fetchedAt;
          entry.expiresAt = fetchedAt + definition.expiresMs;
          entry.error = error;
          delete entry.promise;
        }
        throw error;
      });

    entry.promise = promise;
    return promise;
  }

  prefetch<Args extends QueryArgs, Result>(
    definition: QueryDefinition<Args, Result>,
    ...argsAndOptions: [...Args] | [...Args, QueryFetcherOptions]
  ): void {
    this.read(definition, ...argsAndOptions).catch(() => undefined);
  }

  write<Args extends QueryArgs, Result>(definition: QueryDefinition<Args, Result>, data: Result, ...args: Args): void {
    const now = Date.now();
    const key = copyKey(definition.key(...args));
    const entry: CacheEntry<Result> = {
      key,
      data,
      hasData: true,
      fetchedAt: now,
      staleAt: now + definition.staleMs,
      expiresAt: now + definition.expiresMs,
      generation: this.nextGeneration(),
      dependencies: dependenciesFor(definition, args),
    };
    this.entries.set(serializeKey(key), entry);
  }

  invalidate(prefix: QueryKey): void {
    const normalizedPrefix = copyKey(prefix);
    for (const [id, entry] of this.entries) {
      if (isPrefix(normalizedPrefix, entry.key)) {
        this.entries.delete(id);
      }
    }
  }

  touched(prefix: QueryKey): void {
    const normalizedPrefix = copyKey(prefix);
    for (const [id, entry] of this.entries) {
      if (intersects(entry.key, normalizedPrefix)) {
        this.entries.delete(id);
        continue;
      }
      if (entry.dependencies.some((dependency) => intersects(dependency, normalizedPrefix))) {
        this.entries.delete(id);
      }
    }
  }

  clear(): void {
    this.entries.clear();
  }

  private evictExpired(now: number): void {
    for (const [id, entry] of this.entries) {
      if (entry.promise === undefined && entry.expiresAt <= now) {
        this.entries.delete(id);
      }
    }
  }

  private nextGeneration(): number {
    this.generation += 1;
    return this.generation;
  }
}

function dependenciesFor<Args extends QueryArgs, Result>(
  definition: QueryDefinition<Args, Result>,
  args: Args,
): QueryKey[] {
  return (definition.dependsOn?.(...args) ?? []).map(copyKey);
}

function splitArgsAndOptions<Args extends QueryArgs>(
  argsAndOptions: [...Args] | [...Args, QueryFetcherOptions],
): { args: Args; options: QueryFetcherOptions } {
  if (argsAndOptions.length === 0) {
    return { args: [] as unknown as Args, options: {} };
  }

  const last = argsAndOptions[argsAndOptions.length - 1];
  if (isFetcherOptions(last)) {
    return {
      args: argsAndOptions.slice(0, -1) as unknown as Args,
      options: last,
    };
  }

  return { args: argsAndOptions as unknown as Args, options: {} };
}

function isFetcherOptions(value: QueryKeyPart | QueryFetcherOptions | undefined): value is QueryFetcherOptions {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return "signal" in value || Object.keys(value).length === 0;
}

function copyKey(key: QueryKey): QueryKey {
  return [...key];
}

function serializeKey(key: QueryKey): string {
  return JSON.stringify(key);
}

export const queryCache = new QueryCache();
