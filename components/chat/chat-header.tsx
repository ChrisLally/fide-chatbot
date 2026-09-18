"use client";

import { DatabaseIcon, PanelLeftIcon } from "lucide-react";
import { memo } from "react";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { VisibilitySelector, type VisibilityType } from "./visibility-selector";

// Relative path — absolute test.fide.work URL is blocked by Cloudflare
// hotlink protection when the page is served from another host (403).
const logoSrc = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/images/catalina-quest-logo-white.png`;

function CatalinaLogo() {
  return (
    <a
      className="flex items-center"
      href="https://www.catalinaquest.ai"
      rel="noopener noreferrer"
      target="_blank"
    >
      {/* Plain img: next/image optimizer returns 400 under demo assetPrefix */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt="Catalina Quest"
        className="h-7 w-auto invert dark:invert-0"
        height={28}
        src={logoSrc}
        width={112}
      />
    </a>
  );
}

function PureChatHeader({
  chatId,
  selectedVisibilityType,
  isReadonly,
  onOpenWorldModel,
}: {
  chatId: string;
  selectedVisibilityType: VisibilityType;
  isReadonly: boolean;
  onOpenWorldModel?: () => void;
}) {
  const { state, toggleSidebar, isMobile } = useSidebar();
  const isCollapsedDesktop = state === "collapsed" && !isMobile;
  const showContextLabel = !isCollapsedDesktop && !isMobile;

  return (
    <header className="sticky top-0 flex h-14 min-w-0 items-center gap-2 bg-sidebar px-3">
      {!isCollapsedDesktop && (
        <Button
          className="shrink-0 md:hidden"
          onClick={toggleSidebar}
          size="icon-sm"
          variant="ghost"
        >
          <PanelLeftIcon className="size-4" />
        </Button>
      )}

      {!isReadonly && !isCollapsedDesktop && (
        <VisibilitySelector
          chatId={chatId}
          className="shrink-0"
          selectedVisibilityType={selectedVisibilityType}
        />
      )}

      <div
        className={cn(
          "min-w-0 shrink",
          !isCollapsedDesktop && "max-sm:hidden"
        )}
      >
        <CatalinaLogo />
      </div>

      {onOpenWorldModel ? (
        <Button
          aria-label="Open context"
          className="ml-auto shrink-0"
          onClick={onOpenWorldModel}
          size={showContextLabel ? "sm" : "icon-sm"}
          variant="ghost"
        >
          <DatabaseIcon className="size-4" />
          {showContextLabel ? (
            <span>Context</span>
          ) : (
            <span className="sr-only">Context</span>
          )}
        </Button>
      ) : null}
    </header>
  );
}

export const ChatHeader = memo(PureChatHeader, (prevProps, nextProps) => {
  return (
    prevProps.chatId === nextProps.chatId &&
    prevProps.selectedVisibilityType === nextProps.selectedVisibilityType &&
    prevProps.isReadonly === nextProps.isReadonly &&
    prevProps.onOpenWorldModel === nextProps.onOpenWorldModel
  );
});
