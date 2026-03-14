import { registerAllInternalTools, getRegisteredTools } from './dist/core/agent-loop.js';
registerAllInternalTools();
const tools = getRegisteredTools();
console.log('Total tools:', tools.length);
const mt5tools = tools.filter(t => t.category === 'mt5');
console.log('MT5 tools:', mt5tools.map(t => t.name));
const allCats = [...new Set(tools.map(t => t.category))];
console.log('All categories:', allCats.sort());
process.exit(0);
