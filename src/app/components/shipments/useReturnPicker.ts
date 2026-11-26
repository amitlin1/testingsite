"use client";
import { useMemo, useState } from "react";
import type { Shipment } from "@/app/lib/shipments/contract";

/** Only a shipment not yet sent can be returned (POST /api/shipment-history refuses a sent one). */
export const returnable = (s: Shipment) => !s.is_sent;

const NONE: ReadonlySet<number> = new Set();

/**
 * Picking shipments to return together ("החזר משלוחים" above the table): a
 * mode the table enters, the shipments picked in it, by id — so a reload of
 * the list keeps the picks and hands back the fresh rows. A shipment that was
 * sent meanwhile drops out.
 */
export function useReturnPicker(rows: Shipment[]) {
    const [active, setActive] = useState(false);
    const [ids, setIds] = useState<ReadonlySet<number>>(NONE);

    const picked = useMemo(() => rows.filter((r) => ids.has(r.id) && returnable(r)), [rows, ids]);

    const toggle = (s: Shipment) => {
        if (!returnable(s)) return;
        setIds((cur) => {
            const next = new Set(cur);
            if (next.has(s.id)) next.delete(s.id);
            else next.add(s.id);
            return next;
        });
    };

    /** The header box: all the shown returnable rows on, or (when all are on) off. */
    const toggleAll = (shown: Shipment[]) => {
        const candidates = shown.filter(returnable);
        const allOn = candidates.length > 0 && candidates.every((s) => ids.has(s.id));
        setIds((cur) => {
            const next = new Set(cur);
            for (const s of candidates) {
                if (allOn) next.delete(s.id);
                else next.add(s.id);
            }
            return next;
        });
    };

    const stop = () => {
        setActive(false);
        setIds(NONE);
    };

    return {
        active,
        start: () => setActive(true),
        stop,
        picked,
        isPicked: (s: Shipment) => ids.has(s.id) && returnable(s),
        toggle,
        toggleAll,
    };
}
