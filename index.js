// Set --header-h to the actual header height (handles responsive + font loads)
function setHeaderHeightVar() {
  const header = document.querySelector('.site-header');
  const h = header ? header.offsetHeight : 0;
  document.documentElement.style.setProperty('--header-h', `${h}px`);
}
window.addEventListener('load', setHeaderHeightVar);
window.addEventListener('resize', setHeaderHeightVar);
document.fonts?.ready?.then(setHeaderHeightVar);



// =====================
// Helpers
// =====================
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

// Year
$("#year").textContent = new Date().getFullYear();

// Email regex (simple)
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


// =====================
// Mobile nav (accessible)
// =====================
const nav = $(".site-nav");
const menuBtn = $("#menuBtn");
const menu = $("#menu");

function openNav() {
  nav.classList.add("open");
  menuBtn.setAttribute("aria-expanded", "true");
  document.body.classList.add("nav-locked");
}

function closeNav() {
  nav.classList.remove("open");
  menuBtn.setAttribute("aria-expanded", "false");
  document.body.classList.remove("nav-locked");
}

menuBtn.addEventListener("click", () => {
  const isOpen = nav.classList.contains("open");
  isOpen ? closeNav() : openNav();
});

// Close on link click (mobile)
$$(".menu a").forEach(a => {
  a.addEventListener("click", () => closeNav());
});

// Close on Escape
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeNav();
});


// =====================
// Smooth scroll enhancement
// =====================
$$('a[href^="#"]').forEach(a => {
  a.addEventListener("click", (e) => {
    const id = a.getAttribute("href");
    const target = document.querySelector(id);
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});


// =====================
// Reveal on scroll
// =====================
const revealObserver = new IntersectionObserver(
  (entries) => {
    for (const en of entries) {
      if (en.isIntersecting) {
        en.target.classList.add("show");
        revealObserver.unobserve(en.target);
      }
    }
  },
  { threshold: 0.12 }
);
$$(".reveal").forEach(el => revealObserver.observe(el));


// =====================
// Testimonials carousel (runs only when visible)
// =====================
const slides = $("#slides");
let idx = 0;
let timer = null;

function tick() {
  if (!slides) return;
  idx = (idx + 1) % slides.children.length;
  slides.style.transform = `translateX(-${idx * 100}%)`;
}

if (slides) {
  const carouselObserver = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) {
        if (!timer) timer = setInterval(tick, 5200);
      } else if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    { threshold: 0.2 }
  );
  carouselObserver.observe(slides);
}


// =====================
// Back to top
// =====================
$("#toTop")?.addEventListener("click", (e) => {
  e.preventDefault();
  window.scrollTo({ top: 0, behavior: "smooth" });
});


// =====================
// Contact form (client-side only)
// =====================
const form = $("#contact-form");
const notice = $("#form-notice");

form?.addEventListener("submit", (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());

  if (!data.name || !data.email || !data.message) {
    notice.textContent = "Please fill in all fields.";
    return;
  }
  if (!emailRegex.test(data.email)) {
    notice.textContent = "Please enter a valid email address.";
    return;
  }

  // Demo: open mail client (replace with your recipient to receive messages)
  window.location.href = `mailto:${data.email}?subject=Coaching%20Enquiry%20from%20${encodeURIComponent(
    data.name
  )}&body=${encodeURIComponent(data.message)}`;

  setTimeout(() => (notice.textContent = "Opening your email client…"), 0);
});


// =====================
// Starfield canvas (responsive & performant)
// =====================
const hero = $(".hero");
const canvas = $("#stars");
const ctx = canvas.getContext("2d", { alpha: true });

const DPR = Math.min(1.5, window.devicePixelRatio || 1);
let stars = [];
let animId = null;
let inView = true;

// =====================
// Responsive "trees" layer (SVG injected)
// =====================
const treesLayer = $(".trees");

// Config you can tweak:
const TREE_BASE = 100;              // desired base width per tree (px)
const TREE_BASE_MOBILE = 100;       // tighter on mobile for more trees
const TREE_COLOR = "#3E5F44";      // matches --pine
const TREE_VARIANCE = 0.8;        // height randomness (0..1)
const ROWS = 1;                    // number of rows (1 = like your design)
const OVERLAP = -0.2;              // how much trees overlap (0..0.8)

// Build an SVG string of N triangles across the width
function buildTreesSVG(width, height) {
  const base = (window.innerWidth < 560 ? TREE_BASE_MOBILE : TREE_BASE);
  const spacing = base * (1 - OVERLAP);
  const count = Math.ceil(width / spacing) + 2; // add buffer for edges

  // Heights vary a bit so it doesn't look too uniform
  const minH = height * 0.2;
  const maxH = height * 0.6;

  let polys = [];

  for (let r = 0; r < ROWS; r++) {
    const rowOffsetY = r * (height * 0.12);
    for (let i = -1; i < count; i++) {
      const cx = i * spacing + (r % 2 ? spacing * 0.5 : 0); // stagger odd rows
      const h = minH + (maxH - minH) * (0.7 + Math.random() * TREE_VARIANCE);
      const topY = Math.max(0, height - h - rowOffsetY);
      const leftX = cx - base / 2;
      const rightX = cx + base / 2;

      polys.push(
        `<polygon points="${leftX},${height} ${cx},${topY} ${rightX},${height}" />`
      );
    }
  }

  return `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g fill="${TREE_COLOR}">
        ${polys.join("")}
      </g>
    </svg>
  `;
}

