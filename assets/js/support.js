function getCurrentLang() {
  return localStorage.getItem('selectedLang') || 'en';
}

const loadingMessages = { th: 'กำลังโหลด...', en: 'Loading...' };
const countdownMessages = { th: 'กำลังจะเปิดใน', en: 'Opening in' };
const goNowMessages = { th: 'เปิดทันที', en: 'Open now' };
const cancelMessages = { th: 'ย้อนกลับ', en: 'Cancel' };

function getMessage(key, lang) {
  const localKey = `support_${key}_${lang}`;
  const map = {
    loading: loadingMessages,
    countdown: countdownMessages,
    goNow: goNowMessages,
    cancel: cancelMessages,
  };
  return localStorage.getItem(localKey)
    || (map[key] && map[key][lang])
    || (map[key] && map[key]['en'])
    || '';
}

const paymentMethods = [
  {
    id: 'patreon',
    icon: {
      type: 'svg',
      content: `<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" fill-rule="evenodd" clip-rule="evenodd" stroke-linejoin="round" stroke-miterlimit="2"><g transform="matrix(.47407 0 0 .47407 .383 .422)"><clipPath id="prefix__a"><path d="M0 0h1080v1080H0z"/></clipPath><g clip-path="url(#prefix__a)"><path d="M1033.05 324.45c-.19-137.9-107.59-250.92-233.6-291.7-156.48-50.64-362.86-43.3-512.28 27.2-181.1 85.46-237.99 272.66-240.11 459.36-1.74 153.5 13.58 557.79 241.62 560.67 169.44 2.15 194.67-216.18 273.07-321.33 55.78-74.81 127.6-95.94 216.01-117.82 151.95-37.61 255.51-157.53 255.29-316.38z" fill-rule="nonzero"/></g></g></svg>`
    },
    name: {
      th: 'patreon',
      en: 'patreon'
    },
    supportType: {
      th: 'รายเดือน',
      en: 'Monthly'
    },
    url: 'https://www.patreon.com/LedpAeroWings'
  },
  {
    id: 'truemoney',
    icon: {
      type: 'img',
      content: 'https://images.seeklogo.com/logo-png/36/1/truemoney-wallet-logo-png_seeklogo-367826.png',
      alt: 'truemoney logo'
    },
    name: {
      th: 'ทรูมันนี่',
      en: 'TrueMoney'
    },
    supportType: {
      th: 'ครั้งเดียว',
      en: 'One-time'
    },
    url: 'https://tmn.app.link/6oALhRsvQSb'
  }
];

function resolveLangValue(val, lang, methodId, field) {
  const localKey = `support_${methodId}_${field}_${lang}`;
  const override = localStorage.getItem(localKey);
  if (override) return override;
  if (typeof val === 'object' && val !== null) {
    return val[lang] || val['en'] || Object.values(val)[0];
  }
  return val;
}

const pages = {
  'main': 'main-page',
  'confirm': 'confirmation-page',
  'payment': 'payment-methods-page',
  'thanks': 'thanks-page'
};

// เปลี่ยน selectedPaymentMethod เป็นตัวแปรหน่วยความจำ (in-memory)
let selectedPaymentMethod = '';
let isAnimating = false;
let animationCancel = false;
let countdownInterval = null;
let currentCountdown = 0;

// ========== UI/Overlay Functions ==========

function createPaymentOptions() {
  const lang = getCurrentLang();
  const container = document.querySelector('.payment-options');
  container.innerHTML = paymentMethods.map(method => `
    <div class="payment-option" onclick="selectPaymentMethod('${method.id}')">
      <span class="support-type">${resolveLangValue(method.supportType, lang, method.id, 'supportType')}</span>
      <span class="payment-icon">${getIconHtml(method.icon)}</span>
      <span>${resolveLangValue(method.name, lang, method.id, 'name')}</span>
    </div>
  `).join('');
}

function getIconHtml(icon) {
  switch (icon.type) {
    case 'svg':
      return icon.content;
    case 'img':
      return `<img src="${icon.content}" alt="${icon.alt || ''}" class="payment-img">`;
    case 'emoji':
      return icon.content;
    default:
      return '';
  }
}

// ไม่มีการบันทึก selectedPaymentMethod ใน localStorage อีกต่อไป
function savePaymentMethod(method) {
  selectedPaymentMethod = method;
}
function loadPaymentMethod() {
  return selectedPaymentMethod;
}
function resetPaymentMethod() {
  selectedPaymentMethod = '';
}

