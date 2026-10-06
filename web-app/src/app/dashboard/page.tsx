"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  LayoutGrid,
  Monitor,
  MoreHorizontal,
  Plus,
  Search,
  Filter,
  ArrowUpDown,
  AlertTriangle,
  Loader2,
  Sparkles
} from "lucide-react";
import { CreateCompanyModal, AnimatedButton, ContactAdminModal } from "@/components";
import { LogoutButton } from "@/components/LogoutButton";
import { CompanyCard } from "@/components/CompanyCard";
import type { Company } from "@/generated/prisma/client";
import { motion, AnimatePresence } from "framer-motion";

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Delete state
  const [companyToDelete, setCompanyToDelete] = useState<Company | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const isElite = (session?.user as { tier?: string })?.tier === "elite" || session?.user?.email === "panwalkarsoham@gmail.com";

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  useEffect(() => {
    if (status === "authenticated") {
      fetchCompanies();
    }
  }, [status]);

  const fetchCompanies = async () => {
    try {
      const response = await fetch("/api/companies");
      if (response.ok) {
        const data = await response.json();
        setCompanies(data);
      }
    } catch (error) {
      console.error("Failed to fetch companies:", error);
    } finally {
      setLoadingCompanies(false);
    }
  };

  const handleDelete = async () => {
    if (!companyToDelete) return;
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/companies/${companyToDelete.id}`, {
        method: "DELETE",
      });
      if (response.ok) {
        setCompanies(companies.filter(c => c.id !== companyToDelete.id));
        setCompanyToDelete(null);
      }
    } catch (error) {
      console.error("Failed to delete company:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  if (status === "loading") return null;
  if (!session) return null;

  const userInitials = session.user?.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase() || "PI";

  return (
    <div className="flex h-screen bg-[#121212] text-white overflow-hidden font-sans relative">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 border-r border-[#222222] bg-[#0E0E0E] px-3 py-4 shrink-0">
        {/* Logo Section */}
        <div className="px-2 mb-10 mt-6 flex items-center gap-3">
          <div className="w-8 h-8 flex items-center justify-center overflow-hidden rounded-md bg-white/5 shadow-[0_0_10px_rgba(255,255,255,0.05)]">
            <img src="/logo.png" className="w-full h-full object-cover" alt="Pulsar" />
          </div>
          <span className="text-sm font-bold tracking-widest uppercase">Pulsar</span>
        </div>

        {/* Sidebar Nav */}
        <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
          <button
            className="w-full flex items-center gap-3 px-3 py-1.5 rounded-md transition-colors text-[13px] bg-[#171717] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]"
          >
            <LayoutGrid className="w-4 h-4 text-[#BC66FF]" />
            <span className="font-medium">Companies</span>
          </button>
        </div>

        {/* User Section (Bottom) */}
        <div className="mt-auto px-2 pt-4 border-t border-[#222222]">
          <div className="flex items-center justify-between p-2 hover:bg-[#1A1A1A] rounded-md transition-colors cursor-pointer group">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-[#BC66FF]/20 flex items-center justify-center text-[10px] font-bold overflow-hidden ring-1 ring-[#BC66FF]/30">
                {session.user?.image ? (
                  <img src={session.user.image} alt="" className="w-full h-full object-cover" />
                ) : (
                  userInitials
                )}
              </div>
              <span className="text-xs font-medium truncate max-w-[120px] text-[#888888]">{session.user?.name}</span>
            </div>
            <MoreHorizontal className="w-4 h-4 text-[#444444] group-hover:text-white" />
          </div>
        </div>
      </aside>

      {/* Mobile Drawer Overlay */}
      <AnimatePresence>
        {mobileSidebarOpen && (
          <div className="fixed inset-0 z-50 md:hidden flex">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileSidebarOpen(false)}
              className="fixed inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="relative w-72 bg-[#0E0E0E] border-r border-[#222222] p-5 flex flex-col z-10"
            >
              <div className="flex items-center justify-between pb-6 border-b border-[#222222] mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 flex items-center justify-center rounded-md bg-white/5">
                    <img src="/logo.png" className="w-full h-full object-cover" alt="Pulsar" />
                  </div>
                  <span className="text-sm font-bold tracking-widest uppercase">Pulsar</span>
                </div>
                <button
                  onClick={() => setMobileSidebarOpen(false)}
                  className="p-2 rounded-lg bg-white/5 text-slate-400 hover:text-white"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              <div className="flex-1 space-y-2">
                <button
                  onClick={() => setMobileSidebarOpen(false)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm bg-[#171717] text-white font-semibold"
                >
                  <LayoutGrid className="w-4 h-4 text-[#BC66FF]" />
                  <span>Companies</span>
                </button>
              </div>

              <div className="pt-4 border-t border-[#222222] flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-[#BC66FF]/20 flex items-center justify-center text-xs font-bold ring-1 ring-[#BC66FF]/30">
                    {session.user?.image ? (
                      <img src={session.user.image} alt="" className="w-full h-full object-cover rounded-full" />
                    ) : (
                      userInitials
                    )}
                  </div>
                  <span className="text-xs font-medium text-slate-300 truncate max-w-[130px]">{session.user?.name}</span>
                </div>
                <LogoutButton />
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#121212] overflow-hidden">
        {/* Header */}
        <div className="border-b border-[#222222] sticky top-0 bg-[#121212]/90 backdrop-blur-md z-20">
          <div className="px-4 sm:px-8 h-14 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setMobileSidebarOpen(true)}
                className="md:hidden p-1.5 rounded-md bg-[#1A1A1A] text-slate-300 hover:text-white border border-[#2A2A2A]"
                aria-label="Open sidebar"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
              </button>
              <span className="text-[#666666] text-[10px] font-bold uppercase tracking-wider truncate max-w-[80px] sm:max-w-none">{session.user?.name?.split(" ")[0]}</span>
              <span className="text-[#2A2A2A]">/</span>
              <span className="text-white text-[10px] font-bold uppercase tracking-wider">Companies</span>
            </div>
            <div className="flex items-center gap-3 sm:gap-4">
              {isElite ? (
                <div className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-full bg-[#BC66FF]/15 border border-[#BC66FF]/40 text-[#BC66FF] text-[10px] sm:text-[11px] font-bold shadow-[0_0_15px_rgba(188,102,255,0.15)]">
                  <Sparkles className="w-3.5 h-3.5 text-[#BC66FF]" />
                  <span className="sm:hidden">ELITE</span>
                  <span className="hidden sm:inline">TIER</span>
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
          </div>
        </div>

        {/* Action Bar */}
        <div className="px-4 sm:px-8 py-4 sm:py-6 border-b border-[#1A1A1A]">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:max-w-md">
              <div className="relative w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#444444]" />
                <input
                  placeholder="Search for a company"
                  className="w-full bg-[#1A1A1A] border border-[#2A2A2A] rounded-md pl-9 pr-4 py-2 text-xs text-white focus:outline-none focus:border-[#3A3A3A] transition-colors"
                />
              </div>
              <div className="flex items-center gap-2">
                <button className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 border border-[#222222] bg-[#1A1A1A]/50 rounded-md text-[10px] font-black text-[#666666] hover:text-white transition-colors uppercase tracking-widest">
                  <Filter className="w-2.5 h-2.5" />
                  Status
                </button>
                <button className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 border border-[#222222] bg-[#1A1A1A]/50 rounded-md text-[10px] font-black text-[#666666] hover:text-white transition-colors uppercase tracking-widest shrink-0">
                  <ArrowUpDown className="w-2.5 h-2.5" />
                  Name
                </button>
              </div>
            </div>
            <button
              onClick={() => setIsModalOpen(true)}
              className="flex items-center justify-center gap-2 bg-white text-black px-4 py-2.5 rounded-md text-[10px] font-black uppercase tracking-widest hover:bg-[#dddddd] transition-all shadow-[0_0_20px_rgba(255,255,255,0.05)] w-full sm:w-auto"
            >
              <Plus className="w-3.5 h-3.5" />
              New Company
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto bg-[#121212]">
          {loadingCompanies ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-6 h-6 border-2 border-[#BC66FF]/30 border-t-[#BC66FF] rounded-full animate-spin" />
            </div>
          ) : companies.length > 0 ? (
            <div className="px-4 sm:px-8 py-6 space-y-6">
              {/* Tier Status Card — only shown to Free users */}
              {!isElite && (
                <div className="p-4 rounded-2xl bg-[#161618] border border-white/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-white/5 text-slate-300 border border-white/10 shrink-0">
                      <Sparkles className="w-5 h-5 text-slate-400" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-white tracking-wide">Free Tier Account</h4>
                        <span className="px-2 py-0.5 text-[9px] font-black uppercase tracking-wider bg-white/10 text-slate-300 rounded-md">
                          1 Job / Day
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Free plan includes 1 company creation and 1 master-agent run per day.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setIsContactModalOpen(true)}
                    className="px-4 py-2 rounded-xl bg-[#BC66FF] text-black hover:bg-white text-xs font-bold transition shadow-[0_0_15px_rgba(188,102,255,0.2)] shrink-0"
                  >
                    Upgrade to Elite
                  </button>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {companies.map((company) => (
                  <CompanyCard
                    key={company.id}
                    company={company}
                    onDelete={(e) => {
                      e.stopPropagation();
                      setCompanyToDelete(company);
                    }}
                    onClick={() => router.push(`/${session.user?.name?.toLowerCase().replace(/\s+/g, '-')}/${company.name.toLowerCase().replace(/\s+/g, '-')}`)}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center pb-20">
              <div className="w-16 h-16 bg-[#171717] border border-[#222222] rounded-2xl flex items-center justify-center mb-6">
                <Monitor className="w-8 h-8 text-[#333333]" />
              </div>
              <h2 className="text-xl font-bold tracking-tight text-white mb-2">Initialize your first build</h2>
              <p className="text-[13px] text-[#666666] max-w-[320px] mb-8 leading-relaxed">
                Connect your organization to the Pulsar engine to begin autonomous sales acceleration.
              </p>
              <AnimatedButton
                onClick={() => setIsModalOpen(true)}
                className="h-10 px-8 rounded-md text-sm font-medium bg-white text-black hover:bg-[#e0e0e0] border-0"
              >
                <span>Register Company</span>
              </AnimatedButton>
            </div>
          )}
        </div>

        <CreateCompanyModal
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            fetchCompanies();
          }}
        />

        <ContactAdminModal
          isOpen={isContactModalOpen}
          onClose={() => setIsContactModalOpen(false)}
        />

        {/* Delete Confirmation Modal */}
        <AnimatePresence>
          {companyToDelete && (
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => !isDeleting && setCompanyToDelete(null)}
                className="absolute inset-0 bg-background/80 backdrop-blur-sm"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="w-full max-w-md bg-[#171717] rounded-2xl border border-[#2A2A2A] p-8 relative z-20 shadow-2xl space-y-6"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center text-red-500">
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white tracking-tight">Delete Company?</h3>
                    <p className="text-[12px] text-[#666666]">This action cannot be undone.</p>
                  </div>
                </div>

                <p className="text-[13px] text-[#888888] leading-relaxed">
                  Are you sure you want to delete <span className="text-white font-bold">{companyToDelete.name}</span>? All associated campaigns and lead data will be permanently removed.
                </p>

                <div className="flex items-center gap-4 pt-2">
                  <button
                    disabled={isDeleting}
                    onClick={() => setCompanyToDelete(null)}
                    className="flex-1 px-4 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-widest text-[#444444] hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={isDeleting}
                    onClick={handleDelete}
                    className="flex-1 bg-red-500 hover:bg-red-600 text-white px-4 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all shadow-lg shadow-red-500/10 flex items-center justify-center gap-2"
                  >
                    {isDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : "Delete"}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
