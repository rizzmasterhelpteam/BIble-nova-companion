import React from "react";
import { cn } from "../lib/utils";

type Props = {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "left" | "center";
  action?: React.ReactNode;
  className?: string;
};

export default function PageHeader({ eyebrow, title, description, align = "left", action, className }: Props) {
  const isCentered = align === "center";
  return (
    <header
      className={cn(
        "pt-safe pt-4 pr-16",
        isCentered && "px-8 text-center sm:px-12",
        className,
      )}
    >
      {eyebrow && (
        <p className="app-kicker mb-2">
          {eyebrow}
        </p>
      )}
      <div className={cn("flex items-start gap-3 overflow-visible", isCentered && "justify-center")}>
        <h1 className="app-heading pb-2 text-3xl font-normal leading-[1.26] font-serif sm:text-4xl">
          {title}
        </h1>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {description && (
        <p className="app-muted mt-2 text-[15px] font-light leading-relaxed">
          {description}
        </p>
      )}
    </header>
  );
}
