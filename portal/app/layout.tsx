import type { Metadata } from "next";
import { Be_Vietnam_Pro } from "next/font/google";

import "./globals.css";
import { SiteShell } from "../components/site-shell";
import { getSiteUrl } from "../lib/site-url";

const beVietnamPro = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"]
});

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: "CozoroHome Hostel",
    template: "%s | CozoroHome Hostel"
  },
  description: "Automated hostel bunk bed rental in Ho Chi Minh City with prices starting from 70,000 VND/day.",
  icons: {
    icon: [{ url: "/cozorohome-logo.png", type: "image/png" }],
    apple: [{ url: "/cozorohome-logo.png", type: "image/png" }]
  },
  alternates: {
    languages: {
      vi: "/",
      en: "/"
    }
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
      </head>
      <body className={beVietnamPro.className} suppressHydrationWarning>
        <SiteShell>{children}</SiteShell>
      </body>
    </html>
  );
}
