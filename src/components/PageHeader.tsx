import React from "react";
import { cn } from "../lib/utils";
import { useMobileViewport } from "../context/MobileViewportContext";

type Props = {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "left" | "center";
  action?: React.ReactNode;
  className?: string;
  compact?: boolean | "auto";
};

export default function PageHeader({
  eyebrow,
  title,
  description,
  align = "left",
  action,
  className,
  compact = "auto",
}: Props) {
  const { isCompactPhone, isShortPhone } = useMobileViewport();
  const isCentered = align === "center";
  const shouldCompact =
    compact === true || (compact === "auto" && (isCompactPhone || isShortPhone));

  return (
    <header
      className={cn(
        "pt-safe pr-16",
        shouldCompact ? "pt-3" : "pt-4",
        isCentered && (shouldCompact ? "px-5 text-center sm:px-10" : "px-8 text-center sm:px-12"),
        className,
      )}
    >
      {eyebrow && (
        <p className={cn("app-kicker", shouldCompact ? "mb-1.5" : "mb-2")}>
          {eyebrow}
        </p>
      )}
      <div className={cn("flex items-start gap-3 overflow-visible", isCentered && "justify-center")}>
        <h1
          className={cn(
            "app-heading pb-2 font-serif font-normal leading-[1.22]",
            shouldCompact ? "text-[2rem] sm:text-[2.35rem]" : "text-3xl sm:text-4xl",
          )}
        >
          {title}
        </h1>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {description && (
        <p
          className={cn(
            "app-muted font-light leading-relaxed",
            shouldCompact ? "mt-1.5 text-[14px]" : "mt-2 text-[15px]",
          )}
        >
          {description}
        </p>
      )}
    </header>
  );
}
