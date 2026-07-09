import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";

export default function VoiceTestLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
        <Link
          className="flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          href="/"
        >
          <ArrowLeftIcon className="size-3.5" />
          Back to chat
        </Link>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
