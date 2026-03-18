document.addEventListener('DOMContentLoaded', () => {      
    const navbarToggle = document.getElementById('navbarToggle');      
    const sidebar = document.getElementById('sidebar');      
    const overlay = document.getElementById('overlay');      
    const navButtons = document.querySelectorAll('.nav-button');      
    const draggableElements = document.querySelectorAll('.draggable');
    
    let isNavigationTransitioning = false;
    let isNavigating = false; // เพิ่มตัวแปรสำหรับติดตามสถานะการนำทาง
    
    function highlightNavButton() {        
        const currentLocation = window.location.pathname.split('/').pop();        
        navButtons.forEach(button => {        
            const buttonPath = button.getAttribute('onclick')?.match(/'([^']+)'/);        
            if (buttonPath) {        
                const isActive = (currentLocation === buttonPath[1] || 
                               (currentLocation === '' && buttonPath[1] === 'index.html'));        
                
                button.classList.toggle('active', isActive);
                button.disabled = isActive;
            }        
        });        
    }        
    
    // ปรับปรุงการจัดการคลิกปุ่มนำทาง
    navButtons.forEach(button => {        
        button.addEventListener('click', async (event) => {        
            event.preventDefault();
            event.stopPropagation();
            
            // ตรวจสอบว่าไม่อยู่ระหว่างการนำทางและปุ่มไม่ถูกปิดการใช้งาน
            if (!isNavigationTransitioning && !button.disabled && !isNavigating && event.target === button) {        
                const buttonPath = button.getAttribute('onclick')?.match(/'([^']+)'/);        
                if (buttonPath) {
                    // เพิ่มคลาส loading ให้กับปุ่มขณะกำลังนำทาง
                    button.classList.add('loading');
                    button.disabled = true;
                    await navigate(buttonPath[1]);
                }        
            }        
        });        
    });      
    
    function addHistoryState() {      
        if (!window.history.state || window.history.state.menuOpen !== true) {      
            window.history.pushState({ menuOpen: true }, '');      
        }      
    }      
    
    function removeHistoryState() {      
        if (window.history.state && window.history.state.menuOpen === true) {      
            window.history.back();      
        }      
    }      
    
    // ปรับปรุงฟังก์ชั่น navigate ให้เป็น async และจัดการการเคลียร์สถานะอย่างถูกต้อง
    async function navigate(page) {
        if (isNavigating) return; // ป้องกันการเรียกซ้ำ
        
        isNavigating = true;
        
        try {
            // เคลียร์สถานะทั้งหมดและรอให้เสร็จสมบูรณ์
            await new Promise(resolve => {
                clearAllStates();
                // รอให้ animation ของ sidebar เสร็จสิ้น
                setTimeout(resolve, 300);
            });
            
            // เพิ่ม transition effect ก่อนเปลี่ยนหน้า
            document.body.style.opacity = '0';
            document.body.style.transition = 'opacity 0.2s ease-out';
            
            // รอให้ fade out effect เสร็จสิ้น
            await new Promise(resolve => setTimeout(resolve, 200));
            
            // นำทางไปยังหน้าใหม่
            window.location.href = page;
        } catch (error) {
            console.error('เกิดข้อผิดพลาดในการนำทาง:', error);
            isNavigating = false;
            document.body.style.opacity = '1';
        }
    }     

    function clearAllStates() {      
        toggleMenu(false);
        // เคลียร์ class loading จากทุกปุ่ม
        navButtons.forEach(button => {
            button.classList.remove('loading');
            button.disabled = false;
        });
    }      
    
    function isInsideDraggableElement(event) {      
        return Array.from(draggableElements).some(element => element.contains(event.target));      
    }      
    
    function toggleMenu(open) {
        const isOpen = sidebar.classList.contains('open-sidebar');
        if (open === undefined) {
            open = !isOpen;
        }
        
        if (open === isOpen || isNavigationTransitioning) return;
        
        const TRANSITION_DURATION = 250;
        const TRANSITION_CURVE = 'cubic-bezier(0.4, 0.0, 0.2, 1)';
        
        isNavigationTransitioning = true;
        
        function applyTransition(element) {
            element.style.transition = `all ${TRANSITION_DURATION}ms ${TRANSITION_CURVE}`;
        }
        
        if (window.overlayTimeout) {
            clearTimeout(window.overlayTimeout);
            window.overlayTimeout = null;
        }
        
        if (open) {
            requestAnimationFrame(() => {
                overlay.style.display = 'block';
                overlay.style.opacity = '0';
                
                requestAnimationFrame(() => {
                    applyTransition(sidebar);
                    applyTransition(overlay);
                    
                    sidebar.style.transform = 'translateX(0)';
                    sidebar.classList.add('open-sidebar');
                    overlay.style.opacity = '1';
                    document.body.style.overflow = 'hidden';
                    addHistoryState();
                    
                    setTimeout(() => {
                        isNavigationTransitioning = false;
                    }, TRANSITION_DURATION);
                });
            });
        } else {
            applyTransition(sidebar);
            applyTransition(overlay);
            
            sidebar.style.transform = 'translateX(-100%)';
            overlay.style.opacity = '0';
            document.body.style.overflow = '';
            sidebar.classList.remove('open-sidebar');
            
            setTimeout(() => {
                if (!sidebar.classList.contains('open-sidebar')) {
                    overlay.style.display = 'none';
                    removeHistoryState();
                }
                isNavigationTransitioning = false;
            }, TRANSITION_DURATION);
        }
    }

    function enableSwipeGesture() {
        let touchstartX = 0;
        let touchCurrentX = 0;
        let isDragging = false;
        let startTime = 0;
        let animationFrameId = null;
        let isAnimating = false;
        
        const REQUIRED_DISTANCE = 90;
        const VELOCITY_THRESHOLD = 0.5;
        const TRANSITION_DURATION = 250;
        const TRANSITION_CURVE = 'cubic-bezier(0.4, 0.0, 0.2, 1)';
        
        function getVelocity(currentX, startX, timeDiff) {
            return timeDiff > 0 ? (currentX - startX) / timeDiff : 0;
        }
        
        function applyTransition(element) {
            element.style.transition = `all ${TRANSITION_DURATION}ms ${TRANSITION_CURVE}`;
        }
        
        function removeTransition(element) {
            element.style.transition = 'none';
        }
        
        function cancelAnimation() {
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
        }
        
        function updateSidebarPosition(deltaX) {
            if (isAnimating) return;
            
            const sidebarWidth = sidebar.offsetWidth;
            let progress;
            let transformX;
            
            if (sidebar.classList.contains('open-sidebar')) {
                transformX = Math.min(Math.max(deltaX, -sidebarWidth), 0);
                progress = 1 + (deltaX / sidebarWidth);
            } else {
                transformX = Math.min(Math.max(-sidebarWidth + deltaX, -sidebarWidth), 0);
                progress = deltaX / sidebarWidth;
            }
            
            sidebar.style.transform = `translate3d(${transformX}px, 0, 0)`;
            
            if (progress > 0) {
                if (overlay.style.display !== 'block') {
                    overlay.style.display = 'block';
                }
                overlay.style.opacity = Math.min(progress, 1).toString();
            } else {
                overlay.style.opacity = '0';
            }
        }
        
        async function finishDragging(deltaX, velocity) {
            if (isAnimating) return;
            
            isDragging = false;
            isAnimating = true;
            cancelAnimation();
            
            const isOpen = sidebar.classList.contains('open-sidebar');
            const shouldClose = isOpen ?
                (Math.abs(deltaX) >= REQUIRED_DISTANCE || velocity < -VELOCITY_THRESHOLD) :
                !(Math.abs(deltaX) >= REQUIRED_DISTANCE || velocity > VELOCITY_THRESHOLD);
            
            applyTransition(sidebar);
            applyTransition(overlay);
            
            await new Promise(resolve => {
                const handleTransitionEnd = () => {
                    sidebar.removeEventListener('transitionend', handleTransitionEnd);
                    isAnimating = false;
                    resolve();
                };
                
                sidebar.addEventListener('transitionend', handleTransitionEnd, { once: true });
                
                setTimeout(() => {
                    isAnimating = false;
                    resolve();
                }, TRANSITION_DURATION + 50);
                
                sidebar.style.transform = '';
                toggleMenu(!shouldClose);
                
                if (shouldClose) {
                    overlay.style.display = 'none';
                }
            });
        }
        
        document.addEventListener('touchstart', function(event) {
            if (isAnimating) return;
            if (!sidebar.classList.contains('open-sidebar') && event.touches[0].clientX >= 40) {
                return;
            }
            
            touchstartX = event.touches[0].clientX;
            touchCurrentX = touchstartX;
            isDragging = true;
            startTime = performance.now();
            
            cancelAnimation();
            
            removeTransition(sidebar);
            removeTransition(overlay);
            sidebar.classList.add('dragging');
        }, { passive: true });
        
        document.addEventListener('touchmove', function(event) {
            if (!isDragging || isAnimating) return;
            
            cancelAnimation();
            
            touchCurrentX = event.touches[0].clientX;
            const deltaX = touchCurrentX - touchstartX;
            
            animationFrameId = requestAnimationFrame(() => {
                updateSidebarPosition(deltaX);
            });
        }, { passive: true });
        
        document.addEventListener('touchend', function() {
            if (!isDragging || isAnimating) return;
            
            const deltaX = touchCurrentX - touchstartX;
            const velocity = getVelocity(
                touchCurrentX,
                touchstartX,
                performance.now() - startTime
            );
            
            sidebar.classList.remove('dragging');
            finishDragging(deltaX, velocity);
        }, { passive: true });
        
        window.addEventListener('beforeunload', () => {
            cancelAnimation();
        });
    }

    window.addEventListener('popstate', (event) => {      
        if (!event.state || !event.state.menuOpen) {      
            clearAllStates();      
        }      
    });      
    
    highlightNavButton();
    
    navbarToggle.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleMenu();
    });
    
    overlay.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!isNavigationTransitioning) {
            clearAllStates();
        }
    });
    
    window.addEventListener('beforeunload', clearAllStates);
    
    enableSwipeGesture();      
});      

window.addEventListener('error', (event) => {      
    console.error('เกิดข้อผิดพลาด:', event.message);      
});