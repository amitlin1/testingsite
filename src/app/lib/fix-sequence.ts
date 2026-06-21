import { PrismaClient } from "@prisma/client";

/**
 * Fixes a PostgreSQL sequence to be in sync with the current max ID in a table.
 * This prevents duplicate key errors when inserting new records.
 *
 * @param prisma - The Prisma client instance
 * @param tableName - The name of the table
 * @param idColumnName - The name of the ID column (e.g., 'id', 'item_type_id')
 * @param sequenceNamePattern - Optional pattern to match the sequence name (e.g., 'customers_id_seq')
 */
export async function fixSequence(
  prisma: PrismaClient,
  tableName: string,
  idColumnName: string,
  sequenceNamePattern?: string
): Promise<void> {
  try {
    // Get current max ID
    const maxIdResult: { max_id: number }[] = await prisma.$queryRawUnsafe(
      `SELECT COALESCE(MAX(${idColumnName}), 0) AS max_id FROM ${tableName}`
    );
    const maxId = Number(maxIdResult[0]?.max_id) || 0;

    let seqName: string | null = null;

    // First, try to find sequence using pg_get_serial_sequence (most reliable)
    try {
      const pgSeqResult: { seq_name: string | null }[] = await prisma.$queryRaw`
        SELECT pg_get_serial_sequence(${tableName}, ${idColumnName}) AS seq_name
      `;
      if (pgSeqResult[0]?.seq_name) {
        seqName = pgSeqResult[0].seq_name;
        await prisma.$executeRaw`SELECT setval(${seqName}::regclass, ${maxId}::bigint, true)`;
        return; // Success
      }
    } catch {
      // Continue to other methods
    }

    // If sequenceNamePattern provided, try exact match
    if (sequenceNamePattern) {
      try {
        await prisma.$executeRaw`SELECT setval(${sequenceNamePattern}::regclass, ${maxId}::bigint, true)`;
        return; // Success
      } catch {
        // Continue to pattern search
      }
    }

    // Find sequence by querying information_schema
    const defaultSeqName = sequenceNamePattern || `${tableName}_${idColumnName}_seq`;
    const likePattern1 = `%${tableName}%${idColumnName}%`;
    const likePattern2 = `%${idColumnName}%`;

    const seqResult: { sequence_name: string }[] = await prisma.$queryRaw`
      SELECT sequence_name
      FROM information_schema.sequences
      WHERE sequence_schema = 'public'
      AND (
        sequence_name = ${defaultSeqName}
        OR sequence_name LIKE ${likePattern1}
        OR sequence_name LIKE ${likePattern2}
      )
      LIMIT 1
    `;

    if (seqResult.length > 0) {
      seqName = seqResult[0].sequence_name;
      await prisma.$executeRaw`SELECT setval(${seqName}::regclass, ${maxId}::bigint, true)`;
    } else {
      console.warn(`Could not find sequence for ${tableName}.${idColumnName}`);
    }
  } catch (error) {
    console.error(`Error fixing sequence for ${tableName}.${idColumnName}:`, error);
    // Don't throw - we'll try to continue anyway
  }
}
