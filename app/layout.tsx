import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Kageflow", template: "%s · Kageflow" },
  description: "Dealer management software for Southern African car dealers",
  // the app is private: search engines should only index the marketing site at www.kageflow.co.za
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-ZA">
      <body>{children}</body>
    </html>
  );
}
