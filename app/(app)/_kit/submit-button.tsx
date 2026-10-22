"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { Loader } from "lucide-react";

/**
 * A form's submit button that shows the action is running: a spinner takes the place of
 * its icon (or goes before its label) and it can't be pressed again until the action ends.
 * Use it in forms whose action is a Server Action, so a click never goes unanswered.
 */
export function SubmitButton({ children, disabled, ...props }: ComponentProps<"button">) {
  const { pending } = useFormStatus();
  return (
    <button {...props} type="submit" disabled={disabled || pending} aria-busy={pending || undefined}>
      {pending && <Loader size={15} strokeWidth={1.75} className="btn-spinner animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
