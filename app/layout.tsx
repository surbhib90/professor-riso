import type { Metadata } from "next";
import { Bricolage_Grotesque, Instrument_Sans, Courier_Prime } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
});

const instrument = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin"],
});

const courier = Courier_Prime({
  variable: "--font-courier",
  weight: ["400", "700"],
  subsets: ["latin"],
});

const SITE_NAME = "Professor Riso";
const DESCRIPTION =
  "AI video tutor for computer science. Explain a concept in your own words, get tested with a problem you haven't seen, and leave with a hand-drawn zine study guide — built in a fifteen-minute session.";
const KEYWORDS = [
  "AI tutor",
  "AI video tutor",
  "AI teaching assistant",
  "AI education tool",
  "AI study guide generator",
  "computer science tutor online",
  "learn recursion online",
  "active recall study tool",
  "Socratic AI tutor",
  "personalized learning AI",
  "CS101 AI tutor",
  "AI powered learning platform",
];

export const metadata: Metadata = {
  title: {
    default: `${SITE_NAME} — AI Video Tutor for Computer Science`,
    template: `%s | ${SITE_NAME}`,
  },
  description: DESCRIPTION,
  keywords: KEYWORDS,
  openGraph: {
    title: `${SITE_NAME} — AI Video Tutor for Computer Science`,
    description: DESCRIPTION,
    siteName: SITE_NAME,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — AI Video Tutor for Computer Science`,
    description: DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
  },
};

/**
 * Structured data for answer engines (ChatGPT/Perplexity-style AEO) and
 * search rich results — mirrors the visible hero/how-it-works copy, no
 * claims beyond what the page itself states.
 */
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: SITE_NAME,
  description: DESCRIPTION,
  applicationCategory: "EducationalApplication",
  operatingSystem: "Web",
  provider: {
    "@type": "Organization",
    name: SITE_NAME,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${instrument.variable} ${courier.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
        />
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
