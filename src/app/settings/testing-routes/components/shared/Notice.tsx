"use client";
import * as React from "react";
import { Snackbar } from "@/components/ui";

/** The screen's short message after an action (a paste, an apply, a save as set): a plain Snackbar,
 *  5 s, bottom centre. A new message restarts it. */
export type Notice = { text: string; seq: number } | null;

export function useNotice(): { notice: Notice; say: (text: string) => void; close: () => void } {
  const [notice, setNotice] = React.useState<Notice>(null);
  const say = React.useCallback((text: string) => setNotice((n) => ({ text, seq: (n?.seq ?? 0) + 1 })), []);
  const close = React.useCallback(() => setNotice(null), []);
  return { notice, say, close };
}

export function NoticeSnackbar({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  return (
    <Snackbar
      key={notice?.seq ?? 0}
      open={notice != null}
      message={notice?.text}
      autoHideDuration={5000}
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      onClose={onClose}
    />
  );
}
