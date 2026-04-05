import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Process Tool - Process Visio & Manual Generator",
  description: "Generate process diagrams and manuals with AI assistance",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
