"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition
} from "react";

import {
  usePathname,
  useRouter,
  useSearchParams
} from "next/navigation";

const SEARCH_DELAY_MS = 350;

function createSearchHref({
  pathname,
  paramsString,
  query
}: {
  pathname: string;
  paramsString: string;
  query: string;
}) {
  const params =
    new URLSearchParams(paramsString);

  const normalizedQuery =
    query.trim();

  if (normalizedQuery) {
    params.set("q", normalizedQuery);
  } else {
    params.delete("q");
  }

  params.delete("page");

  const queryString =
    params.toString();

  return queryString
    ? `${pathname}?${queryString}`
    : pathname;
}

export function CatalogLiveSearch({
  initialQuery
}: {
  initialQuery: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const paramsString =
    searchParams.toString();

  const [query, setQuery] =
    useState(initialQuery);

  const [isPending, startTransition] =
    useTransition();

  const lastAppliedQuery =
    useRef(initialQuery.trim());

  useEffect(() => {
    setQuery(initialQuery);

    lastAppliedQuery.current =
      initialQuery.trim();
  }, [initialQuery]);

  useEffect(() => {
    const normalizedQuery =
      query.trim();

    if (
      normalizedQuery
      === lastAppliedQuery.current
    ) {
      return;
    }

    const timer = window.setTimeout(
      () => {
        const href = createSearchHref({
          pathname,
          paramsString,
          query: normalizedQuery
        });

        lastAppliedQuery.current =
          normalizedQuery;

        startTransition(() => {
          router.replace(
            href,
            {
              scroll: false
            }
          );
        });
      },
      SEARCH_DELAY_MS
    );

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    paramsString,
    pathname,
    query,
    router
  ]);

  function clearSearch() {
    setQuery("");
    lastAppliedQuery.current = "";

    const href = createSearchHref({
      pathname,
      paramsString,
      query: ""
    });

    startTransition(() => {
      router.replace(
        href,
        {
          scroll: false
        }
      );
    });
  }

  return (
    <div
      className={[
        "public-catalog-search-row",
        isPending
          ? "is-searching"
          : ""
      ].filter(Boolean).join(" ")}
    >
      <label className="public-search-field">
        <span>Поиск по каталогу</span>

        <div className="public-search-control">
          <input
            type="search"
            name="q"
            value={query}
            maxLength={120}
            placeholder="Например: розы, букет, подарок"
            autoComplete="off"
            enterKeyHint="search"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />

          {query ? (
            <button
              className="public-search-clear"
              type="button"
              aria-label="Очистить поиск"
              title="Очистить поиск"
              onClick={clearSearch}
            >
              ×
            </button>
          ) : null}
        </div>

        <small aria-live="polite">
          {isPending
            ? "Обновляем результаты…"
            : "Результаты обновляются автоматически"}
        </small>
      </label>

      <button type="submit">
        {isPending
          ? "Ищем…"
          : "Найти"}
      </button>
    </div>
  );
}
