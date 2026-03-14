/**
 * Soul LIVE Smoke Test — Tests REAL agent loop with REAL LLM
 * This is NOT a module import test. It sends actual messages and checks tool usage.
 *
 * Run: node test-live.mjs
 * Requires: LLM configured (Ollama, Groq, etc.)
 */

let pass = 0, fail = 0;
function ok(name, condition, detail) {
  if (condition) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} — ${detail || "FAILED"}`); }
}

console.log("\n═══ Soul LIVE Smoke Tests ═══\n");
console.log("Testing real agent loop with real LLM...\n");

const { runAgentLoop, registerAllInternalTools } = await import("./dist/core/agent-loop.js");
registerAllInternalTools();

// Helper: run agent loop with timeout
async function ask(message, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await runAgentLoop(message, { maxIterations: 5 });
    clearTimeout(timer);
    return result;
  } catch (e) {
    clearTimeout(timer);
    return { reply: `ERROR: ${e.message}`, toolsUsed: [], model: "error", provider: "error", iterations: 0, totalTokens: 0 };
  }
}

// ─── Test 1: Simple greeting (should NOT call tools) ───
console.log("1. Simple greeting (no tools expected)");
try {
  const r = await ask("สวัสดีครับ");
  console.log(`   Reply: "${r.reply.substring(0, 80)}..."`);
  console.log(`   Model: ${r.provider}/${r.model} | Tools: [${r.toolsUsed.join(",")}] | Tokens: ${r.totalTokens}`);
  ok("Got a reply", r.reply && r.reply.length > 0);
  ok("No crash", !r.reply.startsWith("ERROR"));
} catch (e) { fail++; console.log(`  ✗ Greeting failed: ${e.message}`); }

// ─── Test 2: Remember something (MUST call soul_remember) ───
console.log("\n2. Remember command (tool: soul_remember)");
try {
  const r = await ask("จำไว้ว่าผมชอบกินข้าวผัด");
  console.log(`   Reply: "${r.reply.substring(0, 80)}..."`);
  console.log(`   Tools: [${r.toolsUsed.join(",")}]`);
  ok("Got a reply", r.reply.length > 0);
  ok("Called soul_remember", r.toolsUsed.includes("soul_remember"), `Tools used: [${r.toolsUsed.join(",")}]`);
} catch (e) { fail++; console.log(`  ✗ Remember failed: ${e.message}`); }

// ─── Test 3: Search memory (MUST call soul_search) ───
console.log("\n3. Search memory (tool: soul_search)");
try {
  const r = await ask("ค้นหาในความจำเรื่องข้าวผัด");
  console.log(`   Reply: "${r.reply.substring(0, 80)}..."`);
  console.log(`   Tools: [${r.toolsUsed.join(",")}]`);
  ok("Got a reply", r.reply.length > 0);
  ok("Called soul_search or soul_recall", r.toolsUsed.some(t => t.includes("search") || t.includes("recall")), `Tools used: [${r.toolsUsed.join(",")}]`);
} catch (e) { fail++; console.log(`  ✗ Search failed: ${e.message}`); }

// ─── Test 4: Read file (MUST call soul_read_file or soul_list_dir) ───
console.log("\n4. File operation (tool: soul_read_file or soul_list_dir)");
try {
  const r = await ask("อ่านไฟล์ package.json ในโฟลเดอร์ปัจจุบัน");
  console.log(`   Reply: "${r.reply.substring(0, 100)}..."`);
  console.log(`   Tools: [${r.toolsUsed.join(",")}]`);
  ok("Got a reply", r.reply.length > 0);
  ok("Called file tool", r.toolsUsed.some(t => t.includes("file") || t.includes("read") || t.includes("dir") || t.includes("list")), `Tools used: [${r.toolsUsed.join(",")}]`);
} catch (e) { fail++; console.log(`  ✗ File read failed: ${e.message}`); }

// ─── Test 5: Error recovery (bad request should not crash) ───
console.log("\n5. Error recovery");
try {
  const r = await ask("aaaaaaaaaaaaaaaa", 30000);
  ok("Did not crash", r.reply && !r.reply.startsWith("ERROR"));
} catch (e) { fail++; console.log(`  ✗ Error recovery failed: ${e.message}`); }

// ─── Test 6: Thai response for Thai input ───
console.log("\n6. Language detection");
try {
  const r = await ask("คุณชื่ออะไร");
  console.log(`   Reply: "${r.reply.substring(0, 80)}..."`);
  // Check if reply contains Thai characters
  const hasThai = /[\u0E00-\u0E7F]/.test(r.reply);
  ok("Replied in Thai", hasThai, `Reply appears to be in English`);
} catch (e) { fail++; console.log(`  ✗ Language test failed: ${e.message}`); }

// ─── Summary ───
console.log(`\n═══ Results: ${pass} passed, ${fail} failed (${pass + fail} total) ═══`);
if (fail > 0) {
  console.log("\n⚠️  Some tests failed. Check if:");
  console.log("   - LLM is configured and reachable (soul_llm_list)");
  console.log("   - Model supports tool calling (check self-diagnostics)");
  console.log("   - Network is available for cloud LLM providers");
}
process.exit(fail > 0 ? 1 : 0);
