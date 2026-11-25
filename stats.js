import { getApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getFirestore, doc, getDoc, getDocs, collection,
  setDoc, deleteDoc, writeBatch, query, where
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

/* ============================================================
   STATS PAGES (admin only)
   - pageStats      : whole-site summary + every restaurant
   - pageStatsRest  : one restaurant (cards, months, days, hours)
   Tracking of visits / WhatsApp lives in script.js; menu + location
   clicks are tracked here.
   ============================================================ */

const app = getApp();
const db = getFirestore(app);
const auth = getAuth(app);

/* How far back the day/hour tables read. Months come from their own small
   documents, so older history is never lost — just not read hour by hour. */
const DAYS_WINDOW = 60;

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

/* State of the restaurant page */
const S = { id: "", name: "", main: {}, rows: [], months: {} };
let wired = false;

function $(id) { return document.getElementById(id); }

function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function toast(msg, type) {
  if (typeof window.showToast === "function") window.showToast(msg, type);
}

/* Same clock as script.js (one source of truth). */
function beirutNow() {
  if (typeof window.beirutNow === "function") return window.beirutNow();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Beirut",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  const day = get("year") + "-" + get("month") + "-" + get("day");
  return { day: day, month: day.slice(0, 7), hour: String(Number(get("hour")) % 24).padStart(2, "0") };
}

/* "YYYY-MM-DD" n days before the given day */
function daysBefore(day, n) {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
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

function statCard(num, label) {
  return '<div class="stat-card"><div class="stat-num">' + esc(num) +
    '</div><div class="stat-label">' + esc(label) + "</div></div>";
}

function headHtml(first) {
  return '<div class="sx-head"><span>' + esc(first) + "</span>" +
    TABLE_METRICS.map((m) => "<span>" + esc(m.short) + "</span>").join("") + "</div>";
}

function cellsHtml(o) {
  return TABLE_METRICS.map((m) => "<span>" + (Number(o[m.field]) || 0) + "</span>").join("");
}

async function commitChunks(ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db);
    ops.slice(i, i + 400).forEach((fn) => fn(batch));
    await batch.commit();
  }
}

/* ---------------- tracking: menu + location clicks ---------------- */

function currentRestId() {
  try {
    const r = JSON.parse(localStorage.getItem("currentRestaurantProfile") || "{}");
    return r.id || "";
  } catch (e) { return ""; }
}

document.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest("#profileMenuBtn, #profileLocationBtn");
  if (!a || a.hidden) return;
  if ((a.getAttribute("href") || "#") === "#") return;
  if (typeof window.trackRestaurantMetric !== "function") return;
  const field = a.id === "profileMenuBtn" ? "menuClicks" : "locationClicks";
  window.trackRestaurantMetric(currentRestId(), field)
    .catch((err) => console.warn("track " + field + ":", err));
});

/* ============================================================
   PAGE 1: all restaurants
   ============================================================ */

function openStatsPage() {
  if (!auth.currentUser) {
    window.showPage("pageLogin");
    return;
  }
  window.showPage("pageStats"); // showPage calls loadStatsPage()
}

