const fs = require('fs');
const path = require('path');

const files = fs.readdirSync('.').filter(f => f.endsWith('.sql'));

files.forEach(f => {
  const content = fs.readFileSync(f, 'utf8');
  const matches = content.match(/CREATE TABLE\s+\w+/gi);
  if (matches) {
    console.log(`File ${f}:`);
    matches.forEach(m => console.log(`  ${m}`));
  }
});
