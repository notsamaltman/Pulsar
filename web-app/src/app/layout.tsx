import type { Metadata } from "next";
import { Inter, Manrope, Geist } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { Providers } from "@/components/Providers";
import { AuthGuard } from "@/components/AuthGuard";
import { NavigationProgress } from "@/components/NavigationProgress";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Pulsar | Self-Learning Sales Outreach",
  description: "Automate the complexity of outreach with an engine that learns. Pulsar transforms your pipeline through high-fidelity persona mapping and adaptive communication.",
  icons: {
    // favicon.ico is served via the ASSETS binding (no Worker CPU cost).
    // /logo.png is the fallback for Apple touch and larger icon slots.
    icon: [{ url: "/favicon.ico" }, { url: "/logo.png" }],
    shortcut: "/favicon.ico",
    apple: "/logo.png",
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
      className={cn("dark", "antialiased", inter.variable, manrope.variable, "font-sans", geist.variable)}
    >
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
      </head>
      <body className="bg-background text-on-surface selection:bg-primary/30">
        <Providers>
          <NavigationProgress />
          <AuthGuard>
            {children}
          </AuthGuard>
        </Providers>
      </body>
    </html>
  );
}
