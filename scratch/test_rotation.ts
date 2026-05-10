import axios from "axios";

async function testRotation(keys: string[], query: string) {
  let items: any[] = [];
  let success = false;

  for (let i = 0; i < keys.length; i++) {
    const currentKey = keys[i];
    try {
      console.log(`[Test] Trying Key ${i + 1}/${keys.length}: ${currentKey}`);
      // Simulate API call
      if (currentKey === "FAIL") {
        throw { response: { status: 403, data: { error: { code: 403, message: "quota exceeded" } } } };
      }
      
      console.log(`[Test] Key ${i + 1} succeeded!`);
      items = [{ videoId: "abc", title: "Success" }];
      success = true;
      break;
    } catch (error: any) {
      const errorData = error.response?.data;
      const isQuotaError = error.response?.status === 403 || errorData?.error?.code === 403 || errorData?.error?.message?.toLowerCase().includes("quota");
      
      console.error(`[Test] Key ${i + 1} Error:`, isQuotaError ? "Quota Exceeded" : (errorData || error.message));

      if (i < keys.length - 1 && isQuotaError) {
        console.log(`[Test] Rotating to next API key...`);
        continue;
      } else {
        console.log("[Test] No more keys or non-quota error.");
        break;
      }
    }
  }

  return { success, items };
}

async function run() {
  console.log("--- Test 1: First key fails, second succeeds ---");
  const result1 = await testRotation(["FAIL", "SUCCESS"], "test");
  console.log("Result 1 Success:", result1.success);

  console.log("\n--- Test 2: All keys fail ---");
  const result2 = await testRotation(["FAIL", "FAIL"], "test");
  console.log("Result 2 Success:", result2.success);
}

run();
