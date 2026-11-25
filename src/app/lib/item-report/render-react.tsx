// Ported from ticketflow (src/lib/pdf/render-react.tsx).
// Renders a Puck template (Data) to a static HTML string.
//
// We deliberately DO NOT use Puck's <Render>: it relies on internal hooks
// (useSlots/useFieldTransforms) that break under Next's RSC module layering
// (two React instances → null dispatcher). Instead we walk the Data tree and
// invoke each component's own `render` from `puckConfig` directly — we own
// those components, so this is exact and avoids any Puck runtime.
//
// `react-dom/server` is imported dynamically so it stays out of Next's static
// module graph (which rejects it) while still running server-side.

import * as React from "react";
import type { Data } from "@measured/puck";
import { puckConfig } from "./puck-config";
import type { ReportRenderMeta } from "./types";

type PuckNode = { type: string; props: Record<string, unknown> };

function renderNode(node: PuckNode, meta: ReportRenderMeta): React.ReactNode {
  const comp = (puckConfig.components as unknown as Record<string, { render: (p: Record<string, unknown>) => React.ReactNode }>)[node.type];
  if (!comp) return null;
  // Puck render functions read metadata off the `puck` param.
  return comp.render({
    ...node.props,
    puck: {
      metadata: meta as unknown as Record<string, unknown>,
      isEditing: false,
      renderDropZone: () => null,
      dragRef: () => undefined,
    },
  });
}

export async function renderTemplateBody(
  data: Data,
  metadata: ReportRenderMeta,
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
