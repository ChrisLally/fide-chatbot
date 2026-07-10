import type { UseChatHelpers } from "@ai-sdk/react";
import { formatDistance } from "date-fns";
import equal from "fast-deep-equal";
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
import { sheetArtifact } from "@/artifacts/sheet/client";
import { textArtifact } from "@/artifacts/text/client";
import { initialArtifactData, useArtifact } from "@/hooks/use-artifact";
import type { Document, Vote } from "@/lib/db/schema";
import type { Attachment, ChatMessage } from "@/lib/types";
import { cn, fetcher } from "@/lib/utils";
import { useSidebar } from "../ui/sidebar";
import { ArtifactActions } from "./artifact-actions";
import { LoaderIcon } from "./icons";
import { Toolbar } from "./toolbar";
import { VersionFooter } from "./version-footer";
import type { VisibilityType } from "./visibility-selector";

export const artifactDefinitions = [
  textArtifact,
  codeArtifact,
  imageArtifact,
  sheetArtifact,
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

type ContextItem = {
  id: string;
  name: string;
  filter: string;
  subtitle: string;
  description: string;
  tags: string[];
  raw?: Record<string, unknown>;
};

type ContextQueryResponse = {
  result?: unknown;
};

const contextListQueries = {
  Hotels: "hotels",
  Activities: "activities",
  Destinations: "destinations",
  Transportation: "transportation",
} as const;

const contextDetailQueries = {
  Hotels: { paramName: "hotel_iri", query: "hotelDetail" },
  Activities: { paramName: "activity_iri", query: "activityDetail" },
  Destinations: { paramName: "place_iri", query: "destinationDetail" },
  Transportation: {
    paramName: "option_iri",
    query: "transportationDetail",
  },
} as const;

type ContextCategory = keyof typeof contextListQueries;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function extractRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }

  if (!isRecord(value)) {
    return [];
  }

  const candidates = [
    value.rows,
    value.data,
    value.items,
    value.records,
    isRecord(value.result) ? value.result.rows : undefined,
    isRecord(value.result) ? value.result.data : undefined,
    value.result,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter(isRecord);
    }
  }

  return [];
}

function readString(
  row: Record<string, unknown>,
  keys: string[],
  fallback = ""
) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number") {
      return String(value);
    }
  }
  return fallback;
}

function readTags(row: Record<string, unknown>, keys: string[]) {
  const tags = new Set<string>();

  for (const key of keys) {
    const value = row[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.trim()) {
          tags.add(item.trim());
        }
      }
    } else if (typeof value === "string" && value.trim()) {
      for (const item of value.split(",")) {
        if (item.trim()) {
          tags.add(item.trim());
        }
      }
    }
  }

  return Array.from(tags).slice(0, 6);
}

function normalizeHotelRow(
  row: Record<string, unknown>,
  index: number
): ContextItem {
  const name = readString(
    row,
    ["hotel", "name", "hotel_name", "display_name", "title"],
    `Hotel ${index + 1}`
  );
  const id = readString(
    row,
    ["hotel_iri", "id", "hotel_id", "fide_id", "slug", "key"],
    `hotel-${index}`
  );
  const filter = readString(
    row,
    [
      "region_name",
      "region",
      "area",
      "neighborhood",
      "location",
      "price_tier",
      "category",
    ],
    "Hotels"
  );
  const priceTier = readString(row, ["price_tier", "price", "budget"]);
  const area = readString(row, [
    "region_name",
    "region",
    "area",
    "neighborhood",
    "location",
  ]);
  const rating = readString(row, [
    "internal_rating",
    "public_rating",
    "rating",
    "stars",
  ]);
  const subtitle = [priceTier, area, rating && `${rating} rating`]
    .filter(Boolean)
    .join(" · ");
  const description = readString(
    row,
    ["advisor_note", "description", "summary", "overview", "notes"],
    "No description available yet."
  );
  const tags = readTags(row, [
    "good_for",
    "bad_for",
    "tags",
    "amenities",
    "features",
    "vibe",
    "region_name",
    "walkability",
    "area",
    "neighborhood",
    "location",
    "price_tier",
  ]);

  return {
    id,
    name,
    filter,
    subtitle: subtitle || "Hotel record",
    description,
    tags: tags.length > 0 ? tags : [filter],
    raw: row,
  };
}

