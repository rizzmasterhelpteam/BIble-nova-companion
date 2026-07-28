import React from "react";
import appLogo from "../assets/app-logo.png";

type Props = Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src">;

export function AppLogo({ alt = "Bible Nova Companion logo", className, style, ...props }: Props) {
  const logoStyle: React.CSSProperties = {
    objectFit: "contain",
    objectPosition: "center",
    ...style,
  };

  return (
    <img
      src={appLogo}
      alt={alt}
      className={className}
      style={logoStyle}
      draggable={false}
      decoding="async"
      {...props}
    />
  );
}
