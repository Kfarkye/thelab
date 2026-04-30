'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Plus, User } from 'lucide-react';

interface LeftDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

const SPRING_PHYSICS = {
  type: 'spring' as const,
  stiffness: 400,
  damping: 30,
  mass: 1,
};

export const LeftDrawer = ({ isOpen, onClose }: LeftDrawerProps) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 z-40 bg-black/20 backdrop-blur-sm"
          />

          {/* Drawer (85% width for mobile) */}
          <motion.div
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={SPRING_PHYSICS}
            className="absolute top-0 left-0 bottom-0 w-[85%] max-w-[340px] z-50 bg-[#F9F9F9] flex flex-col border-r border-black/[0.05]"
          >
            {/* Top: Search & Profile */}
            <div className="p-4 flex items-center gap-3 border-b border-black/[0.05]">
              <div className="flex-1 flex items-center gap-2 px-3 py-1.5 bg-black/[0.05] rounded-[24px]">
                <Search className="w-4 h-4 text-black/40" />
                <input 
                  type="text" 
                  placeholder="Search..." 
                  className="bg-transparent border-none text-[15px] outline-none w-full placeholder:text-black/40"
                />
              </div>
              <div className="w-8 h-8 rounded-full bg-zinc-200 flex items-center justify-center shrink-0">
                <User className="w-4 h-4 text-zinc-500" />
              </div>
            </div>

            {/* Scrollable Sections */}
            <div className="flex-1 overflow-y-auto px-4 py-6 space-y-8">
              {/* Existing Workspace Tabs mapped to sections */}
              <div className="flex gap-4 border-b border-black/[0.05] pb-4 overflow-x-auto no-scrollbar">
                {['ADMIN', 'SOURCES', 'SANDBOX', 'NEW'].map((tab) => (
                  <span key={tab} className="font-mono text-[10px] tracking-widest text-black/50 uppercase whitespace-nowrap">
                    {tab}
                  </span>
                ))}
              </div>

              {/* Recents */}
              <div>
                <h3 className="font-mono text-[10px] tracking-widest text-black/40 uppercase mb-3">Recent Contexts</h3>
                <div className="space-y-3">
                  {['Adrienne Bristow - Placement', 'Arizona Licensure Review', 'Q3 Pipeline Follow-ups'].map((title, i) => (
                    <button key={i} className="block w-full text-left font-sans text-[15px] text-black/80 truncate hover:text-black">
                      {title}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Floating New Chat (Anchored to bottom right of drawer) */}
            <button 
              className="absolute bottom-6 right-6 w-12 h-12 bg-black text-white rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-transform"
              aria-label="New chat"
              onClick={() => {
                if (navigator.vibrate) navigator.vibrate(4);
              }}
            >
              <Plus className="w-6 h-6" />
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
