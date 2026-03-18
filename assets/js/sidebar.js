document.addEventListener('DOMContentLoaded', function() {  
    const sidebar = document.getElementById('sidebar');  
    const navbarToggle = document.getElementById('navbarToggle');  
    const overlay = document.getElementById('overlay');  
    const draggableElements = document.querySelectorAll('.draggable-element');  
  
    // ฟังก์ชันเปิด Sidebar  
    function openSidebar() {  
        sidebar.classList.add('open-sidebar', 'open');  
        overlay.style.display = 'block';  
        requestAnimationFrame(() => {  
            overlay.classList.add('show-overlay');  
            document.body.style.overflow = 'hidden';  
        });  
    }  
  
    // ฟังก์ชันปิด Sidebar  
    function closeSidebar() {  
        sidebar.classList.remove('open-sidebar', 'open');  
        overlay.classList.remove('show-overlay');  
        document.body.style.overflow = '';  
        setTimeout(() => overlay.style.display = 'none', 400);  
    }  

    // ฟังก์ชันตรวจสอบว่าอยู่ใน draggable element หรือไม่  
    function isInsideDraggableElement(event) {  
        return Array.from(draggableElements).some(element => element.contains(event.target));  
    }  

    // ฟังก์ชัน Swipe เพื่อเปิด/ปิด Sidebar ทันทีเมื่อถึงระยะที่กำหนด
    function handleSwipe() {  
        let touchstartX = 0;  
        let touchCurrentX = 0;  
        let isSwiping = false;  

        document.addEventListener('touchstart', function(event) {  
            if (!isInsideDraggableElement(event)) {  
                touchstartX = event.changedTouches[0].screenX;  
                isSwiping = true;  
            }  
        }, { passive: true });  

        document.addEventListener('touchmove', function(event) {  
            if (isSwiping && !isInsideDraggableElement(event)) {  
                touchCurrentX = event.changedTouches[0].screenX;  

                // ปิด Sidebar ทันทีเมื่อปัดซ้ายถึงระยะ 90px  
                if (touchCurrentX < touchstartX - 90 && sidebar.classList.contains('open')) {  
                    closeSidebar();  
                    isSwiping = false; // ป้องกันการปิดซ้ำ  
                }  
            }  
        }, { passive: true });  

        document.addEventListener('touchend', function() {  
            isSwiping = false;  
        }, { passive: true });  
    }  

    // ฟังก์ชันการเปิด/ปิด Sidebar  
    function toggleMenu() {  
        const isOpen = sidebar.classList.toggle('open-sidebar');  
        sidebar.classList.toggle('open', isOpen);  

        if (isOpen) {  
            overlay.style.display = 'block';  
            requestAnimationFrame(() => {  
                overlay.classList.add('show-overlay');  
                document.body.style.overflow = 'hidden';  
            });  
        } else {  
            overlay.classList.remove('show-overlay');  
            document.body.style.overflow = '';  
            setTimeout(() => overlay.style.display = 'none', 400);  
        }  
    }  

    // ฟังก์ชันการปิด Sidebar ทุกสถานะ  
    function clearAllStates() {  
        sidebar.classList.remove('open-sidebar', 'open');  
        overlay.classList.remove('show-overlay');  
        document.body.style.overflow = '';  
        setTimeout(() => overlay.style.display = 'none', 400);  
    }  

    // ฟังก์ชันการตั้งค่า active ปุ่ม  
    function setActiveButton() {  
        const buttons = document.querySelectorAll('#sidebar button');  
        const currentPath = window.location.pathname.split('#')[0];  

        buttons.forEach(button => {  
            const match = button.getAttribute('onclick').match(/window.location.href='([^']+)'/);  
            if (match) {  
                const buttonPath = new URL(match[1], window.location.origin).pathname.split('#')[0];  
                if (buttonPath === currentPath) {  
                    button.classList.add('active');  
                } else {  
                    button.classList.remove('active');  
                }  
            }  
        });  
    }  

    // การจัดการการคลิกที่ปุ่ม Navbar  
    navbarToggle.addEventListener('click', toggleMenu);  
    overlay.addEventListener('click', clearAllStates);  

    // การจัดการการคลิกที่ปุ่มใน Sidebar  
    document.querySelectorAll('#sidebar button').forEach(button => {  
        button.addEventListener('click', () => {  
            clearAllStates();  
            setTimeout(setActiveButton, 0);  
        });  
    });  

    // ตั้งค่า active ปุ่มเมื่อโหลดหน้าเว็บ  
    setActiveButton();  
    handleSwipe();  
});