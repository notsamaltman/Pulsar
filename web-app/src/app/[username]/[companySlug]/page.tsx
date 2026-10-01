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

export default function CompanyDashboardPage({ params }: { params: Promise<{ username: string; companySlug: string }> }) {
  const resolvedParams = use(params);
  const { data: session, status } = useSession();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"campaigns" | "settings">("campaigns");
  const [company, setCompany] = useState<Company | null>(null);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<any | null>(null);
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
    <div className="flex h-screen bg-[#121212] text-white overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-14 border-r border-[#222222] bg-[#0E0E0E] flex flex-col items-center py-6 gap-6">
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
          >
            <BarChart3 className="w-4 h-4" />
          </button>
          <button 
            onClick={() => {
              setSelectedCampaign(null);
              setActiveTab("settings");
            }}
            className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all ${activeTab === "settings" ? 'bg-[#BC66FF]/20 text-[#BC66FF]' : 'text-[#333333] hover:text-white'}`}
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#121212]">
        <header className="px-6 h-12 border-b border-[#222222] flex items-center justify-between bg-[#121212]/80 backdrop-blur-md">
           <div className="flex items-center gap-2.5 text-[10px] font-bold uppercase tracking-wider">
              <button 
                onClick={() => {
                  if (selectedCampaign) {
                    setSelectedCampaign(null);
                  } else {
                    router.push('/dashboard');
                  }
                }}
                className="text-[#555555] hover:text-white transition-colors flex items-center gap-1.5"
              >
                <ArrowLeft className="w-3 h-3" />
                <span>Dashboard</span>
              </button>
              <span className="text-[#222222]">/</span>
              <span className="text-[#666666]">{session.user?.name}</span>
              <span className="text-[#222222]">/</span>
              <span className="text-[#666666]">{company.name}</span>
              {selectedCampaign && (
                <>
                  <span className="text-[#222222]">/</span>
                  <span className="text-[#BC66FF]">{selectedCampaign.name}</span>
                </>
              )}
           </div>
           <LogoutButton />
        </header>

        <div className="flex-1 overflow-y-auto">
          {selectedCampaign ? (
            <CampaignDetailView
              campaignId={selectedCampaign.id}
              campaignName={selectedCampaign.name}
              industry={selectedCampaign.industry}
              geoTarget={selectedCampaign.geoTarget}
              targetProfile={selectedCampaign.targetProfile}
              onClose={() => {
                setSelectedCampaign(null);
                if (company) fetchCampaigns(company.id);
              }}
            />
          ) : (
            <div className="px-8 py-8">
              <div className="max-w-5xl mx-auto">
                <div className="flex items-end justify-between mb-10">
                   <div className="space-y-3">
                      <h1 className="text-3xl font-black tracking-tighter">{company.name}</h1>
                      <div className="flex items-center gap-5">
                        <a href={company.website || "#"} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[11px] text-[#666666] hover:text-[#BC66FF] transition-colors">
                          <ExternalLink className="w-2.5 h-2.5" />
                          {company.website || "No website"}
                        </a>
                      </div>
                   </div>
                   {activeTab === "campaigns" && (
                     <button 
                       onClick={() => setIsCampaignModalOpen(true)}
                       className="bg-white text-black px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-widest hover:bg-[#dddddd] transition-all flex items-center gap-1.5 grayscale hover:grayscale-0 shadow-lg shadow-white/5"
                     >
                       <Plus className="w-3 h-3" />
                       New Campaign
                     </button>
                   )}
                </div>

                {activeTab === "campaigns" ? (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                       {[
                         { label: "Total Campaigns", value: campaigns.length.toString(), icon: <Target className="w-3.5 h-3.5 text-purple-400" /> },
                         { label: "Leads Detected", value: campaigns.reduce((acc, c) => acc + (c._count?.campaignLeads || 0), 0).toString(), icon: <Users className="w-3.5 h-3.5 text-indigo-400" /> },
                         { label: "Active Responses", value: "0", icon: <Zap className="w-3.5 h-3.5 text-emerald-400" /> }
                       ].map((stat, i) => (
                         <div key={i} className="bg-[#171717] border border-[#2A2A2A] p-5 rounded-xl space-y-3 shadow-md">
                            <div className="flex items-center justify-between text-white">
                              <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{stat.label}</span>
                              {stat.icon}
                            </div>
                            <div className="text-xl font-black">{stat.value}</div>
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
                          {campaigns.map((camp) => (
                            <div
                              key={camp.id}
                              onClick={() => setSelectedCampaign(camp)}
                              className="bg-[#171717] border border-[#2A2A2A] hover:border-[#BC66FF]/40 rounded-xl p-5 flex items-center justify-between cursor-pointer transition duration-200 group"
                            >
                              <div className="flex items-center gap-4">
                                <div className="p-3 rounded-lg bg-[#BC66FF]/10 text-[#BC66FF] border border-[#BC66FF]/20 group-hover:scale-105 transition">
                                  <Sparkles className="w-5 h-5" />
                                </div>
                                <div>
                                  <h4 className="font-bold text-base text-white group-hover:text-[#BC66FF] transition">
                                    {camp.name}
                                  </h4>
                                  <div className="flex items-center gap-3 text-xs text-slate-400 mt-1">
                                    <span>Industry: <strong className="text-slate-200">{camp.industry}</strong></span>
                                    <span>•</span>
                                    <span>Geo: <strong className="text-slate-200">{camp.geoTarget}</strong></span>
                                    <span>•</span>
                                    <span>Target: <strong className="text-slate-200">{camp.targetProfile}</strong></span>
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-4">
                                <div className="text-right">
                                  <span className="text-xs text-slate-400 block">Staged Leads</span>
                                  <span className="text-sm font-bold text-purple-300">
                                    {camp._count?.campaignLeads || 0} leads
                                  </span>
                                </div>
                                
                                <button
                                  onClick={(e) => handleDeleteCampaign(e, camp.id, camp.name)}
                                  disabled={deletingId === camp.id}
                                  className="p-2 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition"
                                  title="Delete Campaign"
                                >
                                  {deletingId === camp.id ? (
                                    <Loader2 className="w-4 h-4 animate-spin text-rose-400" />
                                  ) : (
                                    <Trash2 className="w-4 h-4" />
                                  )}
                                </button>

                                <ChevronRight className="w-5 h-5 text-slate-500 group-hover:text-white transition" />
                              </div>
                            </div>
                          ))}
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
      </main>
    </div>
  );
}
