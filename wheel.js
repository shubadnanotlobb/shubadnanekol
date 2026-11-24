import { getApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getFirestore, collection, getDocs
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const db = getFirestore(getApp());

const TAU = Math.PI * 2;
const PALETTE = [
  ["#0f6f68", "#22c3b4"],
  ["#a9611a", "#f3ad45"],
  ["#962a25", "#ee6f63"],
  ["#264f88", "#63a5f0"],
  ["#52399a", "#a082ea"],
  ["#276a3f", "#5fcf88"]
];

let items = [];
let loaded = false;
let rot = 0;
let spinning = false;
let picked = null;
let size = 300;
let blink = 0;

const imgCache = {};

function $(id) { return document.getElementById(id); }

function toast(msg, type) {
  if (typeof window.showToast === "function") window.showToast(msg, type || "error");
}

function colorIdx(i, n) {
  let k = i % PALETTE.length;
  if (i === n - 1 && n > 1 && k === 0) k = 3;
  return k;
}

function nameOf(c) {
  return String(c.nameAr || c.nameEn || "").trim();
}

function getImg(url) {
  if (!url) return null;
  let e = imgCache[url];
  if (!e) {
    const im = new Image();
    e = imgCache[url] = { im: im, ok: false, fail: false };
    im.onload = () => { e.ok = true; draw(); };
    im.onerror = () => { e.fail = true; };
    im.src = url;
  }
  return e.ok ? e.im : null;
}

/* ---------------- entry card on the categories page ---------------- */

function mountEntry() {
  const grid = $("categoriesGridContainer");
  if (!grid || $("wlEntry")) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "wlEntry";
  btn.className = "wl-entry";
  btn.innerHTML =
    '<span class="wl-entry-ico">🎡</span>' +
    '<span class="wl-entry-txt"><b>دولاب الحظ</b><small>مش عارف شو تاكل؟ لف الدولاب</small></span>' +
    '<span class="wl-entry-go">‹</span>';
  btn.addEventListener("click", openWheel);
  grid.parentNode.insertBefore(btn, grid);
}

/* ---------------- modal ---------------- */

function mountModal() {
  if ($("wlModal")) return;

  const m = document.createElement("div");
  m.id = "wlModal";
  m.className = "wl-modal";
  m.hidden = true;
  m.innerHTML =
    '<div class="wl-card" role="dialog" aria-label="دولاب الحظ">' +
      '<button type="button" class="wl-close" data-wl="close" aria-label="إغلاق">×</button>' +
      '<h2 class="wl-title">دولاب الحظ</h2>' +
      '<p class="wl-sub" id="wlSub">لف الدولاب وشوف شو رح تاكل اليوم</p>' +
      '<div class="wl-stage">' +
        '<div class="wl-pointer"></div>' +
        '<canvas id="wlCanvas"></canvas>' +
        '<button type="button" class="wl-spin" id="wlSpin" data-wl="spin">SPIN</button>' +
      "</div>" +
      '<div class="wl-result" id="wlResult" hidden>' +
        '<div class="wl-result-pic" id="wlPic"></div>' +
        '<div class="wl-result-label">اليوم عبالك</div>' +
        '<div class="wl-result-name" id="wlName"></div>' +
        '<div class="wl-actions">' +
          '<button type="button" class="wl-btn is-main" data-wl="go">شوف المطاعم</button>' +
          '<button type="button" class="wl-btn" data-wl="again">لف تاني</button>' +
        "</div>" +
      "</div>" +
    "</div>";
  document.body.appendChild(m);

  m.addEventListener("click", (e) => {
    if (e.target === m) return closeWheel();
    const b = e.target.closest("[data-wl]");
    if (!b) return;
    const act = b.getAttribute("data-wl");
    if (act === "close") closeWheel();
    else if (act === "spin" || act === "again") spin();
    else if (act === "go") go();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !m.hidden) closeWheel();
  });
}

function setup() {
  const canvas = $("wlCanvas");
  if (!canvas) return;
  size = Math.max(250, Math.min(340, window.innerWidth - 64));
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = canvas.height = Math.round(size * dpr);
  canvas.style.width = canvas.style.height = size + "px";
  canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function drawBadge(ctx, cx, d, url, hue) {
  const r = d / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, 0, r, 0, TAU);
  ctx.closePath();
  ctx.fillStyle = "rgba(255,255,255,.92)";
  ctx.fill();
  ctx.clip();

  const im = getImg(url);
  if (im && im.naturalWidth) {
    const s = Math.max(d / im.naturalWidth, d / im.naturalHeight);
    const w = im.naturalWidth * s;
    const h = im.naturalHeight * s;
    ctx.drawImage(im, cx - w / 2, -h / 2, w, h);
  } else {
    ctx.fillStyle = hue;
    ctx.fillRect(cx - r, -r, d, d);
    ctx.fillStyle = "#fff";
    ctx.font = Math.round(d * 0.55) + "px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("🍽", cx, 1);
  }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, 0, r, 0, TAU);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#f6d68e";
  ctx.stroke();
}

