"use client";
import React from "react";
import SignatureCanvas from "react-signature-canvas";
import { Button } from "@/components/ui";

/**
 * The signature pad both shipment forms end with (receiving a shipment and
 * returning one). It is required in both, and both say so the same way: the
 * label carries the asterisk from the start, and while the pad is empty a
 * neutral line under it says what is missing — nothing turns red before anyone
 * has done anything.
 *
 * The canvas is transparent: a canvas paints with real colours, not CSS
 * variables (a `var(--…)` background is ignored and the pad came out black),
 * so the pearl surface is the frame's CSS background, and the signature image
 * itself has no background box when it is printed.
 */
export default function ShipmentSignatureField({
    canvasRef,
    signed,
    onSignedChange,
    hint,
}: {
    canvasRef: React.RefObject<SignatureCanvas | null>;
    signed: boolean;
    onSignedChange: (signed: boolean) => void;
    /** What the empty pad blocks, e.g. "יש לחתום לפני הוספת המשלוח". */
    hint: string;
}) {
    const labelId = React.useId();
    const hintId = React.useId();
    return (
        <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-sm)", marginBottom: 6 }}>
                <span id={labelId} style={{ fontSize: "var(--text-small)", fontWeight: 600, color: "var(--color-ink-muted-80)" }}>
                    חתימה
                    <span aria-hidden style={{ color: "var(--color-destructive)", fontWeight: 700 }}>{" *"}</span>
                </span>
                <Button
                    variant="text"
                    size="small"
                    onClick={() => {
                        canvasRef.current?.clear();
                        onSignedChange(false);
                    }}
                >
                    נקה חתימה
                </Button>
            </div>
            <div
                style={{
                    border: "1px solid var(--color-field-border)",
                    borderRadius: "var(--r-sm)",
                    overflow: "hidden",
                    background: "var(--color-surface-pearl)",
                }}
            >
                <SignatureCanvas
                    ref={canvasRef}
                    canvasProps={{
                        width: 800,
                        height: 120,
                        className: "sigCanvas",
                        role: "img",
                        "aria-labelledby": labelId,
                        "aria-describedby": signed ? undefined : hintId,
                    }}
                    backgroundColor="rgba(0,0,0,0)"
                    // Every stroke that ends re-checks whether the pad holds a signature.
                    onEnd={() => onSignedChange(!canvasRef.current?.isEmpty())}
                />
            </div>
            {!signed && (
                <div id={hintId} className="sh-field-helper">
                    {hint}
                </div>
            )}
        </div>
    );
}
