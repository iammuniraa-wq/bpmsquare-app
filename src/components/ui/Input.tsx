// Shared look of the form controls. Styling is the `.bpm-input` class in
// globals.css (so focus rings, the nextgen "sunken" input surface and dark mode
// all apply); these wrappers only add the `invalid` flag and keep the three
// controls' props identical to their native elements (React 19 passes `ref`
// through as an ordinary prop).

type Invalid = { invalid?: boolean };

const cls = (extra?: string) => (extra ? `bpm-input ${extra}` : "bpm-input");

export function Input({ invalid, className, ...rest }: React.ComponentProps<"input"> & Invalid) {
  return <input {...rest} className={cls(className)} aria-invalid={invalid || undefined} />;
}

export function Select({ invalid, className, children, ...rest }: React.ComponentProps<"select"> & Invalid) {
  return (
    <select {...rest} className={cls(className)} aria-invalid={invalid || undefined}>
      {children}
    </select>
  );
}

export function Textarea({ invalid, className, ...rest }: React.ComponentProps<"textarea"> & Invalid) {
  return <textarea {...rest} className={cls(className)} aria-invalid={invalid || undefined} />;
}
