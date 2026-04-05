"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { 
  LayoutGrid,
  Monitor,
  MoreHorizontal
} from "lucide-react";
import { CreateCompanyModal, AnimatedButton } from "@/components";
import { LogoutButton } from "@/components/LogoutButton";

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  if (status === "loading") {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-black">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) return null;

  const userInitials = session.user?.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase() || "PI";

  return (
    <div className="flex h-screen bg-[#000000] text-white overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="hidden md:flex flex-col w-64 border-r border-[#333333] bg-[#000000] px-3 py-4">
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
            className="w-full flex items-center gap-3 px-3 py-1.5 rounded-md transition-colors text-[13px] bg-[#111111] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]"
          >
            <LayoutGrid className="w-4 h-4" />
            <span>Companies</span>
          </button>
        </div>

        {/* User Section (Bottom) */}
        <div className="mt-auto px-2 pt-4 border-t border-[#333333]">
          <div className="flex items-center justify-between p-2 hover:bg-[#111111] rounded-md transition-colors cursor-pointer group">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold overflow-hidden">
                {session.user?.image ? (
                  <img src={session.user.image} alt="" className="w-full h-full object-cover" />
                ) : (
                  userInitials
                )}
              </div>
              <span className="text-xs font-medium truncate max-w-[120px]">{session.user?.name}</span>
            </div>
            <MoreHorizontal className="w-4 h-4 text-[#666666] group-hover:text-white" />
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#000000] overflow-hidden">
        {/* Simple Header */}
        <div className="border-b border-[#333333] sticky top-0 bg-[#000000] z-20">
          <div className="px-8 h-14 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-[#888888] text-[13px]">{session.user?.name}</span>
              <span className="text-[#333333]">/</span>
              <span className="text-white text-[13px] font-medium">Companies</span>
            </div>
            <LogoutButton />
          </div>
        </div>

        {/* Empty State */}
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center pb-20">
          <div className="w-16 h-16 bg-[#111111] border border-[#333333] rounded-2xl flex items-center justify-center mb-6">
            <Monitor className="w-8 h-8 text-[#444444]" />
          </div>
          <h2 className="text-xl font-bold tracking-tight text-white mb-2">You haven&apos;t added a company yet</h2>
          <p className="text-[13px] text-[#666666] max-w-[320px] mb-8 leading-relaxed">
            Get started by adding your first company to initialize the intelligence outreach core.
          </p>
          <AnimatedButton 
            onClick={() => setIsModalOpen(true)}
            className="h-10 px-8 rounded-md text-sm font-medium bg-white text-black hover:bg-[#e0e0e0] border-0"
          >
            <span>Add Your First Company</span>
          </AnimatedButton>
        </div>

        <CreateCompanyModal 
          isOpen={isModalOpen} 
          onClose={() => setIsModalOpen(false)} 
        />
      </main>
    </div>
  );
}
