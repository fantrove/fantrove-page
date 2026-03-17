// utils.js — v2
// ─────────────────────────────────────────────────────────────
// v2 changes:
//  - ลบ style injection (#notification-styles) ออกจาก showNotification()
//    CSS ของ .notification ทั้งหมดอยู่ใน /assets/css/loading.css แล้ว
//  - ลบ slideOut animation string ออก (อยู่ใน loading.css แล้ว)
//  - ใช้ classList.add('notification-slideout') แทน inline animation style
//  - โค้ดเบาลง ~40 บรรทัด
// ─────────────────────────────────────────────────────────────

export function showNotification(message, type = 'info', options = {}) {
 const lang = localStorage.getItem('selectedLang') || 'en';
 const labels = {
  th: { success: '✨ สำเร็จ!', error: '❌ ข้อผิดพลาด', warning: '⚠️ คำเตือน', info: 'ℹ️ ข้อมูล', loading: '⌛ กำลังโหลด' },
  en: { success: '✨ Success!', error: '❌ Error', warning: '⚠️ Warning', info: 'ℹ️ Information', loading: '⌛ Loading' }
 };
 try {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.setAttribute('data-timestamp', Date.now());
  
  const icon = document.createElement('div');
  icon.className = 'notification-icon';
  icon.innerHTML =
   type === 'success' ? '✓' :
   type === 'error' ? '✕' :
   type === 'warning' ? '⚠' :
   type === 'loading' ? '⌛' : 'ℹ';
  
  const messageContainer = document.createElement('div');
  messageContainer.className = 'notification-message-container';
  messageContainer.innerHTML =
   `<div class="notification-title">${labels[lang]?.[type] || labels.en[type]}</div>` +
   `<div class="notification-content">${message}</div>`;
  
  if (options.dismissible !== false) {
   const closeButton = document.createElement('button');
   closeButton.className = 'notification-close';
   closeButton.innerHTML = '×';
   closeButton.onclick = () => {
    // Use CSS class from loading.css instead of inline animation string
    notification.classList.add('notification-slideout');
    setTimeout(() => notification.remove(), 300);
   };
   notification.appendChild(closeButton);
  }
  
  notification.appendChild(icon);
  notification.appendChild(messageContainer);
  document.body.appendChild(notification);
  
  if (type !== 'loading' && options.duration !== Infinity) {
   setTimeout(() => {
    notification.classList.add('notification-slideout');
    setTimeout(() => { try { notification.remove(); } catch (_) {} }, 300);
   }, options.duration || 3000);
  }
  return notification;
 } catch (error) {
  console.error('Error showing notification:', error);
 }
}

export class ErrorManager {
 constructor() {
  this.errorStates = new Map();
  this.timeouts = new Map();
 }
 isValidError(error) {
  return error && (error instanceof Error || error.message || typeof error === 'string');
 }
 isDuplicateError(errorKey, message) {
  const existing = this.errorStates.get(errorKey);
  return existing && existing.message === message;
 }
 showError(errorKey, error, options = {}) {
  if (!this.isValidError(error)) return;
  const message = error.message || error.toString();
  if (this.isDuplicateError(errorKey, message)) return;
  if (this.timeouts.has(errorKey)) clearTimeout(this.timeouts.get(errorKey));
  this.errorStates.set(errorKey, { message, timestamp: Date.now(), type: options.type || 'error' });
  showNotification(message, options.type || 'error', {
   duration: options.duration || 3000,
   position: options.position || 'top',
   dismissible: options.dismissible !== false
  });
  const timeout = setTimeout(() => {
   this.errorStates.delete(errorKey);
   this.timeouts.delete(errorKey);
  }, options.duration || 3000);
  this.timeouts.set(errorKey, timeout);
 }
 clearErrors() {
  this.errorStates.clear();
  this.timeouts.forEach(clearTimeout);
  this.timeouts.clear();
 }
}

export const _headerV2_utils = {
 debounce(func, wait = 250) {
  let timeout;
  return (...args) => {
   clearTimeout(timeout);
   timeout = setTimeout(() => func.apply(this, args), wait);
  };
 },
 
 throttle(func, limit = 100) {
  let inThrottle;
  return (...args) => {
   if (!inThrottle) {
    func.apply(this, args);
    inThrottle = true;
    setTimeout(() => inThrottle = false, limit);
   }
  };
 },
 
 debounceWithMaxWait(func, wait = 250, maxWait = 1000) {
  let timeout, maxTimeout, lastCallTime = 0;
  return (...args) => {
   const now = Date.now();
   clearTimeout(timeout);
   if (maxTimeout) clearTimeout(maxTimeout);
   const remaining = now - lastCallTime;
   timeout = setTimeout(() => {
    func.apply(this, args);
    lastCallTime = Date.now();
   }, wait);
   if (remaining >= maxWait) {
    func.apply(this, args);
    lastCallTime = Date.now();
   } else {
    maxTimeout = setTimeout(() => {
     func.apply(this, args);
     lastCallTime = Date.now();
    }, maxWait - remaining);
   }
  };
 },
 
 batchDOMReads(tasks) {
  return requestAnimationFrame(() => {
   const results = tasks.map(t => t.read());
   requestAnimationFrame(() => {
    for (let i = 0; i < tasks.length; i++) {
     if (tasks[i].write) tasks[i].write(results[i]);
    }
   });
  });
 },
 
 isOnline() { return navigator.onLine; },
 
 showNotification,
 errorManager: new ErrorManager()
};

export default _headerV2_utils;