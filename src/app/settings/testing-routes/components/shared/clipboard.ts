/**
 * The system clipboard, on the plain-http app: an insecure context, where the browser may give no
 * navigator.clipboard at all.
 */

/** The system clipboard's text, or null when the page may not read it: no permission, or a page
 *  served over plain http — an insecure context, where the browser has no navigator.clipboard. */
export async function readClipboardText(): Promise<string | null> {
  try {
    const clip = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clip || typeof clip.readText !== "function") return null;
    return await clip.readText();
  } catch {
    return null;
  }
}

/** The copy command with our text in it — the way to write the clipboard on plain http, inside a
 *  click (the page's own copy handlers see the event already handled). */
function copyCommand(text: string): boolean {
  if (typeof document === "undefined") return false;
  let done = false;
  const onCopy = (e: ClipboardEvent) => {
    if (!e.clipboardData) return;
    e.clipboardData.setData("text/plain", text);
    e.preventDefault();
    done = true;
  };
  document.addEventListener("copy", onCopy, true);
  try {
    document.execCommand("copy");
  } catch {
    done = false;
  } finally {
    document.removeEventListener("copy", onCopy, true);
  }
  return done;
}

/** Writes text to the system clipboard; false when the browser refused it. */
export async function writeClipboardText(text: string): Promise<boolean> {
  try {
    const clip = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (clip && typeof clip.writeText === "function") {
      await clip.writeText(text);
      return true;
    }
  } catch {
    // Refused (no permission, the page lost focus): try the copy command.
  }
  return copyCommand(text);
}
