"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { AnimatedSection, SpotlightCard, ContactAdminModal } from "@/components";
import { 
  TimerOff, 
  ShieldAlert,
  Bot,
  Zap,
  MessageSquare,
  BarChart3,
  ArrowRight,
  Sparkles
} from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";

// Heavy animation components — only loaded on the client, never SSR'd.
// This keeps them out of the Workers SSR bundle entirely.
const Beams = dynamic(() => import("@/components").then(m => ({ default: m.Beams })), { ssr: false });
const TextReveal = dynamic(() => import("@/components").then(m => ({ default: m.TextReveal })), { ssr: false });

export default function Home() {
  const { status } = useSession();
  const router = useRouter();
  const [isMounted, setIsMounted] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    if (status === "authenticated") {
      router.push("/dashboard");
    }
  }, [status, router]);

  return (
    <div className="relative min-h-screen selection:bg-primary/30">
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
              <Link href="#solution" className="text-on-surface-variant hover:text-white transition-colors">Platform</Link>
              <Link href="#features" className="text-on-surface-variant hover:text-white transition-colors">Solutions</Link>
              <Link href="#pricing" className="text-on-surface-variant hover:text-white transition-colors">Pricing</Link>
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
              <Link href="#solution" onClick={() => setMobileMenuOpen(false)} className="hover:text-white py-1">Platform</Link>
              <Link href="#features" onClick={() => setMobileMenuOpen(false)} className="hover:text-white py-1">Solutions</Link>
              <Link href="#pricing" onClick={() => setMobileMenuOpen(false)} className="hover:text-white py-1">Pricing</Link>
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

      <main>
        {/* Hero Section */}
        <section className="relative min-h-[75vh] sm:min-h-screen flex flex-col justify-center overflow-hidden pt-24 sm:pt-28 pb-14 sm:pb-20">
          <div className="absolute inset-0 pointer-events-none">
            {isMounted && (
              <Beams
                key="hero-beams"
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
              text="Self-learning personalized sales outreach." 
              className="text-4xl sm:text-6xl md:text-8xl font-bold tracking-tighter leading-[1.08] text-white max-w-5xl mb-5 sm:mb-8 font-headline"
            />
            
            <motion.p 
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              className="text-base sm:text-lg md:text-xl text-on-surface-variant max-w-2xl leading-relaxed font-light mb-8 sm:mb-12 text-left"
            >
              Stop spending hours finding leads. Pulsar finds new business opportunities and sends personalized messages for you, automatically.
            </motion.p>
            
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.6 }}
              className="flex flex-row gap-3 sm:gap-4 items-center w-full sm:w-auto"
            >
              <Link href="/login" className="flex-1 sm:flex-none">
                <button className="w-full sm:w-auto group relative px-4 sm:px-8 py-3.5 sm:py-4 bg-white text-black font-semibold text-xs sm:text-base rounded-xl overflow-hidden shadow-[0_0_40px_rgba(255,255,255,0.2)] hover:shadow-[0_0_60px_rgba(196,192,255,0.4)] transition-all duration-300 flex items-center justify-center">
                  <span className="relative z-10 flex items-center gap-1.5 sm:gap-2 whitespace-nowrap">
                    Start automating <ArrowRight className="w-3.5 h-3.5 sm:w-4 sm:h-4 group-hover:translate-x-1 transition-transform" />
                  </span>
                  <div className="absolute inset-0 bg-primary opacity-0 group-hover:opacity-20 transition-opacity duration-300" />
                </button>
              </Link>
              <Link href="#solution" className="flex-1 sm:flex-none">
                <button className="w-full sm:w-auto px-4 sm:px-8 py-3.5 sm:py-4 bg-white/5 text-white font-medium text-xs sm:text-base rounded-xl border border-white/10 hover:bg-white/10 backdrop-blur-sm transition-all duration-300 text-center whitespace-nowrap">
                  How it works
                </button>
              </Link>
            </motion.div>

          </div>
        </section>

        {/* Dynamic Bento Box Features */}
        <section id="features" className="py-14 sm:py-24 px-6 sm:px-8 relative">
          <div className="max-w-7xl mx-auto">
            <AnimatedSection>
              <h2 className="text-3xl md:text-5xl font-medium tracking-tight text-white leading-tight mb-3 sm:mb-4 text-center">
                Built for the modern <br className="hidden sm:inline"/>sales ecosystem.
              </h2>
              <p className="text-center text-on-surface-variant text-xs sm:text-base max-w-2xl mx-auto mb-8 sm:mb-16 px-4">
                Traditional sales is slow and tiring. Pulsar handles the boring work of finding people and starting conversations, so you can focus on closing deals.
              </p>
            </AnimatedSection>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 max-w-6xl mx-auto">
              {/* Feature 1 */}
              <AnimatedSection delay={0.1} className="md:col-span-2">
                <SpotlightCard className="h-full p-6 sm:p-8 rounded-2xl sm:rounded-[2rem] bg-surface-container-low/50 border border-white/5 backdrop-blur-sm group">
                  <div className="flex flex-col h-full justify-between">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-primary/10 flex items-center justify-center mb-4 sm:mb-16 border border-primary/20 shrink-0">
                      <Zap className="text-primary w-5 h-5 sm:w-6 sm:h-6" />
                    </div>
                    <div>
                      <h3 className="text-xl sm:text-2xl font-medium text-white mb-2 sm:mb-3 tracking-tight">The Volume Trap</h3>
                      <p className="text-on-surface-variant text-xs sm:text-sm leading-relaxed max-w-md">
                        Spending 70% of your day on manual prospecting yields diminishing returns in a noise-saturated market. Pulsar processes thousands of data points instantly.
                      </p>
                    </div>
                  </div>
                </SpotlightCard>
              </AnimatedSection>

              {/* Feature 2 */}
              <AnimatedSection delay={0.2} className="md:col-span-1">
                <SpotlightCard className="h-full p-6 sm:p-8 rounded-2xl sm:rounded-[2rem] bg-surface-container-low/50 border border-white/5 backdrop-blur-sm group">
                  <div className="flex flex-col h-full justify-between">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-white/5 flex items-center justify-center mb-4 sm:mb-16 border border-white/10 shrink-0">
                      <ShieldAlert className="text-white w-5 h-5 sm:w-6 sm:h-6" />
                    </div>
                    <div>
                      <h3 className="text-lg sm:text-xl font-medium text-white mb-2 sm:mb-3 tracking-tight">Static Messaging</h3>
                      <p className="text-on-surface-variant text-xs sm:text-sm leading-relaxed">
                        Generic templates are filtered out. Context is no longer optional—it is the absolute requirement for conversion.
                      </p>
                    </div>
                  </div>
                </SpotlightCard>
              </AnimatedSection>

              {/* Feature 3 */}
              <AnimatedSection delay={0.3} className="md:col-span-1">
                <SpotlightCard className="h-full p-6 sm:p-8 rounded-2xl sm:rounded-[2rem] bg-surface-container-low/50 border border-white/5 backdrop-blur-sm group">
                  <div className="flex flex-col h-full justify-between">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-white/5 flex items-center justify-center mb-4 sm:mb-16 border border-white/10 shrink-0">
                      <TimerOff className="text-white w-5 h-5 sm:w-6 sm:h-6" />
                    </div>
                    <div>
                      <h3 className="text-lg sm:text-xl font-medium text-white mb-2 sm:mb-3 tracking-tight">Wasted Hours</h3>
                      <p className="text-on-surface-variant text-xs sm:text-sm leading-relaxed">
                        Your time is your most valuable asset. Stop hunting and start negotiating.
                      </p>
                    </div>
                  </div>
                </SpotlightCard>
              </AnimatedSection>

              {/* Feature 4 */}
              <AnimatedSection delay={0.4} className="md:col-span-2">
                <SpotlightCard className="h-full p-6 sm:p-8 rounded-2xl sm:rounded-[2rem] bg-primary/5 border border-primary/20 backdrop-blur-sm group relative overflow-hidden">
                  <div className="absolute right-0 top-0 w-64 h-64 bg-primary/20 rounded-full blur-[80px]" />
                  <div className="relative z-10 flex flex-col h-full justify-between">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-primary/20 flex items-center justify-center mb-4 sm:mb-16 border border-primary/30 shrink-0">
                      <Bot className="text-primary w-5 h-5 sm:w-6 sm:h-6" />
                    </div>
                    <div>
                      <h3 className="text-xl sm:text-2xl font-medium text-white mb-2 sm:mb-3 tracking-tight">Autonomous Agent</h3>
                      <p className="text-on-surface-variant text-xs sm:text-sm leading-relaxed max-w-md">
                        A self-directing system that learns from every interaction. It adapts its approach, refines its targeting, and optimizes its messaging without human intervention.
                      </p>
                    </div>
                  </div>
                </SpotlightCard>
              </AnimatedSection>
            </div>
          </div>
        </section>

        {/* Solutions Deep Dive */}
        <section id="solution" className="py-12 sm:py-24 px-6 sm:px-8 border-y border-white/5 bg-[#0a0a0c]">
          <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-8 lg:gap-16 items-center">
            <div className="space-y-6 sm:space-y-12">
              <AnimatedSection>
                <h2 className="text-3xl md:text-5xl font-medium text-white tracking-tight leading-tight">
                  Intelligent tooling <br className="hidden sm:inline"/>for impossible growth.
                </h2>
              </AnimatedSection>
              
              <div className="space-y-3 sm:space-y-6">
                {[
                  { icon: <Bot className="w-4 h-4 sm:w-5 sm:h-5 text-primary"/>, title: "Automatic Lead Finding", desc: "Crawls the web to find new customers in your specific industry automatically every single day.", delay: 0.1 },
                  { icon: <MessageSquare className="w-4 h-4 sm:w-5 sm:h-5 text-primary"/>, title: "Smart Follow-ups", desc: "Connect with buyers instantly with hyper-personalized context.", delay: 0.2 },
                  { icon: <BarChart3 className="w-4 h-4 sm:w-5 sm:h-5 text-primary"/>, title: "Daily Sales Reports", desc: "Get simple, actionable updates directly on your phone about how your pipeline is growing.", delay: 0.3 }
                ].map((item, i) => (
                  <AnimatedSection key={i} delay={item.delay}>
                    <div className="group flex gap-4 sm:gap-6 p-5 sm:p-6 rounded-2xl sm:rounded-3xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-primary/30 transition-all duration-300 items-start">
                      <div className="w-9 h-9 sm:w-12 sm:h-12 rounded-full bg-surface-container-low flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform shadow-[0_0_15px_rgba(0,0,0,0.5)] mt-0.5">
                        {item.icon}
                      </div>
                      <div>
                        <h4 className="text-white font-medium text-base sm:text-lg tracking-tight mb-0.5 sm:mb-1">{item.title}</h4>
                        <p className="text-on-surface-variant text-xs sm:text-sm leading-relaxed">{item.desc}</p>
                      </div>
                    </div>
                  </AnimatedSection>
                ))}
              </div>
            </div>
            
            <AnimatedSection delay={0.4} className="h-[220px] sm:h-[600px] w-full rounded-2xl sm:rounded-[2.5rem] bg-gradient-to-b from-surface-container-low to-background border border-white/10 flex items-center justify-center relative overflow-hidden shadow-2xl">
              {/* Decorative dynamic glows */}
              <div className="absolute top-1/4 left-1/4 w-32 sm:w-40 h-32 sm:h-40 bg-primary/30 rounded-full blur-[80px] sm:blur-[100px] animate-pulse" />
              <div className="absolute bottom-1/4 right-1/4 w-40 sm:w-60 h-40 sm:h-60 bg-blue-500/20 rounded-full blur-[90px] sm:blur-[120px] animate-pulse" style={{ animationDelay: '1s' }} />
              
              <div className="text-center space-y-2 sm:space-y-4 p-6 sm:p-12 relative z-10 backdrop-blur-sm bg-white/5 rounded-2xl sm:rounded-3xl border border-white/10">
                 <div className="text-5xl sm:text-7xl font-bold text-transparent bg-clip-text bg-gradient-to-b from-white to-white/50 tracking-tighter">10x</div>
                 <div className="text-[10px] sm:text-xs font-bold tracking-[0.25em] sm:tracking-[0.3em] text-white uppercase">Velocity Accelerated</div>
              </div>
            </AnimatedSection>
          </div>
        </section>

        {/* Pricing Section */}
        <section id="pricing" className="py-12 sm:py-32 px-6 sm:px-8 relative overflow-hidden">
          {/* Subtle background glow for pricing section */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-4xl h-[300px] sm:h-[400px] bg-primary/10 blur-[120px] sm:blur-[150px] rounded-full pointer-events-none" />
          
          <div className="max-w-7xl mx-auto space-y-8 sm:space-y-16 relative z-10">
            <AnimatedSection className="text-center space-y-2 sm:space-y-4 max-w-2xl mx-auto">
              <h2 className="text-3xl md:text-5xl font-medium text-white tracking-tight">Simple Pricing</h2>
              <p className="text-on-surface-variant text-xs sm:text-lg">Choose the tier that fits your execution velocity.</p>
            </AnimatedSection>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-8 max-w-4xl mx-auto">
              {/* Free Tier Card */}
              <AnimatedSection delay={0.1}>
                <SpotlightCard 
                  className="p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] flex flex-col h-full bg-surface-container-low/50 border border-white/5 transition-all duration-500 hover:-translate-y-2"
                  spotlightColor="rgba(255, 255, 255, 0.05)"
                >
                  <div className="flex items-center justify-between mb-1 sm:mb-2">
                    <h3 className="text-xl sm:text-2xl font-bold text-white">Free Tier</h3>
                    <span className="px-2.5 py-0.5 sm:px-3 sm:py-1 bg-white/5 border border-white/10 rounded-full text-[10px] sm:text-xs font-semibold text-slate-300">
                      Standard
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-on-surface-variant mb-4 sm:mb-6">Perfect for testing Pulsar&apos;s automated outreach engine.</p>
                  
                  <div className="flex items-end gap-1 mb-3 sm:mb-6 pb-3 sm:pb-5 border-b border-white/10">
                    <span className="text-3xl sm:text-5xl font-bold tracking-tighter text-white">₹0</span>
                    <span className="text-on-surface-variant text-xs sm:text-sm font-medium mb-1">/forever</span>
                  </div>
                  
                  <div className="space-y-2 sm:space-y-3 mb-4 sm:mb-6 flex-1">
                    {[
                      "1 campaign run per day",
                      "Multi-platform sourcing (Instagram, YouTube, Product Hunt)",
                      "Access to the full campaign builder"
                    ].map((f, j) => (
                      <div key={j} className="text-xs sm:text-sm text-on-surface-variant flex items-center gap-2.5 sm:gap-3">
                        <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-slate-400 shrink-0" />
                        <span>{f}</span>
                      </div>
                    ))}
                  </div>
                  
                  <Link href="/login" className="w-full">
                    <button className="w-full py-2.5 sm:py-3 rounded-xl font-semibold text-xs sm:text-base bg-white/5 text-white border border-white/10 hover:bg-white/10 transition-all duration-300">
                      Get Started Free
                    </button>
                  </Link>
                </SpotlightCard>
              </AnimatedSection>

              {/* Elite Tier Card */}
              <AnimatedSection delay={0.25}>
                <SpotlightCard 
                  className="p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] flex flex-col h-full bg-[#181226] border border-[#BC66FF]/50 shadow-[0_0_40px_rgba(188,102,255,0.15)] relative transition-all duration-500 hover:-translate-y-2 overflow-hidden"
                  spotlightColor="rgba(188, 102, 255, 0.2)"
                >
                  <div className="absolute top-0 right-0 px-3 sm:px-4 py-1 sm:py-1.5 bg-[#BC66FF] text-black text-[10px] sm:text-xs font-extrabold uppercase tracking-wider rounded-bl-[1.2rem] sm:rounded-bl-[1.5rem] rounded-tr-[1.5rem] sm:rounded-tr-[2rem]">
                    Infinite Jobs
                  </div>
                  
                  <div className="flex items-center gap-2 mb-1 sm:mb-2">
                    <h3 className="text-xl sm:text-2xl font-bold text-white">Elite Tier</h3>
                    <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-[#BC66FF]" />
                  </div>
                  <p className="text-xs sm:text-sm text-slate-300 mb-4 sm:mb-6">For growth teams requiring unlimited execution & dedicated support.</p>
                  
                  <div className="flex items-end gap-1 mb-3 sm:mb-6 pb-3 sm:pb-5 border-b border-white/10">
                    <span className="text-2xl sm:text-4xl font-bold tracking-tight text-white">Custom Pricing</span>
                  </div>
                  
                  <div className="space-y-2 sm:space-y-3 mb-4 sm:mb-6 flex-1">
                    {[
                      "Unlimited campaign runs",
                      "Priority execution queue",
                      "Dedicated support & onboarding"
                    ].map((f, j) => (
                      <div key={j} className="text-xs sm:text-sm text-slate-200 flex items-center gap-2.5 sm:gap-3 font-medium">
                        <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-[#BC66FF] shrink-0" />
                        <span>{f}</span>
                      </div>
                    ))}
                  </div>
                  
                  <button 
                    onClick={() => setIsContactModalOpen(true)}
                    className="w-full py-2.5 sm:py-3 rounded-xl font-bold text-xs sm:text-base bg-[#BC66FF] text-black hover:bg-white shadow-[0_0_25px_rgba(188,102,255,0.4)] transition-all duration-300 flex items-center justify-center gap-2"
                  >
                    <span>Request Access</span>
                    <ArrowRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  </button>
                </SpotlightCard>
              </AnimatedSection>
            </div>
          </div>
        </section>

        <ContactAdminModal 
          isOpen={isContactModalOpen} 
          onClose={() => setIsContactModalOpen(false)} 
        />

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
