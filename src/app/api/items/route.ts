import { NextResponse } from "next/server";
import { loadItemList } from "@/app/lib/items/read";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await loadItemList());
  } catch (error) {
    console.error("Error loading items:", error);
    return NextResponse.json([]);
  }
}

// Items are no longer created one at a time: every item lives inside a
// package, and the box and its contents are created together by
// POST /api/packages (docs/packages/PLAN.md §6). Answer 410 so an old client
// gets a message instead of a silently different model.
export async function POST() {
  return NextResponse.json(
    { error: "פריטים נקלטים כחלק ממארז — יש להשתמש ב-POST /api/packages" },
    { status: 410 },
  );
}
