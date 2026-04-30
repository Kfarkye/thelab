import React from 'react';

export const PatchPreview = ({ patch }: { patch: any }) => {
  const applyPatch = (patchToApply: any) => {
    console.log("Applying patch:", patchToApply);
    // TODO: implement local execution
  };

  return (
    <div className="liquid-glass p-6 rounded-[24px] border-t-white/[0.08]">
      <div className="flex justify-between items-center mb-4">
        <h3 className="mono-micro text-amber-500">DEEP THINK PROPOSAL</h3>
        <button 
          onClick={() => applyPatch(patch)}
          className="px-4 py-2 bg-white text-black rounded-[28px] mono-micro hover:bg-zinc-200"
        >
          EXECUTE PATCH
        </button>
      </div>
      
      <div className="space-y-4">
        {patch.files.map((file: any) => (
          <div key={file.path} className="rounded-[12px] bg-black/40 p-4 border border-white/5">
            <span className="text-zinc-500 mono-micro">{file.path}</span>
            <pre className="text-xs text-white mt-2 overflow-x-auto">
              <code>{file.content}</code>
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
};
