"use client";
import { Suspense } from "react";
import { Box } from "@/components/ui";
import ItemTable from "./components/ItemTable";

export default function Page() {
  return (
    <Box sx={{ p: 3 }}>
      {/* ItemTable reads ?q=/?status= (command-palette deep links) via
          useSearchParams, which needs a Suspense boundary. */}
      <Suspense fallback={null}>
        <ItemTable />
      </Suspense>
    </Box>
  );
}
