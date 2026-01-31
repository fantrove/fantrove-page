const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '../../assets/js/header-modules');
function rmrf(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  for (const entry of fs.readdirSync(dirPath)) {
    const full = path.join(dirPath, entry);
    const stat = fs.lstatSync(full);
    if (stat.isDirectory()) {
      rmrf(full);
    } else {
      try { fs.unlinkSync(full); } catch {}
    }
  }
  try { fs.rmdirSync(dirPath); } catch {}
}
rmrf(target);
console.log('cleaned', target);