"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { AnimatedSection, Beams, TextReveal } from "@/components";

export default function TermsPage() {
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
              key="terms-beams"
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
            text="Terms of Service"
            className="text-4xl sm:text-6xl md:text-7xl font-bold tracking-tighter leading-[1.08] text-white max-w-4xl mb-5 sm:mb-6 font-headline"
          />
          <p className="text-base sm:text-lg text-on-surface-variant max-w-xl leading-relaxed font-light">
            Please read these terms carefully before using Pulsar. By accessing or using our service, you agree to be bound by these terms.
          </p>
        </div>
      </section>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-6 py-16 space-y-12">

        <AnimatedSection delay={0}>
          <p className="text-xs text-on-surface-variant mb-8">Last updated: October 2026</p>

          <h2 className="text-2xl font-medium text-white mb-4">1. Acceptance of Terms</h2>
          <p className="text-on-surface-variant text-sm leading-relaxed">
            By accessing or using Pulsar (&quot;the Service&quot;), you confirm that you are at least 18 years of age, have read and understood these Terms of Service, and agree to be legally bound by them. If you are accessing the Service on behalf of an organization, you represent that you have the authority to bind that organization to these terms. If you do not agree to any part of these terms, you must discontinue use of the Service immediately.
          </p>
        </AnimatedSection>

        <AnimatedSection delay={0.05}>
          <h2 className="text-2xl font-medium text-white mb-4">2. Description of Service</h2>
          <p className="text-on-surface-variant text-sm leading-relaxed">
            Pulsar is an AI-powered autonomous agent platform designed to assist B2B sales teams with lead discovery and personalized outreach. The Service operates across social and professional platforms including Instagram, YouTube, and Product Hunt, identifying potential business customers and initiating tailored contact on your behalf.
          </p>
          <p className="text-on-surface-variant text-sm leading-relaxed mt-4">
            Pulsar is offered under two tiers:
          </p>
          <ul className="mt-3 space-y-2">
            <li className="text-on-surface-variant text-sm leading-relaxed flex gap-2">
              <span className="text-white font-medium shrink-0">Free Tier —</span>
              <span>Limited daily executions including one job run, one company profile creation, and one master-agent campaign per day. Standard queue processing speed. Available at no cost.</span>
            </li>
            <li className="text-on-surface-variant text-sm leading-relaxed flex gap-2">
              <span className="text-white font-medium shrink-0">Elite Tier —</span>
              <span>Unlimited job executions, unlimited company profile creations, unlimited master-agent campaigns, and priority queue processing. Pricing is available on request by contacting the admin directly.</span>
            </li>
          </ul>
          <p className="text-on-surface-variant text-sm leading-relaxed mt-4">
            Features, limits, and tier availability are subject to change at our discretion with reasonable notice.
          </p>
        </AnimatedSection>

        <AnimatedSection delay={0.1}>
          <h2 className="text-2xl font-medium text-white mb-4">3. User Responsibilities</h2>
          <p className="text-on-surface-variant text-sm leading-relaxed">
            You are solely responsible for all activity conducted through your Pulsar account. By using the Service, you agree to:
          </p>
          <ul className="mt-3 space-y-2 list-disc list-inside marker:text-white/30">
            <li className="text-on-surface-variant text-sm leading-relaxed">Not use the Service to send unsolicited bulk messages, spam, or any communication that violates applicable anti-spam legislation including CAN-SPAM, CASL, or GDPR.</li>
            <li className="text-on-surface-variant text-sm leading-relaxed">Comply fully with the Terms of Service and community guidelines of all third-party platforms that Pulsar operates on, including Instagram, YouTube, and Product Hunt.</li>
            <li className="text-on-surface-variant text-sm leading-relaxed">Not use the Service for any unlawful purpose, including harassment, impersonation, or fraudulent misrepresentation.</li>
            <li className="text-on-surface-variant text-sm leading-relaxed">Maintain the confidentiality of your account credentials and immediately notify us of any unauthorized access.</li>
            <li className="text-on-surface-variant text-sm leading-relaxed">Ensure that any data or content you provide through the Service does not infringe the intellectual property or privacy rights of any third party.</li>
          </ul>
          <p className="text-on-surface-variant text-sm leading-relaxed mt-4">
            Pulsar reserves the right to suspend or terminate accounts that violate these responsibilities without prior notice.
          </p>
        </AnimatedSection>

        <AnimatedSection delay={0.15}>
          <h2 className="text-2xl font-medium text-white mb-4">4. Intellectual Property</h2>
          <p className="text-on-surface-variant text-sm leading-relaxed">
            All content, software, algorithms, models, interfaces, and materials comprising the Pulsar platform are the exclusive intellectual property of Pulsar and its licensors, protected under applicable copyright, trademark, and trade secret law. You are granted a limited, non-exclusive, non-transferable, revocable license to access and use the Service solely for your internal business purposes in accordance with these terms.
          </p>
          <p className="text-on-surface-variant text-sm leading-relaxed mt-4">
            You retain ownership of any content, data, or materials you submit to the Service. By submitting such content, you grant Pulsar a non-exclusive, worldwide, royalty-free license to process and use that content solely to provide and improve the Service. You must not reproduce, distribute, modify, reverse-engineer, or create derivative works from any part of the Pulsar platform without our express written consent.
          </p>
        </AnimatedSection>

        <AnimatedSection delay={0.2}>
          <h2 className="text-2xl font-medium text-white mb-4">5. Limitation of Liability</h2>
          <p className="text-on-surface-variant text-sm leading-relaxed">
            To the maximum extent permitted by applicable law, Pulsar and its officers, directors, employees, and affiliates shall not be liable for any indirect, incidental, special, consequential, or punitive damages — including but not limited to loss of profits, loss of data, loss of goodwill, or business interruption — arising from your use of or inability to use the Service, even if we have been advised of the possibility of such damages.
          </p>
          <p className="text-on-surface-variant text-sm leading-relaxed mt-4">
            The Service is provided &quot;as is&quot; and &quot;as available&quot; without warranties of any kind, either express or implied, including but not limited to implied warranties of merchantability, fitness for a particular purpose, or non-infringement. We do not warrant that the Service will be uninterrupted, error-free, or that any defects will be corrected. Your use of the Service is entirely at your own risk.
          </p>
        </AnimatedSection>

        <AnimatedSection delay={0.25}>
          <h2 className="text-2xl font-medium text-white mb-4">6. Termination</h2>
          <p className="text-on-surface-variant text-sm leading-relaxed">
            You may terminate your account at any time by ceasing to use the Service and contacting us at panwalkarsoham@gmail.com. Pulsar reserves the right to suspend or permanently terminate your access to the Service at any time, with or without cause, and with or without notice, including in cases where we believe you have violated these Terms of Service or applicable law.
          </p>
          <p className="text-on-surface-variant text-sm leading-relaxed mt-4">
            Upon termination, your right to use the Service will immediately cease. Provisions of these terms that by their nature should survive termination — including intellectual property rights, limitation of liability, and dispute resolution — will remain in full effect.
          </p>
        </AnimatedSection>

        <AnimatedSection delay={0.3}>
          <h2 className="text-2xl font-medium text-white mb-4">7. Changes to Terms</h2>
          <p className="text-on-surface-variant text-sm leading-relaxed">
            We reserve the right to modify these Terms of Service at any time. When we make material changes, we will update the &quot;Last updated&quot; date at the top of this page and, where appropriate, notify users via email or an in-product notice. Your continued use of the Service after any such changes constitutes your acceptance of the revised terms. We encourage you to review these terms periodically to stay informed of your rights and obligations.
          </p>
        </AnimatedSection>

        <AnimatedSection delay={0.35}>
          <h2 className="text-2xl font-medium text-white mb-4">8. Contact</h2>
          <p className="text-on-surface-variant text-sm leading-relaxed">
            If you have any questions, concerns, or requests relating to these Terms of Service, please contact us at:
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
            We aim to respond to all inquiries within 2 business days.
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
