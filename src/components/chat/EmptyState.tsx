'use client';

import React from 'react';

const SUGGESTIONS = [
  { action: 'Find candidates', context: 'wrapping up this week' },
  { action: 'Draft outreach', context: 'for re-engagement' },
  { action: 'Show pipeline', context: 'follow-ups' },
];

export const EmptyState = () => {
  return (
    <div className="h-full flex flex-col justify-end pb-2">
      <div className="flex overflow-x-auto gap-3 px-4 snap-x no-scrollbar pb-4">
        {SUGGESTIONS.map((item, idx) => (
          <button 
            key={idx}
            className="flex-none snap-start w-[240px] text-left p-4 rounded-[24px] border border-black/[0.08] bg-white hover:bg-black/[0.02] active:bg-black/[0.05] transition-colors"
          >
            <span className="block font-sans font-semibold text-[15px] text-black">
              {item.action}
            </span>
            <span className="block font-sans text-[14px] text-black/50 mt-0.5">
              {item.context}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};
