import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "血紅蛋白圖譜台 Hb Pattern Bench",
  description:
    "Decision support for Bio-Rad Variant II HPLC and Sebia Capillarys haemoglobin patterns. Not a diagnostic device.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-HK">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,500;6..72,600&family=Noto+Sans+HK:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
