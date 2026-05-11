import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log("Checking history...");
  const history = await prisma.request.findMany({ where: { status: "played" } });
  console.log(`Current played requests: ${history.length}`);
  
  if (history.length > 0) {
    const videoId = history[0].videoId;
    console.log(`Deleting history for videoId: ${videoId}`);
    const result = await prisma.request.deleteMany({ where: { videoId, status: "played" } });
    console.log(`Deleted ${result.count} records.`);
  } else {
    console.log("No history to delete.");
  }
  
  await prisma.$disconnect();
}

main();