function updateURL(page) {
  const url = new URL(window.location);
  url.searchParams.set('page', page);
  window.history.pushState({ page }, '', url);
}

function showPageFromURL() {
  const urlParams = new URLSearchParams(window.location.search);
  const page = urlParams.get('page') || 'main';
  showPage(pages[page]);

  if (page === 'payment') {
    const savedMethod = loadPaymentMethod();
    if (savedMethod) {
      selectPaymentMethod(savedMethod, true);
    }
  }
}

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(page => {
    page.classList.remove('active');
  });
  document.getElementById(pageId).classList.add('active');
}

function goBack() {
  if (isAnimating) {
    cancelAnimation();
  } else {
    window.history.back();
  }
}

function showConfirmation() {
  updateURL('confirm');
  showPage('confirmation-page');
}

function showPaymentMethods() {
  updateURL('payment');
  showPage('payment-methods-page');

  const savedMethod = loadPaymentMethod();
  if (savedMethod) {
    selectPaymentMethod(savedMethod, true);
  }
}

function showThanks() {
  if (!selectedPaymentMethod) {
    const lang = getCurrentLang();
    alert(lang === 'th' ? 'กรุณาเลือกช่องทางการสนับสนุน' : 'Please select a support method');
    return;
  }
  updateURL('thanks');
  showPage('thanks-page');
}

function selectPaymentMethod(method, isLoading = false) {
  if (!isLoading) {
    savePaymentMethod(method);
  }
  const lang = getCurrentLang();
  document.querySelectorAll('.payment-option').forEach(option => {
    option.classList.remove('selected');
    const nameSpan = option.querySelector('span:last-child');
    const methodObj = paymentMethods.find(m => m.id === method);
    if (
      nameSpan &&
      methodObj &&
      nameSpan.textContent === resolveLangValue(methodObj.name, lang, methodObj.id, 'name')
    ) {
      option.classList.add('selected');
    }
  });
}

function updatePaymentOptionsLanguage() {
  createPaymentOptions();
  if (selectedPaymentMethod) {
    selectPaymentMethod(selectedPaymentMethod, true);
  }
  updateLoadingOverlayLanguage();
}

window.addEventListener('languageChange', () => {
  updatePaymentOptionsLanguage();
});

// --- Animation Overlay Button Area ---
function showCountdownButtonArea() {
  let btnArea = document.querySelector('.countdown-btn-area');
  const overlay = document.getElementById('animation-overlay');
  if (!btnArea) {
    btnArea = document.createElement('div');
    btnArea.className = 'countdown-btn-area';
    btnArea.innerHTML = `
      <button type="button" class="btn-cancel-rocket">${getMessage('cancel', getCurrentLang())}</button>
      <span class="countdown-label">
        <span class="countdown-label-text">${getMessage('countdown', getCurrentLang())}</span>
        <span class="countdown-num" style="font-variant-numeric:tabular-nums;font-size:1.12em;font-weight:bold;"></span>
      </span>
      <button type="button" class="btn-go-rocket">${getMessage('goNow', getCurrentLang())}</button>
    `;
    overlay.appendChild(btnArea);

    // Inject CSS เฉพาะ button area ถ้ายังไม่มี
    if (!document.getElementById('countdown-btn-area-style')) {
      const style = document.createElement('style');
      style.id = 'countdown-btn-area-style';
      style.textContent = `
.countdown-btn-area {
  position: fixed;
  left: 0; right: 0; top: 37%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  gap: 26px;
  z-index: 10002;
  pointer-events: all;
  background: none;
}
.countdown-btn-area button {
  min-width: 110px;
  border-radius: 18px;
  background: #ff69b4;
  border: none;
  color: #fff;
  font-family: inherit;
  font-weight: 600;
  font-size: 1.08em;
  cursor: pointer;
  box-shadow: 0 2px 18px #ff69b48a;
  padding: 12px 0 12px 0;
  transition: background .2s, box-shadow .2s;
  letter-spacing: 0.01em;
}
.countdown-btn-area .btn-cancel-rocket {
  background: rgba(255,255,255,0.12);
  color: #fff;
  box-shadow: 0 2px 10px #0002;
  border: 1.5px solid #fff3;
}
.countdown-btn-area .btn-go-rocket {
  background: #ff69b4;
  color: #fff;
  border: 1.5px solid #ff69b4;
}
.countdown-btn-area .btn-cancel-rocket:hover {
  background: #fff0;
  color: #ff69b4;
  border-color: #ff69b4;
}
.countdown-btn-area .btn-go-rocket:hover {
  background: #ff99cd;
  color: #fff;
}
.countdown-btn-area .countdown-label {
  display: flex; align-items: center; gap: 6px;
  font-size: 1.07em;
  color: #fff;
  background: none;
  font-weight: 600;
  padding: 0 10px;
  text-shadow: 0 1px 6px #ff69b488, 0 0 10px #24001a;
}
@media (max-width: 600px) {
  .countdown-btn-area {
    flex-direction: column;
    gap: 18px;
    top: 45%;
    transform: translateY(-45%);
  }
  .countdown-btn-area button {
    width: 90vw;
    min-width: 0;
    font-size: 1em;
  }
}
      `;
      document.head.appendChild(style);
    }
  }
  btnArea.querySelector('.btn-cancel-rocket').onclick = cancelAnimation;
  btnArea.querySelector('.btn-go-rocket').onclick = () => {
    currentCountdown = 0;
    handleCountdownFinish();
  };
  updateCountdownButtonTexts();
  btnArea.style.display = 'flex';

  // ขยับ rocket ขึ้น
  moveRocketUp();
}

