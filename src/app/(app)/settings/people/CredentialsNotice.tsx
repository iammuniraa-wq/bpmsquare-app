"use client";

import Button from "@/components/ui/Button";
import { Notice } from "../middleware/ui";
import s from "./people.module.css";
import { FIRST_SIGNIN_LINE } from "./logic";

export type SignInDetails = { email: string; password: string };

/**
 * The result of an add or a reset: the text, and, when a password was set, the sign-in details to hand over with a
 * Copy button. It stays until dismissed, because the password is not shown again. Used by People and the employee record.
 */
export default function CredentialsNotice({ text, credentials, onDismiss }: { text: string; credentials: SignInDetails | null; onDismiss: () => void }) {
  const copy = async (c: SignInDetails) => {
    try { await navigator.clipboard.writeText(`Sign-in: ${window.location.origin}\nEmail: ${c.email}\nInitial password: ${c.password}`); } catch { /* the details stay on screen to copy by hand */ }
  };
  return (
    <Notice tone="ok" action={<Button size="sm" onClick={onDismiss}>Dismiss</Button>}>
      <div className={s.creds}>
        <span>{text}</span>
        {credentials && (
          <>
            <code>{credentials.email} / {credentials.password}</code>
            <Button size="sm" onClick={() => void copy(credentials)}>Copy details</Button>
            <span>{FIRST_SIGNIN_LINE}</span>
          </>
        )}
      </div>
    </Notice>
  );
}
