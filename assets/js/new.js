(function() {
 function paintVersion(version) {
  function doPaint() {
   const el = document.getElementById("title");
   if (el) el.textContent = version;
   else setTimeout(doPaint, 0); // ลองใหม่จนกว่าจะมี DOM
  }
  if (document.readyState === "loading") setTimeout(doPaint, 0);
  else doPaint();
 }
 // เริ่มดึงข้อมูลทันทีที่ script ถูก parse
 fetch("/assets/json/version.json")
  .then(r => r.json())
  .then(data => paintVersion(data.version))
  .catch(e => console.error("Error loading version:", e));
})();