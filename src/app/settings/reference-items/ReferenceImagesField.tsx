"use client";

import * as React from "react";
import { Button, IconButton } from "@/components/ui";
import { Close as CloseIcon } from "@/components/ui/icons";
import { CloudUploadOutlined as CloudUploadOutlinedIcon } from "@/components/ui/icons";
import { Star as StarIcon } from "@/components/ui/icons";
import type { FormImage, ReferenceStation, StationsFor } from "./referenceForm";

/**
 * The images of a reference item's form, by station (docs/popup-templates/PLAN.md §5ג): the station
 * type is the reference set — a station shows the worker the images uploaded to its own type.
 *
 * One section per station of the item's routes that shows reference images, in route order, each
 * with its images, a drop target and "הוספת תמונות". Below them, images on a station that left
 * the route, and the images not assigned to a station (uploaded before reference images went by
 * station, to a group no single station showed) — each with the station to move it to, so nothing
 * has to be uploaded again. States (hover / focus / drag) live in settings.css (.ri-*).
 */

export default function ReferenceImagesField({ idPrefix, stations, images, primaryKey, onAddFiles, onStation, onRemove, onPrimary }: {
  idPrefix: string;
  stations: StationsFor;
  images: FormImage[];
  primaryKey: string | null;
  onAddFiles: (stationTypeId: number, files: File[]) => void;
  /** An image moved to a station (or an unassigned one given its station). */
  onStation: (key: string, stationTypeId: number) => void;
  onRemove: (key: string) => void;
  onPrimary: (key: string) => void;
}) {
  const labelId = `${idPrefix}-images-label`;
  const routeIds = new Set(stations.route.map((s) => s.id));
  const offRoute = [...new Set(images.map((i) => i.stationTypeId).filter((id): id is number => id != null && !routeIds.has(id)))]
    .map((id) => ({ id, name: stations.nameOf(id) }));
  const unassigned = images.filter((i) => i.stationTypeId == null);
  // A station to move an image to: the route's, else (no route station) none to offer.
  const targets = stations.route;

  const thumb = (img: FormImage, move: boolean) => (
    <ImageThumb key={img.key} img={img} isPrimary={img.key === primaryKey} onPrimary={onPrimary} onRemove={onRemove}
      move={move && targets.length > 0 ? { targets, idPrefix, onStation } : null} />
  );

  return (
    <div role="group" aria-labelledby={labelId}>
      <div id={labelId} className="sh-field-label">תמונות ייחוס</div>
      <p className="ri-stations-hint">לפי סדר המסלול. כל עמדה מציגה לעובד את התמונות שהועלו אליה.</p>

      {stations.route.length === 0 && (
        <p className="ri-stations-empty">אף עמדה במסלול של סוג הפריט הזה לא מציגה תמונות ייחוס.</p>
      )}

      <div className="ri-stations">
        {stations.route.map((s, i) => (
          <StationSection key={s.id} idPrefix={idPrefix} station={s} index={i + 1} onAddFiles={onAddFiles}
            images={images.filter((img) => img.stationTypeId === s.id)} thumb={(img) => thumb(img, false)} />
        ))}
        {offRoute.map((s) => (
          <StationSection key={s.id} idPrefix={idPrefix} station={s} index={null} onAddFiles={null}
            note="העמדה לא במסלול של סוג הפריט, או שהיא כבר לא מציגה תמונות ייחוס."
            images={images.filter((img) => img.stationTypeId === s.id)} thumb={(img) => thumb(img, true)} />
        ))}
        {unassigned.length > 0 && (
          <section className="ri-station ri-station--unassigned" aria-labelledby={`${idPrefix}-unassigned`}>
            <div className="ri-station__head">
              <span id={`${idPrefix}-unassigned`} className="ri-station__name">לא משויכות לעמדה</span>
              <span className="ri-station__count">{unassigned.length} תמונות</span>
            </div>
            <p className="ri-station__note">
              {targets.length > 0
                ? "הועלו בשיטה הקודמת, ואף עמדה לא מציגה אותן. בחרו לכל תמונה את העמדה שלה."
                : "הועלו בשיטה הקודמת, ואף עמדה לא מציגה אותן."}
            </p>
            <div className="ri-thumbs">{unassigned.map((img) => thumb(img, true))}</div>
          </section>
        )}
      </div>
    </div>
  );
}

