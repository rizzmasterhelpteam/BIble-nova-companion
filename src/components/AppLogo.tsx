import React from "react";
import appLogo from "../assets/app-logo.png";

type Props = Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src">;

export function AppLogo({ alt = "Bible Nova Companion logo", className, ...props }: Props) {
  return (
    <img
      src={appLogo}
      alt={alt}
      className={className}
      draggable={false}
      decoding="async"
      {...props}
    />
  );
}