function draw() {
  const canvas = $("wlCanvas");
  if (!canvas || !items.length) return;
  const ctx = canvas.getContext("2d");
  const n = items.length;
  const c = size / 2;
  const R = c - 17;
  const seg = TAU / n;
  const hub = 38;

  ctx.clearRect(0, 0, size, size);

  /* outer golden ring */
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, "#f9e2a3");
  g.addColorStop(0.5, "#c78a2c");
  g.addColorStop(1, "#f3cf80");
  ctx.beginPath();
  ctx.arc(c, c, c - 2, 0, TAU);
  ctx.fillStyle = g;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(c, c, R + 3, 0, TAU);
  ctx.fillStyle = "#1a1208";
  ctx.fill();

  /* segments */
  const badge = Math.max(24, Math.min(46, R * seg * 0.62));
  const fontSize = Math.max(11, Math.min(15, badge * 0.4));

  for (let i = 0; i < n; i++) {
    const a0 = rot + i * seg;
    const pal = PALETTE[colorIdx(i, n)];

    const rg = ctx.createRadialGradient(c, c, hub, c, c, R);
    rg.addColorStop(0, pal[0]);
    rg.addColorStop(1, pal[1]);

    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.arc(c, c, R, a0, a0 + seg);
    ctx.closePath();
    ctx.fillStyle = rg;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(246,214,142,.85)";
    ctx.stroke();

    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(a0 + seg / 2);

    const bx = R - 10 - badge / 2;
    drawBadge(ctx, bx, badge, items[i].img, pal[0]);

    const tx = bx - badge / 2 - 8;
    ctx.font = "700 " + fontSize + 'px "IBM Plex Sans Arabic", sans-serif';
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";
    ctx.shadowColor = "rgba(0,0,0,.55)";
    ctx.shadowBlur = 4;
    ctx.fillText(items[i].name, tx, 0, Math.max(30, tx - hub - 8));
    ctx.restore();
  }

  /* bulbs on the ring */
  const bulbs = 24;
  const br = c - 9;
  for (let i = 0; i < bulbs; i++) {
    const a = (i / bulbs) * TAU - Math.PI / 2;
    const lit = (i + blink) % 2 === 0;
    ctx.beginPath();
    ctx.arc(c + Math.cos(a) * br, c + Math.sin(a) * br, 3.4, 0, TAU);
    ctx.fillStyle = lit ? "#fffbe6" : "#9a6a1c";
    if (lit) {
      ctx.shadowColor = "#ffe27a";
      ctx.shadowBlur = 9;
    }
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  /* hub */
  const hg = ctx.createRadialGradient(c, c, 4, c, c, hub + 6);
  hg.addColorStop(0, "#2a2112");
  hg.addColorStop(1, "#0d0a05");
  ctx.beginPath();
  ctx.arc(c, c, hub + 5, 0, TAU);
  ctx.fillStyle = "#e7bd63";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(c, c, hub, 0, TAU);
  ctx.fillStyle = hg;
  ctx.fill();
}

async function loadItems() {
  if (loaded) return true;
  try {
    const snap = await getDocs(collection(db, "categories"));
    items = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((c) => nameOf(c))
      .sort((a, b) => {
        const x = a.order != null ? Number(a.order) : 999;
        const y = b.order != null ? Number(b.order) : 999;
        return x - y;
      })
      .map((c) => ({ id: c.id, name: nameOf(c), img: c.imgUrl || "", raw: c }));
    loaded = items.length > 0;
    items.forEach((it) => getImg(it.img));
    return loaded;
  } catch (e) {
    console.error("wheel load:", e);
    return false;
  }
}

async function openWheel() {
  mountModal();
  const m = $("wlModal");
  m.hidden = false;
  document.body.style.overflow = "hidden";
  $("wlResult").hidden = true;
  picked = null;

  const sub = $("wlSub");
  const spinBtn = $("wlSpin");
  spinBtn.disabled = true;
  sub.textContent = "جاري التحميل...";

  const ok = await loadItems();
  if (!ok) {
    sub.textContent = "تعذّر تحميل الأقسام. جرّب مرة تانية.";
    toast("تعذّر تحميل الأقسام", "error");
    return;
  }
  sub.textContent = "لف الدولاب وشوف شو رح تاكل اليوم";
  spinBtn.disabled = false;
  setup();
}

function closeWheel() {
  if (spinning) return;
  const m = $("wlModal");
  if (m) m.hidden = true;
  document.body.style.overflow = "";
}

function spin() {
  if (spinning || !items.length) return;
  spinning = true;
  $("wlResult").hidden = true;
  $("wlSpin").disabled = true;

  const n = items.length;
  const seg = TAU / n;
  const idx = Math.floor(Math.random() * n);
  const jitter = (Math.random() - 0.5) * seg * 0.7;
  const target = -Math.PI / 2 - (idx + 0.5) * seg + jitter;
  const delta =
    ((((target - rot) % TAU) + TAU) % TAU) + TAU * (5 + Math.floor(Math.random() * 3));
  const start = rot;
  const dur = 5000;
  const t0 = performance.now();

  function frame(now) {
    const p = Math.min(1, (now - t0) / dur);
    rot = start + delta * (1 - Math.pow(1 - p, 4));
    blink = Math.floor((now - t0) / 140) % 2;
    draw();
    if (p < 1) requestAnimationFrame(frame);
    else finish(idx);
  }
  requestAnimationFrame(frame);
}

function finish(idx) {
  spinning = false;
  blink = 0;
  draw();
  picked = items[idx];
  $("wlSpin").disabled = false;
  $("wlName").textContent = picked.name;

  const pic = $("wlPic");
  pic.innerHTML = "";
  if (picked.img) {
    const im = document.createElement("img");
    im.src = picked.img;
    im.alt = "";
    pic.appendChild(im);
    pic.hidden = false;
  } else {
    pic.hidden = true;
  }

  $("wlResult").hidden = false;
  try { if (navigator.vibrate) navigator.vibrate(60); } catch (e) {}
}

function go() {
  if (!picked) return;
  const p = picked;
  closeWheel();
  if (typeof window.openRestaurantsByCategory === "function") {
    window.openRestaurantsByCategory(p.id, p.name, p.img || "", null);
  }
}

mountEntry();
