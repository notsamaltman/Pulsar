"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mail, Copy, Check, Sparkles, X, ShieldCheck } from "lucide-react";

interface ContactAdminModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ContactAdminModal({ isOpen, onClose }: ContactAdminModalProps) {
  const [copied, setCopied] = useState(false);
  const adminEmail = "panwalkarsoham@gmail.com";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(adminEmail);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (e) {
      console.error("Failed to copy email:", e);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/80 backdrop-blur-md"
        />

        {/* Modal Container */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="relative w-full max-w-md bg-[#161618] border border-[#2D2D32] rounded-3xl p-6 sm:p-8 shadow-[0_0_50px_rgba(188,102,255,0.15)] z-10 overflow-hidden space-y-6"
        >
          {/* Decorative ambient background glow */}
          <div className="absolute top-0 right-0 w-48 h-48 bg-[#BC66FF]/10 rounded-full blur-[60px] pointer-events-none" />

          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-[#BC66FF]/15 text-[#BC66FF] border border-[#BC66FF]/30 shadow-inner">
                <Sparkles className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white tracking-tight">Elite Tier Access</h3>
                <p className="text-xs text-slate-400 mt-0.5">Contact the Pulsar administrator for upgrade</p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 transition"
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Elite Benefits Callout */}
          <div className="bg-[#1C1C20] border border-[#2B2B32] rounded-2xl p-4 space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
              <ShieldCheck className="w-4 h-4 text-[#BC66FF]" />
              <span>Elite Account Perks</span>
            </div>
            <ul className="text-xs text-slate-400 space-y-1.5 pl-6 list-disc">
              <li><strong className="text-white">Infinite runs</strong> for all company profile creations</li>
              <li><strong className="text-white">Infinite runs</strong> for master-agent lead campaigns</li>
              <li>Priority execution slots in the worker queue</li>
              <li>Custom AI model & prompt tuning</li>
            </ul>
          </div>

          {/* Admin Email Box */}
          <div className="space-y-3 pt-1">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
              Direct Admin Contact
            </label>
            <div className="flex items-center justify-between bg-[#0F0F11] border border-[#26262B] rounded-xl p-3 gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <Mail className="w-4 h-4 text-[#BC66FF] shrink-0" />
                <span className="text-xs sm:text-sm font-mono font-medium text-white truncate">
                  {adminEmail}
                </span>
              </div>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-[#BC66FF]/20 hover:border-[#BC66FF]/40 text-xs font-medium text-slate-200 hover:text-white transition shrink-0"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400 font-bold">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
          </div>


        </motion.div>
      </div>
    </AnimatePresence>
  );
}
