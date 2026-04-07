"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { AnimatedSection, AnimatedButton, Beams, TextReveal, SpotlightCard } from "@/components";
import { 
  TimerOff, 
  ShieldAlert,
  Bot,
  Zap,
  MessageSquare,
  BarChart3,
  ArrowRight
} from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";

export default function Home() {
  const { status } = useSession();
  const router = useRouter();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    if (status === "authenticated") {
      router.push("/dashboard");
    }
  }, [status, router]);

  return (
    <div className="relative min-h-screen selection:bg-primary/30">
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/50 backdrop-blur-xl border-b border-white/5 transition-all duration-300">
        <div className="flex justify-between items-center w-full px-8 py-5 max-w-7xl mx-auto">
          <div className="flex items-center gap-12">
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
          <div className="flex items-center gap-4">
            <Link href="/login">
              <button className="px-5 py-2 text-sm font-medium bg-white text-black rounded-lg hover:bg-gray-200 transition-colors shadow-[0_0_20px_rgba(255,255,255,0.15)] hover:shadow-[0_0_25px_rgba(255,255,255,0.25)]">
                Get Started
              </button>
            </Link>
          </div>
        </div>
      </nav>

      <main>
        {/* Hero Section */}
        <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-20">
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
          
          <div className="relative z-10 max-w-7xl mx-auto px-8 w-full flex flex-col items-start text-left">

            <TextReveal 
              text="Self-learning personalized sales outreach." 
              className="text-6xl md:text-8xl font-bold tracking-tighter leading-[1.05] text-white max-w-5xl mb-8 font-headline"
            />
            
            <motion.p 
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              className="text-lg md:text-xl text-on-surface-variant max-w-2xl leading-relaxed font-light mb-12"
            >
              Stop spending hours finding leads. Pulsar finds new business opportunities and sends personalized messages for you, automatically.
            </motion.p>
            
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.6 }}
              className="flex flex-col sm:flex-row gap-4 items-center"
            >
              <Link href="/login">
                <button className="group relative px-8 py-4 bg-white text-black font-medium rounded-xl overflow-hidden shadow-[0_0_40px_rgba(255,255,255,0.2)] hover:shadow-[0_0_60px_rgba(196,192,255,0.4)] transition-all duration-300">
                  <span className="relative z-10 flex items-center gap-2">
                    Start automating <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </span>
                  <div className="absolute inset-0 bg-primary opacity-0 group-hover:opacity-20 transition-opacity duration-300" />
                </button>
              </Link>
              <Link href="#solution">
                <button className="px-8 py-4 bg-white/5 text-white font-medium rounded-xl border border-white/10 hover:bg-white/10 backdrop-blur-sm transition-all duration-300">
                  See how it works
                </button>
              </Link>
            </motion.div>

          </div>
        </section>

        {/* Dynamic Bento Box Features */}
        <section id="features" className="py-24 px-8 relative">
          <div className="max-w-7xl mx-auto">
            <AnimatedSection>
              <h2 className="text-4xl md:text-5xl font-medium tracking-tight text-white leading-tight mb-4 text-center">
                Built for the modern <br/>sales ecosystem.
              </h2>
              <p className="text-center text-on-surface-variant max-w-2xl mx-auto mb-16 px-4">
                Traditional sales is slow and tiring. Pulsar handles the boring work of finding people and starting conversations, so you can focus on closing deals.
              </p>
            </AnimatedSection>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
              {/* Feature 1 */}
              <AnimatedSection delay={0.1} className="md:col-span-2">
                <SpotlightCard className="h-full p-8 rounded-[2rem] bg-surface-container-low/50 border border-white/5 backdrop-blur-sm group">
                  <div className="flex flex-col h-full justify-between">
                    <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-16 border border-primary/20">
                      <Zap className="text-primary w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-2xl font-medium text-white mb-3 tracking-tight">The Volume Trap</h3>
                      <p className="text-on-surface-variant text-sm leading-relaxed max-w-md">
                        Spending 70% of your day on manual prospecting yields diminishing returns in a noise-saturated market. Pulsar processes thousands of data points instantly.
                      </p>
                    </div>
                  </div>
                </SpotlightCard>
              </AnimatedSection>

              {/* Feature 2 */}
              <AnimatedSection delay={0.2} className="md:col-span-1">
                <SpotlightCard className="h-full p-8 rounded-[2rem] bg-surface-container-low/50 border border-white/5 backdrop-blur-sm group">
                  <div className="flex flex-col h-full justify-between">
                    <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center mb-16 border border-white/10">
                      <ShieldAlert className="text-white w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-xl font-medium text-white mb-3 tracking-tight">Static Messaging</h3>
                      <p className="text-on-surface-variant text-sm leading-relaxed">
                        Generic templates are filtered out. Context is no longer optional—it is the absolute requirement for conversion.
                      </p>
                    </div>
                  </div>
                </SpotlightCard>
              </AnimatedSection>

              {/* Feature 3 */}
              <AnimatedSection delay={0.3} className="md:col-span-1">
                <SpotlightCard className="h-full p-8 rounded-[2rem] bg-surface-container-low/50 border border-white/5 backdrop-blur-sm group">
                  <div className="flex flex-col h-full justify-between">
                    <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center mb-16 border border-white/10">
                      <TimerOff className="text-white w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-xl font-medium text-white mb-3 tracking-tight">Wasted Hours</h3>
                      <p className="text-on-surface-variant text-sm leading-relaxed">
                        Your time is your most valuable asset. Stop hunting and start negotiating.
                      </p>
                    </div>
                  </div>
                </SpotlightCard>
              </AnimatedSection>

              {/* Feature 4 */}
              <AnimatedSection delay={0.4} className="md:col-span-2">
                <SpotlightCard className="h-full p-8 rounded-[2rem] bg-primary/5 border border-primary/20 backdrop-blur-sm group relative overflow-hidden">
                  <div className="absolute right-0 top-0 w-64 h-64 bg-primary/20 rounded-full blur-[80px]" />
                  <div className="relative z-10 flex flex-col h-full justify-between">
                    <div className="w-12 h-12 rounded-2xl bg-primary/20 flex items-center justify-center mb-16 border border-primary/30">
                      <Bot className="text-primary w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-2xl font-medium text-white mb-3 tracking-tight">Autonomous Agent</h3>
                      <p className="text-on-surface-variant text-sm leading-relaxed max-w-md">
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
        <section id="solution" className="py-24 px-8 border-y border-white/5 bg-[#0a0a0c]">
          <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-16 items-center">
            <div className="space-y-12">
              <AnimatedSection>
                <h2 className="text-4xl md:text-5xl font-medium text-white tracking-tight leading-tight">
                  Intelligent tooling <br/>for impossible growth.
                </h2>
              </AnimatedSection>
              
              <div className="space-y-6">
                {[
                  { icon: <Bot className="w-5 h-5 text-primary"/>, title: "Automatic Lead Finding", desc: "Crawls the web to find new customers in your specific industry automatically every single day.", delay: 0.1 },
                  { icon: <MessageSquare className="w-5 h-5 text-primary"/>, title: "Smart Follow-ups", desc: "Connect with buyers instantly with hyper-personalized context.", delay: 0.2 },
                  { icon: <BarChart3 className="w-5 h-5 text-primary"/>, title: "Daily Sales Reports", desc: "Get simple, actionable updates directly on your phone about how your pipeline is growing.", delay: 0.3 }
                ].map((item, i) => (
                  <AnimatedSection key={i} delay={item.delay}>
                    <div className="group flex gap-6 p-6 rounded-3xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-primary/30 transition-all duration-300">
                      <div className="w-12 h-12 rounded-full bg-surface-container-low flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform shadow-[0_0_15px_rgba(0,0,0,0.5)]">
                        {item.icon}
                      </div>
                      <div>
                        <h4 className="text-white font-medium text-lg tracking-tight mb-1">{item.title}</h4>
                        <p className="text-on-surface-variant text-sm leading-relaxed">{item.desc}</p>
                      </div>
                    </div>
                  </AnimatedSection>
                ))}
              </div>
            </div>
            
            <AnimatedSection delay={0.4} className="h-[600px] w-full rounded-[2.5rem] bg-gradient-to-b from-surface-container-low to-background border border-white/10 flex items-center justify-center relative overflow-hidden shadow-2xl">
              {/* Decorative dynamic glows */}
              <div className="absolute top-1/4 left-1/4 w-40 h-40 bg-primary/30 rounded-full blur-[100px] animate-pulse" />
              <div className="absolute bottom-1/4 right-1/4 w-60 h-60 bg-blue-500/20 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '1s' }} />
              
              <div className="text-center space-y-4 p-12 relative z-10 backdrop-blur-sm bg-white/5 rounded-3xl border border-white/10">
                 <div className="text-7xl font-bold text-transparent bg-clip-text bg-gradient-to-b from-white to-white/50 tracking-tighter">10x</div>
                 <div className="text-xs font-bold tracking-[0.3em] text-primary uppercase">Velocity Accelerated</div>
              </div>
            </AnimatedSection>
          </div>
        </section>

        {/* Pricing Section */}
        <section id="pricing" className="py-32 px-8 relative overflow-hidden">
          {/* Subtle background glow for pricing section */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-4xl h-[400px] bg-primary/10 blur-[150px] rounded-full pointer-events-none" />
          
          <div className="max-w-7xl mx-auto space-y-16 relative z-10">
            <AnimatedSection className="text-center space-y-4 max-w-2xl mx-auto">
              <h2 className="text-4xl md:text-5xl font-medium text-white tracking-tight">Simple Pricing</h2>
              <p className="text-on-surface-variant text-lg">Choose the plan that fits your execution velocity.</p>
            </AnimatedSection>
            
            <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
              {[
                { name: "Starter", price: "4,999", desc: "Perfect for exploring automation.", features: ["500 Leads/mo", "Email Outreach", "Daily Notifications"] },
                { name: "Growth", price: "12,999", desc: "For teams scaling their outreach.", features: ["2,500 Leads/mo", "Advanced Email Outreach", "Detailed Reports"], popular: true },
                { name: "Enterprise", price: "Custom", desc: "Limitless infrastructure.", features: ["Unlimited Leads", "Dedicated Relationship Manager", "24/7 Support"] }
              ].map((tier, i) => (
                <AnimatedSection key={i} delay={i * 0.15}>
                  <SpotlightCard 
                    className={`p-8 rounded-[2rem] flex flex-col h-full transition-all duration-500 hover:-translate-y-2 ${
                      tier.popular ? 'bg-surface-container border border-primary/50 shadow-[0_0_40px_rgba(196,192,255,0.15)] relative' : 'bg-surface-container-low/50 border border-white/5'
                    }`}
                    spotlightColor={tier.popular ? "rgba(196, 192, 255, 0.15)" : "rgba(255, 255, 255, 0.05)"}
                  >
                    {tier.popular && (
                      <div className="absolute top-0 right-0 max-w-fit px-4 py-1.5 bg-primary text-black text-xs font-bold uppercase tracking-wider rounded-bl-[1.5rem] rounded-tr-[2rem]">
                        Most Popular
                      </div>
                    )}
                    
                    <h3 className="text-xl font-medium text-white mb-2">{tier.name}</h3>
                    <p className="text-sm text-on-surface-variant mb-6">{tier.desc}</p>
                    
                    <div className="flex items-end gap-1 mb-10 pb-8 border-b border-white/10 mt-auto">
                      <span className="text-4xl md:text-5xl font-bold tracking-tighter text-white">
                        {tier.price === "Custom" ? tier.price : `₹${tier.price}`}
                      </span>
                      {tier.price !== "Custom" && <span className="text-on-surface-variant text-sm font-medium mb-1.5">/mo</span>}
                    </div>
                    
                    <div className="space-y-5 mb-10 flex-1">
                      {tier.features.map((f, j) => (
                        <div key={j} className="text-sm text-on-surface-variant flex items-center gap-3">
                          <div className="w-1.5 h-1.5 rounded-full bg-primary/60" /> {f}
                        </div>
                      ))}
                    </div>
                    
                    <button className={`w-full py-4 rounded-xl font-medium transition-all duration-300 ${
                      tier.popular 
                        ? 'bg-primary text-black hover:bg-white shadow-[0_0_20px_rgba(196,192,255,0.3)]' 
                        : 'bg-white/5 text-white border border-white/10 hover:bg-white/10'
                    }`}>
                      {tier.name === "Enterprise" ? "Contact sales" : "Get started"}
                    </button>
                  </SpotlightCard>
                </AnimatedSection>
              ))}
            </div>
          </div>
        </section>

      </main>

      {/* Footer */}
      <footer className="py-12 px-8 bg-background border-t border-white/5">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex flex-col md:flex-row items-center gap-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 flex items-center justify-center overflow-hidden rounded-md bg-white/5">
                <img src="/logo.png" className="w-full h-full object-cover" alt="Pulsar" />
              </div>
              <span className="text-xl font-bold tracking-tight text-white">Pulsar</span>
            </div>
            <span className="text-outline-variant/30 text-lg hidden md:block">|</span>
            <p className="text-sm text-on-surface-variant/60">@2026 Pulsar Intelligence. Systemic Sales Excellence.</p>
          </div>
          <div className="flex gap-8 text-sm text-on-surface-variant/80 font-medium">
            <Link href="#" className="hover:text-primary transition-colors">Privacy</Link>
            <Link href="#" className="hover:text-primary transition-colors">Terms</Link>
            <Link href="#" className="hover:text-primary transition-colors">Security</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
