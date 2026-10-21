"use client";

import { useFormStatus } from "react-dom";
import { buttonClass } from "./ui";

export function SubmitButton({
  children,
  tone = "primary",
  size = "md",
  pendingText,
  confirm,
  className,
}: {
  children: React.ReactNode;
  tone?: "primary" | "secondary" | "quiet" | "danger";
  size?: "sm" | "md";
  pendingText?: string;
  confirm?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`${buttonClass(tone, size)} ${className ?? ""}`}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? (pendingText ?? "Saving…") : children}
    </button>
  );
}
