'use client';

import React from 'react';
import { Phone, Mail, UserPlus } from 'lucide-react';

export const ActiveCandidateHeader = ({ candidateId }: { candidateId: string }) => {
  return (
    <div className="flex-none h-[48px] flex items-center justify-between px-4 border-b border-black/[0.05] bg-zinc-50">
      <div className="flex items-center gap-3 overflow-hidden">
        <h2 className="font-serif font-medium text-[16px] text-black truncate">
          Adrienne Bristow
        </h2>
        <span className="font-mono text-[10px] tracking-widest px-2 py-0.5 rounded-[28px] bg-amber-100 text-amber-900 border border-amber-200 uppercase shrink-0">
          Wrapped Up
        </span>
      </div>

      <div className="flex items-center gap-4 text-black/40 shrink-0 ml-4">
        <Phone className="w-[18px] h-[18px] hover:text-black cursor-pointer transition-colors" />
        <Mail className="w-[18px] h-[18px] hover:text-black cursor-pointer transition-colors" />
        <UserPlus className="w-[18px] h-[18px] hover:text-black cursor-pointer transition-colors" />
      </div>
    </div>
  );
};