function normalizeActivityRow(
  row: Record<string, unknown>,
  index: number
): ContextItem {
  const name = readString(row, ["activity", "name", "title"], `Activity ${index + 1}`);
  const id = readString(row, ["activity_iri", "id", "key"], `activity-${index}`);
  const region = readString(row, ["region_name", "region"], "Activities");
  const duration = readString(row, ["duration"]);
  const format = readString(row, ["format"]);
  const tags = readTags(row, [
    "good_for",
    "bad_for",
    "format",
    "region_name",
    "duration",
  ]);

  return {
    id,
    name,
    filter: region,
    subtitle: [duration, format, region].filter(Boolean).join(" · ") || "Activity record",
    description: readString(row, ["advisor_note", "description"], "No description available yet."),
    tags: tags.length > 0 ? tags : [region],
    raw: row,
  };
}

function normalizeDestinationRow(
  row: Record<string, unknown>,
  index: number
): ContextItem {
  const name = readString(row, ["place", "name", "title"], `Destination ${index + 1}`);
  const id = readString(row, ["place_iri", "id", "key"], `destination-${index}`);

  return {
    id,
    name,
    filter: "Destinations",
    subtitle: "Destination record",
    description: readString(row, ["advisor_note", "description"], "No description available yet."),
    tags: ["Destination"],
    raw: row,
  };
}

function normalizeTransportationRow(
  row: Record<string, unknown>,
  index: number
): ContextItem {
  const route = readString(row, ["route"], `Route ${index + 1}`);
  const option = readString(row, ["option", "mode"]);
  const id = readString(row, ["option_iri", "route_iri", "id", "key"], `transport-${index}`);
  const from = readString(row, ["from_region_name", "from_region"]);
  const to = readString(row, ["to_region_name", "to_region"]);
  const duration = readString(row, ["duration"]);
  const tags = readTags(row, [
    "good_for",
    "bad_for",
    "option",
    "mode",
    "from_region_name",
    "to_region_name",
  ]);

  return {
    id,
    name: option ? `${route}: ${option}` : route,
    filter: from && to ? `${from} to ${to}` : "Transportation",
    subtitle: [duration, from && to ? `${from} to ${to}` : ""]
      .filter(Boolean)
      .join(" · ") || "Transportation record",
    description: readString(row, ["advisor_note", "description"], "No description available yet."),
    tags: tags.length > 0 ? tags : ["Transportation"],
    raw: row,
  };
}

