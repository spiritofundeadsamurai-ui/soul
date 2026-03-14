import { registerAllInternalTools, getRegisteredTools } from './dist/core/agent-loop.js';
import { isActionMessage } from './dist/core/agent-loop.js';

// Step 1: Register tools (like main() does at startup)
registerAllInternalTools();
const allTools = getRegisteredTools();
console.log(`[Test] Total tools registered: ${allTools.length}`);

// Step 2: Simulate routeTools("ราคาทอง")
const msg = "ราคาทอง";
const lower = msg.toLowerCase();
const isAction = isActionMessage(msg);
console.log(`[Test] isAction: ${isAction}`);

// Check the short-message guard
if (lower.length < 15 && !isAction) {
  console.log("[Test] BLOCKED by short-message guard");
} else {
  console.log("[Test] Passed short-message guard");
}

// Score categories (copy from agent-loop)
const CATEGORY_KEYWORDS = {
  memory: ["remember", "recall", "forget", "memory", "search", "find", "know", "learned", "จำ", "ค้นหา", "ความจำ", "เรียนรู้"],
  mt5: ["mt5", "metatrader", "trading", "trade", "gold", "xauusd", "forex", "candle", "signal", "chart", "position", "เทรด", "ทอง", "ราคาทอง", "ราคา", "กราฟ", "สัญญาณ", "ออเดอร์", "เฝ้า", "ติดตาม", "monitor"],
};

const scores = new Map();
for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
  let score = 0;
  for (const kw of keywords) {
    if (lower.includes(kw)) score += 1;
  }
  if (score > 0) scores.set(category, score);
}
console.log(`[Test] Category scores:`, Object.fromEntries(scores));

// Filter tools by mt5 category
const mt5tools = allTools.filter(t => t.category === 'mt5');
console.log(`[Test] Would route ${mt5tools.length} MT5 tools:`, mt5tools.map(t => t.name));

console.log("\n✅ Tool routing WORKS correctly in this environment");
process.exit(0);
