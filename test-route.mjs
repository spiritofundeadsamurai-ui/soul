import { registerAllInternalTools, getRegisteredTools } from './dist/core/agent-loop.js';
import { isActionMessage } from './dist/core/agent-loop.js';
registerAllInternalTools();

const msg = "ราคาทอง";
const lower = msg.toLowerCase();
console.log("Message:", msg, "length:", lower.length);
console.log("isActionMessage:", isActionMessage(msg));

// Simulate routeTools
const CATEGORY_KEYWORDS = {
  mt5: ["mt5", "metatrader", "trading", "trade", "gold", "xauusd", "forex", "candle", "signal", "chart", "position", "เทรด", "ทอง", "ราคาทอง", "ราคา", "กราฟ", "สัญญาณ", "ออเดอร์", "เฝ้า", "ติดตาม", "monitor"],
};

const scores = new Map();
for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
  let score = 0;
  for (const kw of keywords) {
    if (lower.includes(kw)) {
      score += 1;
      console.log(`  match: "${kw}" in category "${category}"`);
    }
  }
  if (score > 0) scores.set(category, score);
}
console.log("Scores:", Object.fromEntries(scores));

const allTools = getRegisteredTools();
const mt5tools = allTools.filter(t => t.category === 'mt5');
console.log("MT5 tools available:", mt5tools.length);

process.exit(0);
