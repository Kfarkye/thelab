type JewelPillProps = {
  url: string;
  label: string;
};

export function JewelPill({ url, label }: JewelPillProps) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex max-w-[260px] items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-[#050505] shadow-sm transition hover:border-black/20"
      title={url}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-[#9a7a2f]" />
      <span className="truncate">{label}</span>
    </a>
  );
}
