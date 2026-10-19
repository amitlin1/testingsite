// Ported verbatim from ticketflow (src/lib/pdf/render-react.tsx).
// Renders a Puck template (Data) to a static HTML string.
//
// We deliberately DO NOT use Puck's <Render>: it relies on internal hooks
// (useSlots/useFieldTransforms) that break under Next's RSC module layering
// (two React instances → null dispatcher). Instead we walk the Data tree and
// invoke each component's own `render` from `puckConfig` directly — we own
// those components, so this is exact and avoids any Puck runtime. Slot fields
// (declared in the config) are resolved into child-rendering components, which
// is the only thing <Render> did that our components rely on.
//
// `react-dom/server` is imported dynamically so it stays out of Next's static
// module graph (which rejects it) while still running server-side.

import * as React from "react";
import type { Data } from "@measured/puck";
import { puckConfig } from "./puck-config";
import type { ReportRenderMeta as PdfRenderMeta } from "./types";

type PuckNode = { type: string; props: Record<string, unknown> };

function isNodeArray(v: unknown): v is PuckNode[] {
  return (
    Array.isArray(v) &&
    v.every((it) => it && typeof it === "object" && typeof (it as PuckNode).type === "string")
  );
}

function makeSlot(children: PuckNode[], meta: PdfRenderMeta): React.FC {
  const Slot: React.FC = () => (
    <>
      {children.map((child, i) => (
        <React.Fragment key={i}>{renderNode(child, meta)}</React.Fragment>
      ))}
    </>
  );
  Slot.displayName = "PdfSlot";
  return Slot;
}

function renderNode(node: PuckNode, meta: PdfRenderMeta): React.ReactNode {
  const comp = (puckConfig.components as unknown as Record<string, { fields?: Record<string, { type: string }>; render: (p: Record<string, unknown>) => React.ReactNode }>)[node.type];
  if (!comp) return null;

  const props: Record<string, unknown> = { ...node.props };
  // Resolve declared slot fields (their stored value is an array of child
  // nodes) into a component the parent renders via <Slot />.
  const fields = comp.fields ?? {};
  for (const [key, def] of Object.entries(fields)) {
    if (def.type === "slot") {
      const value = props[key];
      props[key] = makeSlot(isNodeArray(value) ? value : [], meta);
    }
  }

  // Puck render functions read metadata off the `puck` param.
  props.puck = {
    metadata: meta as unknown as Record<string, unknown>,
    isEditing: false,
    renderDropZone: () => null,
    dragRef: () => undefined,
  };

  return comp.render(props);
}

export async function renderTemplateBody(
  data: Data,
  metadata: PdfRenderMeta,
): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const content = (data.content ?? []) as unknown as PuckNode[];
  // Blocks flow in a wrapping flex row; each block carries its own width, so
  // adjacent half/third/quarter blocks share a row (mirrors the editor zone).
  const children = (
    <div className="pdf-flow">
      {content.map((node, i) => (
        <React.Fragment key={i}>{renderNode(node, metadata)}</React.Fragment>
      ))}
    </div>
  );
  const root = puckConfig.root as
    | { render?: (p: Record<string, unknown>) => React.ReactNode }
    | undefined;
  // Pass the document-level props (header/footer settings) into root.render,
  // exactly as Puck does in the editor.
  const rootProps = ((data.root?.props ?? {}) as Record<string, unknown>);
  const tree = root?.render
    ? root.render({
        ...rootProps,
        children,
        puck: { metadata: metadata as unknown as Record<string, unknown> },
      })
    : children;
  return renderToStaticMarkup(<>{tree}</>);
}
