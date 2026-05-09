import axios from "axios";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(process.cwd(), ".env") });

async function testInvidious() {
  const q = "never gonna give you up";
  const INVIDIOUS_URL = process.env.INVIDIOUS_URL || "http://127.0.0.1:3000";
  console.log(`Testing Invidious search at ${INVIDIOUS_URL} for "${q}"...`);
  
  try {
    const response = await axios.get(`${INVIDIOUS_URL}/api/v1/search`, {
      params: { q, type: "video" },
      timeout: 5000,
    });

    console.log("Raw Response Data Type:", typeof response.data);
    console.log("Is Array:", Array.isArray(response.data));
    console.log("Full Response Body:", response.data);

    if (!Array.isArray(response.data)) {
      throw new Error("Response data is not an array. Check the logs above for the actual structure.");
    }

    const results = response.data
      .filter((item: any) => item.type === "video")
      .map((item: any) => ({
        videoId: item.videoId,
        title: item.title,
        thumbnail: item.videoThumbnails?.find((t: any) => t.quality === "medium")?.url || item.videoThumbnails?.[0]?.url || "",
      }));

    console.log("Success! Found", results.length, "results.");
    console.log("First result:", results[0]);
  } catch (error: any) {
    console.error("Invidious Search Failed:", error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error("Make sure your Invidious instance is running at", INVIDIOUS_URL);
    }
  }
}

testInvidious();
