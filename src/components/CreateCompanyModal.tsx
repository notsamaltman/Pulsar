"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X, Rocket } from "lucide-react";
import { AnimatedButton } from "./Animations";

interface CreateCompanyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CreateCompanyModal({ isOpen, onClose }: CreateCompanyModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          {/* Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-background/60 backdrop-blur-sm"
          />

          {/* Modal Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="w-full max-w-xl bg-[#000000] rounded-xl border border-[#333333] overflow-hidden flex flex-col shadow-2xl relative z-10"
          >
            {/* Modal Header */}
            <div className="px-8 pt-10 pb-6 relative">
              <button 
                onClick={onClose}
                className="absolute top-6 right-6 text-[#666666] hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
              
              <div className="flex items-center gap-2 mb-2">
                <Rocket className="w-4 h-4 text-white" />
                <span className="text-[10px] uppercase tracking-widest text-[#888888] font-bold">New Company</span>
              </div>
              <h2 className="text-2xl font-bold text-white tracking-tight">Create Company</h2>
              <p className="text-[#888888] text-[13px] mt-2 leading-relaxed max-w-md">
                Initialize a new intelligence node. Pulsar will crawl the web to build an automated profile for your outreach.
              </p>
            </div>

            {/* Form Section */}
            <form className="px-8 pb-10 space-y-6" onSubmit={(e) => { e.preventDefault(); onClose(); }}>
              {/* Field: Company Name */}
              <div className="space-y-2">
                <label className="text-[11px] font-medium text-[#888888] uppercase">Company Name</label>
                <input 
                  className="w-full bg-[#111111] border border-[#333333] rounded-md px-4 py-2.5 text-sm text-white placeholder-[#444444] focus:outline-none focus:border-[#666666] transition-colors" 
                  placeholder="e.g. Acme Corp" 
                  type="text" 
                  required
                />
              </div>

              {/* Field: Website URL */}
              <div className="space-y-2">
                <label className="text-[11px] font-medium text-[#888888] uppercase">Website URL</label>
                <input 
                  className="w-full bg-[#111111] border border-[#333333] rounded-md px-4 py-2.5 text-sm text-white placeholder-[#444444] focus:outline-none focus:border-[#666666] transition-colors" 
                  placeholder="https://acme.com" 
                  type="url"
                  required
                />
              </div>

              {/* Field: What do you sell? (Textarea) */}
              <div className="space-y-2">
                <label className="text-[11px] font-medium text-[#888888] uppercase">What do you sell?</label>
                <textarea 
                  className="w-full bg-[#111111] border border-[#333333] rounded-md px-4 py-3 text-sm text-white placeholder-[#444444] focus:outline-none focus:border-[#666666] transition-colors min-h-[120px] resize-none" 
                  placeholder="Describe your product or service in detail..." 
                  required
                />
              </div>

              {/* Actions */}
              <div className="pt-6 flex items-center justify-end gap-4">
                <button 
                  type="button"
                  onClick={onClose}
                  className="text-[13px] font-medium text-[#888888] hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <AnimatedButton 
                  className="h-10 px-8 rounded-md text-sm font-medium bg-white text-black hover:bg-[#e0e0e0] border-0"
                >
                  <span>Create Company</span>
                </AnimatedButton>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