let treesResizePending = false;
function renderTrees() {
  if (!treesLayer) return;
  if (treesResizePending) return;
  treesResizePending = true;

  requestAnimationFrame(() => {
    treesResizePending = false;
    const rect = treesLayer.getBoundingClientRect();
    const w = Math.max(320, Math.floor(rect.width));
    const h = Math.max(80, Math.floor(rect.height));
    treesLayer.innerHTML = buildTreesSVG(w, h);
  });
}

// Initial render + on resize
const treesRO = new ResizeObserver(renderTrees);
treesRO.observe(treesLayer);
window.addEventListener("resize", renderTrees, { passive: true });
renderTrees();

// Make star count scale with viewport size
function spawnStars() {
  const area = canvas.width * canvas.height;
  // Fewer stars on mobile to keep 60fps
  const base = Math.max(40, Math.floor(area / (16000 * DPR)));
  const cap = window.innerWidth < 480 ? 90 : 160;
  const count = Math.min(cap, base);

  stars = Array.from({ length: count }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height * 0.6, // sky only
    r: Math.random() * (4 * DPR) + 0.3 * DPR,
    a: Math.random() * 0.6 + 0.2,
    tw: Math.random() * 0.015 + 0.003
  }));
}

let resizePending = false;
function resizeCanvas() {
  if (resizePending) return;
  resizePending = true;
  requestAnimationFrame(() => {
    resizePending = false;

    // Match hero size (svh safe on mobile)
    const rect = hero.getBoundingClientRect();
    const w = Math.floor(rect.width * DPR);
    const h = Math.floor(rect.height * DPR);

    if (w <= 0 || h <= 0) return;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      spawnStars();
      // Static "lake" wash is painted by CSS layers — no per-frame blur needed
    }
  });
}

function draw() {
  if (!inView) {
    animId = requestAnimationFrame(draw);
    return;
  }

  // Clear sky region only
  ctx.clearRect(0, 0, canvas.width, canvas.height * 0.75);

  // Tiny rects are cheaper than arcs
for (let i = 0; i < stars.length; i++) {
  const s = stars[i];

  // Twinkle via time-based sine wave (your line, with a clamp)
  const alpha = Math.max(0, Math.min(1, 0.8 + Math.sin(Date.now() / 500 + s.x) * 0.4));
  ctx.globalAlpha = alpha;

  // draw
  const d = s.r;
  ctx.fillStyle = "#fff";
  ctx.fillRect(s.x, s.y, d, d);
}
ctx.globalAlpha = 1;

  animId = requestAnimationFrame(draw);
}

// Observe hero visibility to pause off-screen
const heroObserver = new IntersectionObserver(
  ([entry]) => {
    inView = entry?.isIntersecting ?? true;
  },
  { rootMargin: "0px 0px -40% 0px", threshold: 0.01 }
);
heroObserver.observe(hero);

// Respect reduced motion + hidden tab
const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
function start() {
  if (!motion.matches && animId == null) animId = requestAnimationFrame(draw);
}
function stop() {
  if (animId != null) {
    cancelAnimationFrame(animId);
    animId = null;
  }
}
motion.addEventListener?.("change", (e) => (e.matches ? stop() : start()));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stop();
  else start();
});

// Initial sizing
const ro = new ResizeObserver(resizeCanvas);
ro.observe(hero);
window.addEventListener("resize", resizeCanvas, { passive: true });
resizeCanvas();
start();

/// quotes
const rawQuotes = [
  "The magic you are looking for is in the work you're avoiding.",
  "The answers you are looking for are in the silence you're avoiding.",
  "Treat yourself like somebody you are responsible for helping.",
  "It will all be alright in the end — and if it's not alright, then it’s not the end.",
  "A lack of confidence killed more dreams than a lack of competence ever did.",
  "The road to heaven often feels like hell — and the road to hell often feels like heaven.",
  "Some of us are strangers to ourselves.",
  "Don't fight against the problems of the world until it attacks us personally.",
  "The character you are pretending to be is not you.",
  "The more you learn, the more you realize how little you know.",
  "We don't fight against the problems of the world until they attack us personally"
];

document.addEventListener("DOMContentLoaded", () => {
  const quoteElement = document.getElementById("quote");
  if (!quoteElement || !rawQuotes.length) return;

  let i = Math.floor(Math.random() * rawQuotes.length);

  // Initial render (no fade)
  quoteElement.textContent = rawQuotes[i];
  quoteElement.style.opacity = 1;

  function displayNextQuote() {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduce) {
      i = (i + 1) % rawQuotes.length;
      quoteElement.textContent = rawQuotes[i];
      return;
    }

    quoteElement.style.opacity = 0;
    setTimeout(() => {
      i = (i + 1) % rawQuotes.length;
      quoteElement.textContent = rawQuotes[i];
      quoteElement.style.opacity = 1;
    }, 500);
  }

  const QUOTE_INTERVAL_MS = 7000;
  let timer = setInterval(displayNextQuote, QUOTE_INTERVAL_MS);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { clearInterval(timer); timer = null; }
    else if (!timer) { timer = setInterval(displayNextQuote, QUOTE_INTERVAL_MS); }
  });
  console.log("interval set:", QUOTE_INTERVAL_MS, "ms", Date.now());
});



