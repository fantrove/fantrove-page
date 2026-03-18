function setupLoading() {
 // ตรวจสอบและสร้าง loading-container หากยังไม่มีใน DOM
 let loadingContainer = document.querySelector('.loading-container');
 if (!loadingContainer) {
  loadingContainer = document.createElement('div');
  loadingContainer.classList.add('loading-container');
  document.body.appendChild(loadingContainer);
 }
 
 // เพิ่ม SVG สำหรับ Spinner หากยังไม่มี
 if (!loadingContainer.innerHTML.trim()) {
  const svgSpinner = `
      <svg class="spinner" width="65px" height="65px" viewBox="0 0 66 66" xmlns="http://www.w3.org/2000/svg">
      <circle class="path" fill="none" stroke="black" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" cx="33" cy="33" r="30"></circle>
      </svg>
    `;
  loadingContainer.innerHTML = svgSpinner;
 }
 
 // แสดงหน้าโหลด
 loadingContainer.style.visibility = 'visible';
 loadingContainer.style.opacity = 1;
}

// ฟังก์ชันสำหรับการซ่อนหน้าโหลด
function hideLoading() {
 let loadingContainer = document.querySelector('.loading-container');
 if (loadingContainer) {
  loadingContainer.style.transition = 'opacity 0.3s ease-out, visibility 0s 0.3s';
  loadingContainer.style.opacity = 0;
  setTimeout(() => {
   loadingContainer.style.visibility = 'hidden';
  }, 300); // รอให้จางหายเสร็จ
 }
}

// เมื่อโหลดเสร็จให้ซ่อนหน้าโหลด
window.addEventListener('load', () => {
 setTimeout(hideLoading, 50); // แสดงหน้าโหลดอย่างน้อย 50ms ก่อนซ่อน
});

// แสดงหน้าโหลดเมื่อเข้าเว็บไซต์ครั้งแรก (เมื่อโหลดหน้าใหม่)
if (document.readyState === 'loading') {
 setupLoading();
} else {
 // ถ้าหน้าเว็บโหลดแล้ว เรียกใช้ setupLoading
 setTimeout(setupLoading, 100); // ให้แน่ใจว่า setTimeout เพื่อไม่ให้เกิดปัญหากับการแสดงผลทันที
}