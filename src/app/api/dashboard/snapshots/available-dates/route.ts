import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";

/**
 * GET /api/dashboard/snapshots/available-dates
 * Returns available dates from snapshots - used for period filtering
 *
 * Returns:
 * - minDate: earliest snapshot date available
 * - maxDate: latest snapshot date available
 * - years: array of distinct years available in snapshots
 */
export async function GET() {
  try {
    // Simplified query - just get date range from daily snapshots
    // Monthly/Quarterly snapshots use first day of month/quarter anyway
    const query = `
      SELECT
        MIN(snapshot_date) as min_date,
        MAX(snapshot_date) as max_date
      FROM kpi_snapshots
    `;

    const rows = await prisma.$queryRawUnsafe<any[]>(query);

    const row = rows[0];
    const minDate = row?.min_date ? row.min_date.toISOString().split('T')[0] : null;
    const maxDate = row?.max_date ? row.max_date.toISOString().split('T')[0] : null;

    // Generate years from date range or current year
    let years: number[] = [];
    if (minDate && maxDate) {
      const startYear = parseInt(minDate.split('-')[0]);
      const endYear = parseInt(maxDate.split('-')[0]);
      for (let year = endYear; year >= startYear; year--) {
        years.push(year);
      }
    } else {
      // Fallback: current year and previous 2 years
      const currentYear = new Date().getFullYear();
      years = [currentYear, currentYear - 1, currentYear - 2];
    }

    return NextResponse.json({
      minDate,
      maxDate,
      years,
    });
  } catch (error) {
    console.error("Error fetching available dates:", error);
    // Return safe defaults instead of error
    const currentYear = new Date().getFullYear();
    return NextResponse.json({
      minDate: null,
      maxDate: null,
      years: [currentYear, currentYear - 1, currentYear - 2],
    });
  }
}
