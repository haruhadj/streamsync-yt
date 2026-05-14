import { NextRequest, NextResponse } from "next/server";
import axios from "axios";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");

  if (!q || q.trim().length === 0) {
    return NextResponse.json([]);
  }

  const normalizedQuery = q.toLowerCase().trim();
  const API_KEYS = (process.env.YOUTUBE_API_KEY || "").split(",").map(k => k.trim()).filter(k => k.length > 0);

  if (API_KEYS.length === 0) {
    return NextResponse.json({ error: "YOUTUBE_API_KEY is not configured" }, { status: 500 });
  }

  try {
    // 1. Check Cache
    const cacheEntry = await prisma.searchCache.findUnique({
      where: { query: normalizedQuery }
    });

    if (cacheEntry) {
      const age = Date.now() - new Date(cacheEntry.timestamp).getTime();
      const oneDay = 24 * 60 * 60 * 1000;
      if (age < oneDay) {
        return NextResponse.json(JSON.parse(cacheEntry.results));
      }
    }

    // 2. Call YouTube API
    let items: any[] = [];
    let success = false;

    for (let i = 0; i < API_KEYS.length; i++) {
      const currentKey = API_KEYS[i];
      try {
        const response = await axios.get(
          `https://www.googleapis.com/youtube/v3/search`,
          {
            params: {
              part: "snippet",
              q,
              type: "video",
              maxResults: 10,
              key: currentKey,
            },
            timeout: 5000,
          }
        );

        items = response.data.items.map((item: any) => ({
          videoId: item.id.videoId,
          title: item.snippet.title,
          thumbnail: item.snippet.thumbnails.medium.url,
        }));
        success = true;
        break;
      } catch (error: any) {
        if (i < API_KEYS.length - 1) continue;
        throw error;
      }
    }

    // 3. Save Cache
    if (success && items.length > 0) {
      await prisma.searchCache.upsert({
        where: { query: normalizedQuery },
        update: { results: JSON.stringify(items), timestamp: new Date() },
        create: { query: normalizedQuery, results: JSON.stringify(items) }
      });
    }

    return NextResponse.json(items);
  } catch (error: any) {
    console.error("Search Error:", error.message);
    // Fallback to historical search
    const historyItems = await prisma.request.findMany({
      where: { OR: [{ title: { contains: q } }, { videoId: q }] },
      take: 10,
      distinct: ['videoId']
    });
    return NextResponse.json(historyItems.map(h => ({
      videoId: h.videoId,
      title: h.title,
      thumbnail: h.thumbnail
    })));
  }
}
