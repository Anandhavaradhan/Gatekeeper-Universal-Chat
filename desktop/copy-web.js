// Copies the web app into desktop/www before packaging.
const fs = require('fs');
const path = require('path');
const out = path.join(__dirname, 'www');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const items = [["../app-shell/index.html", "index.html"]];
for (const [from, to] of items) {
  const src = path.join(__dirname, from);
  if (!fs.existsSync(src)) { console.error('missing ' + src); process.exit(1); }
  fs.cpSync(src, path.join(out, to), { recursive: true });
}
console.log('copied ' + items.length + ' item(s) to ' + out);
