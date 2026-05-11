import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log("Resetting SongStats...");
  try {
    const result = await (prisma as any).songStats.deleteMany();
    console.log(`Deleted ${result.count} records.`);
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
