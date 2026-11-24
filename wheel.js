import { getApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getFirestore, collection, getDocs
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const db = getFirestore(getApp());

const TAU = Math.PI * 2;
const COLORS = ["#19a99d", "#d9892b", "#d6453d", "#3b78c4", "#7d58c9", "#3f9e5f"];

let cats = [];
let loaded = false;
let rot = 0;
let spinning = false;
let picked = null;
let size = 300;

function $(id) { return document.getElementById(id); }

function toast(msg, type) {
  if (typeof window.showToast === "function") window.showToast(msg, type || "error");
}

function colorFor(i, n) {
  let k = i % COLORS.length;
  if (i === n - 1 && n > 1 && k === 0) k = 3;
  return COLORS[k];
}

function nameOf(c) {
  return String(c.nameAr || c.nameEn || "").trim();
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
      '<h2 class="wl-title">دولاب الحظ 🎡</h2>' +
      '<p class="wl-sub" id="wlSub">لف الدولاب وشوف شو رح تاكل اليوم</p>' +
      '<div class="wl-stage">' +
        '<div class="wl-pointer"></div>' +
        '<canvas id="wlCanvas"></canvas>' +
        '<button type="button" class="wl-spin" id="wlSpin" data-wl="spin">لف</button>' +
      "</div>" +
      '<div class="wl-result" id="wlResult" hidden>' +
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
  size = Math.max(240, Math.min(320, window.innerWidth - 80));
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = canvas.height = Math.round(size * dpr);
  canvas.style.width = canvas.style.height = size + "px";
  canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function draw() {
  const canvas = $("wlCanvas");
  if (!canvas || !cats.length) return;
  const ctx = canvas.getContext("2d");
  const n = cats.length;
  const c = size / 2;
  const R = c - 6;
  const seg = TAU / n;

  ctx.clearRect(0, 0, size, size);

  ctx.beginPath();
  ctx.arc(c, c, R + 4, 0, TAU);
  ctx.fillStyle = "#222a29";
  ctx.fill();

  const fontSize = n <= 8 ? 15 : n <= 14 ? 13 : 11;
  ctx.font = "600 " + fontSize + 'px "IBM Plex Sans Arabic", sans-serif';
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  for (let i = 0; i < n; i++) {
    const a0 = rot + i * seg;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.arc(c, c, R, a0, a0 + seg);
    ctx.closePath();
    ctx.fillStyle = colorFor(i, n);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(0,0,0,.35)";
    ctx.stroke();

    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(a0 + seg / 2);
    ctx.fillStyle = "#fff";
    ctx.shadowColor = "rgba(0,0,0,.45)";
    ctx.shadowBlur = 3;
    ctx.fillText(nameOf(cats[i]), R - 14, 0, R * 0.6);
    ctx.restore();
  }

  ctx.beginPath();
  ctx.arc(c, c, 34, 0, TAU);
  ctx.fillStyle = "#0a0d0c";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#222a29";
  ctx.stroke();
}

async function loadCats() {
  if (loaded) return true;
  try {
    const snap = await getDocs(collection(db, "categories"));
    cats = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((c) => nameOf(c))
      .sort((a, b) => {
        const x = a.order != null ? Number(a.order) : 999;
        const y = b.order != null ? Number(b.order) : 999;
        return x - y;
      });
    loaded = cats.length > 0;
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

  const ok = await loadCats();
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
  if (spinning || !cats.length) return;
  spinning = true;
  $("wlResult").hidden = true;
  $("wlSpin").disabled = true;

  const n = cats.length;
  const seg = TAU / n;
  const idx = Math.floor(Math.random() * n);
  const jitter = (Math.random() - 0.5) * seg * 0.7;
  const target = -Math.PI / 2 - (idx + 0.5) * seg + jitter;
  const delta =
    ((((target - rot) % TAU) + TAU) % TAU) + TAU * (5 + Math.floor(Math.random() * 3));
  const start = rot;
  const dur = 4800;
  const t0 = performance.now();

  function frame(now) {
    const p = Math.min(1, (now - t0) / dur);
    rot = start + delta * (1 - Math.pow(1 - p, 4));
    draw();
    if (p < 1) requestAnimationFrame(frame);
    else finish(idx);
  }
  requestAnimationFrame(frame);
}

function finish(idx) {
  spinning = false;
  picked = cats[idx];
  $("wlSpin").disabled = false;
  $("wlName").textContent = nameOf(picked);
  $("wlResult").hidden = false;
  try { if (navigator.vibrate) navigator.vibrate(60); } catch (e) {}
}

function go() {
  if (!picked) return;
  const p = picked;
  closeWheel();
  if (typeof window.openRestaurantsByCategory === "function") {
    window.openRestaurantsByCategory(p.id, nameOf(p), p.imgUrl || "", null);
  }
}

mountEntry();
