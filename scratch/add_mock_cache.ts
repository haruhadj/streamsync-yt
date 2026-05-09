import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  try {
    const query = "never gonna give you up";
    const results = JSON.stringify([
      {
        videoId: "dQw4w9WgXcQ",
        title: "Rick Astley - Never Gonna Give You Up (Official Music Video)",
        thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg"
      }
    ]);

    // Use any to bypass type check if client not regenerated
    const prismaAny = prisma as any;
    
    await prismaAny.searchCache.upsert({
      where: { query },
      update: { results, timestamp: new Date() },
      create: { query, results }
    });

    console.log("Mock cache entry added!");
  } catch (err) {
    console.error("Error adding mock entry:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