function hideCountdownButtonArea() {
  let btnArea = document.querySelector('.countdown-btn-area');
  if (btnArea) btnArea.style.display = 'none';
  // คืน rocket ลงมา
  moveRocketDown();
}

function updateCountdownButtonTexts() {
  let btnArea = document.querySelector('.countdown-btn-area');
  if (!btnArea) return;
  btnArea.querySelector('.btn-cancel-rocket').textContent = getMessage('cancel', getCurrentLang());
  btnArea.querySelector('.btn-go-rocket').textContent = getMessage('goNow', getCurrentLang());
  btnArea.querySelector('.countdown-label-text').textContent = getMessage('countdown', getCurrentLang());
}

function updateCountdownDisplay(sec) {
  let btnArea = document.querySelector('.countdown-btn-area');
  if (btnArea) {
    btnArea.querySelector('.countdown-num').textContent = sec > 0 ? sec : '';
  }
}

function handleCountdownFinish() {
  clearInterval(countdownInterval);
  countdownInterval = null;
  hideCountdownButtonArea();
  showLoadingTextRocket();
  setTimeout(() => {
    if (!animationCancel) {
      finishRocketAnimationRedirect();
    }
  }, 700);
}

// ========== Rocket Position Control ==========
function moveRocketUp() {
  const rocket = document.getElementById('rocket');
  if (rocket) {
    rocket.style.transition = 'top 0.4s cubic-bezier(0.4,0,0.2,1)';
    rocket.style.top = '20%';
  }
}
function moveRocketDown() {
  const rocket = document.getElementById('rocket');
  if (rocket) {
    rocket.style.transition = 'top 0.4s cubic-bezier(0.4,0,0.2,1)';
    rocket.style.top = '50%';
  }
}

// --- Animation Overlay Loading Message (หลัง countdown) ---
function showLoadingTextRocket() {
  let loadingText = document.querySelector('.loading-text-rocket');
  const overlay = document.getElementById('animation-overlay');
  if (!loadingText) {
    loadingText = document.createElement('div');
    loadingText.className = 'loading-text-rocket';
    loadingText.innerHTML = `
      <span class="loading-word" style="font-size:1.12em;"></span>
    `;
    overlay.appendChild(loadingText);

    if (!document.getElementById('loading-text-rocket-style')) {
      const style = document.createElement('style');
      style.id = 'loading-text-rocket-style';
      style.textContent = `
.loading-text-rocket {
  position: absolute;
  left: 50%;
  top: 67%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 1.45rem;
  font-weight: 700;
  color: #fff;
  letter-spacing: 0.03em;
  z-index: 10001;
  text-shadow: 0 2px 16px #ff69b4, 0 0 10px #24001a;
  user-select: none;
  background: none;
  border-radius: 22px;
  padding: 0;
  box-shadow: none;
  animation: fadeInLoading 0.7s cubic-bezier(0.4,0,0.2,1);
  pointer-events: none;
}
@keyframes fadeInLoading {
  from { opacity: 0; transform: translate(-50%, -60%) scale(0.92);}
  to   { opacity: 1; transform: translate(-50%, -50%) scale(1);}
}
      `;
      document.head.appendChild(style);
    }
  }
  loadingText.querySelector('.loading-word').textContent = getMessage('loading', getCurrentLang());
  loadingText.style.display = 'flex';

  // คืน rocket ลงมา
  moveRocketDown();
}

