import React from 'react';

export const ThinkingRadar = () => {
  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-slate-900 rounded-full border border-slate-700/50">
      <div className="relative flex h-3 w-3">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
        <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-500"></span>
      </div>
      <span className="text-sm font-mono text-cyan-400">Gemini 3 Deep Think Active</span>
    </div>
  );
};