async function restaurantsList() {
  const loaded = typeof window.getLoadedRestaurants === "function"
    ? window.getLoadedRestaurants()
    : null;
  if (loaded) return loaded;
  // Opened the stats before the live list arrived: read it once.
  const snap = await getDocs(collection(db, "restaurants"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

let statsLoading = false;

async function loadStatsPage() {
  const summary = $("statsSummary");
  const list = $("statsList");
  if (!summary || !list || !auth.currentUser || statsLoading) return;
  statsLoading = true;

  list.innerHTML = '<div class="admin-list-note">جاري التحميل...</div>';

  try {
    const [siteSnap, restSnap, restaurants] = await Promise.all([
      getDoc(doc(db, "stats", "site")),
      getDocs(collection(db, "stats_restaurants")),
      restaurantsList()
    ]);

    const site = siteSnap.exists() ? siteSnap.data() : {};
    const byId = {};
    restSnap.forEach((d) => { byId[d.id] = d.data(); });

    const rows = restaurants.map((r) => {
      const s = byId[r.id] || {};
      const row = { id: r.id, name: r.name || "" };
      TABLE_METRICS.forEach((m) => { row[m.field] = Number(s[m.field]) || 0; });
      return row;
    }).sort((a, b) => b.views - a.views);

    summary.innerHTML =
      statCard(site.visits || 0, "زيارات الموقع") +
      statCard(site.uniqueVisitors || 0, "أشخاص فتحوا الموقع") +
      statCard(sumBy(rows, "views"), "فتحوا مطاعم") +
      statCard(sumBy(rows, "whatsappClicks"), "ضغطوا واتساب") +
      statCard(sumBy(rows, "menuClicks"), "فتحوا المنيو") +
      statCard(sumBy(rows, "locationClicks"), "فتحوا الموقع");

    list.innerHTML = rows.length
      ? '<div class="sx-scroll"><div class="sx-table">' + headHtml("المطعم") +
          rows.map((r) =>
            '<button type="button" class="sx-row" data-stats-rest="' + esc(r.id) + '">' +
              '<span class="sx-name">' + esc(r.name) + "</span>" + cellsHtml(r) +
            "</button>").join("") +
        "</div></div>"
      : '<div class="admin-list-note">ما في مطاعم بعد.</div>';
  } catch (e) {
    console.error("loadStatsPage:", e);
    list.innerHTML = '<div class="admin-list-note">تعذّر تحميل الإحصائيات. تأكد من قواعد Firestore.</div>';
  } finally {
    statsLoading = false;
  }
}

document.addEventListener("click", (e) => {
  const row = e.target.closest && e.target.closest("[data-stats-rest]");
  if (!row) return;
  openRestaurantStats(row.getAttribute("data-stats-rest"));
});

/* ============================================================
   PAGE 2: one restaurant
   ============================================================ */

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
      '<p class="sx-hint">التفاصيل بالساعة متوفرة لآخر ' + DAYS_WINDOW + " يوم.</p>" +
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
        '<div class="stat-label">' + esc(m.label) + "</div>" +
        '<div class="sx-sub">' + sub + "</div>" +
      "</div>"
    );
  }).join("");
}