function hideLoadingTextRocket() {
  const loadingText = document.querySelector('.loading-text-rocket');
  if (loadingText) loadingText.style.display = 'none';
}

function cancelAnimation() {
  clearInterval(countdownInterval);
  countdownInterval = null;
  hideCountdownButtonArea();
  hideLoadingTextRocket();
  const overlay = document.getElementById('animation-overlay');
  const rocket = document.getElementById('rocket');
  overlay.classList.remove('active');
  rocket.style.visibility = 'hidden';
  rocket.style.animation = '';
  rocket.style.transition = '';
  rocket.style.top = '';
  isAnimating = false;
  animationCancel = true;
  resetPaymentMethod(); // reset ตัวเลือกเมื่อย้อนกลับออก
  updateURL('thanks');
  showPage('thanks-page');
}

function finishRocketAnimationRedirect() {
  const selectedMethod = paymentMethods.find(m => m.id === selectedPaymentMethod);
  cleanupAnimationOverlay();
  if (selectedMethod) {
    window.location.href = selectedMethod.url;
  }
}

function animationPopstateHandler(e) {
  if (isAnimating) {
    cancelAnimation();
    window.removeEventListener('popstate', animationPopstateHandler);
    window.removeEventListener('keydown', escCancelHandler);
  }
}
function escCancelHandler(e) {
  if (e.key === 'Escape' && isAnimating) {
    cancelAnimation();
    window.removeEventListener('popstate', animationPopstateHandler);
    window.removeEventListener('keydown', escCancelHandler);
  }
}
function cleanupAnimationOverlay() {
  clearInterval(countdownInterval);
  countdownInterval = null;
  hideCountdownButtonArea();
  hideLoadingTextRocket();
  const overlay = document.getElementById('animation-overlay');
  const rocket = document.getElementById('rocket');
  if (overlay) overlay.classList.remove('active');
  if (rocket) {
    rocket.style.visibility = 'hidden';
    rocket.style.animation = '';
    rocket.style.transition = '';
    rocket.style.top = '';
  }
  isAnimating = false;
  animationCancel = false;
  if (overlay) overlay.onclick = null;
  window.removeEventListener('popstate', animationPopstateHandler);
  window.removeEventListener('keydown', escCancelHandler);
  resetPaymentMethod();
}

// --- Animation Logic ---
async function startRocketAnimation() {
  if (isAnimating) return;
  isAnimating = true;
  animationCancel = false;
  hideLoadingTextRocket(); // ซ่อน loading ขณะ countdown
  showCountdownButtonArea();

  const overlay = document.getElementById('animation-overlay');
  const rocket = document.getElementById('rocket');

  overlay.classList.add('active');
  rocket.style.visibility = 'visible';
  rocket.style.animation = 'rocketPath 2s cubic-bezier(0.4, 0, 0.2, 1) forwards';

  window.addEventListener('popstate', animationPopstateHandler);
  overlay.onclick = null;
  window.addEventListener('keydown', escCancelHandler);

  // Countdown logic (10 วินาที)
  currentCountdown = 10;
  updateCountdownDisplay(currentCountdown);
  let finished = false;
  countdownInterval = setInterval(() => {
    if (animationCancel) {
      clearInterval(countdownInterval);
      countdownInterval = null;
      return;
    }
    currentCountdown--;
    updateCountdownDisplay(currentCountdown);
    if (currentCountdown <= 0 && !finished) {
      finished = true;
      handleCountdownFinish();
    }
  }, 1000);
}

window.addEventListener('popstate', (event) => {
  if (isAnimating) {
    cancelAnimation();
    return;
  }
  if (event.state && event.state.page) {
    // ถ้าออกจากหน้าระบบสนับสนุน ให้ reset ตัวเลือก
    if (!['main-page','confirmation-page','payment-methods-page','thanks-page'].includes(event.state.page)) {
      resetPaymentMethod();
    }
    showPage(pages[event.state.page]);
  } else {
    resetPaymentMethod();
    showPage(pages['main']);
  }
});

window.addEventListener('beforeunload', () => {
  // ถ้าออกจากหน้าเว็บ reset ตัวเลือก
  resetPaymentMethod();
});

window.onload = () => {
  createPaymentOptions();
  showPageFromURL();
  if (!window.history.state) {
    window.history.replaceState({ page: 'main' }, '', window.location);
  }
};