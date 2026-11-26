"use client";

// The ⓘ beside a card's title: what the card shows, in a few plain sentences,
// for a manager who did not build it (2026-11-26). The same icon as the
// ברוטו / נטו one and the role tag on the users page; it opens a small popover
// rather than a side panel because the answer is short. A card that shows
// durations also says in one line what ברוטו and נטו mean, and links to the
// full panel (ClockInfo) when the screen has one — not from inside a modal
// dialog (the history pop-ups), which the side panel cannot open over.
// Texts: ../_lib/explain.ts.

import * as React from "react";
import { Info } from "lucide-react";

import { AnchoredPopover } from "@/components/ui";
import { useClockInfoOpen } from "@/app/components/ClockInfo/ClockInfo";
import { CLOCK_TEXT } from "@/app/lib/dashboard/work-clock";
import type { Explain } from "../_lib/explain";

export default function CardInfo({ explain, panelLink = true }: { explain: Explain; panelLink?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const openClock = useClockInfoOpen();
  const titleId = React.useId();
  const clock = explain.clock;

  return (
    <AnchoredPopover
      open={open}
      onOpenChange={setOpen}
      aria-labelledby={titleId}
      className="dash-info-pop"
      trigger={
        <button
          type="button"
          className="clock-info-icon"
          aria-label={`מה רואים כאן — ${explain.title}`}
          title="מה רואים כאן"
        >
          <Info size={13} strokeWidth={2} aria-hidden />
        </button>
      }
    >
      <div dir="rtl">
        <div id={titleId} className="dash-info-pop__title">
          {explain.title}
        </div>
        <p className="dash-info-pop__text">{explain.text}</p>
        {explain.points && (
          <ul className="dash-info-pop__points">
            {explain.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        )}
        {clock && (
          <div className="dash-info-pop__clocks">
            <p>
              <b>{CLOCK_TEXT.wall.label}</b> = {CLOCK_TEXT.wall.short}.
            </p>
            <p>
              <b>{CLOCK_TEXT.work.label}</b> = {CLOCK_TEXT.work.short}.
            </p>
            {openClock && panelLink && (
              <button
                type="button"
                className="dash-link"
                onClick={() => {
                  setOpen(false);
                  openClock(clock);
                }}
              >
                הסבר מלא: איך הזמנים מחושבים
              </button>
            )}
          </div>
        )}
      </div>
    </AnchoredPopover>
  );
}
