import { toast } from "sonner";
import { Artifact } from "@/components/chat/create-artifact";
import {
  CopyIcon,
  RedoIcon,
  SparklesIcon,
  UndoIcon,
} from "@/components/chat/icons";
import { ItineraryEditor } from "@/components/chat/itinerary-editor";
import { alisonGoldenItinerary } from "@/lib/itinerary/alison-golden";
import type { JevScores } from "@/lib/itinerary/jev-types";
import {
  parseClientItinerary,
  serializeClientItinerary,
} from "@/lib/itinerary/schema";

type Metadata = {
  jev?: JevScores | null;
};

export const itineraryArtifact = new Artifact<"itinerary", Metadata>({
  kind: "itinerary",
  description:
    "Structured client itinerary with overnight stops, days, and entity-backed activities.",
  initialize: () => null,
  onStreamPart: ({ setArtifact, setMetadata, streamPart }) => {
    if (streamPart.type === "data-itineraryDelta") {
      setArtifact((draftArtifact) => ({
        ...draftArtifact,
        content: streamPart.data,
        isVisible: true,
        status: "streaming",
      }));
    }
    if (streamPart.type === "data-jevScores") {
      setMetadata((current) => ({
        ...(current ?? {}),
        jev: streamPart.data,
      }));
    }
  },
  content: ({
    content,
    onSaveContent,
    status,
    isCurrentVersion,
    sendMessage,
    metadata,
  }) => {
    return (
      <ItineraryEditor
        content={content}
        isCurrentVersion={isCurrentVersion}
        jev={metadata?.jev}
        onSaveContent={onSaveContent}
        sendMessage={sendMessage}
        status={status}
      />
    );
  },
  actions: [
    {
      icon: <UndoIcon size={18} />,
      description: "View Previous version",
      onClick: ({ handleVersionChange }) => {
        handleVersionChange("prev");
      },
      isDisabled: ({ currentVersionIndex }) => currentVersionIndex === 0,
    },
    {
      icon: <RedoIcon size={18} />,
      description: "View Next version",
      onClick: ({ handleVersionChange }) => {
        handleVersionChange("next");
      },
      isDisabled: ({ isCurrentVersion }) => isCurrentVersion,
    },
    {
      icon: <CopyIcon />,
      description: "Copy itinerary JSON",
      onClick: ({ content }) => {
        const parsed = parseClientItinerary(content);
        const text = parsed.ok
          ? serializeClientItinerary(parsed.data)
          : content;
        navigator.clipboard.writeText(text);
        toast.success("Copied itinerary JSON!");
      },
    },
  ],
  toolbar: [
    {
      description: "Load Alison golden fixture",
      icon: <SparklesIcon />,
      onClick: ({ onSaveContent }) => {
        // Apply client-side — do not round-trip through the LLM/allowlist binder.
        onSaveContent(serializeClientItinerary(alisonGoldenItinerary), false);
        toast.success("Loaded Alison golden fixture");
      },
    },
  ],
});
