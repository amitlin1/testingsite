import type { TransactionClient, prisma } from "@/lib/db";
import type { SelfcheckRow } from "@/app/lib/jobs/health";

/**
 * metrics_selfcheck() (plan §3.10). STABLE and read-only, so it reads the same
 * on the base client or inside a job's transaction — the selfcheck job reads it
 * twice in one transaction, before and after its own healing.
 */
export async function runSelfcheck(client: TransactionClient | typeof prisma): Promise<SelfcheckRow[]> {
  const rows = await client.$queryRaw<{ check_name: string; value: bigint | null; detail: string | null }[]>`
    SELECT check_name, value, detail FROM metrics_selfcheck()`;
  return rows.map((r) => ({
    checkName: r.check_name,
    value: r.value === null ? null : Number(r.value),
    detail: r.detail,
  }));
}
