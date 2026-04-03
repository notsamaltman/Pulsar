import { AnimatedSection, AnimatedButton, Beams } from "@/components";
import { 
  TimerOff, 
  ShieldAlert
} from "lucide-react";
import Link from "next/link";

export default function Home() {
  return (
    <div className="relative min-h-screen">
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-white/5">
        <div className="flex justify-between items-center w-full px-8 py-5 max-w-7xl mx-auto">
          <div className="flex items-center gap-12">
            <Link href="/" className="text-xl font-bold tracking-tight text-white">
              Pulsar
            </Link>
            <div className="hidden md:flex items-center gap-8 text-sm">
              <Link href="#" className="text-on-surface-variant hover:text-white transition-colors">Platform</Link>
              <Link href="#solution" className="text-on-surface-variant hover:text-white transition-colors">Solutions</Link>
              <Link href="#pricing" className="text-on-surface-variant hover:text-white transition-colors">Pricing</Link>
            </div>
          </div>
        </div>
      </nav>

      <main>
        {/* Hero Section */}
        <section className="relative min-h-[75vh] flex items-center overflow-hidden pt-20">
          <div className="absolute inset-0 pointer-events-none">
            {/* @ts-expect-error - Beams is a JS component from ReactBits */}
            <Beams
              beamWidth={4}
              beamHeight={40}
              beamNumber={25}
              lightColor="#c4c0ff"
              speed={4.0}
              noiseIntensity={2.0}
              scale={0.15}
              rotation={45}
            />
          </div>
          
          <div className="relative z-10 max-w-7xl mx-auto px-8 w-full">
            <AnimatedSection className="max-w-3xl space-y-4">
              
              <h1 className="text-6xl md:text-7xl font-bold tracking-tight leading-[1.05] text-gradient-subtle">
                Self-learning <br/>personalized sales outreach.
              </h1>
              
              <p className="text-lg text-on-surface-variant max-w-md leading-relaxed font-light">
                Stop spending hours finding leads. Pulsar finds new business opportunities and sends personalized messages for you, automatically.
              </p>
              
              <div className="flex flex-wrap gap-4 pt-4">
                <Link href="/login">
                  <AnimatedButton variant="black">Get started</AnimatedButton>
                </Link>
              </div>
            </AnimatedSection>
          </div>
        </section>

        {/* Pain Points Section */}
        <AnimatedSection className="py-16 px-8 bg-surface-container-low/30 border-y border-white/5">
          <div className="max-w-7xl mx-auto">
            <div className="grid lg:grid-cols-2 gap-16 items-center">
              <div className="space-y-6">
                <h2 className="text-4xl font-medium tracking-tight text-white leading-tight">
                  Stop the manual <br/>lead generation struggle.
                </h2>
                <p className="text-on-surface-variant text-lg leading-relaxed max-w-lg">
                  Traditional sales is slow and tiring. Pulsar handles the boring work of finding people and starting conversations, so you can focus on closing deals.
                </p>
              </div>
              
              <div className="grid gap-6">
                <div className="p-6 rounded-card bg-surface-container-low ghost-border flex gap-5 items-start transition-colors hover:bg-surface-container">
                  <TimerOff className="text-primary/60 w-6 h-6 mt-1" />
                  <div>
                    <h4 className="font-medium text-white mb-1">The Volume Trap</h4>
                    <p className="text-sm text-on-surface-variant leading-relaxed">
                      Spending 70% of your day on manual prospecting yields diminishing returns in a noise-saturated market.
                    </p>
                  </div>
                </div>
                
                <div className="p-6 rounded-card bg-surface-container-low ghost-border flex gap-5 items-start transition-colors hover:bg-surface-container">
                  <ShieldAlert className="text-primary/60 w-6 h-6 mt-1" />
                  <div>
                    <h4 className="font-medium text-white mb-1">Static Messaging</h4>
                    <p className="text-sm text-on-surface-variant leading-relaxed">
                      Generic templates are filtered out by modern buyers. Context is no longer optional—it is the requirement.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </AnimatedSection>

        {/* Solution Section */}
        <section id="solution" className="py-16 px-8 border-t border-white/5 bg-surface-container-low/10">
          <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-8">
              <h2 className="text-4xl font-medium text-white tracking-tight leading-tight">
                Simple sales tools <br/>built for your growth.
              </h2>
              <div className="space-y-6">
                {[
                  { title: "Automatic Lead Finding", desc: "Find new customers in any industry automatically every single day." },
                  { title: "Smart Follow-ups", desc: "Connect with buyers via WhatsApp and Email instantly without typing." },
                  { title: "Daily Sales Reports", desc: "Get simple updates on your phone about how your business is growing." }
                ].map((item, i) => (
                  <div key={i} className="flex gap-4 p-4 rounded-card ghost-border bg-background/50">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary mt-2"></div>
                    <div>
                      <h4 className="text-white font-medium text-sm">{item.title}</h4>
                      <p className="text-on-surface-variant text-xs mt-1">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="aspect-[4/3] rounded-card ghost-border bg-surface-container-low flex items-center justify-center relative overflow-hidden">
              <div className="absolute inset-0 bg-primary/5 blur-[120px]"></div>
              <div className="text-center space-y-2 p-10">
                 <div className="text-4xl font-bold text-white mb-2">10x</div>
                 <div className="text-[10px] font-bold tracking-widest text-primary uppercase">Faster Growth</div>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing Section */}
        <section id="pricing" className="py-16 px-8 border-t border-white/5">
          <div className="max-w-7xl mx-auto space-y-12">
            <div className="text-center space-y-4 max-w-2xl mx-auto">
              <h2 className="text-4xl font-medium text-white tracking-tight">Simple Pricing</h2>
              <p className="text-on-surface-variant">Choose the plan that fits your business goals.</p>
            </div>
            
            <div className="grid md:grid-cols-3 gap-8">
              {[
                { name: "Basic", price: "4,999", features: ["500 Leads/mo", "WhatsApp Support", "Email Notifications"] },
                { name: "Growth", price: "12,999", features: ["2,500 Leads/mo", "Priority WhatsApp Support", "Detailed Reports"] },
                { name: "Enterprise", price: "Custom", features: ["Unlimited Leads", "Dedicated Relationship Manager", "24/7 Support"] }
              ].map((tier, i) => (
                <div key={i} className={`p-8 rounded-card ghost-border flex flex-col h-full bg-surface-container-low transition-all hover:scale-[1.02] ${i === 1 ? 'border-primary/40' : ''}`}>
                  <h3 className="text-lg font-medium text-white mb-2">{tier.name}</h3>
                  <div className="flex items-baseline gap-1 mb-8">
                    <span className="text-3xl font-bold text-white">{tier.price === "Custom" ? tier.price : `₹${tier.price}`}</span>
                    {tier.price !== "Custom" && <span className="text-on-surface-variant text-xs">/mo</span>}
                  </div>
                  <div className="space-y-4 mb-10 flex-1">
                    {tier.features.map((f, j) => (
                      <div key={j} className="text-xs text-on-surface-variant flex gap-2">
                        <span>•</span> {f}
                      </div>
                    ))}
                  </div>
                  <AnimatedButton variant={i === 1 ? 'primary' : 'ghost'} className="w-full">
                    {tier.name === "Enterprise" ? "Contact us" : "Get started"}
                  </AnimatedButton>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="py-8 px-8 bg-background border-t border-white/5">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-6">
            <span className="text-lg font-bold tracking-tight text-white">Pulsar</span>
            <span className="text-outline-variant/30 text-xs hidden md:block">|</span>
            <p className="text-xs text-on-surface-variant/60">@2026 Pulsar Intelligence. Systemic Sales Excellence.</p>
          </div>
          <div className="flex gap-8 text-xs text-on-surface-variant/80">
            <Link href="#" className="hover:text-primary transition-colors">Privacy</Link>
            <Link href="#" className="hover:text-primary transition-colors">Terms</Link>
            <Link href="#" className="hover:text-primary transition-colors">Security</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
