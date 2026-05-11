import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log("Checking Prisma Models...");
  console.log("Models in prisma client:", Object.keys(prisma).filter(k => !k.startsWith('_') && !k.startsWith('$')));
  
  try {
    const statsCount = await (prisma as any).songStats.count();
    console.log("SongStats count:", statsCount);
  } catch (err) {
    console.error("Error accessing SongStats:", err.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
