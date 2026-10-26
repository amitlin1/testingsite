"use client";
import React from "react";
import PackagesBoard from "@/app/components/packages/board/PackagesBoard";

/** useSearchParams (every filter lives in the URL) needs a Suspense boundary. */
export default function PackagesPage() {
  return (
    <React.Suspense fallback={null}>
      <PackagesBoard />
    </React.Suspense>
  );
}
