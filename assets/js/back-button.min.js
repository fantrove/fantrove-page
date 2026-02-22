/**
 * ระบบจัดการปุ่มย้อนกลับ
 * เวอร์ชั่น: 2.0.1
 */
document.addEventListener('DOMContentLoaded', () => {
 // ค้นหาปุ่มย้อนกลับ
 const backButton = document.getElementById('back-button');
 
 // ถ้าไม่พบปุ่มย้อนกลับ ให้จบการทำงาน
 if (!backButton) {
  console.warn('ไม่พบปุ่มย้อนกลับในหน้าเว็บ');
  return;
 }
 
 // ค่าหน่วงเวลาก่อนเริ่มการนำทาง (มิลลิวินาที)
 const DELAY_BEFORE_NAVIGATION = 100;
 
 // ฟังก์ชันสำหรับการนำทางย้อนกลับ
 const navigateBack = () => {
  if (window.history.length > 1) {
   // ก่อนเรียก history.back ให้บันทึก intent ว่าเรจะย้อนกลับ (ช่วย debug/loop prevention)
   try { sessionStorage.setItem('fv-back-intent', String(Date.now())); } catch (e) {}
   window.history.back();
   checkNavigation();
  } else {
   redirectToHome();
  }
 };
 
 // ฟังก์ชันตรวจสอบการนำทาง หลังจากย้อนกลับไปแล้ว
 const checkNavigation = () => {
  // หน่วงเวลาเล็กน้อยเพื่อเช็คว่าเอกสารมี referrer หรือไม่
  setTimeout(() => {
   if (!document.referrer) {
    try {
     const lm = window.languageManager;
     if (lm && typeof lm.getPredictedLangForPath === 'function') {
      const predicted = lm.getPredictedLangForPath(location.pathname + (location.search || ''));
      if (predicted && predicted !== (lm.selectedLang || 'en')) {
       // เปลี่ยนภาษาก่อนจะปล่อยให้หน้า continue (non-blocking)
       lm.updatePageLanguage(predicted).catch(() => {});
      }
     }
    } catch (e) {}
    redirectToHome();
   }
  }, 100);
 };
 
 // ฟังก์ชันนำทางกลับไปหน้าหลัก
 const redirectToHome = () => {
  window.location.href = '/home';
 };
 
 // เพิ่ม event listener ให้กับปุ่มย้อนกลับ โดยหน่วงเวลา 100 มิลลิวินาทีก่อนเริ่มการ[...]
 backButton.addEventListener('click', () => {
  setTimeout(() => {
   try {
    navigateBack();
   } catch (error) {
    console.error('เกิดข้อผิดพลาดในการนำทางย้อนกลับ:', error);
    redirectToHome();
   }
  }, DELAY_BEFORE_NAVIGATION);
 });
});