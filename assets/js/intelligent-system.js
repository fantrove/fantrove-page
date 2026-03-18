// Ultra-fast concurrent image loader for high-res images using 'src' attribute

// Select all images with 'src' that need lazy loading (exclude already loaded)
const images = Array.from(document.querySelectorAll('img[src]:not([data-loaded])'));

const MAX_CONCURRENT_LOADS = 6; // Limit to 6 concurrent loads for optimal speed
let activeLoads = 0;
const preloadQueue = [];

// Preload a single image
const preloadImage = (image) => {
  const src = image.getAttribute('src');
  if (!src || image.getAttribute('data-loaded')) return;
  
  activeLoads++;
  
  // Use fetch with high priority and keepalive to hint for speed
  fetch(src, { cache: 'force-cache', priority: 'high', keepalive: true }).catch(() => {});
  
  // Use Image object for actual preload and decoding
  const img = new window.Image();
  img.src = src;
  img.decoding = 'async';
  img.loading = 'eager';
  
  // Inline promise decode for even more speed (if browser supports)
  if (img.decode) {
    img.decode().then(() => {
      handleImageLoaded(image, src);
    }).catch(() => {
      handleImageLoaded(image, src);
    });
  } else {
    img.onload = () => handleImageLoaded(image, src);
    img.onerror = () => handleImageLoaded(image, src);
  }
};

const handleImageLoaded = (image, src) => {
  if (!image.complete || image.naturalWidth === 0) {
    image.src = src;
  }
  image.setAttribute('data-loaded', '1');
  activeLoads--;
  processQueue();
};

// Process the preload queue with high concurrency
const processQueue = () => {
  while (activeLoads < MAX_CONCURRENT_LOADS && preloadQueue.length) {
    const image = preloadQueue.shift();
    if (image && !image.getAttribute('data-loaded')) {
      preloadImage(image);
    }
  }
};

// IntersectionObserver for aggressive preloading
const observer = new IntersectionObserver((entries, observer) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const image = entry.target;
      observer.unobserve(image);
      if (!image.getAttribute('data-loaded')) {
        preloadQueue.push(image);
        processQueue();
      }
    }
  });
}, {
  rootMargin: '1200px', // Preload early before image appears on screen
  threshold: 0.01
});

// Preconnect and DNS-prefetch for first image's host
const preconnect = (url) => {
  const link = document.createElement('link');
  link.rel = 'preconnect';
  link.href = url;
  document.head.appendChild(link);
};
const dnsPrefetch = (url) => {
  const link = document.createElement('link');
  link.rel = 'dns-prefetch';
  link.href = url;
  document.head.appendChild(link);
};
if (images.length > 0) {
  try {
    const url = new URL(images[0].src);
    const origin = url.origin;
    preconnect(origin);
    dnsPrefetch(origin);
  } catch (e) {}
}

// Immediately queue up the first 6 images for ultra-fast initial load
const INITIAL_BURST = 6;
images.forEach((image, idx) => {
  if (idx < INITIAL_BURST) {
    preloadQueue.push(image);
  } else {
    observer.observe(image);
  }
});
processQueue();