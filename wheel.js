import { getApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getFirestore, collection, getDocs, doc, getDoc, setDoc, query, where
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
      '<button type="button" class="wl-mute" id="wlMute" data-wl="mute" aria-label="الصوت">🔊</button>' +
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
    else if (act === "mute") {
      muted = !muted;
      try { localStorage.setItem("wl_muted", muted ? "1" : "0"); } catch (e) {}
      if (muted) stopWin();
      updateMuteBtn();
    }
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
  const badge = Math.max(28, Math.min(66, R * seg * 0.8));

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

    const bx = R - 12 - badge / 2;
    drawBadge(ctx, bx, badge, items[i].img, pal[0]);
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
      .map((c) => ({ id: c.id, name: nameOf(c), img: c.imgUrl || "", sound: c.soundUrl || "", raw: c }));
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
  updateMuteBtn();
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
  stopWin();
  const m = $("wlModal");
  if (m) m.hidden = true;
  document.body.style.overflow = "";
}

function spin() {
  if (spinning || !items.length) return;
  spinning = true;
  audio();
  $("wlResult").hidden = true;
  $("wlSpin").disabled = true;

  const n = items.length;
  const seg = TAU / n;
  const idx = Math.floor(Math.random() * n);
  unlockWin(soundFor(items[idx]));
  const jitter = (Math.random() - 0.5) * seg * 0.7;
  const target = -Math.PI / 2 - (idx + 0.5) * seg + jitter;
  const delta =
    ((((target - rot) % TAU) + TAU) % TAU) + TAU * (5 + Math.floor(Math.random() * 3));
  const start = rot;
  const dur = 5000;
  const t0 = performance.now();
  let lastSeg = -1;
  let lastTick = 0;

  function frame(now) {
    const p = Math.min(1, (now - t0) / dur);
    rot = start + delta * (1 - Math.pow(1 - p, 4));
    blink = Math.floor((now - t0) / 140) % 2;
    const cur = Math.floor(((((-Math.PI / 2 - rot) % TAU) + TAU) % TAU) / seg);
    if (cur !== lastSeg && now - lastTick > 55) { tick(); lastTick = now; }
    lastSeg = cur;
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
  playWin();
  confetti();
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

/* ---------------- sound ---------------- */

let actx = null;
let muted = false;
try { muted = localStorage.getItem("wl_muted") === "1"; } catch (e) {}

function audio() {
  if (!actx) {
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
  }
  if (actx.state === "suspended") actx.resume();
  return actx;
}

function tone(freq, start, dur, type, vol) {
  const a = audio();
  if (!a || muted) return;
  const o = a.createOscillator();
  const g = a.createGain();
  const t = a.currentTime + start;
  o.type = type || "sine";
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol || 0.15, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function tick() {
  const a = audio();
  if (!a || muted) return;
  const t = a.currentTime;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(1400, t);
  o.frequency.exponentialRampToValueAtTime(500, t + 0.04);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.12, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  o.connect(g);
  g.connect(a.destination);
  o.start(t);
  o.stop(t + 0.08);
}

const winSnd = new Audio("win.mp3");
winSnd.preload = "auto";

/* iPhone only allows sound that starts from a tap. So on every SPIN tap we
   start the clip silently (looping), and when the wheel stops we un-mute it
   and play it from the start. It never has to "start" without a tap. */
const DEFAULT_SOUND = "win.mp3";

function soundFor(item) {
  const s = String((item && item.sound) || "").trim();
  if (!s) return DEFAULT_SOUND;
  if (/^https?:\/\//i.test(s)) return s;
  return s.replace(/^\/+/, "");
}

winSnd.addEventListener("error", () => {
  if (!/win\.mp3$/.test(winSnd.getAttribute("src") || "")) winSnd.src = DEFAULT_SOUND;
});

function unlockWin(src) {
  try {
    const full = new URL(src || DEFAULT_SOUND, document.baseURI).href;
    if (winSnd.src !== full) winSnd.src = full;
    winSnd.loop = true;
    winSnd.muted = true;
    winSnd.currentTime = 0;
    const p = winSnd.play();
    if (p && p.catch) p.catch(() => {});
  } catch (e) {}
}

function playWin() {
  try {
    winSnd.loop = false;
    winSnd.currentTime = 0;
    if (muted) {
      winSnd.pause();
      return;
    }
    winSnd.muted = false;
    const p = winSnd.play();
    if (p && p.catch) p.catch(() => {});
  } catch (e) {}
}

function stopWin() {
  try {
    winSnd.pause();
    winSnd.loop = false;
    winSnd.muted = false;
  } catch (e) {}
}

/* ---------------- confetti / fireworks ---------------- */

let confettiRun = 0;

function confetti() {
  const m = $("wlModal");
  if (!m) return;
  try {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  } catch (e) {}

  const run = ++confettiRun;
  let cv = $("wlConfetti");
  if (!cv) {
    cv = document.createElement("canvas");
    cv.id = "wlConfetti";
    cv.className = "wl-confetti";
    m.appendChild(cv);
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = m.clientWidth;
  const H = m.clientHeight;
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  cv.style.width = W + "px";
  cv.style.height = H + "px";
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const colors = ["#f6d68e", "#22c3b4", "#ee6f63", "#63a5f0", "#a082ea", "#5fcf88", "#fff6d6"];
  const parts = [];
  const t0 = performance.now();

  function add(x, y, ang, spd, kind) {
    const a = ang + (Math.random() - 0.5) * (kind === "spark" ? Math.PI * 2 : 0.9);
    const v = spd * (0.45 + Math.random() * 0.75);
    parts.push({
      x: x, y: y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      w: 5 + Math.random() * 6,
      h: 3 + Math.random() * 5,
      rot: Math.random() * TAU,
      vr: (Math.random() - 0.5) * 0.4,
      color: colors[Math.floor(Math.random() * colors.length)],
      kind: kind,
      born: performance.now(),
      life: kind === "spark" ? 1100 + Math.random() * 500 : 2400 + Math.random() * 900
    });
  }

  function cannon(x, y, ang) {
    for (let i = 0; i < 55; i++) add(x, y, ang, 15, "paper");
  }

  function firework(x, y) {
    for (let i = 0; i < 46; i++) add(x, y, 0, 7, "spark");
  }

  cannon(W * 0.08, H * 0.9, -Math.PI * 0.36);
  cannon(W * 0.92, H * 0.9, -Math.PI * 0.64);
  firework(W * 0.5, H * 0.3);
  setTimeout(() => { if (run === confettiRun) firework(W * (0.2 + Math.random() * 0.6), H * (0.2 + Math.random() * 0.2)); }, 380);
  setTimeout(() => { if (run === confettiRun) firework(W * (0.2 + Math.random() * 0.6), H * (0.2 + Math.random() * 0.25)); }, 760);

  let last = t0;
  function frame(now) {
    if (run !== confettiRun) return;
    const dt = Math.min(2.5, (now - last) / 16.67);
    last = now;
    ctx.clearRect(0, 0, W, H);

    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      const age = now - p.born;
      if (age > p.life || p.y > H + 30) { parts.splice(i, 1); continue; }

      p.vy += (p.kind === "spark" ? 0.12 : 0.28) * dt;
      p.vx *= Math.pow(p.kind === "spark" ? 0.96 : 0.985, dt);
      p.vy *= Math.pow(p.kind === "spark" ? 0.96 : 0.99, dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;

      ctx.globalAlpha = Math.max(0, Math.min(1, (p.life - age) / 500));
      ctx.fillStyle = p.color;
      if (p.kind === "spark") {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.4, 0, TAU);
        ctx.fill();
      } else {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.rot * 2)) + 1);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;

    if (parts.length || now - t0 < 900) requestAnimationFrame(frame);
    else cv.remove();
  }
  requestAnimationFrame(frame);
}

/* ---------------- admin: per-category sound ---------------- */

function ensureSoundField() {
  if ($("adminCatSound")) return;
  const img = $("adminCatImg");
  const grp = img && img.closest(".admin-form-group");
  if (!grp) return;

  const box = document.createElement("div");
  box.className = "field admin-form-group";
  box.innerHTML =
    '<label class="field-label" for="adminCatSound">صوت القسم عند الفوز (اختياري)</label>' +
    '<input class="field-control" type="text" id="adminCatSound" placeholder="مثال: pizza.mp3 أو رابط مباشر" dir="ltr">' +
    '<div class="upload-help-text">اكتب اسم ملف الصوت اللي رفعته على GitHub. إذا تركته فاضي بيشتغل الصوت العادي.</div>';
  grp.after(box);
}

(function hookAdmin() {
  ensureSoundField();

  const origSave = window.saveCategoryToFirebase;
  if (typeof origSave === "function") {
    window.saveCategoryToFirebase = async function () {
      ensureSoundField();
      const sound = (($("adminCatSound") || {}).value || "").trim();
      const docId = ($("editCatDocId") || {}).value || "";
      const nameAr = (($("adminCatAr") || {}).value || "").trim();
      const nameEn = (($("adminCatEn") || {}).value || "").trim();

      const out = await origSave.apply(this, arguments);

      if (!nameAr || !nameEn) return out;
      if (($("adminCatAr") || {}).value) return out; // not saved (form still full)

      try {
        let id = docId;
        if (!id) {
          const snap = await getDocs(query(collection(db, "categories"), where("nameAr", "==", nameAr)));
          let best = null;
          let bestT = -1;
          snap.docs.forEach((d) => {
            const c = d.data().createdAt;
            const t = c && c.toMillis ? c.toMillis() : 0;
            if (t >= bestT) { best = d; bestT = t; }
          });
          id = best ? best.id : "";
        }
        if (id) await setDoc(doc(db, "categories", id), { soundUrl: sound }, { merge: true });
        loaded = false;
      } catch (e) {
        console.warn("category sound save:", e);
      }

      const f = $("adminCatSound");
      if (f) f.value = "";
      return out;
    };
  }

  const origEdit = window.editCategory;
  if (typeof origEdit === "function") {
    window.editCategory = function (id) {
      const r = origEdit.apply(this, arguments);
      ensureSoundField();
      const f = $("adminCatSound");
      if (f) f.value = "";
      getDoc(doc(db, "categories", id))
        .then((snap) => { if (f && snap.exists()) f.value = snap.data().soundUrl || ""; })
        .catch(() => {});
      return r;
    };
  }

  const origReset = window.resetCategoryForm;
  if (typeof origReset === "function") {
    window.resetCategoryForm = function () {
      const r = origReset.apply(this, arguments);
      const f = $("adminCatSound");
      if (f) f.value = "";
      return r;
    };
  }
})();

function updateMuteBtn() {
  const b = $("wlMute");
  if (b) b.textContent = muted ? "🔇" : "🔊";
}

mountEntry();
