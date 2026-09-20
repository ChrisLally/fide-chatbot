import { toast } from "sonner";
import { DownloadIcon, PrinterIcon } from "lucide-react";
import { Artifact } from "@/components/chat/create-artifact";
import { CopyIcon, RedoIcon, UndoIcon } from "@/components/chat/icons";
import { ItineraryEditor } from "@/components/chat/itinerary-editor";
import type { JevScores } from "@/lib/itinerary/jev-types";
import {
  itineraryExportFilename,
  itineraryToPrintHtml,
  parseItineraryForExport,
} from "@/lib/itinerary/print-html";
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
    {
      icon: <PrinterIcon size={18} />,
      description: "Print itinerary",
      onClick: ({ content }) => {
        const itinerary = parseItineraryForExport(content);
        if (!itinerary) {
          toast.error("Could not format this itinerary for print");
          return;
        }
        const popup = window.open("", "_blank");
        if (!popup) {
          toast.error("Allow pop-ups to print, or use Download");
          return;
        }
        popup.document.write(itineraryToPrintHtml(itinerary));
        popup.document.close();
        popup.focus();
        window.setTimeout(() => {
          popup.print();
        }, 250);
      },
    },
    {
      icon: <DownloadIcon size={18} />,
      description: "Download formatted itinerary",
      onClick: ({ content }) => {
        const itinerary = parseItineraryForExport(content);
        if (!itinerary) {
          toast.error("Could not format this itinerary for download");
          return;
        }
        const html = itineraryToPrintHtml(itinerary);
        const blob = new Blob([html], { type: "text/html;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = itineraryExportFilename(itinerary.title, "html");
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast.success("Downloaded formatted itinerary");
      },
    },
  ],
  toolbar: [],
});
