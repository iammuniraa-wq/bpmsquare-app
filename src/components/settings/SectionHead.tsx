import InfoTip from "@/components/ui/InfoTip";

/** The title above a list or a small form on a settings page: the name, its "i", and the one action that belongs to it. */
export default function SectionHead({ title, info, action }: { title: string; info?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", minHeight: 36 }}>
      <div className="bpm-label-row">
        <h2 className="bpm-t-section" style={{ margin: 0 }}>{title}</h2>
        {info && <InfoTip label={title}>{info}</InfoTip>}
      </div>
      {action}
    </div>
  );
}
