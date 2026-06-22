const fs = require('fs');
const readline = require('readline');
const path = 'C:\\Users\\andre\\.gemini\\antigravity\\brain\\7371f69e-301e-462e-bfd8-b411737a0d58\\.system_generated\\logs\\transcript.jsonl';

const rl = readline.createInterface({
  input: fs.createReadStream(path),
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  try {
    const obj = JSON.parse(line);
    if (obj.step_index >= 45 && obj.step_index <= 65) {
      console.log(`Step ${obj.step_index} (${obj.source}):`);
      if (obj.content) console.log(obj.content);
      if (obj.tool_calls) console.log(JSON.stringify(obj.tool_calls, null, 2));
      console.log('--------------------------------------------------');
    }
  } catch (e) {
    // ignore
  }
});
