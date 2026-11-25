"use client";
import * as React from "react";
import { Alert, Snackbar } from "./Feedback";

/**
 * One app-wide toast: `useToast().show(...)` from any client component, drawn
 * by the single <Toaster/> mounted in the app providers. A new toast replaces
 * the one on screen and restarts its timer. Drawn as the kit's Snackbar and Alert.
 */

export type ToastSeverity = "info" | "success" | "warning" | "error";

export interface ToastOptions {
  message: React.ReactNode;
  severity?: ToastSeverity;
  /** ms until it hides itself; null keeps it until closed. Default 4000. */
  duration?: number | null;
  /** Default "center" (bottom of the screen). */
  horizontal?: "left" | "center" | "right";
  /** Draw the close button. Default true. */
  dismissible?: boolean;
}

type ToastState = (ToastOptions & { seq: number }) | null;

let current: ToastState = null;
let seq = 0;
const listeners = new Set<() => void>();

function emit(next: ToastState) {
  current = next;
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const getSnapshot = () => current;
const getServerSnapshot = (): ToastState => null;

function show(options: ToastOptions | React.ReactNode, severity?: ToastSeverity) {
  const opts: ToastOptions =
    typeof options === "object" && options !== null && "message" in options
      ? (options as ToastOptions)
      : { message: options as React.ReactNode, severity };
  seq += 1;
  emit({ ...opts, seq });
}

function close() {
  emit(null);
}

const API = { show, close };

/** `show("נשמר", "success")` or `show({ message, severity, duration })`; `close()`. */
export function useToast() {
  return API;
}

/** Draws the current toast. Mount once (the app providers do). */
export function Toaster() {
  const toast = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return (
    <Snackbar
      key={toast?.seq ?? 0}
      open={toast != null}
      autoHideDuration={toast?.duration === undefined ? 4000 : toast.duration}
      onClose={close}
      anchorOrigin={{ vertical: "bottom", horizontal: toast?.horizontal ?? "center" }}
    >
      <Alert severity={toast?.severity ?? "info"} onClose={toast?.dismissible === false ? undefined : close}>
        {toast?.message}
      </Alert>
    </Snackbar>
  );
}
