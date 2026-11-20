"use client";

import { useActionState } from "react";

import { resendConfirmation, type ResendState } from "../(konto)/actions";

/** Until the address is confirmed: what waits for it, and a new mail on request. */
export function ConfirmBanner({ email }: { email: string }) {
  const [state, action, pending] = useActionState<ResendState>(resendConfirmation, {});
  return (
    <div className="ws-confirm" role="status">
      <div className="wrap ws-confirm-in small">
        <p>
          <strong>Bestätigen Sie Ihre Adresse, dann können Sie freischalten und Ihr Team einladen.</strong> Den Link haben wir an {email} geschickt.
        </p>
        <form action={action}>
          <button type="submit" className="btn btn-quiet btn-small" disabled={pending}>
            Mail erneut senden
          </button>
        </form>
        {state.ok ? <p className="ws-confirm-ok">{state.ok}</p> : null}
        {state.error ? <p className="ws-confirm-err">{state.error}</p> : null}
      </div>
    </div>
  );
}
