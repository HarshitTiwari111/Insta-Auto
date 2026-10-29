/** Profile picture with Instagram's gradient story ring (falls back to the first letter). */
export function Avatar({ src, name, size = 40 }: { src?: string | null; name: string; size?: number }) {
  return (
    <span className="ig-ring inline-flex shrink-0" style={{ width: size + 4, height: size + 4 }}>
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        <span className="flex h-full w-full items-center justify-center bg-fill text-[15px] font-semibold uppercase">{name.slice(0, 1)}</span>
      )}
    </span>
  );
}
