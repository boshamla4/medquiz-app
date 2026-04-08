import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MedQuiz",
  description: "QCM exam platform for medical students",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">
        <div className="flex flex-1 flex-col">{children}</div>
        <footer className="border-t border-gray-200 bg-white px-4 py-3 text-center text-xs text-gray-500">
          Built by Aladin B. © 2026. All rights reserved.
        </footer>
      </body>
    </html>
  );
}