function aggregate(rows, keyFn) {
  const map = {};
  rows.forEach((r) => {
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
  const keys = Object.keys(S.months).sort().reverse();
  box.innerHTML = keys.length
    ? keys.map((k) => '<div class="sx-row"><span class="sx-name">' + monthLabel(k) + "</span>" + cellsHtml(S.months[k]) + "</div>").join("")
    : '<div class="admin-list-note">ما في تفاصيل شهرية بعد.</div>';
}

function renderDays() {
  const box = $("sx-days");
  if (!box) return;
  const map = aggregate(S.rows, (r) => r.day);
  const keys = Object.keys(map).sort().reverse().slice(0, 30);
  box.innerHTML = keys.length
    ? keys.map((k) =>
        '<button type="button" class="sx-row" data-sx="day" data-day="' + esc(k) + '"><span class="sx-name">' +
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

/* One-time move to monthly documents: builds them from every hourly
   document that exists, then marks the restaurant as done. Runs once per
   restaurant (and again after a full reset, when there is nothing to read). */
async function migrateMonths(id) {
  const all = await getDocs(collection(db, "stats_restaurants", id, "hours"));
  const totals = aggregate(all.docs.map((d) => d.data()), (r) => r.month);

  await commitChunks(Object.keys(totals).map((m) => (b) =>
    b.set(doc(db, "stats_restaurants", id, "months", m), { ...totals[m], month: m })
  ));
  await setDoc(doc(db, "stats_restaurants", id), { monthsMigrated: true }, { merge: true });
  return totals;
}

async function load() {
  if (!auth.currentUser || !S.id) return;
  const id = S.id;
  const cards = $("sx-cards");
  if (cards) cards.innerHTML = '<div class="admin-list-note">جاري التحميل...</div>';

  try {
    const today = beirutNow().day;
    const from = daysBefore(today, DAYS_WINDOW - 1);

    const [mainSnap, hoursSnap, monthsSnap, restSnap] = await Promise.all([
      getDoc(doc(db, "stats_restaurants", id)),
      getDocs(query(collection(db, "stats_restaurants", id, "hours"), where("day", ">=", from))),
      getDocs(collection(db, "stats_restaurants", id, "months")),
      S.name ? Promise.resolve(null) : getDoc(doc(db, "restaurants", id))
    ]);

    if (id !== S.id) return; // another restaurant was opened meanwhile

    if (restSnap && restSnap.exists()) S.name = restSnap.data().name || "";
    S.main = mainSnap.exists() ? mainSnap.data() : {};
    S.rows = hoursSnap.docs.map((d) => d.data());

    let months = {};
    if (S.main.monthsMigrated === true) {
      monthsSnap.docs.forEach((d) => { months[d.id] = d.data(); });
    } else {
      months = await migrateMonths(id);
      S.main.monthsMigrated = true;
    }
    S.months = months;

    const title = $("sx-title");
    if (title) title.textContent = S.name || "المطعم";

    const input = $("sx-day");
    if (input) {
      input.min = from;
      input.max = today;
      if (!input.value) input.value = today;
    }

    renderCards();
    renderMonths();
    renderDays();
    renderHours();
  } catch (e) {
    console.error("stats load:", e);
    if (cards) cards.innerHTML = '<div class="admin-list-note">تعذّر التحميل. تأكد من قواعد Firestore.</div>';
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
      // Every document, not only the last DAYS_WINDOW days on screen.
      const [hours, months] = await Promise.all([
        getDocs(collection(db, "stats_restaurants", S.id, "hours")),
        getDocs(collection(db, "stats_restaurants", S.id, "months"))
      ]);
      const ops = hours.docs.concat(months.docs)
        .filter((d) => (Number(d.data()[m.field]) || 0) > 0)
        .map((d) => (b) => b.update(d.ref, { [m.field]: 0 }));
      await commitChunks(ops);
    }
    toast("تم التصفير", "success");
    load();
  } catch (e) {
    console.error("resetMetric:", e);
    toast("تعذّر التصفير. تأكد من قواعد Firestore.", "error");
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
    const [hours, months] = await Promise.all([
      getDocs(collection(db, "stats_restaurants", S.id, "hours")),
      getDocs(collection(db, "stats_restaurants", S.id, "months"))
    ]);
    await commitChunks(hours.docs.concat(months.docs).map((d) => (b) => b.delete(d.ref)));
    await deleteDoc(doc(db, "stats_restaurants", S.id));
    toast("تم تصفير إحصائيات المطعم", "success");
    load();
  } catch (e) {
    console.error("resetAll:", e);
    toast("تعذّر التصفير. تأكد من قواعد Firestore.", "error");
  }
}

function openRestaurantStats(id) {
  if (!auth.currentUser) {
    window.showPage("pageLogin");
    return;
  }
  if (!id) return;

  const known = (typeof window.getLoadedRestaurants === "function" && window.getLoadedRestaurants()) || [];
  const r = known.find((x) => x.id === id);

  S.id = id;
  S.name = r ? (r.name || "") : "";
  S.main = {};
  S.rows = [];
  S.months = {};

  localStorage.setItem("parentPage", "pageStats");
  buildPage();
  toggleEdit(false);
  window.showPage("pageStatsRest");
  load();
}

/* After a refresh on the restaurant page: reload it if we still know which
   restaurant it was, otherwise go back to the list. */
function reopenRestaurantStats() {
  if (S.id && auth.currentUser) {
    buildPage();
    load();
  } else {
    window.showPage("pageStats");
  }
}

window.openStatsPage = openStatsPage;
window.loadStatsPage = loadStatsPage;
window.openRestaurantStats = openRestaurantStats;
window.reopenRestaurantStats = reopenRestaurantStats;
window.loadRestaurantStats = load;
window.resetRestaurantStats = resetAll;

/* script.js already ran showPage() before this module loaded: if the stats
   list is on screen and the admin is signed in, fill it now. */
if (auth.currentUser) {
  const active = document.querySelector(".view-page.active");
  if (active && active.id === "pageStats") loadStatsPage();
}
