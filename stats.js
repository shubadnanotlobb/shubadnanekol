import { getApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getFirestore, doc, getDoc, getDocs, collection,
  setDoc, deleteDoc, writeBatch, increment
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const app = getApp();
const db = getFirestore(app);
const auth = getAuth(app);

const MONTH_NAMES = ["كانون الثاني","شباط","آذار","نيسان","أيار","حزيران","تموز","آب","أيلول","تشرين الأول","تشرين الثاني","كانون الأول"];

const METRICS = [
  { key: "views",  field: "views",          label: "الزيارات",       short: "زيارات", hourly: true },
  { key: "unique", field: "uniqueViews",    label: "أشخاص",          short: "أشخاص",  hourly: true },
  { key: "wa",     field: "whatsappClicks", label: "ضغطات واتساب",   short: "واتساب", hourly: true },
  { key: "menu",   field: "menuClicks",     label: "ضغطات المنيو",   short: "منيو",   hourly: true },
  { key: "loc",    field: "locationClicks", label: "ضغطات الموقع",   short: "موقع",   hourly: true },
  { key: "fav",    field: "favorites",      label: "❤️ المفضلة",     short: "",       hourly: false }
];
const TABLE_METRICS = METRICS.filter((m) => m.hourly);

const TRASH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';

const S = { id: "", name: "", main: {}, docs: [], rows: [] };
let wired = false;

function $(id) { return document.getElementById(id); }

function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function isAdminDevice() {
  try { return localStorage.getItem("shu_is_admin") === "1"; } catch (e) { return false; }
}

function beirutNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Beirut",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  const day = get("year") + "-" + get("month") + "-" + get("day");
  const hour = String(Number(get("hour")) % 24).padStart(2, "0");
  return { day: day, month: day.slice(0, 7), hour: hour };
}

function hourLabel(h) {
  const n = Number(h);
  return (n % 12 || 12) + ":00 " + (n < 12 ? "ص" : "م");
}

function dayLabel(d) {
  return Number(d.slice(8)) + " " + MONTH_NAMES[Number(d.slice(5, 7)) - 1];
}

function monthLabel(m) {
  return MONTH_NAMES[Number(m.slice(5)) - 1] + " " + m.slice(0, 4);
}

function sumBy(rows, field) {
  return rows.reduce((n, r) => n + (Number(r[field]) || 0), 0);
}

/* ---------------- tracking: menu + location clicks ---------------- */

function currentRestId() {
  try {
    const r = JSON.parse(localStorage.getItem("currentRestaurantProfile") || "{}");
    return r.id || "";
  } catch (e) { return ""; }
}

async function track(field) {
  const id = currentRestId();
  if (!id || isAdminDevice()) return;
  try {
    const t = beirutNow();
    await Promise.all([
      setDoc(doc(db, "stats_restaurants", id), { [field]: increment(1) }, { merge: true }),
      setDoc(doc(db, "stats_restaurants", id, "hours", t.day + "_" + t.hour), {
        [field]: increment(1), day: t.day, month: t.month, hour: t.hour
      }, { merge: true })
    ]);
  } catch (e) {
    console.warn("track " + field + ":", e);
  }
}

document.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest("#profileMenuBtn, #profileLocationBtn");
  if (!a || a.hidden) return;
  if ((a.getAttribute("href") || "#") === "#") return;
  track(a.id === "profileMenuBtn" ? "menuClicks" : "locationClicks");
});

/* ---------------- restaurant stats page ---------------- */

function headHtml(first) {
  return '<div class="sx-head"><span>' + first + "</span>" +
    TABLE_METRICS.map((m) => "<span>" + m.short + "</span>").join("") + "</div>";
}

function cellsHtml(o) {
  return TABLE_METRICS.map((m) => "<span>" + (o[m.field] || 0) + "</span>").join("");
}

