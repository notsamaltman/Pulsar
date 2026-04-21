"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { useState } from "react";
import { AnimatedButton } from "./Animations";

interface CreateCompanyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CreateCompanyModal({ isOpen, onClose }: CreateCompanyModalProps) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    website: "",
    description: ""
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await fetch("/api/job/company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error("Failed to create company");
      }

      // Success - Commenting out to keep loading animation visible
      // setFormData({ name: "", website: "", description: "" });
      // onClose();
    } catch (error) {
      console.error("Error:", error);
      alert("Failed to create company. Please try again.");
      setLoading(false); // Only stop loading on error so they can fix it
    } finally {
      // setLoading(false); // Commented out to keep animation infinite
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-100 flex items-center justify-center p-6">
          {/* Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={!loading ? onClose : undefined}
            className="absolute inset-0 bg-background/60 backdrop-blur-sm"
          />

          {/* Modal Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="w-full max-w-xl bg-[#000000] rounded-xl border border-[#333333] overflow-hidden flex flex-col shadow-2xl relative z-10"
          >
            {loading ? (
              <div className="flex flex-col items-center justify-center py-32 px-10 text-center space-y-10">
                <div className="relative flex items-center justify-center scale-125">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                    className="w-24 h-24 border-t-2 border-r-2 border-white/20 rounded-full"
                  />
                  <motion.div
                    animate={{ rotate: -360 }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                    className="absolute w-16 h-16 border-b-2 border-l-2 border-white/40 rounded-full"
                  />
                  <motion.div
                    animate={{ scale: [1, 1.4, 1] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                    className="absolute w-6 h-6 bg-white rounded-full shadow-[0_0_20px_rgba(255,255,255,0.6)]"
                  />
                </div>
                <div className="space-y-4">
                  <h3 className="text-3xl font-bold text-white tracking-tight">Creating Personalised Profile</h3>
                  <p className="text-[#888888] text-base max-w-[450px] leading-relaxed mx-auto">
                    Pulsar is processing your information to build a personalised profile.
                  </p>
                </div>
              </div>
            ) : (
              <>
                {/* Modal Header */}
                <div className="px-8 pt-10 pb-6 relative">
                  <button 
                    onClick={onClose}
                    className="absolute top-6 right-6 text-[#666666] hover:text-white transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                  
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-5 h-5 flex items-center justify-center overflow-hidden rounded-sm bg-white/5">
                      <img src="/favicon.ico" className="w-full h-full object-contain" alt="Pulsar" />
                    </div>
                    <span className="text-[10px] uppercase tracking-widest text-[#888888] font-bold">New Company</span>
                  </div>
                  <h2 className="text-2xl font-bold text-white tracking-tight">Create Company</h2>
                  <p className="text-[#888888] text-[13px] mt-2 leading-relaxed max-w-md">
                    Pulsar will create your personalised company profile.
                  </p>
                </div>

                {/* Form Section */}
                <form className="px-8 pb-10 space-y-6" onSubmit={handleSubmit}>
                  {/* Field: Company Name */}
                  <div className="space-y-2">
                    <label className="text-[11px] font-medium text-[#888888] uppercase">Company Name</label>
                    <input 
                      className="w-full bg-[#111111] border border-[#333333] rounded-md px-4 py-2.5 text-sm text-white placeholder-[#444444] focus:outline-none focus:border-[#666666] transition-colors" 
                      placeholder="e.g. Acme Corp" 
                      type="text" 
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      required
                    />
                  </div>

                  {/* Field: Website URL */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <label className="text-[11px] font-medium text-[#888888] uppercase">Website URL</label>
                      <span className="text-[10px] text-[#444444] uppercase font-bold">Optional</span>
                    </div>
                    <input 
                      className="w-full bg-[#111111] border border-[#333333] rounded-md px-4 py-2.5 text-sm text-white placeholder-[#444444] focus:outline-none focus:border-[#666666] transition-colors" 
                      placeholder="https://acme.com" 
                      type="url"
                      value={formData.website}
                      onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                    />
                  </div>

                  {/* Field: What do you sell? (Textarea) */}
                  <div className="space-y-2">
                    <label className="text-[11px] font-medium text-[#888888] uppercase">What do you sell?</label>
                    <textarea 
                      className="w-full bg-[#111111] border border-[#333333] rounded-md px-4 py-3 text-sm text-white placeholder-[#444444] focus:outline-none focus:border-[#666666] transition-colors min-h-[120px] resize-none" 
                      placeholder="Describe your product or service in detail..." 
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
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
                      type="submit"
                      className="h-10 px-8 rounded-md text-sm font-medium bg-white text-black hover:bg-[#e0e0e0] border-0"
                    >
                      <span>Create Company</span>
                    </AnimatedButton>
                  </div>
                </form>
              </>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
