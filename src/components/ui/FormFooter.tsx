import Button from "./Button";

/**
 * The sticky bottom bar of every create/edit form: Cancel and Save, bottom
 * right. Save submits the enclosing <form>; Cancel is either a link
 * (`cancelHref`) or a handler (`onCancel`). `left` takes anything that
 * belongs on the other side of the bar (a validation summary, a status).
 */
export default function FormFooter({
  onCancel, cancelHref, saving = false, saveLabel = "Save", disabled = false, left,
}: {
  onCancel?: () => void;
  cancelHref?: string;
  saving?: boolean;
  saveLabel?: string;
  disabled?: boolean;
  left?: React.ReactNode;
}) {
  return (
    <div className="bpm-form-footer">
      {left && <div className="bpm-form-footer-left">{left}</div>}
      {cancelHref ? (
        <Button href={cancelHref} variant="secondary" data-guide="form.cancel">Cancel</Button>
      ) : (
        <Button variant="secondary" onClick={onCancel} disabled={saving} data-guide="form.cancel">Cancel</Button>
      )}
      <Button type="submit" variant="primary" loading={saving} disabled={disabled} data-guide="form.save">
        {saving ? "Saving…" : saveLabel}
      </Button>
    </div>
  );
}
