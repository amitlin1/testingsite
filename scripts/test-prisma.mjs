import "dotenv/config";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import prismaClient from "@prisma/client";

const { Pool } = pg;
const { PrismaClient } = prismaClient;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    // Test 1: Basic connection
    const result = await prisma.$queryRaw`SELECT NOW() as now`;
    console.log("Connection OK. Server time:", result[0].now);

    // Test 2: Count items
    const itemCount = await prisma.items.count();
    console.log("Items count:", itemCount);

    // Test 3: Count test stations
    const stationCount = await prisma.test_stations.count();
    console.log("Test stations count:", stationCount);

    // Test 4: Count shipments
    const shipmentCount = await prisma.shipments.count();
    console.log("Shipments count:", shipmentCount);

    console.log("\nAll Prisma connection tests passed!");
  } catch (error) {
    console.error("Prisma test failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
