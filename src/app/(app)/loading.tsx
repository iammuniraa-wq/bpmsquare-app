import { c } from "@/lib/theme";

// Shown instantly on any tab switch while the server fetches page data.
export default function AppLoading() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 0" }}>
      <Bone h={28} w={220} />
      <Bone h={14} w={160} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginTop: 8 }}>
        {[0,1,2,3].map((i) => <Bone key={i} h={72} />)}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
        {[0,1,2,3,4].map((i) => <Bone key={i} h={56} />)}
      </div>
    </div>
  );
}

function Bone({ h, w }: { h: number; w?: number }) {
  return (
    <div style={{
      height: h, width: w ?? "100%", borderRadius: 8,
      background: c.line,
      animation: "vvcrm-pulse 1.4s ease-in-out infinite",
    }} />
  );
}
