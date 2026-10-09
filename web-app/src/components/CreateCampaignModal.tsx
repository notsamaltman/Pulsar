import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, AlertCircle } from "lucide-react";
import Stepper, { Step } from "./Stepper";
import { useServiceHealth } from "./ServiceHealthProvider";

interface CreateCampaignModalProps {
  isOpen: boolean;
  onClose: () => void;
  companyId?: string;
}

export default function CreateCampaignModal({ isOpen, onClose, companyId }: CreateCampaignModalProps) {
  const { isOffline } = useServiceHealth();
  const [formData, setFormData] = useState({
    campaignName: "",
    goalType: "Lead Generation",
    industry: "",
    geoTarget: "",
    budget: "Organic Outreach ($0)",
    targetProfile: "",
    focus: "B2B (Business-to-Business)",
    minFollowers: "",
    exclusions: "",
    b2bSignals: [] as string[],
    minEngagement: "",
    contentType: "",
    channels: [] as string[],
    platforms: ["youtube", "instagram", "producthunt"] as string[],
    tone: "Professional / Formal",
    sequence: "3 Touchpoints (Standard)"
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState<{ title: string; message: string; code?: string } | null>(null);


  const validateStep = (step: number) => {
    const newErrors: Record<string, string> = {};
    if (step === 1) {
      if (!formData.campaignName.trim()) newErrors.campaignName = "Campaign name is required";
      if (!formData.industry.trim()) newErrors.industry = "Industry is required";
      if (!formData.geoTarget.trim()) newErrors.geoTarget = "Geographic target is required";
    } else if (step === 2) {
      if (!formData.targetProfile.trim()) newErrors.targetProfile = "Target profile is required";
    } else if (step === 3) {
      const hasB2bSignal = formData.b2bSignals.length > 0;
      const hasInfluencerSignal = formData.minEngagement.trim() || formData.contentType.trim();
      if (!hasB2bSignal && !hasInfluencerSignal) {
        newErrors.intent = "Provide at least one B2B signal or Influencer requirement";
      }
    } else if (step === 4) {
      if (formData.channels.length === 0) newErrors.channels = "Select at least one preferred channel";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleCheckbox = (field: 'b2bSignals' | 'channels', value: string) => {
    setFormData(prev => {
      const arr = prev[field];
      if (arr.includes(value)) {
        return { ...prev, [field]: arr.filter(item => item !== value) };
      } else {
        return { ...prev, [field]: [...arr, value] };
      }
    });
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
          {/* Overlay */}
          <motion.div
            initial={{opacity: 0}}
            animate={{opacity: 1}}
            exit={{opacity: 0}}
            className="absolute inset-0 bg-background/80 backdrop-blur-md"
            onClick={onClose}
          />

          {/* Modal Container */}
          <motion.div
            initial={{opacity: 0, scale: 0.95, y: 10}}
            animate={{opacity: 1, scale: 1, y: 0}}
            exit={{opacity: 0, scale: 0.95, y: 10}}
            className="w-full max-w-4xl max-h-[92vh] flex flex-col relative z-10"
          >
            <button 
              onClick={onClose}
              className="absolute top-4 right-4 sm:top-6 sm:right-6 z-50 text-[#888888] hover:text-white transition-colors bg-[#171717] rounded-full p-2"
              title="Close"
            >
              <X className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
            {apiError && (
              <div className="mb-3 mx-4 sm:mx-6 p-3 sm:p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-start gap-3 text-rose-300">
                <AlertCircle className="w-4 h-4 sm:w-5 sm:h-5 text-rose-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-xs font-bold uppercase tracking-wider text-rose-200">{apiError.title}</p>
                  <p className="text-xs text-rose-300/90">{apiError.message}</p>
                </div>
              </div>
            )}
            <Stepper
              validateStep={validateStep}
              onFinalStepCompleted={async () => {
                setApiError(null);
                if (isOffline) {
                  setApiError({
                    title: "Backend Service Down",
                    message: "The backend execution server is currently offline or unreachable. Please try again in a few moments."
                  });
                  return;
                }
                try {
                  const res = await fetch("/api/job/campaign", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ...formData, companyId })
                  });

                  if (res.ok) {
                    onClose();
                  } else {
                    const data = await res.json();
                    if (data.code === "DAILY_LIMIT_REACHED") {
                      setApiError({
                        code: data.code,
                        title: "Daily Free Limit Reached",
                        message: data.message || "To ensure high quality and prevent platform abuse, free tier users can launch 1 successful campaign per day. Please try again tomorrow!"
                      });
                    } else if (data.code === "SERVER_BUSY" || res.status === 503) {
                      setApiError({
                        code: data.code || "SERVER_BUSY",
                        title: "System At Capacity",
                        message: data.message || "Our execution queues are currently full (500 active jobs). Please wait a few minutes and try again."
                      });
                    } else {
                      setApiError({
                        title: "Campaign Enqueue Failed",
                        message: data.error || data.message || "An unexpected error occurred while launching your campaign."
                      });
                    }
                  }
                } catch {
                  setApiError({
                    title: "Network Error",
                    message: "Unable to connect to server. Please check your internet connection."
                  });
                }

              }}

              stepCircleContainerClassName="!rounded-2xl"
              stepContainerClassName="!px-4 !py-4 sm:!px-8 sm:!py-6 !border-b border-[#2A2A2A]"
              contentClassName="!p-0"
              footerClassName="!px-4 !py-4 sm:!px-8 sm:!py-5 !border-t border-[#2A2A2A]"
              disableStepIndicators={false}
            >
              {/* Step 1: Basics */}
              <Step 
                title="Campaign Basics" 
                description="Define the core metadata and objective of this campaign."
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 pt-2">
                  <div className="space-y-2 col-span-1">
                    <label className="text-[10px] font-bold text-[#555555] uppercase tracking-wider">Campaign Name *</label>
                    <input 
                      value={formData.campaignName}
                      onChange={e => setFormData({ ...formData, campaignName: e.target.value })}
                      className={`w-full bg-[#1A1A1A] border rounded-lg px-4 py-3 text-sm text-white focus:outline-none transition-colors ${errors.campaignName ? 'border-red-500/50 focus:border-red-500' : 'border-[#2A2A2A] focus:border-[#BC66FF]/50'}`}
                      placeholder="e.g. Q3 Founders Outreach" 
                    />
                    {errors.campaignName && <p className="text-red-400 text-[10px] uppercase font-bold tracking-wider">{errors.campaignName}</p>}
                  </div>
                  <div className="space-y-2 col-span-1">
                    <label className="text-[10px] font-bold text-[#555555] uppercase tracking-wider">Goal Type</label>
                    <select 
                      value={formData.goalType}
                      onChange={e => setFormData({ ...formData, goalType: e.target.value })}
                      className="w-full bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-[#BC66FF]/50 transition-colors appearance-none">
                      <option>Lead Generation</option>
                      <option>Influencer Outreach</option>
                      <option>Partnership</option>
                      <option>Hiring</option>
                    </select>
                  </div>
                  <div className="space-y-2 col-span-1">
                    <label className="text-[10px] font-bold text-[#555555] uppercase tracking-wider">Industry / Niche *</label>
                    <input 
                      value={formData.industry}
                      onChange={e => setFormData({ ...formData, industry: e.target.value })}
                      className={`w-full bg-[#1A1A1A] border rounded-lg px-4 py-3 text-sm text-white focus:outline-none transition-colors ${errors.industry ? 'border-red-500/50 focus:border-red-500' : 'border-[#2A2A2A] focus:border-[#BC66FF]/50'}`}
                      placeholder="e.g. SaaS, E-commerce, AI" 
                    />
                    {errors.industry && <p className="text-red-400 text-[10px] uppercase font-bold tracking-wider">{errors.industry}</p>}
                  </div>
                  <div className="space-y-2 col-span-1">
                    <label className="text-[10px] font-bold text-[#555555] uppercase tracking-wider">Geographic Target *</label>
                    <input 
                      value={formData.geoTarget}
                      onChange={e => setFormData({ ...formData, geoTarget: e.target.value })}
                      className={`w-full bg-[#1A1A1A] border rounded-lg px-4 py-3 text-sm text-white focus:outline-none transition-colors ${errors.geoTarget ? 'border-red-500/50 focus:border-red-500' : 'border-[#2A2A2A] focus:border-[#BC66FF]/50'}`}
                      placeholder="e.g. North America, UK, Global" 
                    />
                    {errors.geoTarget && <p className="text-red-400 text-[10px] uppercase font-bold tracking-wider">{errors.geoTarget}</p>}
                  </div>
                  <div className="space-y-2 col-span-full">
                    <label className="text-[10px] font-bold text-[#555555] uppercase tracking-wider">Budget Range (Paid vs Organic)</label>
                    <select 
                      value={formData.budget}
                      onChange={e => setFormData({ ...formData, budget: e.target.value })}
                      className="w-full bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-[#BC66FF]/50 transition-colors appearance-none">
                      <option>Organic Outreach ($0)</option>
                      <option>Low Budget ($1k - $5k)</option>
                      <option>Medium Budget ($5k - $20k)</option>
                      <option>Enterprise ($20k+)</option>
                    </select>
                  </div>
                </div>
              </Step>

              {/* Step 2: Audience Definition */}
              <Step 
                title="Audience Definition" 
                description="Who precisely are we targeting and filtering out?"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 pt-2">
                  <div className="space-y-2 col-span-full">
                    <label className="text-[10px] font-bold text-[#555555] uppercase tracking-wider">Target Profile (Title, Niche, Size) *</label>
                    <input 
                      value={formData.targetProfile}
                      onChange={e => setFormData({ ...formData, targetProfile: e.target.value })}
                      className={`w-full bg-[#1A1A1A] border rounded-lg px-4 py-3 text-sm text-white focus:outline-none transition-colors ${errors.targetProfile ? 'border-red-500/50 focus:border-red-500' : 'border-[#2A2A2A] focus:border-[#BC66FF]/50'}`}
                      placeholder="e.g. CTOs at 50-200 employee startups" 
                    />
                    {errors.targetProfile && <p className="text-red-400 text-[10px] uppercase font-bold tracking-wider">{errors.targetProfile}</p>}
                  </div>
                  <div className="space-y-2 col-span-1">
                    <label className="text-[10px] font-bold text-[#555555] uppercase tracking-wider">Focus</label>
                    <select 
                      value={formData.focus}
                      onChange={e => setFormData({ ...formData, focus: e.target.value })}
                      className="w-full bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-[#BC66FF]/50 transition-colors appearance-none">
                      <option>B2B (Business-to-Business)</option>
                      <option>B2C (Business-to-Consumer)</option>
                      <option>Both</option>
                    </select>
                  </div>
                  <div className="space-y-2 col-span-1">
                    <label className="text-[10px] font-bold text-[#555555] uppercase tracking-wider">Minimum Follower Count (Optional)</label>
                    <input 
                      value={formData.minFollowers}
                      onChange={e => setFormData({ ...formData, minFollowers: e.target.value })}
                      className="w-full bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-[#BC66FF]/50 transition-colors" 
                      placeholder="e.g. 10,000" 
                    />
                  </div>
                  <div className="space-y-2 col-span-full">
                    <label className="text-[10px] font-bold text-[#555555] uppercase tracking-wider">Exclusions (Negative Filters)</label>
                    <textarea 
                      value={formData.exclusions}
                      onChange={e => setFormData({ ...formData, exclusions: e.target.value })}
                      className="w-full bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-[#BC66FF]/50 transition-colors min-h-[80px] resize-none" 
                      placeholder="e.g. Reject direct competitors, enterprise companies, users with 'student' in bio" 
                    />
                  </div>
                </div>
              </Step>

              {/* Step 3: Intent Signals */}
              <Step 
                title="Intent Signals" 
                description="Which behavioral signals indicate a prospect is ready to engage?"
              >
                <div className="space-y-3 sm:space-y-6 pt-1 sm:pt-2">
                  {errors.intent && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center gap-3">
                      <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
                      <p className="text-red-400 text-xs font-medium">{errors.intent}</p>
                    </div>
                  )}
                  
                  <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-3 sm:p-6 space-y-3 sm:space-y-5">
                    <h4 className="text-xs sm:text-sm font-bold text-white uppercase tracking-widest">B2B Intent Signals</h4>
                    <div className="space-y-4">
                      {['Recently Raised Funding', 'Actively Hiring for related roles', 'Published content on relevant topics'].map((signal, i) => (
                        <label key={i} className="flex items-center gap-2 sm:gap-4 cursor-pointer group">
                          <div className={`w-4 h-4 sm:w-5 sm:h-5 rounded shrink-0 flex items-center justify-center transition-colors border ${formData.b2bSignals.includes(signal) ? 'bg-[#BC66FF] border-[#BC66FF]' : 'border-[#444] bg-[#111] group-hover:border-[#BC66FF]'}`}>
                            <input 
                              type="checkbox" 
                              className="opacity-0 absolute" 
                              checked={formData.b2bSignals.includes(signal)}
                              onChange={() => handleCheckbox('b2bSignals', signal)}
                            />
                            {formData.b2bSignals.includes(signal) && <div className="w-2 h-2 rounded-[2px] bg-white" />}
                          </div>
                          <span className={`text-xs sm:text-sm transition-colors ${formData.b2bSignals.includes(signal) ? 'text-white font-medium' : 'text-[#888] group-hover:text-white'}`}>{signal}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  
                  <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-3 sm:p-6 space-y-3 sm:space-y-5">
                    <h4 className="text-xs sm:text-sm font-bold text-white uppercase tracking-widest">Influencer / Creator Signals</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold text-[#555555] uppercase tracking-wider">Min. Engagement Rate</label>
                        <input 
                          value={formData.minEngagement}
                          onChange={e => setFormData({ ...formData, minEngagement: e.target.value })}
                          className="w-full bg-[#111111] border border-[#2A2A2A] rounded-lg px-3 py-2.5 sm:px-4 sm:py-3 text-sm text-white focus:outline-none focus:border-[#BC66FF]/50" 
                          placeholder="e.g. 2.5%" 
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold text-[#555555] uppercase tracking-wider">Key Content Type</label>
                        <input 
                          value={formData.contentType}
                          onChange={e => setFormData({ ...formData, contentType: e.target.value })}
                          className="w-full bg-[#111111] border border-[#2A2A2A] rounded-lg px-3 py-2.5 sm:px-4 sm:py-3 text-sm text-white focus:outline-none focus:border-[#BC66FF]/50" 
                          placeholder="e.g. Video, Threads" 
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </Step>

              {/* Step 4: Outreach */}
              <Step 
                title="Outreach Preferences" 
                description="Define the execution logistics for engaging the audience."
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 pt-2">
                    <div className="flex flex-col gap-2 col-span-full">
                       <label className="text-[10px] font-bold text-[#555555] uppercase tracking-wider">Target Platforms (Restricts Agents &amp; UI Tabs) *</label>
                       <div className="flex flex-col xs:flex-row gap-3">
                         {[
                           { id: "youtube", label: "YouTube" },
                           { id: "instagram", label: "Instagram" },
                           { id: "producthunt", label: "ProductHunt" }
                         ].map(plat => {
                           const isSelected = (formData.platforms || ["youtube", "instagram", "producthunt"]).includes(plat.id);
                           return (
                             <label key={plat.id} className="flex-1 cursor-pointer">
                               <input
                                 type="checkbox"
                                 className="peer hidden"
                                 checked={isSelected}
                                 onChange={() => {
                                   const current = formData.platforms || ["youtube", "instagram", "producthunt"];
                                   let next: string[];
                                   if (isSelected) {
                                     if (current.length === 1) return;
                                     next = current.filter(p => p !== plat.id);
                                   } else {
                                     next = [...current, plat.id];
                                   }
                                   setFormData({ ...formData, platforms: next });
                                 }}
                               />
                               <div className="w-full py-4 px-3 border border-[#2A2A2A] bg-[#1A1A1A] rounded-lg flex items-center justify-center gap-2.5 text-xs font-bold text-[#666] uppercase tracking-wider hover:border-[#444] peer-checked:border-[#BC66FF] peer-checked:text-[#BC66FF] peer-checked:bg-[#BC66FF]/10 transition-all">
                                 <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-all ${isSelected ? "bg-[#BC66FF] border-[#BC66FF]" : "border-[#444] bg-[#111]"}`}>
                                   {isSelected && (
                                     <svg className="w-2.5 h-2.5 text-black" viewBox="0 0 10 10" fill="none">
                                       <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                                     </svg>
                                   )}
                                 </span>
                                 {plat.label}
                               </div>
                             </label>
                           );
                         })}
                       </div>
                    </div>

                    <div className="space-y-3 col-span-full">
                    <div className="flex items-center justify-between">
                       <label className="text-[10px] font-bold text-[#555555] uppercase tracking-wider">Preferred Channels *</label>
                       {errors.channels && <span className="text-red-400 text-[10px] uppercase font-bold tracking-wider">{errors.channels}</span>}
                    </div>
                    <div className="flex flex-col xs:flex-row gap-3">
                      {['Email', 'LinkedIn InMail', 'Twitter DM'].map((chan, i) => (
                         <label key={i} className="flex-1">
                           <input 
                             type="checkbox" 
                             className="peer hidden" 
                             checked={formData.channels.includes(chan)}
                             onChange={() => handleCheckbox('channels', chan)}
                           />
                           <div className="w-full py-4 border border-[#2A2A2A] bg-[#1A1A1A] rounded-lg text-center text-xs font-bold text-[#666] uppercase cursor-pointer hover:border-[#444] peer-checked:border-[#BC66FF] peer-checked:text-[#BC66FF] peer-checked:bg-[#BC66FF]/10 transition-all">
                             {chan}
                           </div>
                         </label>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2 col-span-1">
                    <label className="text-[10px] font-bold text-[#555555] uppercase tracking-wider">Messaging Tone</label>
                    <select 
                      value={formData.tone}
                      onChange={e => setFormData({ ...formData, tone: e.target.value })}
                      className="w-full bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-[#BC66FF]/50 transition-colors appearance-none">
                      <option>Professional / Formal</option>
                      <option>Casual & Direct</option>
                      <option>Humorous / Witty</option>
                      <option>Consultative</option>
                    </select>
                  </div>
                  <div className="space-y-2 col-span-1">
                    <label className="text-[10px] font-bold text-[#555555] uppercase tracking-wider">Sequence Length</label>
                    <select 
                      value={formData.sequence}
                      onChange={e => setFormData({ ...formData, sequence: e.target.value })}
                      className="w-full bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-[#BC66FF]/50 transition-colors appearance-none"
                    >
                      <option>1 Touchpoint (Single message)</option>
                      <option>3 Touchpoints (Standard)</option>
                      <option>5+ Touchpoints (Aggressive)</option>
                    </select>
                  </div>
                </div>
              </Step>
            </Stepper>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
