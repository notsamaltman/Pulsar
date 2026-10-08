"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { AnimatedSection, Beams, TextReveal } from "@/components";

export default function PrivacyPage() {
  const [isMounted, setIsMounted] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  return (
    <div className="relative min-h-screen bg-background text-white selection:bg-primary/30">
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl border-b border-white/5 transition-all duration-300">
        <div className="flex justify-between items-center w-full px-4 sm:px-8 py-4 max-w-7xl mx-auto">
          <div className="flex items-center gap-8 md:gap-12">
            <Link href="/" className="flex items-center gap-3 text-xl font-bold tracking-tight text-white group">
              <div className="w-8 h-8 flex items-center justify-center overflow-hidden rounded-md bg-white/5 shadow-[0_0_15px_rgba(196,192,255,0.1)] transition-transform group-hover:scale-105">
                <img src="/logo.png" className="w-full h-full object-cover" alt="Pulsar" />
              </div>
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70">Pulsar</span>
            </Link>
            <div className="hidden md:flex items-center gap-8 text-sm font-medium">
              <Link href="/#solution" className="text-on-surface-variant hover:text-white transition-colors">Platform</Link>
              <Link href="/#features" className="text-on-surface-variant hover:text-white transition-colors">Solutions</Link>
              <Link href="/#pricing" className="text-on-surface-variant hover:text-white transition-colors">Pricing</Link>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-4">
            <Link href="/login">
              <button className="px-5 py-2 text-sm font-medium bg-white text-black rounded-lg hover:bg-gray-200 transition-colors shadow-[0_0_20px_rgba(255,255,255,0.15)] hover:shadow-[0_0_25px_rgba(255,255,255,0.25)]">
                Get Started
              </button>
            </Link>
          </div>
          {/* Mobile menu trigger */}
          <div className="md:hidden flex items-center gap-3">
            <Link href="/login">
              <button className="px-3.5 py-1.5 text-xs font-semibold bg-white text-black rounded-lg">
                Start
              </button>
            </Link>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-lg bg-white/5 border border-white/10 text-white hover:bg-white/10 transition-colors"
              aria-label="Toggle mobile menu"
            >
              {mobileMenuOpen ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
              )}
            </button>
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-white/10 bg-[#0E0E10]/95 backdrop-blur-2xl px-6 py-6 space-y-4 animate-in slide-in-from-top-2 duration-200">
            <div className="flex flex-col gap-4 text-base font-medium text-slate-300">
              <Link href="/#solution" onClick={() => setMobileMenuOpen(false)} className="hover:text-white py-1">Platform</Link>
              <Link href="/#features" onClick={() => setMobileMenuOpen(false)} className="hover:text-white py-1">Solutions</Link>
              <Link href="/#pricing" onClick={() => setMobileMenuOpen(false)} className="hover:text-white py-1">Pricing</Link>
              <div className="pt-2 border-t border-white/10">
                <Link href="/login" onClick={() => setMobileMenuOpen(false)}>
                  <button className="w-full py-3 text-sm font-semibold bg-white text-black rounded-xl hover:bg-gray-200 transition-colors text-center">
                    Get Started Now
                  </button>
                </Link>
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* Hero Section */}
      <section className="relative min-h-[50vh] flex flex-col justify-center overflow-hidden pt-24 pb-14">
        <div className="absolute inset-0 pointer-events-none">
          {isMounted && (
            <Beams
              key="privacy-beams"
              beamWidth={3}
              beamHeight={35}
              beamNumber={30}
              lightColor="#c4c0ff"
              speed={3.5}
              noiseIntensity={2.5}
              scale={0.18}
              rotation={45}
            />
          )}
        </div>
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-8 w-full flex flex-col items-start text-left">
          <TextReveal
            text="Privacy Policy"
            className="text-4xl sm:text-6xl md:text-7xl font-bold tracking-tighter leading-[1.08] text-white max-w-4xl mb-5 sm:mb-6 font-headline"
          />
          <p className="text-base sm:text-lg text-on-surface-variant max-w-xl leading-relaxed font-light">
            Your privacy matters. This policy explains what data we collect, how we use it, and the choices you have.
          </p>
        </div>
      </section>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-6 py-16 space-y-12">

        <AnimatedSection delay={0}>
          <p className="text-xs text-on-surface-variant mb-8">Last updated: October 2026</p>

          <h2 className="text-2xl font-medium text-white mb-4">1. Information We Collect</h2>
          <p className="text-on-surface-variant text-sm leading-relaxed">
            We collect information you provide directly when you create an account and use the Service, as well as information generated automatically through your interactions with the platform. Specifically, we collect:
          </p>
          <ul className="mt-3 space-y-2 list-disc list-inside marker:text-white/30">
            <li className="text-on-surface-variant text-sm leading-relaxed">
              <span className="text-white font-medium">Account information</span> — your name, email address, and any profile details you provide during registration.
            </li>
            <li className="text-on-surface-variant text-sm leading-relaxed">
              <span className="text-white font-medium">Usage data</span> — details about the campaigns you create, the platforms you target, outreach volume, response rates, job execution logs, and interactions with the Pulsar dashboard.
            </li>
            <li className="text-on-surface-variant text-sm leading-relaxed">
              <span className="text-white font-medium">Platform credentials</span> — connection tokens or access credentials for third-party platforms (Instagram, YouTube, Product Hunt) that you authorize Pulsar to operate on your behalf. These are stored encrypted and used exclusively to execute outreach on your instruction.
            </li>
            <li className="text-on-surface-variant text-sm leading-relaxed">
              <span className="text-white font-medium">Technical data</span> — IP address, browser type, device information, and session timestamps collected automatically for security and service optimization purposes.
            </li>
          </ul>
        </AnimatedSection>

        <AnimatedSection delay={0.05}>
          <h2 className="text-2xl font-medium text-white mb-4">2. How We Use Your Information</h2>
          <p className="text-on-surface-variant text-sm leading-relaxed">
            The information we collect is used to:
          </p>
          <ul className="mt-3 space-y-2 list-disc list-inside marker:text-white/30">
            <li className="text-on-surface-variant text-sm leading-relaxed">Power and operate the Pulsar AI agent, including executing lead discovery, outreach campaigns, follow-up sequences, and daily sales reports on your behalf.</li>
            <li className="text-on-surface-variant text-sm leading-relaxed">Personalize the Service to your business context — including adapting messaging tone, target audience criteria, and platform behavior based on prior campaign performance.</li>
            <li className="text-on-surface-variant text-sm leading-relaxed">Authenticate your identity and protect your account from unauthorized access.</li>
            <li className="text-on-surface-variant text-sm leading-relaxed">Communicate with you about your account, updates to the Service, and responses to your support inquiries.</li>
            <li className="text-on-surface-variant text-sm leading-relaxed">Analyze aggregate usage patterns to improve the reliability, performance, and features of the platform.</li>
            <li className="text-on-surface-variant text-sm leading-relaxed">Comply with applicable legal obligations and enforce our Terms of Service.</li>
          </ul>
        </AnimatedSection>

        <AnimatedSection delay={0.1}>
          <h2 className="text-2xl font-medium text-white mb-4">3. Data Sharing</h2>
          <p className="text-on-surface-variant text-sm leading-relaxed">
            We do not sell, rent, or trade your personal information to third parties. We may share your data only in the following limited circumstances:
          </p>
          <ul className="mt-3 space-y-2 list-disc list-inside marker:text-white/30">
            <li className="text-on-surface-variant text-sm leading-relaxed">
              <span className="text-white font-medium">AI service providers</span> — to power the intelligent outreach and personalization features of Pulsar, your data (including outreach content and target context) may be processed by third-party AI providers such as OpenAI. These providers process data strictly as data processors under our instructions and are contractually prohibited from using your data for their own purposes.
            </li>
            <li className="text-on-surface-variant text-sm leading-relaxed">
              <span className="text-white font-medium">Infrastructure providers</span> — cloud hosting, database, and monitoring services that store or process data on our behalf under strict confidentiality agreements.
            </li>
            <li className="text-on-surface-variant text-sm leading-relaxed">
              <span className="text-white font-medium">Legal compliance</span> — if required by law, court order, or governmental authority, or to protect the rights, property, or safety of Pulsar, its users, or the public.
            </li>
            <li className="text-on-surface-variant text-sm leading-relaxed">
              <span className="text-white font-medium">Business transfers</span> — in the event of a merger, acquisition, or sale of assets, your data may be transferred to the acquiring entity, subject to the same privacy protections.
            </li>
          </ul>
        </AnimatedSection>

        <AnimatedSection delay={0.15}>
          <h2 className="text-2xl font-medium text-white mb-4">4. Data Retention</h2>
          <p className="text-on-surface-variant text-sm leading-relaxed">
            We retain your personal data for as long as your account remains active or as needed to provide the Service. If you close your account, we will delete or anonymize your personal information within 90 days, except where we are required to retain certain records by law (for example, for tax, legal, or fraud prevention purposes).
          </p>
          <p className="text-on-surface-variant text-sm leading-relaxed mt-4">
            Campaign logs and usage analytics may be retained in anonymized, aggregated form indefinitely for the purpose of improving the Service. Anonymized data cannot be used to identify you.
          </p>
        </AnimatedSection>

        <AnimatedSection delay={0.2}>
          <h2 className="text-2xl font-medium text-white mb-4">5. Your Rights</h2>
          <p className="text-on-surface-variant text-sm leading-relaxed">
            Depending on your jurisdiction, you may have the following rights with respect to your personal data:
          </p>
          <ul className="mt-3 space-y-2 list-disc list-inside marker:text-white/30">
            <li className="text-on-surface-variant text-sm leading-relaxed"><span className="text-white font-medium">Access</span> — request a copy of the personal data we hold about you.</li>
            <li className="text-on-surface-variant text-sm leading-relaxed"><span className="text-white font-medium">Correction</span> — request that we correct inaccurate or incomplete data.</li>
            <li className="text-on-surface-variant text-sm leading-relaxed"><span className="text-white font-medium">Deletion</span> — request that we delete your personal data, subject to legal retention requirements.</li>
            <li className="text-on-surface-variant text-sm leading-relaxed"><span className="text-white font-medium">Portability</span> — request a machine-readable export of your data.</li>
            <li className="text-on-surface-variant text-sm leading-relaxed"><span className="text-white font-medium">Objection</span> — object to certain processing activities, including direct marketing.</li>
            <li className="text-on-surface-variant text-sm leading-relaxed"><span className="text-white font-medium">Restriction</span> — request that we restrict processing of your data in certain circumstances.</li>
          </ul>
          <p className="text-on-surface-variant text-sm leading-relaxed mt-4">
            To exercise any of these rights, contact us at panwalkarsoham@gmail.com. We will respond within 30 days.
          </p>
        </AnimatedSection>

        <AnimatedSection delay={0.25}>
          <h2 className="text-2xl font-medium text-white mb-4">6. Security Measures</h2>
          <p className="text-on-surface-variant text-sm leading-relaxed">
            We take the security of your data seriously. Pulsar implements industry-standard technical and organizational measures to protect your information against unauthorized access, disclosure, alteration, or destruction. These measures include encryption of data at rest and in transit, access controls limiting data access to authorized personnel only, regular security reviews, and secure credential storage for third-party platform tokens.
          </p>
          <p className="text-on-surface-variant text-sm leading-relaxed mt-4">
            Despite these precautions, no method of transmission over the internet or electronic storage is completely secure. We cannot guarantee absolute security, and you use the Service at your own risk. If you believe your account has been compromised, please contact us immediately.
          </p>
        </AnimatedSection>

        <AnimatedSection delay={0.3}>
          <h2 className="text-2xl font-medium text-white mb-4">7. Cookies</h2>
          <p className="text-on-surface-variant text-sm leading-relaxed">
            Pulsar uses cookies and similar tracking technologies to maintain your session, remember your preferences, and analyze how the Service is used. Specifically:
          </p>
          <ul className="mt-3 space-y-2 list-disc list-inside marker:text-white/30">
            <li className="text-on-surface-variant text-sm leading-relaxed"><span className="text-white font-medium">Session cookies</span> — essential for authentication and keeping you logged in during a session. These expire when you close your browser.</li>
            <li className="text-on-surface-variant text-sm leading-relaxed"><span className="text-white font-medium">Persistent cookies</span> — used to remember your preferences across sessions (for example, login state). These expire after a set period.</li>
            <li className="text-on-surface-variant text-sm leading-relaxed"><span className="text-white font-medium">Analytics cookies</span> — used in aggregate, anonymized form to understand usage patterns and improve the platform.</li>
          </ul>
          <p className="text-on-surface-variant text-sm leading-relaxed mt-4">
            You can control cookie behavior through your browser settings. Disabling essential cookies may affect the functionality of the Service.
          </p>
        </AnimatedSection>

        <AnimatedSection delay={0.35}>
          <h2 className="text-2xl font-medium text-white mb-4">8. Contact</h2>
          <p className="text-on-surface-variant text-sm leading-relaxed">
            If you have any questions, concerns, or requests regarding this Privacy Policy or how we handle your data, please reach out to us at:
          </p>
          <p className="mt-3 text-sm">
            <a
              href="mailto:panwalkarsoham@gmail.com"
              className="text-primary hover:text-white transition-colors underline underline-offset-4"
            >
              panwalkarsoham@gmail.com
            </a>
          </p>
          <p className="text-on-surface-variant text-sm leading-relaxed mt-3">
            We aim to respond to all privacy-related inquiries within 2 business days.
          </p>
        </AnimatedSection>

      </main>

      {/* Footer */}
      <footer className="py-6 sm:py-12 px-6 sm:px-8 bg-background border-t border-white/5">
        <div className="max-w-7xl mx-auto flex flex-col items-center gap-3 sm:gap-4">
          <div className="flex items-center gap-3 text-xs sm:text-sm">
            <Link href="/terms" className="text-on-surface-variant hover:text-white transition-colors">Terms of Service</Link>
            <span className="text-on-surface-variant">·</span>
            <Link href="/privacy" className="text-on-surface-variant hover:text-white transition-colors">Privacy Policy</Link>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center overflow-hidden rounded-md bg-white/5">
              <img src="/logo.png" className="w-full h-full object-cover" alt="Pulsar" />
            </div>
            <span className="text-lg sm:text-xl font-bold tracking-tight text-white">Pulsar</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
