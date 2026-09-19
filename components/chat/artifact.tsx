import type { UseChatHelpers } from "@ai-sdk/react";
import { formatDistance } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeftIcon, DatabaseIcon, FileTextIcon, XIcon } from "lucide-react";
import {
  type Dispatch,
  memo,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import useSWR, { useSWRConfig } from "swr";
import { useWindowSize } from "usehooks-ts";
import { codeArtifact } from "@/artifacts/code/client";
import { imageArtifact } from "@/artifacts/image/client";
import { itineraryArtifact } from "@/artifacts/itinerary/client";
import { sheetArtifact } from "@/artifacts/sheet/client";
import { textArtifact } from "@/artifacts/text/client";
import { initialArtifactData, useArtifact } from "@/hooks/use-artifact";
import { useContextNav } from "@/hooks/use-context-nav";
import type { Document } from "@/lib/db/schema";
import type { ContextCategory } from "@/lib/fide/context-nav";
import { categoryToTravelKind } from "@/lib/fide/context-nav";
import {
  extractRows,
  normalizeContextRow,
  readString,
  type TravelContextItem,
} from "@/lib/fide/travel-context";
import {
  coerceGraphEntityId,
  fideIdHex,
  subjectFingerprintFromFideId,
  type PeekEntityKind,
} from "@/lib/itinerary/schema";
import { EntityDetail } from "@/components/chat/travel-cards/entity-detail";
import { FideIdChip } from "@/components/chat/fide-id-chip";
import type { Attachment, ChatMessage } from "@/lib/types";
import { cn, fetcher } from "@/lib/utils";
import { ArtifactActions } from "./artifact-actions";
import { ArtifactCloseButton } from "./artifact-close-button";
import { ContextDataUpload } from "./context-data-upload";
import { LoaderIcon } from "./icons";
import { Toolbar } from "./toolbar";
import { VersionFooter } from "./version-footer";
import type { VisibilityType } from "./visibility-selector";

export const artifactDefinitions = [
  textArtifact,
  codeArtifact,
  imageArtifact,
  sheetArtifact,
  itineraryArtifact,
];
export type ArtifactKind = (typeof artifactDefinitions)[number]["kind"];

export type UIArtifact = {
  title: string;
  documentId: string;
  kind: ArtifactKind;
  content: string;
  isVisible: boolean;
  status: "streaming" | "idle";
  boundingBox: {
    top: number;
    left: number;
    width: number;
    height: number;
  };
};

type ContextItem = Omit<TravelContextItem, "kind" | "raw"> & {
  kind?: TravelContextItem["kind"];
  raw?: Record<string, unknown>;
};

type ContextQueryResponse = {
  result?: unknown;
};

const contextListQueries = {
  Hotels: "hotels",
  Activities: "activities",
  Attractions: "attractions",
  Itineraries: "itineraries",
  Collections: "collections",
  Destinations: "destinations",
  Transportation: "transportation",
} as const satisfies Record<ContextCategory, string>;

const contextDetailQueries = {
  Hotels: { paramName: "fideId", legacyIriParam: "hotel_iri", query: "hotelDetail" },
  Activities: {
    paramName: "fideId",
    legacyIriParam: "activity_iri",
    query: "activityDetail",
  },
  Attractions: {
    paramName: "fideId",
    legacyIriParam: "attraction_iri",
    query: "attractionDetail",
  },
  Itineraries: { paramName: "itinerary_iri", query: "itineraryDetail" },
  Collections: { paramName: "collection_iri", query: "collectionDetail" },
  Destinations: {
    paramName: "fideId",
    legacyIriParam: "place_iri",
    query: "destinationDetail",
  },
  Transportation: {
    paramName: "option_iri",
    query: "transportationDetail",
  },
} as const satisfies Record<
  ContextCategory,
  { paramName: string; query: string; legacyIriParam?: string }
>;

function coerceContextDetailId(
  category: ContextCategory,
  id: string
): string {
  const kindByCategory: Partial<Record<ContextCategory, PeekEntityKind>> = {
    Destinations: "destination",
    Hotels: "hotel",
    Activities: "activity",
    Attractions: "attraction",
  };
  const kind = kindByCategory[category];
  return kind ? coerceGraphEntityId(id, kind) : id;
}

function PureArtifact({
  addToolApprovalResponse: _addToolApprovalResponse,
  chatId: _chatId,
  input: _input,
  setInput: _setInput,
  status,
  stop,
  attachments: _attachments,
  setAttachments: _setAttachments,
  sendMessage,
  messages: _messages,
  setMessages,
  regenerate: _regenerate,
  isReadonly: _isReadonly,
  selectedVisibilityType: _selectedVisibilityType,
  selectedModelId: _selectedModelId,
  isWorldModelVisible,
  setWorldModelVisible,
}: {
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  chatId: string;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  status: UseChatHelpers<ChatMessage>["status"];
  stop: UseChatHelpers<ChatMessage>["stop"];
  attachments: Attachment[];
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  messages: ChatMessage[];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  isReadonly: boolean;
  selectedVisibilityType: VisibilityType;
  selectedModelId: string;
  isWorldModelVisible: boolean;
  setWorldModelVisible: Dispatch<SetStateAction<boolean>>;
}) {
  const { artifact, setArtifact, metadata, setMetadata } = useArtifact();
  const {
    category: contextCategory,
    id: selectedContextItemId,
    openContext,
    openTravelContext,
    clearContextItem,
    clearContext,
  } = useContextNav();
  const [activeTab, setActiveTab] = useState<"artifact" | "world-model">(
    artifact.isVisible ? "artifact" : "world-model"
  );
  const [contextSearch, setContextSearch] = useState("");
  const [contextFilter, setContextFilter] = useState("All");
  const [transportFrom, setTransportFrom] = useState("All");
  const [transportTo, setTransportTo] = useState("All");

  const {
    data: documents,
    isLoading: isDocumentsFetching,
    mutate: mutateDocuments,
  } = useSWR<Document[]>(
    artifact.documentId !== "init" && artifact.status !== "streaming"
      ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/document?id=${artifact.documentId}`
      : null,
    fetcher
  );

  const activeContextCategory =
    contextCategory && contextCategory in contextListQueries
      ? (contextCategory as ContextCategory)
      : null;
  const activeContextQuery = activeContextCategory
    ? contextListQueries[activeContextCategory]
    : null;

  const {
    data: contextQueryResponse,
    error: contextQueryError,
    isLoading: isContextQueryLoading,
  } = useSWR<ContextQueryResponse>(
    activeContextQuery
      ? [
          `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/context/query:list`,
          activeContextQuery,
        ]
      : null,
    async ([, query]: [string, string]) => {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/context/query`,
        {
          body: JSON.stringify({ query }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }
      );

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json();
    }
  );

  const {
    data: contextDetailQueryResponse,
    error: contextDetailQueryError,
    isLoading: isContextDetailLoading,
  } = useSWR<ContextQueryResponse>(
    activeContextCategory && selectedContextItemId
      ? [
          `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/context/query:detail`,
          contextDetailQueries[activeContextCategory].query,
          contextDetailQueries[activeContextCategory].paramName,
          selectedContextItemId,
        ]
      : null,
    async ([, query, paramName, itemId]: [string, string, string, string]) => {
      const detail = activeContextCategory
        ? contextDetailQueries[activeContextCategory]
        : null;
      const hex = fideIdHex(itemId);
      const fingerprint = hex ? subjectFingerprintFromFideId(itemId) : null;
      const legacyKey =
        (detail as { legacyIriParam?: string } | null)?.legacyIriParam ??
        "place_iri";
      const params =
        detail?.paramName === "fideId"
          ? hex
            ? {
                fideId: itemId.startsWith("did:fide:")
                  ? itemId
                  : `did:fide:${hex}`,
                subjectFingerprint: fingerprint ?? "",
                [legacyKey]: "",
              }
            : {
                fideId: "",
                subjectFingerprint: "",
                [legacyKey]: coerceContextDetailId(
                  activeContextCategory!,
                  itemId
                ),
              }
          : { [paramName]: itemId };

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/context/query`,
        {
          body: JSON.stringify({
            params,
            query,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }
      );

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json();
    }
  );

  const realContextItems = useMemo(
    () =>
      activeContextCategory
        ? extractRows(contextQueryResponse?.result).map((row, index) =>
            normalizeContextRow(activeContextCategory, row, index)
          )
        : [],
    [activeContextCategory, contextQueryResponse]
  );

  const contextDetailRows = useMemo(
    () => extractRows(contextDetailQueryResponse?.result),
    [contextDetailQueryResponse]
  );

  const [mode, setMode] = useState<"edit" | "diff">("edit");
  const [document, setDocument] = useState<Document | null>(null);
  const [currentVersionIndex, setCurrentVersionIndex] = useState(-1);

  const artifactContentRef = useRef<HTMLDivElement>(null);
  const userScrolledArtifact = useRef(false);
  const [isContentDirty, setIsContentDirty] = useState(false);

  useEffect(() => {
    if (artifact.status !== "streaming") {
      userScrolledArtifact.current = false;
      return;
    }
    if (userScrolledArtifact.current) {
      return;
    }
    const el = artifactContentRef.current;
    if (!el) {
      return;
    }
    el.scrollTo({ top: el.scrollHeight });
  }, [artifact.status]);

  useEffect(() => {
    if (documents && documents.length > 0) {
      const mostRecentDocument = documents.at(-1);

      if (mostRecentDocument) {
        setDocument(mostRecentDocument);
        setCurrentVersionIndex(documents.length - 1);
        if (artifact.status === "streaming" || !isContentDirty) {
          setArtifact((currentArtifact) => ({
            ...currentArtifact,
            content: mostRecentDocument.content ?? "",
          }));
        }
      }
    }
  }, [documents, setArtifact, artifact.status, isContentDirty]);

  useEffect(() => {
    mutateDocuments();
  }, [mutateDocuments]);

  const { mutate } = useSWRConfig();

  const handleContentChange = useCallback(
    (updatedContent: string) => {
      if (!artifact) {
        return;
      }

      mutate<Document[]>(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/document?id=${artifact.documentId}`,
        async (currentDocuments) => {
          if (!currentDocuments) {
            return [];
          }

          const currentDocument = currentDocuments.at(-1);

          if (!currentDocument?.content) {
            setIsContentDirty(false);
            return currentDocuments;
          }

          if (currentDocument.content === updatedContent) {
            setIsContentDirty(false);
            return currentDocuments;
          }

          await fetch(
            `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/document?id=${artifact.documentId}`,
            {
              method: "POST",
              body: JSON.stringify({
                title: artifact.title,
                content: updatedContent,
                kind: artifact.kind,
                isManualEdit: true,
              }),
            }
          );

          setIsContentDirty(false);

          return currentDocuments.map((doc, i) =>
            i === currentDocuments.length - 1
              ? { ...doc, content: updatedContent }
              : doc
          );
        },
        { revalidate: false }
      );
    },
    [artifact, mutate]
  );

  const latestContentRef = useRef<string>("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveContent = useCallback(
    (updatedContent: string, debounce: boolean) => {
      latestContentRef.current = updatedContent;
      setIsContentDirty(true);

      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }

      if (debounce) {
        saveTimerRef.current = setTimeout(() => {
          handleContentChange(latestContentRef.current);
          saveTimerRef.current = null;
        }, 2000);
      } else {
        handleContentChange(updatedContent);
      }
    },
    [handleContentChange]
  );

  function getDocumentContentById(index: number) {
    if (!documents) {
      return "";
    }
    if (!documents[index]) {
      return "";
    }
    return documents[index].content ?? "";
  }

  const handleVersionChange = (type: "next" | "prev" | "toggle" | "latest") => {
    if (!documents) {
      return;
    }

    if (type === "latest") {
      setCurrentVersionIndex(documents.length - 1);
      setMode("edit");
    }

    if (type === "toggle") {
      setMode((currentMode) => (currentMode === "edit" ? "diff" : "edit"));
    }

    if (type === "prev") {
      if (currentVersionIndex > 0) {
        setCurrentVersionIndex((index) => index - 1);
      }
    } else if (type === "next" && currentVersionIndex < documents.length - 1) {
      setCurrentVersionIndex((index) => index + 1);
    }
  };

  const [isToolbarVisible, setIsToolbarVisible] = useState(true);

  const isCurrentVersion =
    documents && documents.length > 0
      ? currentVersionIndex === documents.length - 1
      : true;

  const { width: windowWidth, height: windowHeight } = useWindowSize();
  const isMobile = windowWidth ? windowWidth < 768 : false;

  const artifactDefinition = artifactDefinitions.find(
    (definition) => definition.kind === artifact.kind
  );

  if (!artifactDefinition) {
    throw new Error("Artifact definition not found!");
  }

  useEffect(() => {
    if (artifact.documentId !== "init" && artifactDefinition.initialize) {
      artifactDefinition.initialize({
        documentId: artifact.documentId,
        setMetadata,
      });
    }
  }, [artifact.documentId, artifactDefinition, setMetadata]);

  useEffect(() => {
    if (artifact.isVisible) {
      setActiveTab("artifact");
    } else if (isWorldModelVisible) {
      setActiveTab("world-model");
    }
  }, [artifact.isVisible, isWorldModelVisible]);

  const isPanelVisible = artifact.isVisible || isWorldModelVisible;
  const showArtifactTab = artifact.isVisible;
  const showWorldModelTab = isPanelVisible;
  const currentTab =
    activeTab === "artifact" && showArtifactTab ? "artifact" : "world-model";

  if (!isPanelVisible && !isMobile) {
    return (
      <div
        className="h-dvh w-0 shrink-0 overflow-hidden transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
        data-testid="artifact"
      />
    );
  }

  if (!isPanelVisible) {
    return null;
  }

  const consoleError =
    metadata?.outputs
      ?.filter((o: { status: string }) => o.status === "failed")
      .flatMap((o: { contents: { type: string; value: string }[] }) =>
        o.contents.filter((c) => c.type === "text").map((c) => c.value)
      )
      .join("\n") || undefined;

  const closeCurrentTab = () => {
    if (currentTab === "artifact") {
      setArtifact((currentArtifact) =>
        currentArtifact.status === "streaming"
          ? { ...currentArtifact, isVisible: false }
          : { ...initialArtifactData, status: "idle" }
      );
      if (isWorldModelVisible) {
        setActiveTab("world-model");
      }
      return;
    }

    clearContext();
    setWorldModelVisible(false);
    if (artifact.isVisible) {
      setActiveTab("artifact");
    }
  };

  const tabButtonClass = (tab: "artifact" | "world-model") =>
    cn(
      "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
      currentTab === tab
        ? "bg-background text-foreground shadow-sm ring-1 ring-border/50"
        : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
    );

  const contextCategories: Array<{
    label: ContextCategory;
    description: string;
  }> = [
    {
      label: "Hotels",
      description: "AU inventory stays with addresses and booking links.",
    },
    {
      label: "Activities",
      description: "Bookable tours and experiences with affiliate links.",
    },
    {
      label: "Attractions",
      description: "Top-10 things to do from Catalina destination guides.",
    },
    {
      label: "Itineraries",
      description: "Advisor trip templates with ordered stays.",
    },
    {
      label: "Collections",
      description: "Signature lodges, walks, wineries, golf, and Aboriginal experiences.",
    },
    {
      label: "Destinations",
      description: "AU & NZ places with stay nights, landscapes, and airports.",
    },
    {
      label: "Transportation",
      description: "Pick a from city, then a to city, to see routing legs.",
    },
  ];

  const contextItems = activeContextCategory ? realContextItems : [];
  const isContextLoading = Boolean(activeContextCategory && isContextQueryLoading);
  const contextError = activeContextCategory && contextQueryError
    ? contextQueryError instanceof Error
      ? contextQueryError.message
      : `Unable to load ${activeContextCategory.toLowerCase()}.`
    : null;
  const contextEmptyMessage =
    activeContextCategory
      ? `No ${activeContextCategory.toLowerCase()} records match that search.`
      : "No world model records match that search.";
  const selectedContextItem = (() => {
    if (!selectedContextItemId || !activeContextCategory) {
      return null;
    }

    const fromList = contextItems.find(
      (item) => item.id === selectedContextItemId
    );
    if (fromList) {
      return fromList;
    }

    if (contextDetailRows[0]) {
      return normalizeContextRow(
        activeContextCategory,
        contextDetailRows[0],
        0
      );
    }

    return {
      id: selectedContextItemId,
      name: "Loading…",
      filter: "",
      subtitle: activeContextCategory,
      description: "",
      tags: [],
      raw: undefined,
    } satisfies ContextItem;
  })();
  const selectedDetailRow =
    activeContextCategory
      ? (contextDetailRows[0] ?? selectedContextItem?.raw ?? null)
      : selectedContextItem?.raw ?? null;
  const contextDetailError =
    activeContextCategory && contextDetailQueryError
      ? `Could not load the ${activeContextCategory.toLowerCase()} detail record.`
      : null;
  const selectedDetailItem =
    selectedContextItem && activeContextCategory
      ? {
          kind: categoryToTravelKind(activeContextCategory),
          id: selectedContextItem.id,
          name: selectedContextItem.name,
          filter: selectedContextItem.filter,
          subtitle: selectedContextItem.subtitle,
          description: selectedDetailRow
            ? readString(
                selectedDetailRow,
                ["advisor_note", "description", "summary"],
                selectedContextItem.description
              )
            : selectedContextItem.description,
          tags: selectedContextItem.tags,
          raw: {
            ...(selectedContextItem.raw ?? {}),
            ...(selectedDetailRow ?? {}),
          },
        } satisfies TravelContextItem
      : null;
  const contextFilters = [
    "All",
    ...Array.from(new Set(contextItems.map((item) => item.filter))).filter(
      Boolean
    ),
  ];
  const transportFromOptions =
    contextCategory === "Transportation"
      ? Array.from(
          new Set(
            contextItems
              .map((item) =>
                readString(item.raw ?? {}, ["from_region_name", "from_region"])
              )
              .filter(Boolean)
          )
        ).sort((a, b) => a.localeCompare(b))
      : [];
  const transportToOptions =
    contextCategory === "Transportation"
      ? Array.from(
          new Set(
            contextItems
              .filter((item) => {
                if (transportFrom === "All") {
                  return true;
                }
                return (
                  readString(item.raw ?? {}, [
                    "from_region_name",
                    "from_region",
                  ]) === transportFrom
                );
              })
              .map((item) =>
                readString(item.raw ?? {}, ["to_region_name", "to_region"])
              )
              .filter(Boolean)
          )
        ).sort((a, b) => a.localeCompare(b))
      : [];
  const visibleContextItems = contextCategory
    ? contextItems.filter((item) => {
        const matchesSearch = `${item.name} ${item.subtitle} ${item.tags.join(" ")}`
          .toLowerCase()
          .includes(contextSearch.trim().toLowerCase());
        if (!matchesSearch) {
          return false;
        }
        if (contextCategory === "Transportation") {
          const from = readString(item.raw ?? {}, [
            "from_region_name",
            "from_region",
          ]);
          const to = readString(item.raw ?? {}, [
            "to_region_name",
            "to_region",
          ]);
          if (transportFrom !== "All" && from !== transportFrom) {
            return false;
          }
          if (transportTo !== "All" && to !== transportTo) {
            return false;
          }
          return true;
        }
        return contextFilter === "All" || item.filter === contextFilter;
      })
    : [];

  const worldModelPanel = (
    <>
      <div className="flex-1 overflow-y-auto bg-background p-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {contextCategory ? (
            <>
              <div className="flex items-center gap-2">
                <button
                  className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={() => {
                    if (selectedContextItem) {
                      clearContextItem();
                    } else {
                      clearContext();
                      setContextSearch("");
                      setContextFilter("All");
                    }
                  }}
                  type="button"
                >
                  <ArrowLeftIcon className="size-4" />
                </button>
                <div>
                  <div className="text-sm font-semibold">
                    {selectedContextItem?.name ?? contextCategory}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {selectedContextItem
                      ? contextCategory
                      : "Live Catalina Quest inventory"}
                  </div>
                  {selectedContextItem?.id ? (
                    <div className="mt-0.5">
                      <FideIdChip id={selectedContextItem.id} />
                    </div>
                  ) : null}
                </div>
              </div>

              {contextError ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                  Could not load {contextCategory?.toLowerCase()} from the
                  world model.
                </div>
              ) : selectedContextItem ? (
                <div className="flex flex-col gap-4">
                  {isContextDetailLoading && !selectedDetailRow ? (
                    <div className="rounded-lg border border-border/60 bg-card/40 p-4 text-sm text-muted-foreground">
                      Loading details...
                    </div>
                  ) : null}
                  {contextDetailError ? (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                      {contextDetailError}
                    </div>
                  ) : null}
                  {selectedDetailItem ? (
                    <EntityDetail item={selectedDetailItem} />
                  ) : null}
                </div>
              ) : (
                <>
                  <input
                    className="h-10 rounded-lg border border-input bg-muted/30 px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/20 focus:bg-muted"
                    onChange={(event) => setContextSearch(event.target.value)}
                    placeholder={
                      contextCategory === "Transportation"
                        ? "Search routes..."
                        : `Search ${contextCategory.toLowerCase()}...`
                    }
                    value={contextSearch}
                  />
                  {contextCategory === "Transportation" ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="flex flex-col gap-1.5">
                        <span className="text-[11px] font-medium uppercase text-muted-foreground">
                          From
                        </span>
                        <select
                          className="h-10 rounded-lg border border-input bg-muted/30 px-3 text-sm outline-none transition-colors focus:border-foreground/20 focus:bg-muted"
                          onChange={(event) => {
                            setTransportFrom(event.target.value);
                            setTransportTo("All");
                          }}
                          value={transportFrom}
                        >
                          <option value="All">All origins</option>
                          {transportFromOptions.map((place) => (
                            <option key={place} value={place}>
                              {place}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1.5">
                        <span className="text-[11px] font-medium uppercase text-muted-foreground">
                          To
                        </span>
                        <select
                          className="h-10 rounded-lg border border-input bg-muted/30 px-3 text-sm outline-none transition-colors focus:border-foreground/20 focus:bg-muted"
                          onChange={(event) =>
                            setTransportTo(event.target.value)
                          }
                          value={transportTo}
                        >
                          <option value="All">All destinations</option>
                          {transportToOptions.map((place) => (
                            <option key={place} value={place}>
                              {place}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {contextFilters.map((filter) => (
                        <button
                          className={cn(
                            "rounded-md border px-2.5 py-1 text-xs transition-colors",
                            contextFilter === filter
                              ? "border-foreground/20 bg-foreground text-background"
                              : "border-border/60 bg-card/40 text-muted-foreground hover:bg-card hover:text-foreground"
                          )}
                          key={filter}
                          onClick={() => setContextFilter(filter)}
                          type="button"
                        >
                          {filter}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-col gap-2">
                    {isContextLoading ? (
                      <div className="rounded-lg border border-border/60 bg-card/40 p-4 text-sm text-muted-foreground">
                        Loading {contextCategory.toLowerCase()}...
                      </div>
                    ) : null}
                    {!isContextLoading &&
                      visibleContextItems.map((item, index) => (
                        <button
                          className="rounded-lg border border-border/60 bg-card/40 p-4 text-left transition-colors hover:border-border hover:bg-card"
                          key={`${item.id}:${index}`}
                          onClick={() => {
                            if (contextCategory) {
                              openContext(contextCategory as ContextCategory, item.id);
                            }
                          }}
                          type="button"
                        >
                          <div className="text-sm font-medium">
                            {item.name}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {item.subtitle}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {item.tags.slice(0, 3).map((tag) => (
                              <span
                                className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                                key={tag}
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        </button>
                      ))}
                    {!isContextLoading && visibleContextItems.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                        {contextCategory === "Transportation"
                          ? "No routes match that from/to selection."
                          : contextEmptyMessage}
                      </div>
                    ) : null}
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {contextCategories.map(({ label, description }) => (
                  <button
                    className="group flex min-h-28 flex-col justify-between rounded-lg border border-border/60 bg-card/40 p-4 text-left transition-colors hover:border-border hover:bg-card"
                    key={label}
                    onClick={() => {
                      openContext(label);
                      setContextFilter("All");
                      setContextSearch("");
                      setTransportFrom("All");
                      setTransportTo("All");
                    }}
                    type="button"
                  >
                    <div>
                      <div className="text-sm font-medium">{label}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {description}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              <ContextDataUpload />
            </div>
          )}
        </div>
      </div>
    </>
  );

  const artifactPanel = (
    <>
      <div className="flex h-[calc(3.5rem+1px)] shrink-0 items-center justify-between gap-3 border-b border-border/50 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="truncate text-sm font-semibold leading-tight tracking-tight">
              {artifact.title}
            </div>
            <div className="flex items-center gap-2">
              {isContentDirty ? (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <div className="size-1.5 animate-pulse rounded-full bg-amber-500" />
                  Saving...
                </div>
              ) : document ? (
                <div className="text-xs text-muted-foreground">
                  {`Updated ${formatDistance(new Date(document.createdAt), new Date(), { addSuffix: true })}`}
                </div>
              ) : artifact.status === "streaming" ? (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <div className="animate-spin">
                    <LoaderIcon size={12} />
                  </div>
                  Generating...
                </div>
              ) : (
                <div className="h-3 w-24 animate-pulse rounded bg-muted-foreground/10" />
              )}
              {documents && documents.length > 1 && (
                <div className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                  v{currentVersionIndex + 1}/{documents.length}
                </div>
              )}
            </div>
          </div>
        </div>
        <ArtifactCloseButton />
      </div>
      <div
        className="relative flex-1 overflow-y-auto bg-background"
        data-slot="artifact-content"
        onScroll={() => {
          const el = artifactContentRef.current;
          if (!el) {
            return;
          }
          const atBottom =
            el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          userScrolledArtifact.current = !atBottom;
        }}
        ref={artifactContentRef}
      >
        <artifactDefinition.content
          content={
            isCurrentVersion
              ? artifact.content
              : getDocumentContentById(currentVersionIndex)
          }
          currentVersionIndex={currentVersionIndex}
          getDocumentContentById={getDocumentContentById}
          isCurrentVersion={isCurrentVersion}
          isInline={false}
          isLoading={isDocumentsFetching && !artifact.content}
          metadata={metadata}
          mode={mode}
          onSaveContent={saveContent}
          sendMessage={sendMessage}
          setMetadata={setMetadata}
          status={artifact.status}
          suggestions={[]}
          title={artifact.title}
        />
        <AnimatePresence>
          {isCurrentVersion && (
            <Toolbar
              artifactActions={
                <ArtifactActions
                  artifact={artifact}
                  currentVersionIndex={currentVersionIndex}
                  handleVersionChange={handleVersionChange}
                  isCurrentVersion={isCurrentVersion}
                  metadata={metadata}
                  mode={mode}
                  setMetadata={setMetadata}
                />
              }
              artifactKind={artifact.kind}
              consoleError={consoleError}
              documentId={artifact.documentId}
              isToolbarVisible={isToolbarVisible}
              onClose={() => {
                setArtifact((prev) => ({ ...prev, isVisible: false }));
              }}
              sendMessage={sendMessage}
              onSaveContent={saveContent}
              setIsToolbarVisible={setIsToolbarVisible}
              setMessages={setMessages}
              status={status}
              stop={stop}
            />
          )}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {!isCurrentVersion && (
          <VersionFooter
            currentVersionIndex={currentVersionIndex}
            documents={documents}
            handleVersionChange={handleVersionChange}
            mode={mode}
            setMode={setMode}
          />
        )}
      </AnimatePresence>
    </>
  );

  const panel = (
    <>
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border/50 bg-sidebar px-3">
        <div className="flex items-center gap-1 rounded-lg bg-muted/40 p-1">
          {showArtifactTab ? (
            <button
              className={tabButtonClass("artifact")}
              onClick={() => setActiveTab("artifact")}
              type="button"
            >
              <FileTextIcon className="size-3.5" />
              Document
            </button>
          ) : null}
          {showWorldModelTab ? (
            <button
              className={tabButtonClass("world-model")}
              onClick={() => {
                setWorldModelVisible(true);
                setActiveTab("world-model");
              }}
              type="button"
            >
              <DatabaseIcon className="size-3.5" />
              Context
            </button>
          ) : null}
        </div>
        <button
          aria-label={
            currentTab === "artifact" ? "Close document" : "Close context"
          }
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={closeCurrentTab}
          type="button"
        >
          <XIcon className="size-4" />
        </button>
      </div>
      {currentTab === "artifact" ? artifactPanel : worldModelPanel}
    </>
  );

  if (isMobile) {
    return (
      <motion.div
        animate={{
          opacity: 1,
          x: 0,
          y: 0,
          height: windowHeight,
          width: "100dvw",
          borderRadius: 0,
        }}
        className="fixed inset-0 z-50 flex h-dvh flex-col overflow-hidden bg-sidebar"
        data-testid="artifact"
        exit={{ opacity: 0, scale: 0.95 }}
        initial={{
          opacity: 1,
          x: artifact.boundingBox.left,
          y: artifact.boundingBox.top,
          height: artifact.boundingBox.height,
          width: artifact.boundingBox.width,
          borderRadius: 50,
        }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
      >
        {panel}
      </motion.div>
    );
  }

  return (
    <div
      className="flex h-dvh w-[60%] shrink-0 flex-col overflow-hidden border-l border-border/50 bg-sidebar transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
      data-testid="artifact"
    >
      {panel}
    </div>
  );
}

export const Artifact = memo(PureArtifact, (prevProps, nextProps) => {
  if (prevProps.status !== nextProps.status) {
    return false;
  }
  if (prevProps.input !== nextProps.input) {
    return false;
  }
  if (prevProps.messages.length !== nextProps.messages.length) {
    return false;
  }
  if (prevProps.selectedVisibilityType !== nextProps.selectedVisibilityType) {
    return false;
  }
  if (prevProps.isWorldModelVisible !== nextProps.isWorldModelVisible) {
    return false;
  }

  return true;
});
