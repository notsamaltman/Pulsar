"use client";

import { signIn } from "next-auth/react";
import { Mail, Lock } from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";
import { AnimatedButton } from "@/components";

export default function LoginPage() {
  return (
    <div className="flex items-center justify-center min-h-screen p-6 bg-background relative overflow-hidden">
      {/* Background Decorative Element */}
      <div className="fixed -bottom-24 -left-24 w-96 h-96 bg-primary/5 blur-[120px] rounded-full pointer-events-none"></div>
      <div className="fixed -top-24 -right-24 w-96 h-96 bg-primary/5 blur-[120px] rounded-full pointer-events-none"></div>

      <main className="w-full max-w-md relative z-10">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="bg-surface-container-low ghost-border rounded-xl overflow-hidden p-10 flex flex-col items-center shadow-2xl"
        >
          {/* Pulsar Logo Section */}
          <div className="mb-10 text-center">
            <div className="flex items-center justify-center space-x-2 mb-2">
              <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
                <Hub className="text-white w-6 h-6" />
              </div>
              <span className="text-2xl font-headline font-bold tracking-tight text-white italic">Pulsar</span>
            </div>
            <p className="text-on-surface-variant text-sm">Welcome back to sales intelligence.</p>
          </div>

          {/* Social Sign In - Actual Google Action */}
          <button
            onClick={() => signIn("google")}
            className="w-full py-4 px-4 bg-white hover:bg-slate-50 transition-all rounded-xl flex items-center justify-center space-x-3 mb-8 shadow-xl shadow-white/5 active:scale-[0.98]"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            <span className="text-slate-900 font-semibold text-sm">Sign in with Google</span>
          </button>

          <div className="w-full mt-2 pt-8 border-t border-white/5 flex flex-col space-y-4">
            <div className="flex space-x-3">
              <Mail className="text-on-surface-variant w-5 h-5 shrink-0" />
              <p className="text-xs text-on-surface-variant leading-relaxed">
                <span className="font-semibold text-white/70">Direct Email Integration:</span> We will ask for Gmail access to send personalized outreach directly from your account.
              </p>
            </div>
            <div className="flex space-x-3">
              <Lock className="text-on-surface-variant w-5 h-5 shrink-0" />
              <p className="text-xs text-on-surface-variant leading-relaxed">
                <span className="font-semibold text-white/70">Secure & Private:</span> Your data is fully encrypted and stored on our secure servers.
              </p>
            </div>
          </div>

          {/* Footer Link */}
          <div className="mt-8 text-center">
            <p className="text-sm text-on-surface-variant">
              Don&apos;t have an account? 
              <Link href="#" className="text-primary font-medium hover:text-primary/80 transition-colors ml-1">
                Sign up
              </Link>
            </p>
          </div>
        </motion.div>

        {/* System Status Indicator */}
        <div className="mt-8 flex justify-center items-center space-x-6 opacity-60">
          <div className="flex items-center space-x-2">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
            <span className="text-[10px] text-on-surface-variant uppercase tracking-widest">System Online</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-[10px] text-on-surface-variant uppercase tracking-widest">Pulsar V2.4.0</span>
          </div>
        </div>
      </main>
    </div>
  );
}

// Hub icon component
function Hub({ className }: { className?: string }) {
  return (
    <svg 
      className={className} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <circle cx="19" cy="5" r="2" />
      <circle cx="5" cy="19" r="2" />
      <path d="M17.3 6.7 13.5 10.5" />
      <path d="M10.5 13.5 6.7 17.3" />
      <circle cx="19" cy="19" r="2" />
      <path d="m17.3 17.3-3.8-3.8" />
      <circle cx="5" cy="5" r="2" />
      <path d="m6.7 6.7 3.8 3.8" />
    </svg>
  )
}
