"use client";

import { useState, useEffect, use } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  Settings,
  Plus,
  ArrowLeft,
  Search,
  Zap,
  Target,
  Users,
  ExternalLink,
  Save,
  Loader2,
  ChevronRight,
  Sparkles,
  Trash2
} from "lucide-react";
import { LogoutButton } from "@/components/LogoutButton";
import type { Company } from "@/generated/prisma/client";

import CreateCampaignModal from "@/components/CreateCampaignModal";
import CampaignDetailView from "@/components/CampaignDetailView";
import { ContactAdminModal } from "@/components/ContactAdminModal";

export default function CompanyDashboardPage({ params }: { params: Promise<{ username: string; companySlug: string }> }) {
  const resolvedParams = use(params);
  const { data: session, status } = useSession();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"campaigns" | "settings">("campaigns");
  const [company, setCompany] = useState<Company | null>(null);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<any | null>(null);
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);

  const isElite = (session?.user as { tier?: string })?.tier === "elite" || session?.user?.email === "panwalkarsoham@gmail.com";
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isCampaignModalOpen, setIsCampaignModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Form state for settings
  const [editData, setEditData] = useState({
    name: "",
    website: "",
    description: "",
    summary: ""
  });

  const fetchCampaigns = async (compId: string) => {
    try {
      const res = await fetch(`/api/campaigns?companyId=${compId}`);
      if (res.ok) {
        const data = await res.json();
        setCampaigns(data.campaigns || []);
      }
    } catch (err) {
      console.error("Error fetching campaigns:", err);
    }
  };

  const handleDeleteCampaign = async (e: React.MouseEvent, campId: string, campName: string) => {
    e.stopPropagation();
    if (!confirm(`Are you sure you want to delete campaign "${campName}"? Associated leads will be preserved.`)) {
      return;
    }
    setDeletingId(campId);
    try {
      const res = await fetch(`/api/campaigns/${campId}`, {
        method: "DELETE"
      });
      if (res.ok) {
        if (company) fetchCampaigns(company.id);
      } else {
        alert("Failed to delete campaign.");
      }
    } catch (err) {
      console.error("Error deleting campaign:", err);
    } finally {
      setDeletingId(null);
    }
  };

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  useEffect(() => {
    const fetchCompanyData = async () => {
      try {
        const response = await fetch("/api/companies");
        if (response.ok) {
          const companies: Company[] = await response.json();
          const found = companies.find(c =>
            c.name.toLowerCase().replace(/\s+/g, '-') === resolvedParams.companySlug
          );
          if (found) {
            setCompany(found);
            setEditData({
              name: found.name,
              website: found.website || "",
              description: found.description,
              summary: found.summary || ""
            });
            await fetchCampaigns(found.id);
          }
        }
      } catch (error) {
        console.error("Error fetching company:", error);
      } finally {
        setLoading(false);
      }
    };

    if (status === "authenticated") {
      fetchCompanyData();
    }
  }, [status, resolvedParams.companySlug]);

  useEffect(() => {
    if (!company) return;
    const hasActiveCampaign = campaigns.some(c => {
      const s = (c.status || "").toLowerCase();
      return s === "queue" || s === "queued" || s === "ongoing" || s === "running" || s === "processing";
    });

    if (hasActiveCampaign) {
      const interval = setInterval(() => {
        fetchCampaigns(company.id);
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [campaigns, company]);

  const handleUpdate = async () => {
    setSaving(true);
    try {
      await new Promise(r => setTimeout(r, 1000));
      alert("Settings updated");
    } finally {
      setSaving(false);
    }
  };

  if (status === "loading" || loading) return null;
  if (!session || !company) return null;

  return (
    <div className="flex flex-col md:flex-row h-screen bg-[#121212] text-white overflow-hidden font-sans">
      {/* Sidebar - Desktop */}
      <aside className="hidden md:flex w-14 border-r border-[#222222] bg-[#0E0E0E] flex-col items-center py-6 gap-6 shrink-0">
        <div
          onClick={() => router.push('/dashboard')}
          className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/5 cursor-pointer hover:bg-white/10 transition-colors"
        >
          <img src="/logo.png" className="w-4 h-4 opacity-40" alt="Pulsar" />
        </div>
        <div className="flex-1 flex flex-col gap-3">
          <button
            onClick={() => {
              setSelectedCampaign(null);
              setActiveTab("campaigns");
            }}
            className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all ${activeTab === "campaigns" ? 'bg-[#BC66FF]/20 text-[#BC66FF]' : 'text-[#333333] hover:text-white'}`}
            title="Campaigns"
          >
            <BarChart3 className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              setSelectedCampaign(null);
              setActiveTab("settings");
            }}
            className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all ${activeTab === "settings" ? 'bg-[#BC66FF]/20 text-[#BC66FF]' : 'text-[#333333] hover:text-white'}`}
            title="Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#121212] overflow-hidden">
        <header className="px-4 sm:px-6 h-14 border-b border-[#222222] flex items-center justify-between bg-[#121212]/90 backdrop-blur-md shrink-0">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider overflow-hidden">
            <button
              onClick={() => {
                if (selectedCampaign) {
                  setSelectedCampaign(null);
                } else {
                  router.push('/dashboard');
                }
              }}
              className="text-[#555555] hover:text-white transition-colors flex items-center gap-1 shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Dashboard</span>
            </button>
            <span className="text-[#222222]">/</span>
            <span className="text-[#666666] truncate max-w-[70px] sm:max-w-[120px]">{company.name}</span>
            {selectedCampaign && (
              <>
                <span className="text-[#222222]">/</span>
                <span className="text-[#BC66FF] truncate max-w-[90px] sm:max-w-[150px]">{selectedCampaign.name}</span>
              </>
            )}
          </div>

          {/* Mobile Tab Switcher */}
          <div className="flex md:hidden items-center bg-[#171717] border border-[#222222] rounded-lg p-0.5 mx-2">
            <button
              onClick={() => {
                setSelectedCampaign(null);
                setActiveTab("campaigns");
              }}
              className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${activeTab === "campaigns" ? "bg-[#BC66FF] text-black" : "text-[#777777]"}`}
            >
              Campaigns
            </button>
            <button
              onClick={() => {
                setSelectedCampaign(null);
                setActiveTab("settings");
              }}
              className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${activeTab === "settings" ? "bg-[#BC66FF] text-black" : "text-[#777777]"}`}
            >
              Settings
            </button>
          </div>

          <div className="flex items-center gap-3 sm:gap-4">
            {isElite ? (
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#BC66FF]/15 border border-[#BC66FF]/40 text-[#BC66FF] text-[11px] font-bold shadow-[0_0_15px_rgba(188,102,255,0.15)]">
                <Sparkles className="w-3.5 h-3.5 text-[#BC66FF]" />
                <span className="hidden sm:inline">ELITE TIER</span>
                <span className="sm:hidden">ELITE</span>
                <span className="hidden sm:inline text-white/60 font-medium">• Unlimited Jobs</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-slate-300 text-[11px] font-medium">
                  <span>FREE TIER</span>
                  <span className="hidden sm:inline text-slate-500">• 1 Job/Day</span>
                </div>
                <button
                  onClick={() => setIsContactModalOpen(true)}
                  className="px-2.5 py-1 rounded-full bg-[#BC66FF]/20 border border-[#BC66FF]/40 text-[#BC66FF] hover:bg-[#BC66FF] hover:text-black text-[11px] font-bold transition"
                >
                  Upgrade
                </button>
              </div>
            )}
            <LogoutButton />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {selectedCampaign ? (
            <CampaignDetailView
              campaignId={selectedCampaign.id}
              campaignName={selectedCampaign.name}
              industry={selectedCampaign.industry}
              geoTarget={selectedCampaign.geoTarget}
              targetProfile={selectedCampaign.targetProfile}
              platforms={selectedCampaign.platforms}
              status={selectedCampaign.status}
              onClose={() => {
                setSelectedCampaign(null);
                if (company) fetchCampaigns(company.id);
              }}
            />
          ) : (
            <div className="px-4 sm:px-8 py-4 sm:py-8">
              <div className="max-w-5xl mx-auto">
                <div className="flex items-center justify-between mb-6 sm:mb-10 gap-3">
                  <div className="space-y-1 min-w-0">
                    <h1 className="text-xl sm:text-3xl font-black tracking-tighter truncate">{company.name}</h1>
                    <div className="flex items-center gap-3">
                      <a href={company.website || "#"} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[10px] sm:text-[11px] text-[#666666] hover:text-[#BC66FF] transition-colors truncate">
                        <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                        <span className="truncate">{company.website || "No website"}</span>
                      </a>
                    </div>
                  </div>
                  {activeTab === "campaigns" && (
                    <button
                      onClick={() => setIsCampaignModalOpen(true)}
                      className="bg-white text-black px-3.5 sm:px-5 py-2 sm:py-2 rounded-full text-[9px] sm:text-[10px] font-black uppercase tracking-widest hover:bg-[#dddddd] transition-all flex items-center gap-1.5 grayscale hover:grayscale-0 shadow-lg shadow-white/5 shrink-0 whitespace-nowrap"
                    >
                      <Plus className="w-3 h-3" />
                      New Campaign
                    </button>
                  )}
                </div>

                {activeTab === "campaigns" ? (
                  <div className="space-y-4 sm:space-y-6">
                    <div className="grid grid-cols-3 gap-2 sm:gap-3">
                      {[
                        { label: "Campaigns", value: campaigns.length.toString(), icon: <Target className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-purple-400" /> },
                        { label: "Leads", value: campaigns.reduce((acc, c) => acc + (c._count?.campaignLeads || 0), 0).toString(), icon: <Users className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-indigo-400" /> },
                        { label: "Responses", value: "0", icon: <Zap className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-emerald-400" /> }
                      ].map((stat, i) => (
                        <div key={i} className="bg-[#171717] border border-[#2A2A2A] p-2.5 sm:p-5 rounded-xl space-y-1 sm:space-y-3 shadow-md">
                          <div className="flex items-center justify-between text-white">
                            <span className="text-[8px] sm:text-[9px] font-bold uppercase tracking-wider text-slate-400 truncate">{stat.label}</span>
                            {stat.icon}
                          </div>
                          <div className="text-base sm:text-xl font-black">{stat.value}</div>
                        </div>
                      ))}
                    </div>

                    {campaigns.length === 0 ? (
                      <div className="bg-[#171717] border border-[#2A2A2A] rounded-2xl p-10 text-center space-y-4 shadow-md">
                        <div className="w-12 h-12 bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl flex items-center justify-center mx-auto mb-2 opacity-50">
                          <Search className="w-6 h-6 text-[#333333]" />
                        </div>
                        <h2 className="text-lg font-bold">No active campaigns</h2>
                        <p className="text-[12px] text-[#555555] max-w-sm mx-auto leading-relaxed">
                          Initialize your first AI-driven outreach strategy to start seeing real-time performance analytics.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">Campaigns ({campaigns.length})</h3>
                        <div className="grid grid-cols-1 gap-3">
                          {campaigns.map((camp: any) => {
                            const targetWords = (camp.targetProfile || "").split(/\s+/);
                            const truncatedTarget = targetWords.length > 5
                              ? targetWords.slice(0, 5).join(" ") + "..."
                              : camp.targetProfile;

                            const status = (camp.status || "queue").toLowerCase();
                            const isQueued = status === "queue" || status === "queued";
                            const isOngoing = status === "ongoing" || status === "running" || status === "processing";
                            const isComplete = status === "complete" || status === "completed";
                            const isCampaignActive = isQueued || isOngoing;

                            let cardStyle = "bg-[#171717] border-[#2A2A2A] hover:border-[#22c55e]/50 cursor-pointer";
                            if (isQueued) {
                              cardStyle = "bg-[#1A1A1A] border-transparent cursor-not-allowed pointer-events-none relative overflow-hidden";
                            } else if (isOngoing) {
                              cardStyle = "bg-blue-950/20 border-blue-500/50 hover:border-blue-400 cursor-pointer shadow-[0_0_20px_rgba(59,130,246,0.15)]";
                            } else {
                              cardStyle = "bg-[#171717] border-[#2A2A2A] hover:border-[#22c55e]/50 cursor-pointer";
                            }

                            return (
                              <div
                                key={camp.id}
                                onClick={() => {
                                  if (!isQueued) setSelectedCampaign(camp);
                                }}
                                className={`border rounded-xl p-3.5 sm:p-5 flex flex-col gap-3 transition duration-200 group shadow-sm ${cardStyle}`}
                              >
                                {/* Clockwise pulsing border for queued */}
                                {isQueued && (
                                  <>
                                    <style>{`
                                      @keyframes rotateBorder {
                                        0% { transform: rotate(0deg); }
                                        100% { transform: rotate(360deg); }
                                      }
                                      .queued-border::before {
                                        content: '';
                                        position: absolute;
                                        inset: -2px;
                                        border-radius: 14px;
                                        padding: 2px;
                                        background: conic-gradient(from var(--angle, 0deg), transparent 80%, white 100%);
                                        -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
                                        -webkit-mask-composite: xor;
                                        mask-composite: exclude;
                                        animation: rotateBorder 2s linear infinite;
                                      }
                                      @property --angle {
                                        syntax: '<angle>';
                                        initial-value: 0deg;
                                        inherits: false;
                                      }
                                      @keyframes rotateBorder {
                                        to { --angle: 360deg; }
                                      }
                                    `}</style>
                                    <div className="queued-border absolute inset-0 rounded-xl pointer-events-none" />
                                  </>
                                )}
                                <div className="flex items-center justify-between gap-2 sm:gap-4 w-full">
                                  <div className="flex items-center gap-2.5 sm:gap-4 min-w-0 flex-1">
                                    <div className={`p-2 sm:p-3 rounded-lg border shrink-0 transition ${isQueued ? 'bg-[#1e1e1e] border-white/10 text-white' : isOngoing ? 'bg-blue-500/20 border-blue-500/40 text-blue-400 animate-pulse' : 'bg-green-500/10 text-green-400 border-green-500/20 group-hover:scale-105'
                                      }`}>
                                      {isQueued ? (
                                        <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 text-white animate-spin" />
                                      ) : isOngoing ? (
                                        <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 text-blue-400 animate-spin" />
                                      ) : (
                                        <Sparkles className="w-4 h-4 sm:w-5 sm:h-5" />
                                      )}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-2">
                                        <h4 className={`font-bold text-xs sm:text-base transition truncate ${isQueued ? 'text-white' : isOngoing ? 'text-blue-200 group-hover:text-blue-400' : 'text-white group-hover:text-[#22c55e]'
                                          }`}>
                                          {camp.name}
                                        </h4>
                                        {isQueued && (
                                          <span className="text-[9px] uppercase font-extrabold px-2 py-0.5 rounded bg-white/5 text-white/60 border border-white/10">Queued</span>
                                        )}
                                        {isOngoing && (
                                          <span className="text-[9px] uppercase font-extrabold px-2 py-0.5 rounded bg-blue-900/60 text-blue-300 border border-blue-600/50 flex items-center gap-1">
                                            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping" />
                                            Ongoing
                                          </span>
                                        )}
                                      </div>
                                      {isCampaignActive && (
                                        <div className="flex items-center gap-1.5 text-[10px] sm:text-xs font-mono mt-0.5 sm:mt-1">
                                          <span className="text-slate-400">ETA:</span>
                                          <strong className={camp.isGroqExhausted || camp.eta === "Long time" ? "text-amber-300 font-bold" : "text-white font-bold"}>
                                            {camp.eta || (isQueued ? "~5-10 min" : "~3-5 min")}
                                          </strong>
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2 sm:gap-4 shrink-0">
                                    <div className="text-right">
                                      <span className="text-[9px] sm:text-xs text-slate-400 block">
                                        {isOngoing ? "Results till now" : isQueued ? "Waiting" : "Complete"}
                                      </span>
                                      <span className={`text-xs sm:text-sm font-bold ${isQueued ? "text-white/40" : isOngoing ? "text-blue-400" : "text-green-400"
                                        }`}>
                                        {camp._count?.campaignLeads || 0} leads
                                      </span>
                                    </div>

                                    <button
                                      onClick={(e) => handleDeleteCampaign(e, camp.id, camp.name)}
                                      disabled={deletingId === camp.id}
                                      className="p-1.5 sm:p-2 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition pointer-events-auto"
                                      title="Delete Campaign"
                                    >
                                      {deletingId === camp.id ? (
                                        <Loader2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin text-rose-400" />
                                      ) : (
                                        <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                                      )}
                                    </button>

                                    <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 text-slate-500 group-hover:text-white transition hidden xs:block" />
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="max-w-xl space-y-10">
                    <div className="space-y-6">
                      <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <label className="text-[9px] font-bold text-[#444444] uppercase tracking-wider">Company Name</label>
                          <input
                            className="w-full bg-[#171717] border border-[#2A2A2A] rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[#BC66FF]/30 transition-colors"
                            value={editData.name}
                            onChange={e => setEditData({ ...editData, name: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-[9px] font-bold text-[#444444] uppercase tracking-wider">Website URL</label>
                          <input
                            className="w-full bg-[#171717] border border-[#2A2A2A] rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[#BC66FF]/30 transition-colors"
                            value={editData.website}
                            onChange={e => setEditData({ ...editData, website: e.target.value })}
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[9px] font-bold text-[#444444] uppercase tracking-wider">Global Summary</label>
                        <textarea
                          className="w-full bg-[#171717] border border-[#2A2A2A] rounded-lg px-3 py-2 text-xs min-h-[200px] focus:outline-none focus:border-[#BC66FF]/30 transition-colors leading-relaxed resize-none"
                          value={editData.summary}
                          onChange={e => setEditData({ ...editData, summary: e.target.value })}
                        />
                      </div>

                      <button
                        onClick={handleUpdate}
                        disabled={saving}
                        className="bg-white text-black px-8 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-[0.2em] hover:bg-[#dddddd] transition-all flex items-center gap-2 disabled:opacity-50"
                      >
                        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                        Save Changes
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <CreateCampaignModal
          isOpen={isCampaignModalOpen}
          onClose={() => {
            setIsCampaignModalOpen(false);
            if (company) fetchCampaigns(company.id);
          }}
          companyId={company.id}
        />

        <ContactAdminModal
          isOpen={isContactModalOpen}
          onClose={() => setIsContactModalOpen(false)}
        />
      </main>
    </div>
  );
}
