"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  applyContextSearchParams,
  type ContextCategory,
  parseContextSearchParams,
  type TravelContextKind,
  travelKindToCategory,
} from "@/lib/fide/context-nav";

export function useContextNav() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { category, id } = useMemo(
    () => parseContextSearchParams(searchParams),
    [searchParams]
  );

  const replaceNav = useCallback(
    (next: { category?: ContextCategory | null; id?: string | null }) => {
      const params = applyContextSearchParams(searchParams, next);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const openContext = useCallback(
    (nextCategory: ContextCategory, nextId?: string | null) => {
      replaceNav({
        category: nextCategory,
        id: nextId ?? null,
      });
    },
    [replaceNav]
  );

  const openTravelContext = useCallback(
    (kind: TravelContextKind, nextId: string) => {
      openContext(travelKindToCategory(kind), nextId);
    },
    [openContext]
  );

  const clearContextItem = useCallback(() => {
    replaceNav({ id: null });
  }, [replaceNav]);

  const clearContext = useCallback(() => {
    replaceNav({ category: null, id: null });
  }, [replaceNav]);

  return {
    category,
    id,
    openContext,
    openTravelContext,
    clearContextItem,
    clearContext,
    replaceNav,
  };
}
