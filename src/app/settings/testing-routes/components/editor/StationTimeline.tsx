"use client";
import * as React from "react";
import { ChevronLeft, ChevronRight, Package } from "lucide-react";
import { Button, cn } from "@/components/ui";
import { EDITOR_TEXT, nextStationText } from "../../lib/labels";
import { neighbourStop } from "../../lib/editorModel";
import type { TimelineStop } from "../../lib/editorModel";
import type { MapCell } from "../../lib/mapModel";

/** The station bar above the editor (artboard 2, spec §5.5 item 2): a stop per map column, and the
 *  previous / next station that has a cell to open. */

export type StationTimelineProps = {
  stops: readonly TimelineStop[];
  /** Set to the current stop's button. */
  currentRef?: React.Ref<HTMLButtonElement>;
  /** Open a stop's cell in the editor. */
  onGo: (cell: MapCell) => void;
};

export function StationTimeline({ stops, currentRef, onGo }: StationTimelineProps) {
  const prev = neighbourStop(stops, -1);
  const next = neighbourStop(stops, 1);
  return (
    <section aria-label={EDITOR_TEXT.timelineLabel} className="sfe-timeline">
      {prev?.target && (
        <Button
          variant="text"
          startIcon={<ChevronRight size={16} strokeWidth={1.75} aria-hidden />}
          onClick={() => prev.target && onGo(prev.target)}
        >
          {EDITOR_TEXT.prevStation}
        </Button>
      )}
      <ol className="sfe-stops">
        {stops.map((s, i) => (
          <React.Fragment key={s.key}>
            {i > 0 && <li aria-hidden="true" className="sfe-stops__line" />}
            <li className="sfe-stops__item">
              <button
                ref={s.current ? currentRef : undefined}
                type="button"
                className="sfe-stop"
                aria-current={s.current ? "step" : undefined}
                disabled={!s.target}
                onClick={() => {
                  if (s.target && !s.current) onGo(s.target);
                }}
              >
                <span className={cn("sfe-stop__mark", s.packageLevel && "sfe-stop__mark--pkg")} aria-hidden={s.packageLevel || undefined}>
                  {s.packageLevel ? <Package size={14} strokeWidth={1.75} aria-hidden /> : s.n}
                </span>
                <span className="sfe-stop__text">
                  <span className="sfe-stop__name">{s.name}</span>
                  <span className={cn("sfe-stop__sub", s.error && "sfe-stop__sub--error")}>{s.sub}</span>
                </span>
              </button>
            </li>
          </React.Fragment>
        ))}
      </ol>
      {next?.target && (
        <Button
          variant="text"
          endIcon={<ChevronLeft size={16} strokeWidth={1.75} aria-hidden />}
          onClick={() => next.target && onGo(next.target)}
        >
          {nextStationText(next.name)}
        </Button>
      )}
    </section>
  );
}
