// BPMSquare mark — 2×2 tile grid on orange-to-terracotta gradient
export default function Logo({ size = 34 }: { size?: number }) {
  const id = "bms-grad";
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-label="BPMSquare">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F47C20" />
          <stop offset="1" stopColor="#D85F06" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="9" fill={`url(#${id})`} />
      <rect x="8"  y="8"  width="10" height="10" rx="2.5" fill="#fff" />
      <rect x="22" y="8"  width="10" height="10" rx="2.5" fill="#fff" opacity=".5" />
      <rect x="8"  y="22" width="10" height="10" rx="2.5" fill="#fff" opacity=".5" />
      <rect x="22" y="22" width="10" height="10" rx="2.5" fill="#fff" />
    </svg>
  );
}