/** A station's images, with its own drop target and file picker (none for a station off the route). */
function StationSection({ idPrefix, station, index, images, thumb, onAddFiles, note }: {
  idPrefix: string;
  station: ReferenceStation;
  /** Its place on the route (1-based); null off the route. */
  index: number | null;
  images: FormImage[];
  thumb: (img: FormImage) => React.ReactNode;
  onAddFiles: ((stationTypeId: number, files: File[]) => void) | null;
  note?: string;
}) {
  const [dragOver, setDragOver] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const nameId = `${idPrefix}-st-${station.id}`;
  const add = onAddFiles ? (files: File[]) => { if (files.length > 0) onAddFiles(station.id, files); } : null;

  return (
    <section
      className={"ri-station" + (dragOver ? " ri-station--over" : "")}
      aria-labelledby={nameId}
      onDragOver={add ? (e) => { e.preventDefault(); setDragOver(true); } : undefined}
      onDragLeave={add ? () => setDragOver(false) : undefined}
      onDrop={add ? (e) => { e.preventDefault(); setDragOver(false); add([...(e.dataTransfer?.files ?? [])]); } : undefined}
    >
      <div className="ri-station__head">
        {index != null && <span className="ri-station__index" aria-hidden>{index}</span>}
        <span id={nameId} className="ri-station__name">{station.name}</span>
        <span className="ri-station__count">{images.length} תמונות</span>
        {add && (
          <Button size="small" variant="outlined" onClick={() => fileRef.current?.click()} aria-describedby={nameId}
            startIcon={<CloudUploadOutlinedIcon fontSize={16} aria-hidden />}>
            הוספת תמונות
          </Button>
        )}
      </div>
      {note && <p className="ri-station__note">{note}</p>}
      {images.length > 0 ? (
        <div className="ri-thumbs">{images.map(thumb)}</div>
      ) : add && (
        // Empty: the whole strip opens the picker, by click or keyboard.
        <div role="button" tabIndex={0} className="ri-station__drop" onClick={() => fileRef.current?.click()}
          aria-label={`הוספת תמונות ייחוס ל${station.name}: גרור תמונות לכאן או לחץ לבחירה`}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileRef.current?.click(); } }}>
          גרור תמונות לכאן, או <span className="ri-station__drop-link">לחץ לבחירה</span> · PNG או JPG · עד 50MB לתמונה
        </div>
      )}
      {add && (
        <input ref={fileRef} type="file" accept="image/*" multiple tabIndex={-1} aria-hidden style={{ display: "none" }}
          onChange={(e) => { add([...(e.target.files ?? [])]); e.target.value = ""; }} />
      )}
    </section>
  );
}

/** One image: the cover star, remove, and — off its station's place — the station to move it to. */
function ImageThumb({ img, isPrimary, onPrimary, onRemove, move }: {
  img: FormImage;
  isPrimary: boolean;
  onPrimary: (key: string) => void;
  onRemove: (key: string) => void;
  move: { targets: ReferenceStation[]; idPrefix: string; onStation: (key: string, stationTypeId: number) => void } | null;
}) {
  const selectId = move ? `${move.idPrefix}-move-${img.key}` : undefined;
  return (
    <div className="ri-thumb">
      <div className="ri-thumb__frame" data-primary={isPrimary || undefined}>
        {/* contain so the full image is visible in the square preview */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img.url} alt={img.fileName} />
        <div className="ri-thumb__actions">
          <IconButton size="small" round color={isPrimary ? "primary" : "default"}
            title={isPrimary ? "תמונת הכריכה" : `הגדר את ${img.fileName} כתמונת כריכה`} aria-pressed={isPrimary}
            onClick={(e) => { e.stopPropagation(); onPrimary(img.key); }}>
            <StarIcon fontSize={14} fill={isPrimary ? "currentColor" : "none"} aria-hidden />
          </IconButton>
          <IconButton size="small" round color="error" title={`הסר את ${img.fileName}`}
            onClick={(e) => { e.stopPropagation(); onRemove(img.key); }}>
            <CloseIcon fontSize={14} aria-hidden />
          </IconButton>
        </div>
        {isPrimary && <span className="ri-thumb__cover">כריכה</span>}
      </div>
      {move && (
        <select id={selectId} className="ri-assign" value="" aria-label={`העבר את ${img.fileName} לעמדה`}
          onChange={(e) => { if (e.target.value) move.onStation(img.key, Number(e.target.value)); }}>
          <option value="">העבר לעמדה…</option>
          {move.targets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
    </div>
  );
}
