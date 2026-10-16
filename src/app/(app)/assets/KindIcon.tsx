import { Zap, Gear, Droplet, Battery, Monitor, Activity } from "@/components/Icons";

export default function KindIcon({ kind, size = 18, color }: { kind: string; size?: number; color?: string }) {
  const p = { size, color: color ?? "currentColor" };
  switch (kind) {
    case "motor":       return <Zap {...p} />;
    case "transformer": return <Gear {...p} />;
    case "pump":        return <Droplet {...p} />;
    case "generator":   return <Battery {...p} />;
    case "panel":       return <Monitor {...p} />;
    default:            return <Activity {...p} />;
  }
}