function normalizeContextRow(
  category: ContextCategory,
  row: Record<string, unknown>,
  index: number
): ContextItem {
  if (category === "Hotels") {
    return normalizeHotelRow(row, index);
  }
  if (category === "Activities") {
    return normalizeActivityRow(row, index);
  }
  if (category === "Destinations") {
    return normalizeDestinationRow(row, index);
  }
  return normalizeTransportationRow(row, index);
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
  votes: _votes,
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
  votes: Vote[] | undefined;
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  isReadonly: boolean;
  selectedVisibilityType: VisibilityType;
  selectedModelId: string;
  isWorldModelVisible: boolean;
  setWorldModelVisible: Dispatch<SetStateAction<boolean>>;
}) {
  const { artifact, setArtifact, metadata, setMetadata } = useArtifact();
  const [activeTab, setActiveTab] = useState<"artifact" | "world-model">(
    artifact.isVisible ? "artifact" : "world-model"
  );
  const [contextCategory, setContextCategory] = useState<string | null>(null);
  const [contextSearch, setContextSearch] = useState("");
  const [contextFilter, setContextFilter] = useState("All");
  const [selectedContextItemId, setSelectedContextItemId] = useState<
    string | null
  >(null);

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
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/context/query`,
        {
          body: JSON.stringify({
            params: { [paramName]: itemId },
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

  const { state: sidebarState } = useSidebar();
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
  const showWorldModelTab = isWorldModelVisible;
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

  const contextCategories = [
    "Hotels",
    "Activities",
    "Destinations",
    "Transportation",
  ];

  const placeholderContextItems: Record<string, ContextItem[]> = {
    Hotels: [
      {
        id: "hotel-avalon-harbor",
        name: "Avalon Harbor Inn",
        filter: "Harbor",
        subtitle: "$$$ · Harbor views · Walkable",
        description:
          "Placeholder hotel detail for a waterfront stay close to ferry arrivals, restaurants, and evening walks.",
        tags: ["Harbor", "Couples", "Walkable"],
      },
      {
        id: "hotel-courtyard",
        name: "Catalina Courtyard Hotel",
        filter: "Central",
        subtitle: "$$ · Quiet courtyard · Family friendly",
        description:
          "Placeholder hotel detail for a central, practical stay with easy access to Avalon activities.",
        tags: ["Central", "Families", "Quiet"],
      },
      {
        id: "hotel-descanso",
        name: "Descanso View Lodge",
        filter: "Beach",
        subtitle: "$$$ · Beach access · Scenic",
        description:
          "Placeholder hotel detail for travelers prioritizing beach time and slower mornings.",
        tags: ["Beach", "Views", "Relaxed"],
      },
      {
        id: "hotel-palms",
        name: "Island Palms Suites",
        filter: "Central",
        subtitle: "$$ · Suite-style · Group friendly",
        description:
          "Placeholder hotel detail for groups who want more room and a simple home base.",
        tags: ["Central", "Groups", "Suites"],
      },
    ],
    Activities: [
      {
        id: "activity-glass-boat",
        name: "Glass-bottom boat tour",
        filter: "Water",
        subtitle: "60 min · Easy · Family friendly",
        description:
          "Placeholder activity detail for seeing marine life without getting wet.",
        tags: ["Water", "Families", "Easy"],
      },
      {
        id: "activity-cabana",
        name: "Descanso Beach cabana day",
        filter: "Beach",
        subtitle: "Half day · Relaxed · Premium",
        description:
          "Placeholder activity detail for a low-effort beach day with a reserved base.",
        tags: ["Beach", "Relaxed", "Premium"],
      },
      {
        id: "activity-hike",
        name: "Garden to Sky hike",
        filter: "Outdoors",
        subtitle: "3 hr · Moderate · Scenic",
        description:
          "Placeholder activity detail for a more active route with island views.",
        tags: ["Outdoors", "Scenic", "Moderate"],
      },
      {
        id: "activity-food",
        name: "Avalon food walk",
        filter: "Food",
        subtitle: "2 hr · Easy · Local flavor",
        description:
          "Placeholder activity detail for sampling Avalon restaurants and stories.",
        tags: ["Food", "Easy", "Avalon"],
      },
    ],
    Destinations: [
      {
        id: "destination-avalon",
        name: "Avalon",
        filter: "Town",
        subtitle: "Main town · Dining · Hotels",
        description:
          "Placeholder destination detail for the island's primary visitor hub.",
        tags: ["Town", "Dining", "Walkable"],
      },
      {
        id: "destination-two-harbors",
        name: "Two Harbors",
        filter: "Remote",
        subtitle: "Quieter side · Boating · Camping",
        description:
          "Placeholder destination detail for a more remote Catalina experience.",
        tags: ["Remote", "Boating", "Outdoors"],
      },
      {
        id: "destination-descanso",
        name: "Descanso Beach",
        filter: "Beach",
        subtitle: "Beach club · Swimming · Cabanas",
        description:
          "Placeholder destination detail for lounging, swimming, and beach activities.",
        tags: ["Beach", "Relaxed", "Popular"],
      },
      {
        id: "destination-garden",
        name: "Wrigley Memorial & Botanic Garden",
        filter: "Nature",
        subtitle: "Garden · Views · History",
        description:
          "Placeholder destination detail for native plants, architecture, and views.",
        tags: ["Nature", "History", "Scenic"],
      },
    ],
    Transportation: [
      {
        id: "transport-ferry",
        name: "Catalina Express ferry",
        filter: "Ferry",
        subtitle: "Mainland route · Scheduled · Common",
        description:
          "Placeholder transportation detail for standard ferry arrivals and departures.",
        tags: ["Ferry", "Scheduled", "Mainland"],
      },
      {
        id: "transport-golf-cart",
        name: "Avalon golf cart rental",
        filter: "Local",
        subtitle: "Local mobility · Scenic loop · Timed",
        description:
          "Placeholder transportation detail for exploring Avalon at a relaxed pace.",
        tags: ["Local", "Avalon", "Scenic"],
      },
      {
        id: "transport-shuttle",
        name: "Two Harbors shuttle",
        filter: "Shuttle",
        subtitle: "Cross-island · Limited schedule",
        description:
          "Placeholder transportation detail for reaching the quieter side of the island.",
        tags: ["Shuttle", "Two Harbors", "Planning"],
      },
      {
        id: "transport-private",
        name: "Private boat transfer",
        filter: "Private",
        subtitle: "Flexible · Premium · Weather dependent",
        description:
          "Placeholder transportation detail for customized arrivals or special trips.",
        tags: ["Private", "Premium", "Flexible"],
      },
    ],
  };

  const contextItems =
    activeContextCategory
      ? realContextItems
      : contextCategory
        ? placeholderContextItems[contextCategory]
        : [];
  const isContextLoading = Boolean(activeContextCategory && isContextQueryLoading);
  const contextError = activeContextCategory && contextQueryError
    ? contextQueryError instanceof Error
      ? contextQueryError.message
      : `Unable to load ${activeContextCategory.toLowerCase()}.`
    : null;
  const contextEmptyMessage =
    activeContextCategory
      ? `No ${activeContextCategory.toLowerCase()} records match that search.`
      : "No placeholder records match that search.";
  const selectedContextItem =
    contextItems.find((item) => item.id === selectedContextItemId) ?? null;
  const selectedDetailRow =
    activeContextCategory
      ? (contextDetailRows[0] ?? selectedContextItem?.raw ?? null)
      : selectedContextItem?.raw ?? null;
  const contextDetailError =
    activeContextCategory && contextDetailQueryError
      ? `Could not load the ${activeContextCategory.toLowerCase()} detail record.`
      : null;
  const selectedDetailFields = selectedDetailRow
    ? [
        ["Region", readString(selectedDetailRow, ["region_name", "region"])],
        ["Route", readString(selectedDetailRow, ["route"])],
        ["From", readString(selectedDetailRow, ["from_region_name", "from_region"])],
        ["To", readString(selectedDetailRow, ["to_region_name", "to_region"])],
        ["Duration", readString(selectedDetailRow, ["duration"])],
        ["Format", readString(selectedDetailRow, ["format"])],
        [
          "Internal rating",
          readString(selectedDetailRow, ["internal_rating"]),
        ],
        ["Public rating", readString(selectedDetailRow, ["public_rating"])],
        ["Walkability", readString(selectedDetailRow, ["walkability"])],
        ["Times sent", readString(selectedDetailRow, ["times_sent"])],
        ["Room tip", readString(selectedDetailRow, ["room_tip"])],
        ["Booking tip", readString(selectedDetailRow, ["booking_tip"])],
        ["Caution", readString(selectedDetailRow, ["caution_note"])],
      ].filter(([, value]) => value)
    : [];
  const selectedReviews = selectedDetailRow
    ? readString(selectedDetailRow, ["guest_reviews"])
        .split("\n")
        .map((review) => review.trim())
        .filter(Boolean)
    : [];
  const contextFilters = [
    "All",
    ...Array.from(new Set(contextItems.map((item) => item.filter))),
  ];
  const visibleContextItems = contextCategory
    ? contextItems.filter(
        (item) =>
          (contextFilter === "All" || item.filter === contextFilter) &&
          `${item.name} ${item.subtitle} ${item.tags.join(" ")}`
            .toLowerCase()
            .includes(contextSearch.trim().toLowerCase())
      )
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
                      setSelectedContextItemId(null);
                    } else {
                      setContextCategory(null);
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
                      : activeContextCategory
                        ? "World model records"
                        : "Placeholder context records"}
                  </div>
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
                  <div className="rounded-lg border border-border/60 bg-card/40 p-4">
                    <div className="text-sm font-medium">
                      {selectedContextItem.subtitle}
                    </div>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">
                      {selectedDetailRow
                        ? readString(
                            selectedDetailRow,
                            ["advisor_note", "description", "summary"],
                            selectedContextItem.description
                          )
                        : selectedContextItem.description}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {selectedContextItem.tags.map((tag) => (
                        <span
                          className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"
                          key={tag}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  {selectedDetailFields.length > 0 ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {selectedDetailFields.map(([label, value]) => (
                        <div
                          className="rounded-lg border border-border/60 bg-card/40 p-3"
                          key={label}
                        >
                          <div className="text-[11px] font-medium uppercase text-muted-foreground">
                            {label}
                          </div>
                          <div className="mt-1 text-sm leading-5">{value}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {selectedReviews.length > 0 ? (
                    <div className="rounded-lg border border-border/60 bg-card/40 p-4">
                      <div className="text-sm font-medium">Guest reviews</div>
                      <div className="mt-3 flex flex-col gap-3">
                        {selectedReviews.map((review) => (
                          <p
                            className="border-border/60 border-l-2 pl-3 text-sm leading-6 text-muted-foreground"
                            key={review}
                          >
                            {review}
                          </p>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <>
                  <input
                    className="h-10 rounded-lg border border-input bg-muted/30 px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/20 focus:bg-muted"
                    onChange={(event) => setContextSearch(event.target.value)}
                    placeholder={`Search ${contextCategory.toLowerCase()}...`}
                    value={contextSearch}
                  />
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
                  <div className="flex flex-col gap-2">
                    {isContextLoading ? (
                      <div className="rounded-lg border border-border/60 bg-card/40 p-4 text-sm text-muted-foreground">
                        Loading hotels...
                      </div>
                    ) : null}
                    {!isContextLoading &&
                      visibleContextItems.map((item) => (
                        <button
                          className="rounded-lg border border-border/60 bg-card/40 p-4 text-left transition-colors hover:border-border hover:bg-card"
                          key={item.id}
                          onClick={() => setSelectedContextItemId(item.id)}
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
                        {contextEmptyMessage}
                      </div>
                    ) : null}
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {contextCategories.map((label) => (
                <button
                  className="group flex min-h-28 flex-col justify-between rounded-lg border border-border/60 bg-card/40 p-4 text-left transition-colors hover:border-border hover:bg-card"
                  key={label}
                  onClick={() => {
                    setContextCategory(label);
                    setContextFilter("All");
                    setContextSearch("");
                    setSelectedContextItemId(null);
                  }}
                  type="button"
                >
                  <div>
                    <div className="text-sm font-medium">{label}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Browse {label.toLowerCase()} records from the world
                      model.
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );

  const artifactPanel = (
    <>
      {sidebarState !== "collapsed" && (
        <div className="flex h-[calc(3.5rem+1px)] shrink-0 items-center justify-between border-b border-border/50 px-4">
          <div className="flex items-center gap-3">
            <div className="flex flex-col gap-0.5">
              <div className="text-sm font-semibold leading-tight tracking-tight">
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
        </div>
      )}
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
              onClick={() => setActiveTab("world-model")}
              type="button"
            >
              <DatabaseIcon className="size-3.5" />
              Context
            </button>
          ) : null}
        </div>
        <button
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
  if (!equal(prevProps.votes, nextProps.votes)) {
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
