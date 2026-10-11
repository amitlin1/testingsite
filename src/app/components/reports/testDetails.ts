/**
 * Per-test fields for the test results report.
 *
 * test_results.details is a station-type-specific JSON. The report reads it in
 * any of these shapes:
 *   { fields: TestDetailField[] }   ← preferred, new stations should write this
 *   TestDetailField[]
 *   { "<label>": <primitive>, ... } ← legacy flat object, shown as text fields
 */
import type { ReportStatus } from "./reportTheme";

export type TestFieldType = "number" | "boolean" | "choice" | "text";

export type TestDetailField = {
    key?: string;
    label: string;
    type?: TestFieldType;
    value: string | number | boolean | null;
    unit?: string;
    /** number: inclusive limits */
    min?: number;
    max?: number;
    /** boolean / choice: the required value */
    expected?: string | boolean;
    /** explicit verdict; overrides the computed one */
    passed?: boolean | null;
};

export type NormalizedTestField = {
    label: string;
    value: string;
    unit: string;
    spec: string;
    status: ReportStatus;
};

const fmt = (v: unknown): string => {
    if (v === null || v === undefined || v === "") return "—";
    if (typeof v === "boolean") return v ? "כן" : "לא";
    return String(v);
};

function specOf(f: TestDetailField): string {
    const hasMin = typeof f.min === "number";
    const hasMax = typeof f.max === "number";
    if (hasMin && hasMax) return `${f.min} – ${f.max}`;
    if (hasMin) return `≥ ${f.min}`;
    if (hasMax) return `≤ ${f.max}`;
    if (f.expected !== undefined) return fmt(f.expected);
    return "—";
}

function statusOf(f: TestDetailField): ReportStatus {
    if (f.passed === true) return "pass";
    if (f.passed === false) return "fail";
    if (f.value === null || f.value === undefined || f.value === "") return "none";
    const type = f.type ?? (typeof f.value === "number" ? "number" : typeof f.value === "boolean" ? "boolean" : "text");
    if (type === "number") {
        const n = Number(f.value);
        if (Number.isNaN(n)) return "none";
        if (typeof f.min !== "number" && typeof f.max !== "number") return "none";
        if (typeof f.min === "number" && n < f.min) return "fail";
        if (typeof f.max === "number" && n > f.max) return "fail";
        return "pass";
    }
    if (type === "boolean" || type === "choice") {
        if (f.expected === undefined) return "none";
        return String(f.value) === String(f.expected) ? "pass" : "fail";
    }
    return "none";
}

const isField = (x: unknown): x is TestDetailField =>
    !!x && typeof x === "object" && "label" in (x as object) && "value" in (x as object);

export function normalizeTestDetails(details: unknown): NormalizedTestField[] {
    if (!details || typeof details !== "object") return [];
    let list: TestDetailField[];
    if (Array.isArray(details)) {
        list = details.filter(isField);
    } else if (Array.isArray((details as { fields?: unknown }).fields)) {
        list = ((details as { fields: unknown[] }).fields).filter(isField);
    } else {
        list = Object.entries(details as Record<string, unknown>)
            .filter(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v))
            .map(([k, v]) => ({ label: k, type: "text" as const, value: v as string | number | boolean | null }));
    }
    return list.map((f) => ({
        label: f.label,
        value: fmt(f.value),
        unit: f.unit ?? "",
        spec: specOf(f),
        status: statusOf(f),
    }));
}
