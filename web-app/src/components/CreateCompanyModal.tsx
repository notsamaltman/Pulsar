"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X, Check, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import { AnimatedButton } from "./Animations";

interface CreateCompanyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CreateCompanyModal({ isOpen, onClose }: CreateCompanyModalProps) {
  const [loading, setLoading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ status: string; message: string } | null>(null);
  const [showResultForm, setShowResultForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failureMessage, setFailureMessage] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: "",
    website: "",
    description: ""
  });

  const [resultData, setResultData] = useState({
    name: "",
    website: "",
    description: "",
    summary: ""
  });

  // Full reset — called after success, failure, or close
  const resetModal = () => {
    setLoading(false);
    setJobId(null);
    setProgress(null);
    setShowResultForm(false);
    setFailureMessage(null);
  };

  // Polling effect
  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (jobId && loading && !showResultForm) {
      interval = setInterval(async () => {
        try {
          const response = await fetch(`/api/job/${jobId}`);
          if (response.ok) {
            const job = await response.json();
            
            if (job.progress) {
              setProgress(job.progress);
              
              if (job.progress.status === "completed" && job.progress.result) {
                setResultData(job.progress.result);
                setShowResultForm(true);
                clearInterval(interval);
              } else if (job.progress.status === "failed") {
                const isInvalidContent = job.progress.message === "Content Invalidated";
                setFailureMessage(
                  isInvalidContent
                    ? "Please be more detailed — Try adding a clearer description, full website URL, or more specific business information."
                    : (job.progress.message || "Job failed. Please try again.")
                );
                setLoading(false);
                setJobId(null); // clear so the next submit starts fresh
                clearInterval(interval);
              }
            }
          }
        } catch (error) {
          console.error("Polling error:", error);
        }
      }, 2000);
    }

    return () => clearInterval(interval);
  }, [jobId, loading, showResultForm]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFailureMessage(null); // clear any previous failure before retrying
    setLoading(true);
    setProgress({ status: "initializing", message: "Queuing Request..." });

    try {
      const response = await fetch("/api/job/company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error("Failed to create company");
      }

      const data = await response.json();
      setJobId(data.jobId);
    } catch (error) {
      console.error("Error:", error);
      setFailureMessage("Failed to create company. Please try again.");
      setLoading(false);
    }
  };

  const handleFinalSave = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(resultData),
      });

      if (!response.ok) {
        throw new Error("Failed to save company");
      }

      // Reset and close
      setFormData({ name: "", website: "", description: "" });
      resetModal();
      onClose();
    } catch (error) {
      console.error("Error saving company:", error);
      setFailureMessage("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          {/* Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={!loading ? onClose : undefined}
            className="absolute inset-0 bg-background/80 backdrop-blur-md"
          />

          {/* Modal Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="w-full max-w-xl sm:max-w-2xl max-h-[90vh] bg-[#171717] rounded-2xl border border-[#2A2A2A] overflow-y-auto flex flex-col shadow-[0_0_50px_rgba(0,0,0,0.5)] relative z-10"
          >
            {loading && !showResultForm ? (
              <div className="flex flex-col items-center justify-center py-12 sm:py-20 px-6 sm:px-10 text-center space-y-6 sm:space-y-10">
                <div className="relative flex items-center justify-center scale-100 sm:scale-125">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                    className="w-24 h-24 border-t-2 border-[#BC66FF]/20 rounded-full"
                  />
                  <motion.div
                    animate={{ rotate: -360 }}
                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                    className="absolute w-16 h-16 border-b-2 border-[#BC66FF]/40 rounded-full"
                  />
                  <motion.div
                    animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                    className="absolute w-8 h-8 bg-[#BC66FF]/20 rounded-full blur-sm"
                  />
                  <div className="absolute w-4 h-4 bg-[#BC66FF] rounded-full shadow-[0_0_15px_rgba(188,102,255,0.8)]" />
                </div>
                
                <div className="space-y-8">
                  <div className="flex flex-col items-center gap-4">
                    <h3 className="text-2xl font-bold text-white tracking-tight">Building Profile</h3>
                    <div className="h-1.5 w-48 bg-white/10 rounded-full overflow-hidden">
                      <motion.div 
                        className="h-full bg-[#BC66FF]"
                        initial={{ width: "0%" }}
                        animate={{ width: "100%" }}
                        transition={{ duration: 2, repeat: Infinity }}
                      />
                    </div>
                  </div>
                  <div className="space-y-4">
                    <p className="text-white text-xl sm:text-2xl font-black uppercase tracking-[0.3em] animate-pulse">
                      {progress?.message || "Please wait..."}
                    </p>
                    <p className="text-[#666666] text-sm max-w-sm mx-auto leading-relaxed">
                      Pulsar is analyzing {formData.name}&apos;s digital footprint to craft a high-performance profile.
                    </p>
                  </div>
                </div>
              </div>
            ) : showResultForm ? (
              <div className="flex flex-col h-full max-h-[85vh]">
                {/* Result Header */}
                <div className="px-6 sm:px-8 pt-6 sm:pt-8 pb-3 border-b border-[#2A2A2A] flex justify-between items-start">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 mb-0.5">
                      <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                      <span className="text-[10px] uppercase font-bold tracking-widest text-[#555555]">Build Complete</span>
                    </div>
                    <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Review & Edit</h2>
                  </div>
                  <button onClick={onClose} className="text-[#444444] hover:text-white transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Result Form */}
                <div className="px-6 sm:px-8 py-6 sm:py-8 space-y-6 overflow-y-auto min-h-[300px]">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-[#444444] uppercase tracking-wider">Name</label>
                      <input 
                        className="w-full bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-[#444444] transition-colors" 
                        value={resultData.name}
                        onChange={(e) => setResultData({ ...resultData, name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-[#444444] uppercase tracking-wider">Website</label>
                      <input 
                        className="w-full bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-[#444444] transition-colors" 
                        value={resultData.website}
                        onChange={(e) => setResultData({ ...resultData, website: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-[#444444] uppercase tracking-wider">Generated Summary</label>
                    <textarea 
                      className="w-full bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-[#444444] transition-colors min-h-[180px] sm:min-h-[260px] leading-relaxed resize-none" 
                      value={resultData.summary}
                      onChange={(e) => setResultData({ ...resultData, summary: e.target.value })}
                    />
                  </div>
                </div>

                {/* Result Actions */}
                <div className="px-6 sm:px-8 py-4 sm:py-6 bg-[#131313] border-t border-[#2A2A2A] flex flex-col gap-3">
                  {failureMessage && (
                    <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 flex items-start gap-3">
                      <span className="text-rose-400 text-sm leading-relaxed">{failureMessage}</span>
                      <button
                        type="button"
                        onClick={() => setFailureMessage(null)}
                        className="ml-auto text-rose-400/60 hover:text-rose-400 transition-colors shrink-0"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                    <p className="text-[11px] text-[#444444] text-center sm:text-left">
                      You can refine the AI-generated summary before finalizing the company record.
                    </p>
                    <div className="flex gap-4 w-full sm:w-auto justify-end">
                      <button 
                        onClick={() => setShowResultForm(false)}
                        className="text-xs font-bold text-[#666666] hover:text-white transition-colors uppercase tracking-wider px-2"
                      >
                        Back
                      </button>
                      <button 
                        disabled={saving}
                        onClick={handleFinalSave}
                        className="bg-white text-black px-6 sm:px-8 py-2.5 rounded-full text-xs font-bold uppercase tracking-widest hover:bg-[#dddddd] transition-all flex items-center justify-center gap-2 disabled:opacity-50 flex-1 sm:flex-none"
                      >
                        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                        {saving ? "Saving..." : "Confirm & Save"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {/* Modal Header */}
                <div className="px-6 sm:px-8 pt-8 sm:pt-10 pb-4 sm:pb-6 relative">
                  <button 
                    onClick={onClose}
                    className="absolute top-6 sm:top-8 right-6 sm:right-8 text-[#444444] hover:text-white transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                  
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-6 h-6 flex items-center justify-center overflow-hidden rounded bg-white/10 ring-1 ring-white/20">
                      <img src="/favicon.ico" className="w-4 h-4 object-contain brightness-0 invert" alt="Pulsar" />
                    </div>
                    <span className="text-[10px] uppercase tracking-[0.25em] text-[#555555] font-bold">New Entity</span>
                  </div>
                  <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Register Company</h2>
                  <p className="text-[#666666] text-[12px] sm:text-[13px] mt-1 sm:mt-2 leading-relaxed max-w-sm">
                    Initiate Pulsar&apos;s intelligent analysis to build your company profile.
                  </p>
                </div>

                {/* Form Section */}
                <form className="px-6 sm:px-8 pb-8 sm:pb-10 space-y-5 sm:space-y-6" onSubmit={handleSubmit}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-[#555555] uppercase tracking-wider">Company Name</label>
                      <input 
                        className="w-full bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-4 py-3 text-sm text-white placeholder-[#333333] focus:outline-none focus:border-[#444444] transition-colors" 
                        placeholder="Acme Corporation" 
                        type="text" 
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-bold text-[#555555] uppercase tracking-wider">Website URL</label>
                        <span className="text-[9px] text-[#222222] uppercase font-black">Optional</span>
                      </div>
                      <input 
                        className="w-full bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-4 py-3 text-sm text-white placeholder-https:// focus:outline-none focus:border-[#444444] transition-colors" 
                        placeholder="https://acme.com" 
                        type="url"
                        value={formData.website}
                        onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-[#555555] uppercase tracking-wider">Company Description</label>
                    <textarea 
                      className="w-full bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-4 py-4 text-sm text-white placeholder-Describe... focus:outline-none focus:border-[#444444] transition-colors min-h-[140px] resize-none leading-relaxed" 
                      placeholder="What is the core focus of your business?" 
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      required
                    />
                  </div>

                  {/* Error Banner */}
                  {failureMessage && (
                    <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 flex items-start gap-3">
                      <span className="text-rose-400 text-sm leading-relaxed">{failureMessage}</span>
                      <button
                        type="button"
                        onClick={() => setFailureMessage(null)}
                        className="ml-auto text-rose-400/60 hover:text-rose-400 transition-colors shrink-0"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="pt-6 flex items-center justify-end gap-6">
                    <button 
                      type="button"
                      onClick={onClose}
                      className="text-[12px] font-bold text-[#444444] hover:text-white transition-colors uppercase tracking-widest"
                    >
                      Cancel
                    </button>
                    <AnimatedButton 
                      type="submit"
                      className="h-12 px-10 rounded-full text-xs font-black uppercase tracking-[0.2em] bg-white text-black hover:bg-[#eeeeee] border-0 shadow-lg shadow-white/5 transition-all"
                    >
                      <span>Initialize Build</span>
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
