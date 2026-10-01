"use client";

import { motion } from "framer-motion";
import { Trash2 } from "lucide-react";
import type { Company } from "@/generated/prisma/client";

interface CompanyCardProps {
  company: Company;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
}

export function CompanyCard({ company, onClick, onDelete }: CompanyCardProps) {
  return (
    <motion.div
      onClick={onClick}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2, transition: { duration: 0.2 } }}
      className="group relative bg-[#171717] border border-[#2A2A2A] hover:border-[#BC66FF]/30 rounded-xl p-5 cursor-pointer transition-all duration-300 flex flex-col justify-between min-h-[140px] shadow-lg"
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <h3 className="text-[14px] font-bold text-white group-hover:text-[#BC66FF] transition-colors tracking-tight">
            {company.name}
          </h3>
          <p className="text-[11px] text-[#666666] font-medium truncate max-w-[180px]">
             {company.website || "No website"}
          </p>
        </div>
        <button 
          onClick={onDelete}
          className="text-[#2A2A2A] hover:text-red-500 transition-colors p-1"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </motion.div>
  );
}
