import type { Metadata } from "next";
import { Inter, Manrope, Geist } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

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
      <body className="bg-background text-on-surface selection:bg-primary/30">
        {children}
      </body>
    </html>
  );
}
