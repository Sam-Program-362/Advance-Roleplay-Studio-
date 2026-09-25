import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import RegisterSW from "./register-sw";

export const metadata: Metadata = {
  title: "Roleplay Studio — Advanced AI Character Studio",
  description:
    "Multi-model AI roleplay studio with character creation, lorebooks, memory summarisation and an AI Writer.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#020617",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-slate-950 text-slate-100 antialiased">
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
