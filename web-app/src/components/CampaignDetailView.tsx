"use client";

import React, { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import * as XLSX from "xlsx";
import { 
  Rocket, 
  Loader2, 
  ExternalLink, 
  Users, 
  Mail,
  Sparkles,
  ArrowLeft,
  Layers,
  Trash2,
  CheckCircle2,
  Lock,
  Download
} from "lucide-react";

const YoutubeIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
  </svg>
);

const InstagramIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
  </svg>
);

interface Lead {
  id: string;
  platform?: string;
  handle?: string;
  followerCount?: number;
  engagementRate?: number;
  geoCountry?: string;
  niche?: string[];
  profile?: any;
  icpScore?: number;
  status?: string;
}

interface CampaignDetailViewProps {
  campaignId: string;
  campaignName: string;
  industry?: string;
  geoTarget?: string;
  targetProfile?: string;
  platforms?: string[];
  status?: string;
  onClose?: () => void;
}

export default function CampaignDetailView({
  campaignId,
  campaignName,
  industry,
  geoTarget,
  targetProfile,
  platforms = ["youtube", "instagram", "producthunt"],
  status,
  onClose
}: CampaignDetailViewProps) {
  const { data: session } = useSession();
  const isElite = (session?.user as { tier?: string })?.tier === "elite" || session?.user?.email === "panwalkarsoham@gmail.com";

  const [activeTab, setActiveTab] = useState<"youtube" | "instagram" | "producthunt">(() => {
    const first = (platforms && platforms.length > 0 ? platforms[0] : "youtube").toLowerCase();
    return (first as "youtube" | "instagram" | "producthunt");
  });
  const [leads, setLeads] = useState<Lead[]>([]);
  const [campaignStatus, setCampaignStatus] = useState<string>(status || "complete");
  const [loading, setLoading] = useState<boolean>(true);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [rerunning, setRerunning] = useState<boolean>(false);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const [queueInfo, setQueueInfo] = useState<{
    queuePosition?: number;
    estimatedEtaSeconds?: number;
    totalWaiting?: number;
    groqStatus?: { isExhausted: boolean; resetAt?: string; retryAfterSeconds?: number };
  } | null>(null);

  useEffect(() => {
    const fetchCampaignData = async () => {
      try {
        const res = await fetch(`/api/campaigns/${campaignId}`);
        if (res.ok) {
          const data = await res.json();
          setLeads(data.leads || []);
          // Prefer the DB status if available, fallback to jobState mapping
          if (data.campaign?.status) {
            setCampaignStatus(data.campaign.status);
          }
        }
      } catch (err) {
        console.error("Error fetching campaign data:", err);
      } finally {
        setLoading(false);
      }
    };


    fetchCampaignData();

    const fetchQueueStatus = async () => {
      try {
        const qRes = await fetch(`/api/queue/status?jobId=${campaignId}`);
        if (qRes.ok) {
          const qData = await qRes.json();
          const groq = qData.groqStatus;
          setQueueInfo({
            queuePosition: qData.jobDetail?.queuePosition,
            estimatedEtaSeconds: qData.jobDetail?.estimatedEtaSeconds,
            totalWaiting: qData.totalWaiting,
            groqStatus: groq
              ? {
                  isExhausted: !!groq.isExhausted,
                  resetAt: groq.resetAtLabel || groq.resetAt,
                  retryAfterSeconds: groq.retryAfterSeconds,
                }
              : undefined,
          });
        }
      } catch (err) {
        console.error("Error fetching queue status:", err);
      }
    };

    fetchQueueStatus();
    const queueInterval = setInterval(fetchQueueStatus, 5000);

    const eventSource = new EventSource(`/api/campaigns/${campaignId}/stream`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.leads) setLeads(data.leads);
        if (data.status) setCampaignStatus(data.status);
      } catch (err) {
        console.error("Error parsing SSE event:", err);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.close();
      clearInterval(queueInterval);
    };
  }, [campaignId]);


  const handleDeleteCampaign = async () => {
    if (!confirm(`Are you sure you want to delete campaign "${campaignName}"? Leads extracted will be preserved in your database.`)) {
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: "DELETE"
      });
      if (res.ok) {
        if (onClose) onClose();
      } else {
        alert("Failed to delete campaign. Please try again.");
      }
    } catch (err) {
      console.error("Error deleting campaign:", err);
      alert("Error deleting campaign.");
    } finally {
      setDeleting(false);
    }
  };

  const handleRerunCampaign = async () => {
    if (!isElite) return;
    setRerunError(null);
    setRerunning(true);
    try {
      const res = await fetch("/api/job/campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignName,
          industry,
          geoTarget,
          targetProfile,
          platforms,
          companyId: null,
          goalType: "Lead Generation",
          budget: "Organic Outreach ($0)",
          focus: "B2B (Business-to-Business)",
          tone: "Professional / Formal",
          sequence: "3 Touchpoints (Standard)",
          b2bSignals: [],
          channels: []
        })
      });
      const data = await res.json();
      if (res.ok) {
        setCampaignStatus("queue");
      } else if (data.error === "DAILY_LIMIT_REACHED") {
        setRerunError("Daily free-tier limit reached.");
      } else {
        setRerunError(data.message || "Failed to rerun campaign.");
      }
    } catch {
      setRerunError("Network error. Please try again.");
    } finally {
      setRerunning(false);
    }
  };

  const handleExportLeads = () => {
    if (leads.length === 0) return;

    const rows = leads.map(lead => {
      const prof = lead.profile || {};
      const rawName = prof.full_name || prof.name || prof.channel_name || lead.handle || prof.username || "";
      const name = typeof rawName === "string" ? rawName : String(rawName);
      const handle = lead.handle || prof.username || prof.custom_url || "";
      const platform = lead.platform || "";
      const followers = lead.followerCount || prof.follower_count || prof.subscriber_count || "";
      const engagement = lead.engagementRate || prof.engagement_rate || "";
      const country = lead.geoCountry || prof.country || "";
      const email = prof.email || prof.contact_email || "";
      const bio = prof.biography || prof.description || prof.bio || "";
      const niche = Array.isArray(lead.niche) ? lead.niche.join(", ") : (lead.niche || "");
      const icpScore = lead.icpScore || "";

      let profileUrl = "";
      const rawHandle = handle.replace(/^@/, "").trim();
      if (platform.includes("youtube")) {
        profileUrl = prof.channel_id ? `https://www.youtube.com/channel/${prof.channel_id}` : rawHandle ? `https://www.youtube.com/@${rawHandle}` : "";
      } else if (platform.includes("instagram")) {
        profileUrl = rawHandle ? `https://www.instagram.com/${rawHandle}/` : "";
      } else if (platform.includes("producthunt")) {
        profileUrl = prof.url || (rawHandle ? `https://www.producthunt.com/@${rawHandle}` : "");
      }

      return {
        Platform: platform,
        Name: name,
        Handle: handle,
        "Profile URL": profileUrl,
        Email: email,
        Followers: followers,
        "Engagement Rate": engagement ? `${(Number(engagement) * 100).toFixed(2)}%` : "",
        Country: country,
        Niche: niche,
        "ICP Score": icpScore,
        Bio: typeof bio === "string" ? bio : JSON.stringify(bio),
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Leads");

    // Auto-size columns
    const colWidths = Object.keys(rows[0] || {}).map(key => ({
      wch: Math.max(key.length, ...rows.map(r => String(r[key as keyof typeof r] || "").length).slice(0, 50))
    }));
    worksheet["!cols"] = colWidths;

    const filename = `${campaignName.replace(/\s+/g, "_")}_leads.xlsx`;
    XLSX.writeFile(workbook, filename);
  };

  const youtubeLeads = leads.filter(l => (l.platform || "").toLowerCase() === "youtube");
  const instagramLeads = leads.filter(l => (l.platform || "").toLowerCase() === "instagram");
  const producthuntLeads = leads.filter(l => (l.platform || "").toLowerCase().includes("producthunt"));

  const currentLeads =
    activeTab === "youtube"
      ? youtubeLeads
      : activeTab === "instagram"
      ? instagramLeads
      : producthuntLeads;

  const extractThumbnails = (lead: Lead): string[] => {
    const prof = lead.profile || {};
    const thumbnails: string[] = [];

    if (prof.posts && Array.isArray(prof.posts)) {
      for (const p of prof.posts) {
        const img = p.display_url || p.thumbnail_url || p.media_url || p.display_src;
        if (img && typeof img === "string" && !thumbnails.includes(img)) {
          thumbnails.push(img);
        }
        if (thumbnails.length >= 5) break;
      }
    }

    if (thumbnails.length < 5 && prof.recent_videos && Array.isArray(prof.recent_videos)) {
      for (const v of prof.recent_videos) {
        let img = v.thumbnail || v.thumbnail_url;
        if (!img && v.id) {
          img = `https://img.youtube.com/vi/${v.id}/hqdefault.jpg`;
        }
        if (img && typeof img === "string" && !thumbnails.includes(img)) {
          thumbnails.push(img);
        }
        if (thumbnails.length >= 5) break;
      }
    }

    if (thumbnails.length === 0 && prof.profile_pic_url) {
      thumbnails.push(prof.profile_pic_url);
    }

    return thumbnails;
  };

  // Helper to dynamically build platform URLs according to actual site handles
  const getPlatformProfileUrl = (lead: Lead): string => {
    const prof = lead.profile || {};
    const platform = (lead.platform || activeTab || "").toLowerCase();
    const rawHandle = (lead.handle || prof.username || prof.custom_url || prof.channel_id || "").toString().replace(/^@/, "").trim();

    if (prof.website && typeof prof.website === "string" && prof.website.startsWith("http")) {
      return prof.website;
    }
    if (prof.custom_url && typeof prof.custom_url === "string" && prof.custom_url.startsWith("http")) {
      return prof.custom_url;
    }

    if (platform.includes("youtube")) {
      if (prof.channel_id) return `https://www.youtube.com/channel/${prof.channel_id}`;
      if (rawHandle) return `https://www.youtube.com/@${rawHandle}`;
      return "https://www.youtube.com";
    }

    if (platform.includes("instagram")) {
      if (rawHandle) return `https://www.instagram.com/${rawHandle}/`;
      return "https://www.instagram.com";
    }

    if (platform.includes("producthunt")) {
      if (prof.url && typeof prof.url === "string" && prof.url.startsWith("http")) return prof.url;
      if (rawHandle) return `https://www.producthunt.com/@${rawHandle}`;
      return "https://www.producthunt.com";
    }

    return "https://google.com/search?q=" + encodeURIComponent(rawHandle || "lead");
  };

  const isRunning = campaignStatus === "queue" || campaignStatus === "ongoing";

  // Tab active colour: grey while running, purple once complete
  const activeTabClass = isRunning
    ? "bg-[#222222] text-[#999999] border border-[#333333]"
    : "bg-[#BC66FF]/15 text-[#BC66FF] border border-[#BC66FF]/30 shadow-[0_0_15px_rgba(188,102,255,0.1)]";
  const activeIconColor = isRunning ? "text-[#888888]" : "text-[#BC66FF]";

  // Status badge config
  const statusBadge =
    campaignStatus === "queue"
      ? { label: "Queued", dot: "bg-gray-400 animate-pulse", badge: "bg-gray-500/15 text-gray-300 border-gray-500/30" }
      : campaignStatus === "ongoing"
      ? { label: "Ongoing", dot: "bg-blue-400 animate-pulse", badge: "bg-blue-500/15 text-blue-300 border-blue-500/30" }
      : { label: "Complete", dot: "bg-green-400", badge: "bg-green-500/15 text-green-300 border-green-500/30" };

  return (
    <div className="w-full min-h-screen bg-[#121212] text-white p-4 sm:p-8 flex flex-col gap-4 sm:gap-6 font-sans max-w-7xl mx-auto">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between border-b border-[#222222] pb-6 gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-[#BC66FF]/10 border border-[#BC66FF]/20 flex items-center justify-center text-[#BC66FF]">
              <Sparkles className="w-4 h-4" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              {campaignName}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-[#777777]">
            {industry && <span>Industry: <strong className="text-white font-medium">{industry}</strong></span>}
            {industry && geoTarget && <span>•</span>}
            {geoTarget && <span>Geo: <strong className="text-white font-medium">{geoTarget}</strong></span>}
            {targetProfile && <span>•</span>}
            {targetProfile && <span>Target: <strong className="text-white font-medium">{targetProfile}</strong></span>}
            {(industry || geoTarget || targetProfile) && <span>•</span>}
            {/* Status badge — inline with campaign metadata */}
            <span className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${statusBadge.badge}`}>
              {campaignStatus === "complete" ? (
                <CheckCircle2 className="w-3 h-3" />
              ) : (
                <span className={`w-2 h-2 rounded-full shrink-0 ${statusBadge.dot}`} />
              )}
              {statusBadge.label}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {/* Export Leads button */}
          <button
            onClick={handleExportLeads}
            disabled={leads.length === 0}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all border border-[#2A2A2A] bg-[#171717] text-[#666] hover:border-emerald-500/40 hover:bg-emerald-500/8 hover:text-emerald-400 disabled:opacity-30 disabled:cursor-not-allowed"
            title={leads.length === 0 ? "No leads to export" : `Export ${leads.length} leads to Excel`}
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export Leads</span>
          </button>

          {/* Rerun button — Elite: active purple / Free: locked red */}
          {isElite ? (
            <button
              onClick={handleRerunCampaign}
              disabled={isRunning || rerunning}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all border border-[#BC66FF]/40 bg-[#BC66FF]/10 text-[#BC66FF] hover:bg-[#BC66FF]/20 hover:border-[#BC66FF]/70 disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_0_12px_rgba(188,102,255,0.08)]"
              title="Rerun campaign — Elite: unlimited reruns"
            >
              {rerunning ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Rocket className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">{rerunning ? "Queuing..." : "Rerun"}</span>
            </button>
          ) : (
            <button
              disabled
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-[11px] font-black uppercase tracking-wider border border-rose-500/30 bg-rose-500/8 text-rose-500/70 cursor-not-allowed"
              title="Rerun locked — upgrade to Elite Tier for unlimited reruns"
            >
              <Lock className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Locked</span>
            </button>
          )}
          {rerunError && (
            <span className="text-[10px] text-rose-400 font-medium">{rerunError}</span>
          )}

          {/* Delete button */}
          <button
            onClick={handleDeleteCampaign}
            disabled={deleting}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all border border-[#2A2A2A] bg-[#171717] text-[#666] hover:border-rose-500/40 hover:bg-rose-500/8 hover:text-rose-400 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Delete campaign (leads preserved)"
          >
            {deleting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-400" />
            ) : (
              <Trash2 className="w-3.5 h-3.5" />
            )}
            <span className="hidden sm:inline">{deleting ? "Deleting..." : "Delete"}</span>
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-[11px] font-black uppercase tracking-wider border border-[#2A2A2A] bg-[#171717] text-[#666] hover:bg-[#1E1E1E] hover:text-white transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Back</span>
            </button>
          )}
        </div>
      </div>



      {/* Groq Quota Exhausted Callout */}
      {queueInfo?.groqStatus?.isExhausted && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between text-amber-300">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-amber-200">Groq API Rate Limit Reached</p>
              <p className="text-xs text-amber-300/80">
                Job requeued at lower priority. System is on idle check until Groq resets around{" "}
                <strong className="text-amber-100">{queueInfo.groqStatus.resetAt || "shortly"}</strong>.
              </p>
            </div>
          </div>
          {queueInfo.groqStatus.retryAfterSeconds && (
            <span className="text-xs font-mono font-bold bg-amber-500/20 px-3 py-1 rounded-md border border-amber-500/30">
              ~{Math.ceil(queueInfo.groqStatus.retryAfterSeconds / 60)}m left
            </span>
          )}
        </div>
      )}


      {/* Stats Cards Bar */}
      <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-2.5 sm:gap-4">

        <div className="bg-[#171717] border border-[#222222] p-3 sm:p-5 rounded-xl space-y-1 sm:space-y-2 shadow-sm">
          <div className="flex items-center justify-between text-[#666666]">
            <span className="text-[8px] sm:text-[10px] font-bold uppercase tracking-widest">TOTAL LEADS</span>
            <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#BC66FF]" />
          </div>
          <div className="text-lg sm:text-2xl font-black text-white">{leads.length}</div>
        </div>

        <div className="bg-[#171717] border border-[#222222] p-3 sm:p-5 rounded-xl space-y-1 sm:space-y-2 shadow-sm">
          <div className="flex items-center justify-between text-[#666666]">
            <span className="text-[8px] sm:text-[10px] font-bold uppercase tracking-widest">PLATFORMS</span>
            <Layers className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-indigo-400" />
          </div>
          <div className="text-lg sm:text-2xl font-black text-white">3 Channels</div>
        </div>

        {/* Queue / Ongoing status card */}
        {(campaignStatus === "queue" || campaignStatus === "ongoing") && (
          <div className={`col-span-2 lg:col-span-1 border p-3 sm:p-5 rounded-xl space-y-2 sm:space-y-3 shadow-sm ${
            campaignStatus === "queue"
              ? "bg-[#171717] border-[#2B2B2B]"
              : "bg-blue-950/20 border-blue-500/20"
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Loader2 className={`w-3.5 h-3.5 animate-spin ${
                  campaignStatus === "queue" ? "text-gray-400" : "text-blue-400"
                }`} />
                <span className={`text-[8px] sm:text-[10px] font-bold uppercase tracking-widest ${
                  campaignStatus === "queue" ? "text-gray-400" : "text-blue-400"
                }`}>
                  {campaignStatus === "queue" ? "Queued" : "Ongoing"}
                </span>
              </div>
              <span className={`text-[10px] font-mono font-bold ${
                queueInfo?.groqStatus?.isExhausted
                  ? "text-amber-300"
                  : campaignStatus === "queue" ? "text-gray-300" : "text-blue-300"
              }`}>
                ETA {queueInfo?.groqStatus?.isExhausted ? "Long time" : `~${Math.ceil((queueInfo?.estimatedEtaSeconds || 300) / 60)}m`}
              </span>
            </div>
            <div className="w-full bg-[#222222] h-1 rounded-full overflow-hidden">
              <div className={`h-full w-full rounded-full animate-pulse ${
                campaignStatus === "queue"
                  ? "bg-gradient-to-r from-gray-600 via-gray-400 to-gray-600"
                  : "bg-gradient-to-r from-blue-600 via-blue-400 to-blue-600 shadow-[0_0_8px_rgba(59,130,246,0.4)]"
              }`} />
            </div>
            <div className={`text-[10px] ${
              campaignStatus === "queue" ? "text-gray-500" : "text-blue-500/70"
            }`}>
              {queueInfo?.groqStatus?.isExhausted
                ? "API limit exhausted — job requeued, system on idle check"
                : campaignStatus === "queue"
                ? `Position #${queueInfo?.queuePosition || 1} — waiting to start`
                : "Agent extracting leads now..."}
            </div>
          </div>
        )}
      </div>

      {/* Platform Lead Tabs Bar - filtered by selected platforms */}
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-3 border-b border-[#222222] pb-3 sm:pb-4 mt-1 sm:mt-2 w-full">
        {(!platforms || platforms.length === 0 || platforms.includes("youtube")) && (
          <button
            onClick={() => setActiveTab("youtube")}
            className={`flex items-center justify-center sm:justify-start gap-1 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-[9px] sm:text-xs font-bold uppercase tracking-wider transition-all min-w-0 ${
              activeTab === "youtube"
                ? activeTabClass
                : "bg-[#171717] text-[#666666] border border-[#222222] hover:text-white hover:border-[#333333]"
            }`}
          >
            {isRunning ? (
              <Loader2 className={`w-3 h-3 sm:w-3.5 sm:h-3.5 ${activeIconColor} animate-spin shrink-0`} />
            ) : (
              <YoutubeIcon className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
            )}
            <span className="sm:hidden truncate">YT ({youtubeLeads.length})</span>
            <span className="hidden sm:inline">YouTube ({youtubeLeads.length})</span>
          </button>
        )}

        {(!platforms || platforms.length === 0 || platforms.includes("instagram")) && (
          <button
            onClick={() => setActiveTab("instagram")}
            className={`flex items-center justify-center sm:justify-start gap-1 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-[9px] sm:text-xs font-bold uppercase tracking-wider transition-all min-w-0 ${
              activeTab === "instagram"
                ? activeTabClass
                : "bg-[#171717] text-[#666666] border border-[#222222] hover:text-white hover:border-[#333333]"
            }`}
          >
            {isRunning ? (
              <Loader2 className={`w-3 h-3 sm:w-3.5 sm:h-3.5 ${activeIconColor} animate-spin shrink-0`} />
            ) : (
              <InstagramIcon className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
            )}
            <span className="sm:hidden truncate">IG ({instagramLeads.length})</span>
            <span className="hidden sm:inline">Instagram ({instagramLeads.length})</span>
          </button>
        )}

        {(!platforms || platforms.length === 0 || platforms.includes("producthunt")) && (
          <button
            onClick={() => setActiveTab("producthunt")}
            className={`flex items-center justify-center sm:justify-start gap-1 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-[9px] sm:text-xs font-bold uppercase tracking-wider transition-all min-w-0 ${
              activeTab === "producthunt"
                ? activeTabClass
                : "bg-[#171717] text-[#666666] border border-[#222222] hover:text-white hover:border-[#333333]"
            }`}
          >
            {isRunning ? (
              <Loader2 className={`w-3 h-3 sm:w-3.5 sm:h-3.5 ${activeIconColor} animate-spin shrink-0`} />
            ) : (
              <Rocket className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
            )}
            <span className="sm:hidden truncate">PH ({producthuntLeads.length})</span>
            <span className="hidden sm:inline">ProductHunt ({producthuntLeads.length})</span>
          </button>
        )}
      </div>

      {/* Main Leads Display Section */}
      {loading ? (
        <div className="w-full py-20 flex flex-col items-center justify-center gap-3 text-[#666666]">
          <Loader2 className="w-6 h-6 text-[#BC66FF] animate-spin" />
          <p className="text-xs uppercase tracking-wider font-bold">Loading campaign leads...</p>
        </div>
      ) : currentLeads.length === 0 ? (
        isRunning ? (
          <div className="w-full py-20 bg-[#171717] border border-white/10 rounded-xl flex flex-col items-center justify-center text-center p-8 gap-4 relative overflow-hidden">
            <div className="relative flex items-center justify-center">
              <div className="absolute w-16 h-16 rounded-full bg-white/5 animate-ping" />
              <div className="w-12 h-12 rounded-full bg-[#121212] border border-white/20 flex items-center justify-center shadow-inner">
                <Loader2 className="w-6 h-6 text-white animate-spin" />
              </div>
            </div>
            <div className="space-y-1.5 z-10 max-w-md">
              <h3 className="text-base font-bold text-white uppercase tracking-wider flex items-center justify-center gap-2">
                <span>Finding {activeTab.toUpperCase()} Leads...</span>
              </h3>
              <p className="text-xs text-[#888888] leading-relaxed">
                AI agents are actively extracting, enriching, and scoring high-intent prospects against your campaign ICP. Verified leads will appear here automatically as they are discovered.
              </p>
            </div>
          </div>
        ) : (
          <div className="w-full py-20 bg-[#171717] border border-[#222222] rounded-xl flex flex-col items-center justify-center text-center p-8 gap-3">
            <h3 className="text-base font-bold text-white uppercase tracking-wider">No {activeTab} leads found</h3>
            <p className="text-xs text-[#666666] max-w-sm">No leads matching the target ICP were found for this platform.</p>
          </div>
        )
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-6">

          {currentLeads.map((lead) => {
            const prof = lead.profile || {};
            const thumbnails = extractThumbnails(lead);
            const handle = lead.handle || prof.username || prof.custom_url || "lead";
            const rawBio = prof.biography || prof.description || prof.creator_info || prof.bio_description || prof.bio || "No biography provided.";
            const bio = typeof rawBio === "string" ? rawBio : typeof rawBio === "object" ? JSON.stringify(rawBio) : String(rawBio);
            const rawName = prof.full_name || prof.name || prof.channel_name || handle;
            const name = typeof rawName === "string" ? rawName : String(rawName);
            const followers = lead.followerCount || prof.follower_count || prof.subscriber_count || 0;
            const engagement = lead.engagementRate || prof.engagement_rate || 0;
            const country = lead.geoCountry || prof.country || "Global";
            const email = prof.email || prof.contact_email;
            const profileUrl = getPlatformProfileUrl(lead);

            return (
              <div
                key={lead.id}
                className="bg-[#171717] border border-[#222222] hover:border-[#333333] rounded-xl p-3 sm:p-6 flex flex-col justify-between gap-3 sm:gap-5 transition-all shadow-md group"
              >
                <div className="space-y-2 sm:space-y-4">
                  {/* Lead Profile Header */}
                  <div className="flex items-center gap-2 sm:gap-3">
                    <div className="w-7 h-7 sm:w-10 sm:h-10 rounded-full bg-[#BC66FF]/20 flex items-center justify-center font-bold text-[10px] sm:text-xs text-[#BC66FF] overflow-hidden shrink-0 border border-[#BC66FF]/30">
                      {prof.profile_pic_url ? (
                        <img src={prof.profile_pic_url} alt={name} className="w-full h-full object-cover" />
                      ) : (
                        name.charAt(0).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-bold text-xs sm:text-sm text-white group-hover:text-[#BC66FF] transition truncate">
                        {name}
                      </h4>
                      <p className="text-[10px] sm:text-xs text-[#BC66FF] font-mono truncate">@{handle}</p>
                    </div>
                  </div>

                  {/* Bio */}
                  <p className="text-[10px] sm:text-xs text-[#888888] line-clamp-2 leading-relaxed">
                    {bio}
                  </p>

                  {/* 5-Post Thumbnail Grid */}
                  {thumbnails.length > 0 && (
                    <div className="space-y-1.5 sm:space-y-2">
                      <span className="text-[8px] sm:text-[10px] font-bold uppercase tracking-wider text-[#666666] block">
                        Recent Content ({thumbnails.length})
                      </span>
                      <div className="grid grid-cols-5 gap-1 sm:gap-2">
                        {thumbnails.map((imgUrl, idx) => (
                          <div
                            key={idx}
                            className="aspect-square bg-[#121212] border border-[#222222] rounded-md sm:rounded-lg overflow-hidden group/img relative"
                          >
                            <img
                              src={imgUrl}
                              alt=""
                              className="w-full h-full object-cover group-hover/img:scale-105 transition duration-300"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = "none";
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Key Metrics Row */}
                  <div className="grid grid-cols-3 gap-1 sm:gap-2 py-1.5 sm:py-2.5 px-1.5 sm:px-3 rounded-lg bg-[#121212] border border-[#222222] text-center text-[10px] sm:text-xs">
                    <div>
                      <span className="text-[7px] sm:text-[9px] font-bold uppercase text-[#555555] block">Followers</span>
                      <p className="font-bold text-white text-[9px] sm:text-xs mt-0.5">{followers ? followers.toLocaleString() : "N/A"}</p>
                    </div>
                    <div>
                      <span className="text-[7px] sm:text-[9px] font-bold uppercase text-[#555555] block">Eng. Rate</span>
                      <p className="font-bold text-white text-[9px] sm:text-xs mt-0.5">{engagement ? `${(engagement * 100).toFixed(1)}%` : "N/A"}</p>
                    </div>
                    <div>
                      <span className="text-[7px] sm:text-[9px] font-bold uppercase text-[#555555] block">Geo</span>
                      <p className="font-bold text-white text-[9px] sm:text-xs mt-0.5 truncate">{country}</p>
                    </div>
                  </div>
                </div>

                {/* Footer Actions */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between border-t border-[#222222] pt-2 sm:pt-3 text-[10px] sm:text-xs gap-1 sm:gap-0">
                  {email ? (
                    <span className="flex items-center gap-1 sm:gap-1.5 text-slate-300 truncate max-w-full sm:max-w-[170px]">
                      <Mail className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-[#BC66FF] shrink-0" />
                      <span className="truncate text-[10px] sm:text-xs">{email}</span>
                    </span>
                  ) : (
                    <span className="text-[10px] sm:text-xs text-[#555555] italic">No public email</span>
                  )}

                  <a
                    href={profileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[#BC66FF] font-bold hover:underline transition sm:ml-auto text-[10px] sm:text-xs"
                  >
                    <span>Visit Profile</span>
                    <ExternalLink className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
