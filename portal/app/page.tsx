import type { Metadata } from "next";
import Script from "next/script";

import { HomeDashboardClient } from "../components/home-dashboard-client";
import { getSiteUrl } from "../lib/site-url";

const siteUrl = getSiteUrl();

export const metadata: Metadata = {
  title: "Cheap Hostel Bunk Bed Rental In Ho Chi Minh City",
  description:
    "CozoroHome offers one of the most automated and cheap hostel bunk bed rentals in Ho Chi Minh City, starting from 70,000 VND/day.",
  alternates: {
    canonical: "/"
  },
  openGraph: {
    title: "Cheap Hostel Bunk Bed Rental In Ho Chi Minh City",
    description:
      "Automated hostel bunk bed rental in Ho Chi Minh City starting from 70,000 VND/day at CozoroHome.",
    url: "/",
    siteName: "CozoroHome Hostel",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: `${siteUrl}/cozorohome-logo.png`,
        width: 1200,
        height: 630,
        alt: "CozoroHome Hostel"
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: "Cheap Hostel Bunk Bed Rental In Ho Chi Minh City",
    description:
      "Automated hostel bunk bed rental in Ho Chi Minh City starting from 70,000 VND/day.",
    images: [`${siteUrl}/cozorohome-logo.png`]
  },
  keywords: [
    "hostel Ho Chi Minh City",
    "cheap hostel Ho Chi Minh City",
    "bunk bed rental Ho Chi Minh City",
    "automated hostel Vietnam",
    "hostel starting from 70000 VND day",
    "CozoroHome hostel"
  ]
};

export default function HomePage() {
  const lodgingJsonLd = {
    "@context": "https://schema.org",
    "@type": "Hostel",
    name: "CozoroHome Hostel",
    url: siteUrl,
    image: `${siteUrl}/cozorohome-logo.png`,
    description:
      "Automated hostel bunk bed rental in Ho Chi Minh City with low-cost stays starting from 70,000 VND/day.",
    address: {
      "@type": "PostalAddress",
      addressLocality: "Ho Chi Minh City",
      addressCountry: "VN"
    },
    areaServed: "Ho Chi Minh City",
    priceRange: "From 70,000 VND/day",
    offers: {
      "@type": "Offer",
      priceCurrency: "VND",
      price: "70000",
      availability: "https://schema.org/InStock",
      url: siteUrl
    }
  };

  return (
    <>
      <Script
        id="cozorohome-hostel-jsonld"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(lodgingJsonLd) }}
      />
      <HomeDashboardClient />
    </>
  );
}