function buildPage() {
  const page = $("pageStatsRest");
  if (!page) return;

  page.innerHTML =
    '<div class="section-head">' +
      '<h1 class="section-title" id="sx-title"></h1>' +
      '<div class="sx-actions">' +
        '<button class="btn btn-ghost btn-sm" type="button" data-sx="refresh">تحديث</button>' +
        '<button class="btn btn-ghost btn-sm" type="button" id="sx-edit-btn" data-sx="edit">تعديل</button>' +
      "</div>" +
    "</div>" +
    '<div class="stats-summary sx-cards" id="sx-cards"></div>' +

    '<section class="panel">' +
      '<div class="panel-head"><h3 class="panel-title">حسب الشهر</h3></div>' +
      '<div class="sx-scroll"><div class="sx-table">' + headHtml("الشهر") + '<div id="sx-months"></div></div></div>' +
    "</section>" +

    '<section class="panel">' +
      '<div class="panel-head"><h3 class="panel-title">حسب اليوم</h3><span class="section-sub">آخر 30 يوم</span></div>' +
      '<p class="sx-hint">اضغط على أي يوم لتشوف ساعاته.</p>' +
      '<div class="sx-scroll"><div class="sx-table">' + headHtml("اليوم") + '<div id="sx-days"></div></div></div>' +
    "</section>" +

    '<section class="panel" id="sx-hours-panel">' +
      '<div class="panel-head"><h3 class="panel-title">حسب الساعة</h3>' +
      '<input class="field-control sx-date" type="date" id="sx-day"></div>' +
      '<div class="sx-scroll"><div class="sx-table">' + headHtml("الساعة") + '<div id="sx-hours"></div></div></div>' +
    "</section>" +

    '<button class="btn btn-danger btn-block sx-reset-all" type="button" data-sx="reset-all">' + TRASH + " تصفير كل إحصائيات المطعم</button>";

  if (!wired) {
    wired = true;
    page.addEventListener("click", onClick);
    page.addEventListener("change", (e) => {
      if (e.target && e.target.id === "sx-day") renderHours();
    });
  }
}

function toggleEdit(force) {
  const page = $("pageStatsRest");
  if (!page) return;
  const on = typeof force === "boolean" ? force : !page.classList.contains("sx-edit");
  page.classList.toggle("sx-edit", on);
  const b = $("sx-edit-btn");
  if (b) b.textContent = on ? "تم" : "تعديل";
}

function onClick(e) {
  const btn = e.target.closest("[data-sx]");
  if (!btn) return;
  const act = btn.getAttribute("data-sx");

  if (act === "refresh") load();
  else if (act === "edit") toggleEdit();
  else if (act === "reset") resetMetric(btn.getAttribute("data-m"));
  else if (act === "reset-all") resetAll();
  else if (act === "day") {
    const input = $("sx-day");
    if (input) input.value = btn.getAttribute("data-day");
    renderHours();
    const panel = $("sx-hours-panel");
    if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function renderCards() {
  const box = $("sx-cards");
  if (!box) return;
  const today = beirutNow().day;
  const todayRows = S.rows.filter((r) => r.day === today);

  box.innerHTML = METRICS.map((m) => {
    const total = Math.max(0, Number(S.main[m.field]) || 0);
    const sub = m.hourly ? "اليوم: <b>" + sumBy(todayRows, m.field) + "</b>" : "عدد اللي حفظوه";
    return (
      '<div class="stat-card sx-card">' +
        '<button type="button" class="sx-trash" data-sx="reset" data-m="' + m.key + '" aria-label="تصفير ' + esc(m.label) + '" title="تصفير">' + TRASH + "</button>" +
        '<div class="stat-num">' + total + "</div>" +
        '<div class="stat-label">' + m.label + "</div>" +
        '<div class="sx-sub">' + sub + "</div>" +
      "</div>"
    );
  }).join("");
}

function aggregate(keyFn) {
  const map = {};
  S.rows.forEach((r) => {
    const k = keyFn(r);
    if (!k) return;
    const o = map[k] || (map[k] = {});
    TABLE_METRICS.forEach((m) => { o[m.field] = (o[m.field] || 0) + (Number(r[m.field]) || 0); });
  });
  return map;
}

function renderMonths() {
  const box = $("sx-months");
  if (!box) return;
  const map = aggregate((r) => r.month);
  const keys = Object.keys(map).sort().reverse();
  box.innerHTML = keys.length
    ? keys.map((k) => '<div class="sx-row"><span class="sx-name">' + monthLabel(k) + "</span>" + cellsHtml(map[k]) + "</div>").join("")
    : '<div class="admin-list-note">ما في تفاصيل شهرية بعد.</div>';
}

function renderDays() {
  const box = $("sx-days");
  if (!box) return;
  const map = aggregate((r) => r.day);
  const keys = Object.keys(map).sort().reverse().slice(0, 30);
  box.innerHTML = keys.length
    ? keys.map((k) =>
        '<button type="button" class="sx-row" data-sx="day" data-day="' + k + '"><span class="sx-name">' +
        dayLabel(k) + "</span>" + cellsHtml(map[k]) + "</button>").join("")
    : '<div class="admin-list-note">ما في تفاصيل يومية بعد.</div>';
}

function renderHours() {
  const box = $("sx-hours");
  const input = $("sx-day");
  if (!box || !input) return;

  const rows = S.rows
    .filter((r) => r.day === input.value)
    .sort((a, b) => String(a.hour).localeCompare(String(b.hour)));

  if (!rows.length) {
    box.innerHTML = '<div class="admin-list-note">ما في بيانات بهاد اليوم.</div>';
    return;
  }

  const total = {};
  TABLE_METRICS.forEach((m) => { total[m.field] = sumBy(rows, m.field); });

  box.innerHTML =
    rows.map((r) => '<div class="sx-row"><span class="sx-name">' + hourLabel(r.hour) + "</span>" + cellsHtml(r) + "</div>").join("") +
    '<div class="sx-row sx-total"><span class="sx-name">المجموع</span>' + cellsHtml(total) + "</div>";
}

async function load() {
  if (!auth.currentUser || !S.id) return;
  const cards = $("sx-cards");
  if (cards) cards.innerHTML = '<div class="admin-list-note">جاري التحميل...</div>';

  try {
    const [mainSnap, hoursSnap, restSnap] = await Promise.all([
      getDoc(doc(db, "stats_restaurants", S.id)),
      getDocs(collection(db, "stats_restaurants", S.id, "hours")),
      S.name ? Promise.resolve(null) : getDoc(doc(db, "restaurants", S.id))
    ]);

    if (restSnap && restSnap.exists()) S.name = restSnap.data().name || "";
    S.main = mainSnap.exists() ? mainSnap.data() : {};
    S.docs = hoursSnap.docs;
    S.rows = hoursSnap.docs.map((d) => d.data());

    const title = $("sx-title");
    if (title) title.textContent = S.name || "المطعم";

    renderCards();
    renderMonths();
    renderDays();
    renderHours();
  } catch (e) {
    console.error("stats load:", e);
    if (cards) cards.innerHTML = '<div class="admin-list-note">تعذّر التحميل. تأكد من قواعد Firestore.</div>';
  }
}

async function commitChunks(ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db);
    ops.slice(i, i + 400).forEach((fn) => fn(batch));
    await batch.commit();
  }
}

async function resetMetric(key) {
  const m = METRICS.find((x) => x.key === key);
  if (!m || !S.id || !auth.currentUser) return;

  const ok = await window.showConfirm(
    'بدك تصفّر "' + m.label.replace("❤️ ", "") + '" لمطعم ' + (S.name || "") + "؟ ما في رجعة.",
    "تصفير",
    "تصفير"
  );
  if (!ok) return;

  try {
    await setDoc(doc(db, "stats_restaurants", S.id), { [m.field]: 0 }, { merge: true });
    if (m.hourly) {
      const ops = S.docs
        .filter((d) => (Number(d.data()[m.field]) || 0) > 0)
        .map((d) => (b) => b.update(d.ref, { [m.field]: 0 }));
      await commitChunks(ops);
    }
    window.showToast("تم التصفير", "success");
    load();
  } catch (e) {
    console.error("resetMetric:", e);
    window.showToast("تعذّر التصفير. تأكد من قواعد Firestore.", "error");
  }
}

async function resetAll() {
  if (!S.id || !auth.currentUser) return;

  const ok = await window.showConfirm(
    "بدك تصفّر كل إحصائيات " + (S.name || "المطعم") + " (الأيام والساعات والأشهر والمفضلة)؟ ما في رجعة.",
    "تصفير الكل",
    "تصفير"
  );
  if (!ok) return;

  try {
    await commitChunks(S.docs.map((d) => (b) => b.delete(d.ref)));
    await deleteDoc(doc(db, "stats_restaurants", S.id));
    window.showToast("تم تصفير إحصائيات المطعم", "success");
    load();
  } catch (e) {
    console.error("resetAll:", e);
    window.showToast("تعذّر التصفير. تأكد من قواعد Firestore.", "error");
  }
}

/* ---------------- hook into the existing stats list ---------------- */

const oldOpen = window.openRestaurantStats;

window.openRestaurantStats = function (id) {
  if (typeof oldOpen === "function") oldOpen(id);
  else if (window.showPage) window.showPage("pageStatsRest");

  if (!auth.currentUser) return;

  S.id = id;
  S.name = "";
  S.main = {};
  S.docs = [];
  S.rows = [];

  buildPage();
  toggleEdit(false);
  const input = $("sx-day");
  if (input) input.value = beirutNow().day;
  load();
};

window.resetRestaurantStats = resetAll;
