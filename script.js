import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";

import {
  getFirestore,
  collection,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";


const firebaseConfig = {
  apiKey: "AIzaSyDIoVcSZQwj9M9X6kXSVGCiHkELDZvsB2Y",
  authDomain: "shubadnanotlob-7b128.firebaseapp.com",
  databaseURL: "https://shubadnanotlob-7b128-default-rtdb.firebaseio.com",
  projectId: "shubadnanotlob-7b128",
  storageBucket: "shubadnanotlob-7b128.firebasestorage.app",
  messagingSenderId: "137645087727",
  appId: "1:137645087727:web:00c0099090e773ab3cf41a",
  measurementId: "G-7E4XSDTN10"
};


const app = initializeApp(firebaseConfig);

const db = getFirestore(app);

const storage = getStorage(app);


const MAX_GALLERY_IMAGES = 20;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;


let currentCategoryFilter = localStorage.getItem("currentCategoryFilter") || "";
let allRestaurants = [];
let allCategories = [];

// Design-system state: are the Firestore snapshots in yet?
let categoriesLoaded = false;
let restaurantsLoaded = false;
let categoriesLoadFailed = false;
let restaurantsLoadFailed = false;
let unsubscribeCategories = null;
let unsubscribeRestaurants = null;


// ============================================================
// HELPER: SHUFFLE ARRAY (خلط عشوائي)
// ============================================================

function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ============================================================
// UI LAYER — TOASTS, CONFIRM DIALOG, LIGHTBOX, LIST STATES
// (presentation only; no data / routing / auth behaviour changes)
// ============================================================

function inferToastType(message) {
  const m = String(message === null || message === undefined ? "" : message);
  if (/بنجاح/.test(m)) return "success";
  if (
    /حدث خطأ|يرجى|غير صحيحة|لا يمكن|يمكنك اختيار|أكبر من|حجم صورة|عدد صور/.test(m)
  )
    return "error";
  if (/للتثبيت يدوياً|ميزة التثبيت/.test(m)) return "info";
  return "info";
}

/**
 * Native `alert()` is replaced across the whole module by the design-system
 * toast. The module-level binding shadows `window.alert`; any external code
 * still gets the browser default because `window.alert` is untouched.
 */
const alert = (message) => showToast(message, inferToastType(message));

function showToast(message, type = "info", duration = 3800) {
  const stack = document.getElementById("toastStack");
  if (!stack) return;

  while (stack.children.length >= 3) {
    stack.removeChild(stack.firstElementChild);
  }

  const toast = document.createElement("div");
  toast.className = "toast is-" + type;

  const mark = document.createElement("span");
  mark.className = "toast-mark";

  const body = document.createElement("div");
  body.className = "toast-body";
  body.textContent = message === null || message === undefined ? "" : String(message);

  toast.appendChild(mark);
  toast.appendChild(body);
  stack.appendChild(toast);

  window.setTimeout(() => {
    if (!toast.isConnected) return;
    toast.classList.add("is-out");
    window.setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 200);
  }, duration);
}

function showConfirm(message, title = "تأكيد", confirmLabel = "تأكيد") {
  return new Promise(resolve => {
    const backdrop = document.getElementById("dialogBackdrop");
    const titleEl = document.getElementById("dialogTitle");
    const msgEl = document.getElementById("dialogMessage");
    const okBtn = document.getElementById("dialogConfirm");
    const cancelBtn = document.getElementById("dialogCancel");

    if (!backdrop || !okBtn || !cancelBtn) {
      resolve(window.confirm(message));
      return;
    }

    const previousFocus =
      document.activeElement && typeof document.activeElement.focus === "function"
        ? document.activeElement
        : null;

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    okBtn.textContent = confirmLabel;

    backdrop.hidden = false;
    document.body.classList.add("no-scroll");
    okBtn.focus();

    function close(value) {
      backdrop.hidden = true;
      document.body.classList.remove("no-scroll");
      okBtn.removeEventListener("click", onConfirm);
      cancelBtn.removeEventListener("click", onCancel);
      backdrop.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onKey);
      if (previousFocus) previousFocus.focus();
      resolve(value);
    }

    function onConfirm() { close(true); }
    function onCancel() { close(false); }
    function onBackdrop(event) { if (event.target === backdrop) close(false); }
    function onKey(event) {
      if (event.key === "Escape") { event.preventDefault(); close(false); }
      if (event.key === "Enter") { event.preventDefault(); close(true); }
    }

    okBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click", onCancel);
    backdrop.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKey);
  });
}

/* --- Gallery lightbox ------------------------------------------------- */
let lightboxImages = [];
let lightboxIndex = 0;

function openLightbox(list, index) {
  const box = document.getElementById("lightbox");
  if (!box || !list || list.length === 0) return;
  lightboxImages = list;
  lightboxIndex = Math.min(Math.max(index || 0, 0), list.length - 1);
  renderLightbox();
  box.hidden = false;
  document.body.classList.add("no-scroll");
}

function renderLightbox() {
  const img = document.getElementById("lightboxImg");
  const count = document.getElementById("lightboxCount");
  const prev = document.getElementById("lightboxPrev");
  const next = document.getElementById("lightboxNext");
  const total = lightboxImages.length;

  if (img) img.src = lightboxImages[lightboxIndex] || "";
  if (count) count.textContent = (lightboxIndex + 1) + " / " + total;

  const multi = total > 1;
  if (prev) prev.hidden = !multi;
  if (next) next.hidden = !multi;
}

function closeLightbox() {
  const box = document.getElementById("lightbox");
  if (!box) return;
  box.hidden = true;
  document.body.classList.remove("no-scroll");
}

function stepLightbox(delta) {
  if (lightboxImages.length === 0) return;
  lightboxIndex =
    (lightboxIndex + delta + lightboxImages.length) % lightboxImages.length;
  renderLightbox();
}

/* --- List states (skeleton / empty) ----------------------------------- */
/* One monoline food mark for every empty state: cutlery, never a cartoon. */
const EMPTY_MARK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M4 3v5a2 2 0 0 0 4 0V3"/>' +
    '<path d="M6 3v5"/>' +
    '<path d="M6 10v11"/>' +
    '<path d="M18 21V3"/>' +
    '<path d="M18 3c-2.2 1.2-3.4 3.4-3.4 5.8S16.4 12.6 18 13"/>' +
  "</svg>";

const EMPTY_ACTIONS = {
  browse: { label: "تصفح كل الأقسام", cls: "btn-primary" },
  clear: { label: "امسح البحث", cls: "btn-ghost" },
  retry: { label: "إعادة المحاولة", cls: "btn-ghost" }
};

/**
 * @param {string} title
 * @param {string} text
 * @param {string[]} [actions] keys of EMPTY_ACTIONS to render as CTAs
 */
function emptyStateHtml(title, text, actions) {
  let buttons = "";
  (actions || []).forEach(key => {
    const action = EMPTY_ACTIONS[key];
    if (!action) return;
    buttons +=
      '<button type="button" class="btn btn-sm ' + action.cls +
      '" data-empty-action="' + key + '">' + action.label + "</button>";
  });

  return (
    '<div class="empty" role="status">' +
      '<div class="empty-mark">' + EMPTY_MARK_SVG + "</div>" +
      '<div class="empty-title">' + title + "</div>" +
      '<div class="empty-text">' + text + "</div>" +
      (buttons ? '<div class="empty-actions">' + buttons + "</div>" : "") +
    "</div>"
  );
}

function renderCategorySkeleton() {
  const grid = document.getElementById("categoriesGridContainer");
  if (!grid) return;
  let html = "";
  for (let i = 0; i < 6; i++) {
    html +=
      '<div class="skel-card skel-cat">' +
        '<div class="skel skel-media"></div>' +
        '<div class="skel-body">' +
          '<div class="skel skel-line" style="width:72%"></div>' +
          '<div class="skel skel-line" style="width:44%"></div>' +
        "</div>" +
      "</div>";
  }
  grid.innerHTML = html;
}

/* Mirrors the real card: 16:9 cover + status/rating row + two text lines +
   the meta strip. Same padding, so the list does not jump when data lands. */
function renderRestaurantSkeleton() {
  const box = document.getElementById("restaurantsListContainer");
  if (!box) return;
  let html = "";
  for (let i = 0; i < 3; i++) {
    html +=
      '<div class="skel-card skel-rc">' +
        '<div class="skel skel-media"></div>' +
        '<div class="skel-body">' +
          '<div class="skel-row">' +
            '<div class="skel skel-chip"></div>' +
            '<div class="skel skel-rating"></div>' +
          "</div>" +
          '<div class="skel skel-line" style="width:84%"></div>' +
          '<div class="skel skel-line" style="width:56%"></div>' +
          '<div class="skel-meta"><div class="skel skel-line" style="width:48%"></div></div>' +
        "</div>" +
      "</div>";
  }
  box.innerHTML = html;
}

/* --- Image loading: photo develop + broken-image fallback --------------- */
function markImageLoaded(img) {
  if (!img || img.tagName !== "IMG") return;
  img.classList.remove("is-broken");
  if (img.naturalWidth > 0) img.classList.add("is-loaded");
}

/* Images already in the cache finish before any listener can see them. */
function sweepImages(root) {
  const scope = root || document;
  scope.querySelectorAll("img").forEach(img => {
    if (img.complete) markImageLoaded(img);
  });
}

document.addEventListener(
  "error",
  event => {
    const target = event.target;
    if (target && target.tagName === "IMG" && target.getAttribute("src")) {
      target.classList.add("is-broken");
      target.classList.remove("is-loaded");
    }
  },
  true
);

document.addEventListener(
  "load",
  event => {
    const target = event.target;
    if (target && target.tagName === "IMG") markImageLoaded(target);
  },
  true
);

/**
 * Clicking a <div> is invisible to keyboards and screen readers. This gives
 * the card list items the same semantics as a link without changing markup.
 */
function makeCardInteractive(el, handler) {
  if (!el) return;
  el.setAttribute("role", "button");
  el.tabIndex = 0;
  el.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      handler(event);
    }
  });
}

// ============================================================
// MOTION HELPERS (View Transitions, photo develop, one-shot feedback)
// ============================================================

function prefersReducedMotion() {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Drops the old frame so a new photo develops from its placeholder. */
function setImgSrc(img, src) {
  if (!img) return;
  const next = src || "";
  const current = img.getAttribute("src") || "";
  if (current === next) {
    markImageLoaded(img);
    return;
  }
  img.classList.remove("is-loaded", "is-broken");
  if (next) img.setAttribute("src", next);
  else img.removeAttribute("src");
  if (img.complete) requestAnimationFrame(() => markImageLoaded(img));
}

function decodeImage(src) {
  if (!src) return Promise.resolve();
  const img = new Image();
  img.src = src;
  if (typeof img.decode === "function") {
    return img.decode().catch(() => {});
  }
  return new Promise(resolve => {
    img.onload = img.onerror = resolve;
    setTimeout(resolve, 400);
  });
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(resolve, ms))
  ]);
}

/**
 * Runs `mutate` inside a View Transition so the photo that was tapped travels
 * into the destination photo. Without support (or with reduced motion) this is
 * just the mutation — the CSS page transition takes over.
 *
 * @param {HTMLImageElement|null} sourceImg tapped photo
 * @param {HTMLImageElement|null} targetImg photo it travels into
 * @param {string} decodeSrc URL the destination photo will use; the hold lasts
 *   only as long as that real decode needs
 * @param {Function} mutate DOM work (page switch)
 */
function runViewTransition(sourceImg, targetImg, decodeSrc, mutate) {
  if (typeof document.startViewTransition !== "function" || prefersReducedMotion()) {
    mutate();
    return;
  }

  const NAME = "food-photo";
  if (sourceImg) sourceImg.style.viewTransitionName = NAME;

  let transition;
  try {
    transition = document.startViewTransition(async () => {
      if (sourceImg) sourceImg.style.viewTransitionName = "";
      // Never an artificial delay: only until the photo is actually decodable.
      await withTimeout(decodeImage(decodeSrc), 200);
      mutate();
      if (targetImg) targetImg.style.viewTransitionName = NAME;
    });
  } catch (e) {
    if (sourceImg) sourceImg.style.viewTransitionName = "";
    mutate();
    return;
  }

  document.documentElement.classList.add("vt-running");
  const cleanup = () => {
    document.documentElement.classList.remove("vt-running");
    if (sourceImg) sourceImg.style.viewTransitionName = "";
    if (targetImg) targetImg.style.viewTransitionName = "";
  };
  transition.finished.then(cleanup, cleanup);
}

/** One-shot confirmation on the heart that was tapped. */
function popFavorite(btn) {
  if (!btn) return;
  btn.classList.remove("is-pop");
  void btn.offsetWidth;
  btn.classList.add("is-pop");
  window.setTimeout(() => btn.classList.remove("is-pop"), 480);
}

/** Haptic tick when favouriting — supported devices only, never under
 *  prefers-reduced-motion. */
function pulseFavorite() {
  if (prefersReducedMotion()) return;
  if (typeof navigator.vibrate === "function") {
    try {
      navigator.vibrate(8);
    } catch (e) {
      /* ignore */
    }
  }
}

/**
 * Rating bars fill once, the first time they scroll into view. Ratings inside
 * a page that is still hidden simply wait for it.
 */
let ratingObserver = null;
function armRatings(root) {
  const scope = root || document;
  const ratings = scope.querySelectorAll(".rating");
  if (!ratings.length) return;

  if (!("IntersectionObserver" in window)) {
    ratings.forEach(r => r.classList.add("is-shown"));
    return;
  }

  if (!ratingObserver) {
    ratingObserver = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-shown");
          ratingObserver.unobserve(entry.target);
        });
      },
      { threshold: 0.25 }
    );
  }

  ratings.forEach(r => {
    if (!r.classList.contains("is-shown")) ratingObserver.observe(r);
  });
}

// ============================================================
// LOAD ERRORS + RETRY (never a dead end)
// ============================================================

const LOAD_ERROR_COPY = {
  categories: {
    title: "تعذّر تحميل الأقسام",
    text: "في مشكلة بالاتصال أو بخدمة البيانات. جرّب مرة تانية."
  },
  restaurants: {
    title: "تعذّر تحميل المطاعم",
    text: "في مشكلة بالاتصال أو بخدمة البيانات. جرّب مرة تانية."
  }
};

function loadErrorHtml(kind) {
  const copy = LOAD_ERROR_COPY[kind];
  return emptyStateHtml(copy.title, copy.text, ["retry"]);
}

/* Both subscriptions report failures here instead of failing silently. */
function handleSnapshotError(kind, error) {
  if (error) console.error(kind + " onSnapshot:", error);

  if (kind === "categories") {
    categoriesLoaded = true;
    categoriesLoadFailed = true;
    filterCategories();
  } else {
    restaurantsLoaded = true;
    restaurantsLoadFailed = true;
    renderRestaurantsList("", false);
  }

  showToast("تعذّر تحميل البيانات. تحقّق من الاتصال وأعد المحاولة.", "error");
}

function retryLoad(kind) {
  if (kind === "categories") {
    if (typeof unsubscribeCategories === "function") {
      try {
        unsubscribeCategories();
      } catch (e) {
        /* ignore */
      }
    }
    unsubscribeCategories = null;
    categoriesLoadFailed = false;
    categoriesLoaded = false;
    renderCategorySkeleton();
    listenToCategories();
  } else {
    if (typeof unsubscribeRestaurants === "function") {
      try {
        unsubscribeRestaurants();
      } catch (e) {
        /* ignore */
      }
    }
    unsubscribeRestaurants = null;
    restaurantsLoadFailed = false;
    restaurantsLoaded = false;
    renderRestaurantSkeleton();
    listenToRestaurants();
  }
}

/* One delegated listener serves every empty/error state's CTAs. */
let emptyStateActionsWired = false;
function wireEmptyStateActions() {
  if (emptyStateActionsWired) return;
  emptyStateActionsWired = true;
  document.addEventListener("click", event => {
    const target = event.target;
    if (!target || !target.closest) return;
    const btn = target.closest("[data-empty-action]");
    if (!btn) return;

    const action = btn.getAttribute("data-empty-action");

    if (action === "browse") {
      showPage("pageCategories");
      return;
    }

    if (action === "clear") {
      const inCategories = !!btn.closest("#categoriesGridContainer");
      const input = document.getElementById(
        inCategories ? "categoriesSearchInput" : "restaurantsSearchInput"
      );
      if (!input) return;
      const wrap = input.closest(".search-field");
      const clearBtn = wrap && wrap.querySelector(".search-clear");
      if (clearBtn) clearBtn.click();
      else {
        input.value = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return;
    }

    if (action === "retry") {
      retryLoad(btn.closest("#categoriesGridContainer") ? "categories" : "restaurants");
    }
  });
}

// ============================================================
// PAGE NAVIGATION (WITH PERFECT REFRESH HANDLER & PARENT PAGE FIX)
// ============================================================

let pageHistory = [];

const PAGE_TITLES = {
  pageHome: "شو بدنا ناكل",
  pageCategories: "الأقسام",
  pageRestaurants: "المطاعم",
  pageRestProfile: "المطعم",
  pageLogin: "تسجيل الدخول",
  pageAdmin: "لوحة التحكم"
};

function getPageTitle(pageId) {
  return PAGE_TITLES[pageId] || "شو بدنا ناكل";
}

function showPage(pageId, isBack = false) {
  const currentPage = document.querySelector(".view-page.active");

  if (!isBack && currentPage && currentPage.id !== pageId) {
    pageHistory.push(currentPage.id);
  }

  document.querySelectorAll(".view-page").forEach(page => {
    page.classList.remove("active");
    page.style.display = "none";
  });

  const targetPage = document.getElementById(pageId);
  if (targetPage) {
    // Direction of the entering transition: forward from below, back from above.
    targetPage.classList.toggle("is-back", !!isBack);
    targetPage.classList.add("active");
    targetPage.style.display = "block";
  }

  const backBtn = document.getElementById("backBtn");
  if (backBtn) {
    backBtn.style.display = (pageId === "pageHome") ? "none" : "flex";
  }

  // Homepage-only atmosphere (blue gradient + centred app-bar brand line)
  document.body.classList.toggle("is-home", pageId === "pageHome");

  // Dynamic app-bar title — presentation only, with a short crossfade so the
  // bar reads as part of the transition instead of a hard text swap.
  const titleEl = document.getElementById("headerTitleText");
  if (titleEl) {
    const nextPageTitle = getPageTitle(pageId);
    if (titleEl.textContent !== nextPageTitle) {
      titleEl.classList.remove("is-swap");
      void titleEl.offsetWidth;
      titleEl.classList.add("is-swap");
    }
    titleEl.textContent = nextPageTitle;
    titleEl.dir = "auto";
  }

  // 1. حفظ الصفحة الحالية في رابط الـ URL عبر الـ Hash
  window.location.hash = pageId;
  // 2. حفظ اسم الصفحة في ذاكرة المتصفح للنسخ الاحتياطي
  localStorage.setItem("lastActivePage", pageId);

  // === حفظ الصفحة الأب (Parent Page) لضمان عمل زر الرجوع بدقة بعد الـ Refresh ===
  if (pageId === "pageRestaurants") {
    localStorage.setItem("parentPage", "pageCategories");
  } else if (pageId === "pageRestProfile") {
    localStorage.setItem("parentPage", "pageRestaurants");
  } else if (pageId === "pageCategories" || pageId === "pageAdmin" || pageId === "pageLogin") {
    localStorage.setItem("parentPage", "pageHome");
  }

  // فتح صفحة المطاعم: خلط القائمة، أو هيكل التحميل عند الدخول المباشر
  if (pageId === "pageRestaurants") {
    if (currentCategoryFilter) {
      renderRestaurantsList("", true);
    } else if (!restaurantsLoaded) {
      renderRestaurantSkeleton();
    } else {
      renderRestaurantsList("", false);
    }
  }

  window.scrollTo(0, 0);

  // Section headings settle in behind the page transition.
  revealActivePage(targetPage);
}

function goBack() {
  if (pageHistory.length > 0) {
    const previousPage = pageHistory.pop();
    showPage(previousPage, true);
  } else {
    // العودة للصفحة الأب المخزنة بدلاً من الرئيسية مباشرة عند عمل Refresh
    const parentPage = localStorage.getItem("parentPage") || "pageHome";
    showPage(parentPage, true);
  }
}

function openCategories() {
  showPage("pageCategories");
}

// ------------------------------------------------------------
// الحفاظ على الصفحة عند عمل Refresh أو فتح رابط مباشر
// ------------------------------------------------------------
function loadPageFromHash() {
  // تفريغ حقول الدخول للأدمن لمنع ظهور admin1 عند الـ Refresh
  const unEl = document.getElementById("loginUsername");
  const pwEl = document.getElementById("loginPassword");
  if (unEl) unEl.value = "";
  if (pwEl) pwEl.value = "";

  const hash = window.location.hash.replace("#", "");
  const savedPage = localStorage.getItem("lastActivePage");
  
  const pageToLoad = (hash && document.getElementById(hash)) ? hash : (savedPage && document.getElementById(savedPage) ? savedPage : "pageHome");

  // تفعيل الصفحة بدون إضافة سجل مضاعف
  showPage(pageToLoad, true);

  // إذا كانت الصفحة الحالية هي صفحة البروفايل وتم عمل Refresh، نسترجع بيانات المطعم المحفوظة
  if (pageToLoad === "pageRestProfile") {
    const savedRestData = localStorage.getItem("currentRestaurantProfile");
    if (savedRestData) {
      try {
        const r = JSON.parse(savedRestData);
        fillRestaurantProfileDOM(r);
      } catch (e) {
        console.error(e);
      }
    }
  }
}

window.addEventListener("DOMContentLoaded", loadPageFromHash);

window.addEventListener("hashchange", () => {
  const hash = window.location.hash.replace("#", "");
  if (hash && document.getElementById(hash)) {
    const currentPage = document.querySelector(".view-page.active");
    if (!currentPage || currentPage.id !== hash) {
      showPage(hash, true);
    }
  }
});

// ============================================================
// CATEGORY FORM
// ============================================================

function resetCategoryForm() {

  const editCatDocId =
    document.getElementById("editCatDocId");

  const adminCatAr =
    document.getElementById("adminCatAr");

  const adminCatEn =
    document.getElementById("adminCatEn");

  const adminCatOrder =
    document.getElementById("adminCatOrder");

  const adminCatImg =
    document.getElementById("adminCatImg");

  const adminCatFile =
    document.getElementById("adminCatFile");

  const catPreview =
    document.getElementById("catPreview");

  const categoryFormTitle =
    document.getElementById("categoryFormTitle");


  if (editCatDocId)
    editCatDocId.value = "";

  if (adminCatAr)
    adminCatAr.value = "";

  if (adminCatEn)
    adminCatEn.value = "";

  if (adminCatOrder)
    adminCatOrder.value = "";

  if (adminCatImg)
    adminCatImg.value = "";

  if (adminCatFile)
    adminCatFile.value = "";

  if (catPreview) {
    catPreview.src = "";
    catPreview.style.display = "none";
  }

  if (categoryFormTitle)
    categoryFormTitle.innerText =
      "إضافة / تعديل قسم";
}


async function saveCategoryToFirebase() {

  const docId =
    document.getElementById("editCatDocId")?.value;

  const nameAr =
    document.getElementById("adminCatAr")?.value.trim();

  const nameEn =
    document.getElementById("adminCatEn")?.value.trim();

  const orderVal =
    document.getElementById("adminCatOrder")?.value.trim();

  const manualImg =
    document.getElementById("adminCatImg")?.value.trim();

  const catFile =
    document.getElementById("adminCatFile")?.files?.[0];


  if (!nameAr || !nameEn) {

    alert(
      "يرجى إدخال اسم القسم بالعربي والإنجليزي"
    );

    return;
  }


  try {

    let finalImg = manualImg || "";

    if (catFile) {
      const uploadedCatImg = await uploadRestaurantImage(catFile, "category_imgs", "cat");
      if (uploadedCatImg) {
        finalImg = uploadedCatImg.url;
      }
    }

    const categoryOrder = orderVal !== "" ? parseInt(orderVal, 10) : 999;

    if (docId) {

      await updateDoc(
        doc(db, "categories", docId),
        {
          nameAr,
          nameEn,
          order: categoryOrder,
          imgUrl: finalImg
        }
      );


      alert("تم تعديل القسم بنجاح!");

    } else {

      await addDoc(
        collection(db, "categories"),
        {
          nameAr,
          nameEn,
          order: categoryOrder,
          imgUrl: finalImg,
          createdAt: new Date()
        }
      );


      alert("تم إضافة القسم بنجاح!");

    }


    resetCategoryForm();


  } catch (error) {

    console.error(
      "Error saving category:",
      error
    );

    alert(
      "حدث خطأ أثناء حفظ القسم:\n\n" +
      error.message
    );

  }
}


function editCategory(
  id,
  nameAr,
  nameEn,
  order,
  imgUrl
) {

  const editCatDocId =
    document.getElementById("editCatDocId");

  const adminCatAr =
    document.getElementById("adminCatAr");

  const adminCatEn =
    document.getElementById("adminCatEn");

  const adminCatOrder =
    document.getElementById("adminCatOrder");

  const adminCatImg =
    document.getElementById("adminCatImg");

  const catPreview =
    document.getElementById("catPreview");

  const categoryFormTitle =
    document.getElementById("categoryFormTitle");


  if (editCatDocId)
    editCatDocId.value = id;

  if (adminCatAr)
    adminCatAr.value = nameAr || "";

  if (adminCatEn)
    adminCatEn.value = nameEn || "";

  if (adminCatOrder)
    adminCatOrder.value = order !== undefined && order !== null ? order : "";

  if (adminCatImg)
    adminCatImg.value = imgUrl || "";

  if (catPreview) {
    catPreview.src = imgUrl || "";
    catPreview.style.display = imgUrl ? "block" : "none";
  }

  if (categoryFormTitle)
    categoryFormTitle.innerText =
      "تعديل قسم";
}


async function deleteCategoryFromFirebase(id) {

  const confirmed = await showConfirm(
    "هل أنت متأكد من حذف هذا القسم؟",
    "حذف القسم",
    "حذف"
  );

  if (confirmed) {

    try {

      await deleteDoc(
        doc(db, "categories", id)
      );


      alert(
        "تم حذف القسم بنجاح"
      );


    } catch (error) {

      console.error(
        "Error deleting category:",
        error
      );

      alert(
        "حدث خطأ أثناء الحذف"
      );

    }

  }
}


// ============================================================
// RESTAURANT FORM RESET
// ============================================================

function resetAdminForm() {

  const editDocId =
    document.getElementById("editDocId");

  const adminCategory =
    document.getElementById("adminCategory");

  const adminName =
    document.getElementById("adminName");

  const adminDesc =
    document.getElementById("adminDesc");

  const adminOpenTime =
    document.getElementById("adminOpenTime");

  const adminCloseTime =
    document.getElementById("adminCloseTime");

  const adminCover =
    document.getElementById("adminCover");

  const adminLogo =
    document.getElementById("adminLogo");

  const adminGallery =
    document.getElementById("adminGallery");

  const adminPhone =
    document.getElementById("adminPhone");

  const adminMenu =
    document.getElementById("adminMenu");

  const adminMap =
    document.getElementById("adminMap");

  const adminCoverFile =
    document.getElementById("adminCoverFile");

  const adminLogoFile =
    document.getElementById("adminLogoFile");

  const adminGalleryFiles =
    document.getElementById("adminGalleryFiles");

  const coverPreview =
    document.getElementById("coverPreview");

  const logoPreview =
    document.getElementById("logoPreview");

  const galleryPreview =
    document.getElementById("galleryPreview");

  const formTitle =
    document.getElementById("formTitle");


  if (editDocId)
    editDocId.value = "";

  if (adminCategory)
    adminCategory.value = "";

  if (adminName)
    adminName.value = "";

  if (adminDesc)
    adminDesc.value = "";

  if (adminOpenTime)
    adminOpenTime.value = "11:00";

  if (adminCloseTime)
    adminCloseTime.value = "02:00";

  if (adminCover)
    adminCover.value = "";

  if (adminLogo)
    adminLogo.value = "";

  if (adminGallery)
    adminGallery.value = "";

  if (adminPhone)
    adminPhone.value = "";

  if (adminMenu)
    adminMenu.value = "";

  if (adminMap)
    adminMap.value = "";


  setAdminRating(0);


  if (adminCoverFile)
    adminCoverFile.value = "";


  if (adminLogoFile)
    adminLogoFile.value = "";


  if (adminGalleryFiles)
    adminGalleryFiles.value = "";


  if (coverPreview) {
    coverPreview.src = "";
    coverPreview.style.display = "none";
  }


  if (logoPreview) {

    logoPreview.src = "";

    logoPreview.style.display = "none";

  }


  if (galleryPreview) {

    galleryPreview.innerHTML = "";

  }


  if (formTitle)
    formTitle.innerText =
      "إضافة مطعم جديد";
}


// ============================================================
// FIREBASE STORAGE
// ============================================================

function createSafeFileName(fileName) {

  return fileName
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_");

}


function createUniqueFileName(fileName) {

  const extension =
    fileName.includes(".")
      ? "." + fileName.split(".").pop()
      : "";

  const baseName =
    fileName
      .replace(/\.[^/.]+$/, "")
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .substring(0, 60);

  return (
    Date.now() +
    "_" +
    Math.random()
      .toString(36)
      .substring(2, 10) +
    "_" +
    baseName +
    extension
  );

}


async function uploadRestaurantImage(
  file,
  restaurantId,
  folder
) {

  if (!file) {

    return null;

  }


  if (!file.type.startsWith("image/")) {

    throw new Error(
      `"${file.name}" is not an image.`
    );

  }


  if (file.size > MAX_IMAGE_SIZE) {

    throw new Error(
      `"${file.name}" أكبر من 5 MB. الحد الأقصى للصورة هو 5 MB.`
    );

  }


  const uniqueName =
    createUniqueFileName(
      createSafeFileName(file.name)
    );


  const storagePath =
    `restaurant-images/${restaurantId}/${folder}/${uniqueName}`;


  const storageRef =
    ref(storage, storagePath);


  await uploadBytes(
    storageRef,
    file,
    {
      contentType: file.type
    }
  );


  const downloadURL =
    await getDownloadURL(storageRef);


  return {
    url: downloadURL,
    path: storagePath
  };

}


// ============================================================
// UPLOAD COVER & LOGO
// ============================================================

async function uploadRestaurantCover(file, restaurantId) {
  if (!file) return null;
  return await uploadRestaurantImage(file, restaurantId, "cover");
}

async function uploadRestaurantLogo(
  file,
  restaurantId
) {

  if (!file) {

    return null;

  }


  return await uploadRestaurantImage(
    file,
    restaurantId,
    "logo"
  );

}


// ============================================================
// UPLOAD GALLERY
// ============================================================

async function uploadRestaurantGallery(
  files,
  restaurantId
) {

  if (
    !files ||
    files.length === 0
  ) {

    return [];

  }


  if (files.length > MAX_GALLERY_IMAGES) {

    throw new Error(
      "يمكنك رفع 20 صورة كحد أقصى للمعرض."
    );

  }


  const results = [];


  for (const file of files) {

    const result =
      await uploadRestaurantImage(
        file,
        restaurantId,
        "gallery"
      );


    if (result) {

      results.push(result);

    }

  }


  return results;

}


// ============================================================
// SAVE RESTAURANT
// ============================================================

async function saveRestaurantToFirebase() {

  const docId =
    document.getElementById("editDocId")?.value.trim();

  const category =
    document.getElementById("adminCategory")?.value;

  const name =
    document.getElementById("adminName")?.value.trim();

  const desc =
    document.getElementById("adminDesc")?.value.trim();

  const openTime =
    document.getElementById("adminOpenTime")?.value || "11:00";

  const closeTime =
    document.getElementById("adminCloseTime")?.value || "02:00";

  const manualCover =
    document.getElementById("adminCover")?.value.trim();

  const manualLogo =
    document.getElementById("adminLogo")?.value.trim();

  const manualGallery =
    document.getElementById("adminGallery")?.value.trim();

  const coverFile =
    document.getElementById("adminCoverFile")?.files?.[0];

  const logoFile =
    document.getElementById(
      "adminLogoFile"
    )?.files?.[0];

  const galleryFiles =
    document.getElementById(
      "adminGalleryFiles"
    )?.files;

  const phone =
    document.getElementById("adminPhone")?.value.trim();

  const menu =
    document.getElementById("adminMenu")?.value.trim();

  const map =
    document.getElementById("adminMap")?.value.trim();

  const rating =
    getAdminRating();


  if (!name || !category) {

    alert(
      "يرجى كتابة اسم المطعم واختيار القسم على الأقل"
    );

    return;

  }


  let finalGallery =
    manualGallery
      ? manualGallery
          .split(",")
          .map(item => item.trim())
          .filter(Boolean)
      : [];


  const selectedGalleryCount =
    galleryFiles
      ? galleryFiles.length
      : 0;


  const totalGalleryCount =
    finalGallery.length +
    selectedGalleryCount;


  if (
    totalGalleryCount >
    MAX_GALLERY_IMAGES
  ) {

    alert(
      `يمكنك إضافة 20 صورة كحد أقصى للمطعم.\n\n` +
      `الصور الموجودة: ${finalGallery.length}\n` +
      `الصور الجديدة: ${selectedGalleryCount}\n` +
      `المجموع: ${totalGalleryCount}`
    );

    return;

  }


  const saveButton =
    document.querySelector(
      'button[onclick="window.saveRestaurantToFirebase()"]'
    );


  if (saveButton) {

    saveButton.disabled = true;

    saveButton.innerHTML =
      '<span class="spinner" aria-hidden="true"></span>جارٍ رفع الصور…';

  }


  try {

    if (!docId) {

      const newRestaurantRef =
        doc(
          collection(
            db,
            "restaurants"
          )
        );


      const restaurantId =
        newRestaurantRef.id;


      let finalCover = manualCover || "";
      let coverStoragePath = "";

      if (coverFile) {
        const uploadedCover = await uploadRestaurantCover(coverFile, restaurantId);
        if (uploadedCover) {
          finalCover = uploadedCover.url;
          coverStoragePath = uploadedCover.path;
        }
      }

      let finalLogo =
        manualLogo || "";


      let logoStoragePath =
        "";


      if (logoFile) {

        const uploadedLogo =
          await uploadRestaurantLogo(
            logoFile,
            restaurantId
          );


        if (uploadedLogo) {

          finalLogo =
            uploadedLogo.url;

          logoStoragePath =
            uploadedLogo.path;

        }

      }


      const galleryStoragePaths = [];


      if (
        galleryFiles &&
        galleryFiles.length > 0
      ) {

        const uploadedGallery =
          await uploadRestaurantGallery(
            galleryFiles,
            restaurantId
          );


        uploadedGallery.forEach(
          image => {

            if (image?.url) {

              finalGallery.push(
                image.url
              );

            }

            if (image?.path) {

              galleryStoragePaths.push(
                image.path
              );

            }

          }
        );

      }


      const newRestaurantData = {

        category,

        name,

        desc,

        openTime,

        closeTime,

        cover: finalCover,

        logo:
          finalLogo,

        gallery:
          finalGallery,

        phone,

        menu,

        map,

        rating,

        coverStoragePath,

        logoStoragePath,

        galleryStoragePaths,

        createdAt:
          new Date(),

        updatedAt:
          new Date()

      };


      await setDoc(
        newRestaurantRef,
        newRestaurantData
      );


      alert(
        "تم إضافة المطعم ورفع الصور بنجاح!"
      );


      resetAdminForm();


      return;

    }


    let finalCover = manualCover || "";
    let finalCoverStoragePath = "";

    let finalLogo =
      manualLogo || "";


    let finalLogoStoragePath = "";


    const existingRestaurant =
      allRestaurants.find(
        restaurant =>
          restaurant.id === docId
      );


    if (existingRestaurant) {

      finalCover = manualCover || existingRestaurant.cover || "";
      finalCoverStoragePath = existingRestaurant.coverStoragePath || "";

      finalLogo =
        manualLogo ||
        existingRestaurant.logo ||
        "";

      finalLogoStoragePath =
        existingRestaurant.logoStoragePath ||
        "";

    }


    if (coverFile) {
      const uploadedCover = await uploadRestaurantCover(coverFile, docId);
      if (uploadedCover) {
        finalCover = uploadedCover.url;
        finalCoverStoragePath = uploadedCover.path;
      }
    }


    if (logoFile) {

      const uploadedLogo =
        await uploadRestaurantLogo(
          logoFile,
          docId
        );


      if (uploadedLogo) {

        finalLogo =
          uploadedLogo.url;

        finalLogoStoragePath =
          uploadedLogo.path;

      }

    }


    let existingGallery =
      [];


    let existingGalleryStoragePaths =
      [];


    if (existingRestaurant) {

      existingGallery =
        Array.isArray(
          existingRestaurant.gallery
        )
          ? existingRestaurant.gallery
          : [];

      existingGalleryStoragePaths =
        Array.isArray(
          existingRestaurant.galleryStoragePaths
        )
          ? existingRestaurant.galleryStoragePaths
          : [];

    }


    if (manualGallery) {

      existingGallery =
        manualGallery
          .split(",")
          .map(item => item.trim())
          .filter(Boolean);

    } else {

      existingGallery = [];

    }


    if (
      existingGallery.length +
      selectedGalleryCount >
      MAX_GALLERY_IMAGES
    ) {

      alert(
        "لا يمكن أن يتجاوز عدد صور المعرض 20 صورة."
      );

      return;

    }


    if (
      galleryFiles &&
      galleryFiles.length > 0
    ) {

      const uploadedGallery =
        await uploadRestaurantGallery(
          galleryFiles,
          docId
        );


      uploadedGallery.forEach(
        image => {

          if (image?.url) {

            existingGallery.push(
              image.url
            );

          }

          if (image?.path) {

            existingGalleryStoragePaths.push(
              image.path
            );

          }

        }
      );

    }


    const restaurantData = {

      category,

      name,

      desc,

      openTime,

      closeTime,

      cover: finalCover,

      logo:
        finalLogo,

      gallery:
        existingGallery,

      phone,

      menu,

      map,

      rating,

      coverStoragePath: finalCoverStoragePath,

      logoStoragePath:
        finalLogoStoragePath,

      galleryStoragePaths:
        existingGalleryStoragePaths,

      updatedAt:
        new Date()

    };


    await updateDoc(
      doc(
        db,
        "restaurants",
        docId
      ),
      restaurantData
    );


    alert(
      "تم تحديث المطعم ورفع الصور بنجاح!"
    );


    resetAdminForm();


  } catch (error) {

    console.error(
      "Error saving restaurant:",
      error
    );


    alert(
      "حدث خطأ أثناء حفظ المطعم أو رفع الصورة:\n\n" +
      error.message
    );


  } finally {

    if (saveButton) {

      saveButton.disabled =
        false;

      saveButton.innerText =
        "حفظ المطعم";

    }

  }

}


// ============================================================
// DELETE RESTAURANT
// ============================================================

async function deleteRestaurantFromFirebase(id) {

  const confirmed = await showConfirm(
    "هل أنت متأكد من حذف هذا المطعم؟",
    "حذف المطعم",
    "حذف"
  );

  if (confirmed) {

    try {

      await deleteDoc(
        doc(
          db,
          "restaurants",
          id
        )
      );


      alert(
        "تم الحذف بنجاح"
      );


    } catch (error) {

      console.error(
        "Error deleting restaurant:",
        error
      );


      alert(
        "حدث خطأ أثناء الحذف"
      );

    }

  }

}


// ============================================================
// ADMIN LOGIN
// ============================================================

/* The footer copyright is a hidden entry point: it now needs five
   taps/clicks inside a short window, so nobody opens it by accident. */
const FOOTER_TAP_TARGET = 5;
const FOOTER_TAP_WINDOW = 1200; // ms allowed between two consecutive taps

let footerTapCount = 0;
let footerTapLastAt = 0;
let footerTapResetTimer = null;

function handleFooterTap(event) {
  if (event && typeof event.preventDefault === "function") {
    event.preventDefault();
  }

  const now = Date.now();

  // A gap longer than the window restarts the sequence from scratch.
  if (footerTapCount > 0 && now - footerTapLastAt > FOOTER_TAP_WINDOW) {
    footerTapCount = 0;
  }

  footerTapLastAt = now;
  footerTapCount += 1;

  if (footerTapResetTimer) clearTimeout(footerTapResetTimer);
  footerTapResetTimer = setTimeout(() => {
    footerTapCount = 0;
    footerTapResetTimer = null;
  }, FOOTER_TAP_WINDOW);

  if (footerTapCount >= FOOTER_TAP_TARGET) {
    footerTapCount = 0;
    footerTapLastAt = 0;
    if (footerTapResetTimer) clearTimeout(footerTapResetTimer);
    footerTapResetTimer = null;
    checkAdminAccess();
  }
}

function checkAdminAccess() {

  const isAdmin =
    sessionStorage.getItem(
      "isAdminLoggedIn"
    );


  if (isAdmin === "true") {

    showPage("pageAdmin");

  } else {

    if (
      document.getElementById(
        "loginUsername"
      )
    ) {

      document.getElementById(
        "loginUsername"
      ).value = "";

    }


    if (
      document.getElementById(
        "loginPassword"
      )
    ) {

      document.getElementById(
        "loginPassword"
      ).value = "";

    }


    showPage("pageLogin");

  }

}


function performAdminLogin() {

  const user =
    document.getElementById(
      "loginUsername"
    )?.value;

  const pass =
    document.getElementById(
      "loginPassword"
    )?.value;


  if (
    user === "admin1" &&
    pass === "70725"
  ) {

    sessionStorage.setItem(
      "isAdminLoggedIn",
      "true"
    );


    showPage("pageAdmin");

  } else {

    alert(
      "اسم المستخدم أو كلمة المرور غير صحيحة"
    );

  }

}


function logoutAdmin() {

  sessionStorage.removeItem(
    "isAdminLoggedIn"
  );


  showPage("pageHome");

}


// ============================================================
// FILTER CATEGORIES
// ============================================================

function filterCategories() {

  const queryStr =
    document.getElementById(
      "categoriesSearchInput"
    )?.value
      .toLowerCase()
      .trim();


  const grid =
    document.getElementById(
      "categoriesGridContainer"
    );


  if (!grid)
    return;


  grid.innerHTML = "";


  const filtered =
    allCategories.filter(c =>

      (
        c.nameAr &&
        c.nameAr
          .toLowerCase()
          .includes(queryStr)
      )

      ||

      (
        c.nameEn &&
        c.nameEn
          .toLowerCase()
          .includes(queryStr)
      )

    );


  if (filtered.length === 0) {

    if (!categoriesLoaded) {
      renderCategorySkeleton();
      return;
    }

    if (categoriesLoadFailed) {
      grid.innerHTML = loadErrorHtml("categories");
      return;
    }

    grid.innerHTML = queryStr
      ? emptyStateHtml(
          "لا توجد نتائج",
          "ما لقينا قسم بهذا الاسم. جرّب كلمة تانية.",
          ["clear"]
        )
      : emptyStateHtml(
          "لا توجد أقسام بعد",
          "أضف الأقسام من لوحة الإدارة، ومنرجع تاني."
        );

    return;

  }


  filtered.forEach((data, index) => {

    const card =
      document.createElement("div");


    card.className =
      "category-card";

    if (!queryStr && index < 6) {
      card.classList.add("stagger-in");
      card.style.setProperty("--i", index);
    }

    const pair = pickArabicPair(data.nameAr, data.nameEn);

    card.onclick = (event) =>
      openRestaurantsByCategory(
        data.id,
        data.nameAr ||
          data.nameEn,
        data.imgUrl,
        event
      );

    makeCardInteractive(card, card.onclick);

    const catImg = data.imgUrl
      ? `<img class="fade-img"
          src="${escapeHtml(data.imgUrl)}"
          alt="${escapeHtml(pair[0])}"
          loading="lazy"
          decoding="async"
        >`
      : "";

    card.innerHTML = `

      <div class="cat-media">
        ${catImg}
      </div>

      <div class="cat-body">
        <span class="cat-name">${escapeHtml(pair[0])}</span>
        <svg class="cat-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
      </div>

      ${
        pair[1]
          ? `<div class="cat-en">${escapeHtml(pair[1])}</div>`
          : ""
      }

    `;


    grid.appendChild(card);

  });

  sweepImages(grid);

  renderHomeCategories();
  fixRegionImage();

}


// ============================================================
// FILTER RESTAURANTS
// ============================================================

function filterRestaurants() {

  const queryStr =
    document.getElementById(
      "restaurantsSearchInput"
    )?.value
      .toLowerCase()
      .trim();


  renderRestaurantsList(
    queryStr,
    false
  );

}


// ============================================================
// MOTION: shared helpers + shell-ready gate
// ============================================================

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const ARABIC_RE = /[\u0600-\u06FF]/;

/** The two name fields arrive swapped in live data. Whichever one is Arabic
 *  becomes the primary label, the other one sits underneath. */
function pickArabicPair(a, b) {
  const x = String(a || "").trim();
  const y = String(b || "").trim();
  if (!x && !y) return ["", ""];
  if (!x) return [y, ""];
  if (!y) return [x, ""];
  return ARABIC_RE.test(x) ? [x, y] : [y, x];
}

function withAlpha(hex, alpha) {
  let h = String(hex || "").replace("#", "").trim();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return `rgba(25,169,157,${alpha})`;
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Callbacks that must not fire before the launch screen is gone. */
let shellReadyFired = false;
const shellReadyQueue = [];
function whenShellReady(cb) {
  if (typeof cb !== "function") return;
  if (shellReadyFired) {
    cb();
    return;
  }
  shellReadyQueue.push(cb);
}
function fireShellReady() {
  if (shellReadyFired) return;
  shellReadyFired = true;
  while (shellReadyQueue.length) {
    try {
      shellReadyQueue.shift()();
    } catch (e) {
      /* never let one callback block the rest */
    }
  }
}

// ============================================================
// MOTION: launch splash — the mark assembles, one pass of light, hand-off
// ============================================================

const SPLASH_SEEN_KEY = "shu_badna_nekol_splash_seen";
// The choreography below (mark 620ms, rim 780ms, light pass 900ms) has to be
// able to finish before the screen leaves — 500ms was cutting the wordmark off
// mid-fade and the tagline never appeared at all.
const SPLASH_MIN_MS = 960;
const SPLASH_MAX_MS = 1300;

function initSplash() {
  const splash = document.getElementById("splash");

  let seen = false;
  try {
    seen = sessionStorage.getItem(SPLASH_SEEN_KEY) === "1";
  } catch (e) {
    seen = false;
  }

  if (!splash || seen || prefersReducedMotion()) {
    if (splash) splash.remove();
    fireShellReady();
    return;
  }

  try {
    sessionStorage.setItem(SPLASH_SEEN_KEY, "1");
  } catch (e) {
    /* private mode — worst case the screen shows again */
  }

  splash.hidden = false;

  const startedAt = performance.now();
  let dismissed = false;
  const finish = () => {
    if (dismissed) return;
    dismissed = true;
    dismissSplash(splash);
  };

  // Only the shell and the mark itself — never Firestore, never the full
  // resource load, and always capped so it can never feel like a stall.
  const shellReady =
    document.readyState === "loading"
      ? new Promise(resolve =>
          document.addEventListener("DOMContentLoaded", resolve, { once: true })
        )
      : Promise.resolve();

  Promise.race([
    Promise.all([shellReady, decodeImage("iconnn.jpeg")]),
    new Promise(resolve => setTimeout(resolve, SPLASH_MAX_MS))
  ]).then(() => {
    const elapsed = performance.now() - startedAt;
    setTimeout(finish, Math.max(0, SPLASH_MIN_MS - elapsed));
  });

  setTimeout(finish, SPLASH_MAX_MS + 500);
}

function dismissSplash(splash) {
  const mark = splash.querySelector(".splash-logo");
  const target = document.querySelector(".masthead-logo");
  const clearNames = () => {
    if (mark) mark.style.viewTransitionName = "";
    if (target) target.style.viewTransitionName = "";
  };

  let handedOff = false;
  if (
    typeof document.startViewTransition === "function" &&
    !prefersReducedMotion() &&
    target
  ) {
    try {
      if (mark) mark.style.viewTransitionName = "brand-mark";
      target.style.viewTransitionName = "brand-mark";
      const transition = document.startViewTransition(() => splash.remove());
      transition.finished.then(clearNames, clearNames);
      handedOff = true;
    } catch (e) {
      clearNames();
    }
  }

  if (!handedOff) {
    splash.classList.add("is-leaving");
    setTimeout(() => splash.remove(), 420);
  }

  // The homepage entrance choreography starts the moment the screen lifts.
  fireShellReady();
}

// ============================================================
// MOTION: category food moment — artwork, matching, scene controller
// ============================================================

const FOOD_HUE = {
  pizza: "#e8613c",
  burger: "#f0a13c",
  snack: "#f0a13c",
  shawarma: "#d98b3f",
  sushi: "#4fc3b6",
  chicken: "#f0b429",
  pasta: "#f2c94c",
  dessert: "#e97ba6",
  coffee: "#c08a5e",
  drinks: "#5ec8e5",
  lebanese: "#e0553f",
  seafood: "#4aa3d8",
  bakery: "#e0a860",
  breakfast: "#f5c451",
  generic: null
};

const FOOD_ALIAS = { snack: "burger" };

/** Editorial line drawings, 160×160, built from seven roles:
 *  .o outline · .n neutral line · .of filled outline · .f/.f2/.d/.s washes ·
 *  .w white · .sh contact shadow — plus motion roles .fa-step/.fa-slide/
 *  .fa-pop/.fa-draw/.fa-shade/.fa-liquid/.fa-tilt/.fa-wedge. */
const FOOD_ART = {
  pizza: `
    <ellipse class="sh" cx="80" cy="146" rx="48" ry="6"/>
    <path class="of" d="M80 76 L99.2 23.4 A56 56 0 1 0 135.2 66.3 Z"/>
    <path class="f2" d="M80 76 L95.4 33.7 A45 45 0 1 0 124.3 68.2 Z"/>
    <circle class="s fa-pop" style="--si:0" cx="60" cy="54" r="6.5"/>
    <circle class="s fa-pop" style="--si:1" cx="54" cy="96" r="6"/>
    <circle class="s fa-pop" style="--si:1" cx="94" cy="104" r="6.5"/>
    <circle class="s fa-pop" style="--si:2" cx="74" cy="120" r="5.5"/>
    <circle class="s fa-pop" style="--si:2" cx="58" cy="76" r="5"/>
    <g class="fa-wedge">
      <path class="of" d="M80 76 L99.2 23.4 A56 56 0 0 1 135.2 66.3 Z"/>
      <circle class="s" cx="106" cy="54" r="6"/>
      <circle class="s" cx="113" cy="64" r="5"/>
    </g>
  `,

  burger: `
    <ellipse class="sh" cx="80" cy="142" rx="46" ry="6"/>
    <g class="fa-step" style="--si:0">
      <path class="of" d="M32 116 H128 a10 10 0 0 1 -10 14 H42 a10 10 0 0 1 -10 -14 Z"/>
    </g>
    <g class="fa-step" style="--si:1">
      <rect class="d" x="34" y="96" width="92" height="20" rx="10"/>
    </g>
    <g class="fa-step" style="--si:2">
      <path class="s" d="M34 86 h92 v10 H34 Z"/>
      <path class="s" d="M50 96 l6 11 l6 -11 Z"/>
      <path class="s" d="M98 96 l6 11 l6 -11 Z"/>
    </g>
    <g class="fa-step" style="--si:3">
      <path class="s" d="M34 78 h92 v2 q-11 12 -23 0 q-11 12 -23 0 q-11 12 -23 0 q-11 12 -23 0 Z"/>
      <path class="of" d="M34 78 A46 40 0 0 1 126 78 Z"/>
      <ellipse class="w" cx="64" cy="60" rx="4.6" ry="3" transform="rotate(-18 64 60)"/>
      <ellipse class="w" cx="86" cy="54" rx="4.6" ry="3"/>
      <ellipse class="w" cx="106" cy="64" rx="4.6" ry="3" transform="rotate(20 106 64)"/>
    </g>
  `,

  shawarma: `
    <ellipse class="sh" cx="80" cy="142" rx="42" ry="6"/>
    <g class="fa-tilt">
      <path class="of" d="M46 34 Q80 22 114 34 L98 116 Q80 132 62 116 Z"/>
      <path class="n fa-draw" pathLength="1" d="M52 58 Q80 68 108 58"/>
      <path class="n fa-draw" pathLength="1" d="M56 82 Q80 92 104 82"/>
      <path class="n fa-draw" pathLength="1" d="M61 104 Q80 114 99 104"/>
      <path class="o fa-draw" pathLength="1" d="M80 30 V124"/>
    </g>
    <path class="n fa-draw" pathLength="1" d="M54 136 H106"/>
  `,

  sushi: `
    <ellipse class="sh" cx="80" cy="132" rx="56" ry="7"/>
    <path class="n fa-draw" pathLength="1" d="M20 116 H140"/>
    <g class="fa-slide" style="--si:0">
      <path class="w" d="M24 90 h44 v20 q0 8 -10 8 H34 q-10 0 -10 -8 Z"/>
      <path class="s" d="M22 80 q0 -8 10 -8 h34 q10 0 10 8 v6 H22 Z"/>
    </g>
    <g class="fa-slide" style="--si:1">
      <circle class="o" cx="82" cy="96" r="20"/>
      <circle class="w" cx="82" cy="96" r="13"/>
      <circle class="s" cx="82" cy="96" r="5"/>
    </g>
    <g class="fa-slide" style="--si:2">
      <path class="w" d="M104 90 h30 q10 0 10 8 v12 q0 8 -10 8 h-30 q-10 0 -10 -8 V98 q0 -8 10 -8 Z"/>
      <path class="s" d="M102 80 q0 -8 10 -8 h32 q10 0 10 8 v6 H102 Z"/>
    </g>
    <g class="fa-slide" style="--si:3">
      <path class="n" d="M104 30 L138 70"/>
      <path class="n" d="M118 26 L146 60"/>
    </g>
  `,

  chicken: `
    <ellipse class="sh" cx="80" cy="140" rx="46" ry="6"/>
    <path class="f fa-shade" d="M44 80 C44 54 66 40 88 40 C112 40 126 58 126 80 C126 104 106 118 82 118 C58 118 44 104 44 80 Z"/>
    <path class="o fa-draw" pathLength="1" d="M44 80 C44 54 66 40 88 40 C112 40 126 58 126 80 C126 104 106 118 82 118 C58 118 44 104 44 80 Z"/>
    <path class="o fa-step" style="--si:0" d="M58 110 L46 126"/>
    <circle class="o fa-step" style="--si:0" cx="43" cy="130" r="7"/>
    <path class="o fa-step" style="--si:1" d="M110 110 L122 126"/>
    <circle class="o fa-step" style="--si:1" cx="125" cy="130" r="7"/>
    <path class="n fa-draw" pathLength="1" d="M74 62 Q94 58 110 72"/>
    <path class="n fa-draw" pathLength="1" d="M62 86 Q82 98 106 92"/>
  `,

  pasta: `
    <ellipse class="sh" cx="80" cy="148" rx="52" ry="7"/>
    <path class="f fa-shade" d="M26 88 H134 A54 54 0 0 1 26 88 Z"/>
    <path class="o fa-step" style="--si:0" d="M26 88 H134 A54 54 0 0 1 26 88 Z"/>
    <path class="n fa-draw" pathLength="1" d="M44 76 q9 -14 18 0 t18 0 t18 0 t18 0"/>
    <path class="n fa-draw" pathLength="1" d="M46 86 q9 -13 18 0 t18 0 t18 0"/>
    <path class="n fa-draw" pathLength="1" d="M26 88 H134"/>
    <g class="fa-step" style="--si:2">
      <path class="o" d="M100 26 V56 M112 26 V62 M124 26 V56"/>
      <path class="o" d="M100 56 q12 16 24 0"/>
      <path class="o" d="M112 62 V126"/>
    </g>
  `,

  dessert: `
    <ellipse class="sh" cx="80" cy="142" rx="48" ry="6"/>
    <path class="n fa-draw" pathLength="1" d="M32 136 H128"/>
    <rect class="of fa-step" style="--si:0" x="42" y="106" width="76" height="28" rx="6"/>
    <rect class="of fa-step" style="--si:1" x="50" y="80" width="60" height="26" rx="6"/>
    <g class="fa-step" style="--si:2">
      <rect class="of" x="58" y="56" width="44" height="24" rx="6"/>
      <path class="s" d="M58 74 h44 v6 q-5.5 10 -11 0 q-5.5 10 -11 0 q-5.5 10 -11 0 q-5.5 10 -11 0 Z"/>
    </g>
    <g class="fa-pop" style="--si:3">
      <circle class="s" cx="80" cy="44" r="9"/>
      <path class="o" d="M80 35 q5 -9 15 -10"/>
    </g>
  `,

  coffee: `
    <ellipse class="sh" cx="76" cy="140" rx="46" ry="7"/>
    <path class="n fa-draw" pathLength="1" d="M34 134 H118"/>
    <path class="f fa-step" style="--si:0" d="M46 68 H108 L104 116 q-2 12 -14 12 H64 q-12 0 -14 -12 Z"/>
    <path class="f2 fa-liquid" d="M51 78 H103 L100 114 q-2 10 -12 10 H66 q-10 0 -12 -10 Z"/>
    <path class="o fa-step" style="--si:0" d="M46 68 H108 L104 116 q-2 12 -14 12 H64 q-12 0 -14 -12 Z"/>
    <path class="o fa-step" style="--si:1" d="M108 78 a16 16 0 0 1 0 32"/>
    <path class="n fa-draw" pathLength="1" d="M64 56 q7 -10 0 -20 q-7 -10 0 -18"/>
    <path class="n fa-draw" pathLength="1" d="M88 52 q7 -10 0 -18 q-7 -9 0 -16"/>
  `,

  drinks: `
    <ellipse class="sh" cx="80" cy="144" rx="36" ry="6"/>
    <path class="f fa-step" style="--si:0" d="M54 44 H106 L99 126 q-1 10 -11 10 H72 q-10 0 -11 -10 Z"/>
    <path class="f2 fa-liquid" d="M58 66 H102 L97 124 q-1 8 -10 8 H73 q-9 0 -10 -8 Z"/>
    <path class="o fa-step" style="--si:0" d="M54 44 H106 L99 126 q-1 10 -11 10 H72 q-10 0 -11 -10 Z"/>
    <path class="o fa-step" style="--si:1" d="M93 24 L79 92"/>
    <path class="n fa-draw" pathLength="1" d="M64 58 L67 110"/>
    <circle class="s fa-pop" style="--si:2" cx="70" cy="106" r="4"/>
    <circle class="s fa-pop" style="--si:3" cx="87" cy="94" r="3.4"/>
    <circle class="s fa-pop" style="--si:4" cx="76" cy="78" r="3"/>
  `,

  lebanese: `
    <ellipse class="sh" cx="80" cy="146" rx="54" ry="6"/>
    <path class="n fa-draw" pathLength="1" d="M24 108 H136"/>
    <path class="n fa-draw" pathLength="1" d="M24 124 H136"/>
    <path class="n fa-draw" pathLength="1" d="M24 140 H136"/>
    <path class="o fa-draw" pathLength="1" d="M20 132 L140 44"/>
    <g transform="rotate(-36 57 105)"><rect class="of fa-step" style="--si:0" x="44" y="92" width="26" height="26" rx="8"/></g>
    <g transform="rotate(-36 81 87)"><rect class="of fa-step" style="--si:1" x="68" y="74" width="26" height="26" rx="8"/></g>
    <g transform="rotate(-36 105 70)"><rect class="of fa-step" style="--si:2" x="92" y="57" width="26" height="26" rx="8"/></g>
  `,

  seafood: `
    <ellipse class="sh" cx="78" cy="136" rx="54" ry="7"/>
    <path class="f fa-shade" d="M110 76 C110 54 90 40 66 40 C42 40 24 56 24 76 C24 96 42 112 66 112 C90 112 110 98 110 76 Z"/>
    <path class="o fa-draw" pathLength="1" d="M110 76 C110 54 90 40 66 40 C42 40 24 56 24 76 C24 96 42 112 66 112 C90 112 110 98 110 76 Z"/>
    <path class="o fa-step" style="--si:0" d="M110 76 L140 52 L140 100 Z"/>
    <path class="n fa-draw" pathLength="1" d="M54 48 q11 28 0 56"/>
    <path class="n fa-draw" pathLength="1" d="M74 42 q13 18 0 34"/>
    <circle class="s fa-pop" style="--si:1" cx="42" cy="66" r="5"/>
    <g class="fa-pop" style="--si:2">
      <circle class="f2" cx="124" cy="128" r="12"/>
      <path class="n" d="M124 116 v24 M112 128 h24 M115.5 119.5 l17 17 M132.5 119.5 l-17 17"/>
    </g>
  `,

  bakery: `
    <ellipse class="sh" cx="80" cy="134" rx="52" ry="7"/>
    <path class="f fa-shade" d="M30 104 Q30 66 80 66 Q130 66 130 104 Q130 120 116 120 H44 Q30 120 30 104 Z"/>
    <path class="o fa-step" style="--si:0" d="M30 104 Q30 66 80 66 Q130 66 130 104 Q130 120 116 120 H44 Q30 120 30 104 Z"/>
    <path class="o fa-draw" pathLength="1" d="M58 76 L46 98 M82 70 L70 94 M106 76 L94 98"/>
    <path class="n fa-draw" pathLength="1" d="M64 54 q7 -9 0 -16 M88 50 q7 -9 0 -16"/>
    <circle class="s fa-pop" style="--si:1" cx="46" cy="50" r="3"/>
    <circle class="s fa-pop" style="--si:2" cx="118" cy="44" r="2.6"/>
  `,

  breakfast: `
    <ellipse class="sh" cx="72" cy="134" rx="50" ry="7"/>
    <path class="w fa-step" style="--si:0" d="M30 96 C22 76 40 60 58 64 C66 50 94 54 96 74 C116 78 116 106 96 110 C86 124 52 124 42 110 C32 108 30 102 30 96 Z"/>
    <path class="o fa-step" style="--si:0" d="M30 96 C22 76 40 60 58 64 C66 50 94 54 96 74 C116 78 116 106 96 110 C86 124 52 124 42 110 C32 108 30 102 30 96 Z"/>
    <circle class="s fa-pop" style="--si:1" cx="66" cy="88" r="15"/>
    <g class="fa-step" style="--si:2">
      <path class="of" d="M116 74 H146 L142 124 H120 Z"/>
      <path class="f2" d="M119 92 H143 L140 120 H122 Z"/>
    </g>
    <path class="n fa-draw" pathLength="1" d="M126 64 q6 -8 0 -14"/>
  `,

  /* Generic: no artwork forced — an elegant plate that the photograph
     develops into, sized to match the photo disc almost exactly. */
  generic: `
    <ellipse class="sh" cx="80" cy="150" rx="62" ry="6"/>
    <circle class="f" cx="80" cy="76" r="71"/>
    <circle class="o fa-draw" pathLength="1" cx="80" cy="76" r="71"/>
    <circle class="n fa-draw" pathLength="1" cx="80" cy="76" r="61"/>
    <path class="n fa-draw" pathLength="1" d="M80 14 A62 62 0 0 1 129 34"/>
  `
};

const FOOD_MATCHERS = [
  ["pizza", /pizza|pizz|بيتزا|بيتز/],
  ["burger", /burger|برجر|برغر|همبر|ساندويش|سندويش/],
  ["shawarma", /shawarma|shwarma|شاورما|شاوما|مناوي|شاو/],
  ["sushi", /sushi|suchi|سوشي|سوشي/],
  ["chicken", /chicken|farooj|فروج|فرخ|فرجان|ديك رومي|دجاج|شيش طاووق|طوق|طلوع/],
  ["pasta", /pasta|noodle|معكرونة|مكرونة|باستا|سباغيتي|لازانيا|مقلوبة/],
  ["dessert", /dessert|cake|sweet|حلويات|حلا|كيك|كيكة|آيس كريم|فطائر|كريب/],
  ["coffee", /coffee|cafe|قهوة|قهه|كافيه|كافيه|لاتيه|اسبريسو|كابتشينو|قهوة/],
  ["drinks", /drink|عصير|مشروب|مشروبات|شاي|ليموناضة|موهيتو|بيرة|آيس/],
  ["seafood", /sea ?food|سمك|بحر|روبيان|محار|سلمون|تونة|كاليماري/],
  ["bakery", /bakery|خبز|مناقيش|منقوشة|فطاير|زعتر|صمون|كعك|مرقوق/],
  ["breakfast", /breakfast|terwee|فطور|ترويق|بيض|فول|لبنة|صحن/],
  ["lebanese", /mashewe|مشاوي|مشويات|شواء|كباب|ليفتة|كسة|مندي|حمص|متبل|تبولة|فتوش|تبوله/],
  ["snack", /snack|fast ?food|فاست فود|سناك|بطاطا|فرايز/]
];

function matchFoodKey(cat) {
  if (!cat) return "generic";
  const explicit = String(cat.motionKey || "").trim().toLowerCase();
  if (explicit && FOOD_ART[explicit]) return explicit;

  const hay = [cat.nameAr, cat.nameEn, cat.id]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/\u0640/g, "");

  for (let i = 0; i < FOOD_MATCHERS.length; i++) {
    if (FOOD_MATCHERS[i][1].test(hay)) return FOOD_MATCHERS[i][0];
  }
  return "generic";
}

const MOMENT_SEEN_KEY = "shu_badna_nekol_moments_seen";
let momentActive = false;
let momentTimers = [];
let homeRailSignature = "";

function readSeenMoments() {
  try {
    const list = JSON.parse(sessionStorage.getItem(MOMENT_SEEN_KEY) || "[]");
    return new Set(Array.isArray(list) ? list : []);
  } catch (e) {
    return new Set();
  }
}

function rememberMoment(id) {
  try {
    const set = readSeenMoments();
    set.add(id);
    sessionStorage.setItem(MOMENT_SEEN_KEY, JSON.stringify(Array.from(set)));
  } catch (e) {
    /* private mode — the full scene simply plays every time */
  }
}

function clearMomentTimers() {
  momentTimers.forEach(id => clearTimeout(id));
  momentTimers = [];
}

/**
 * Mounts the signature scene. Returns the scene descriptor, or null when it
 * should not play (reduced motion, another scene running, no markup).
 * Navigation is deliberately NOT done here — it happens on the same frame,
 * underneath the overlay, so nothing ever waits on this.
 */
function startCategoryMoment(cat, title, photo, sourceEl) {
  const layer = document.getElementById("momentLayer");
  if (!layer || momentActive || prefersReducedMotion()) return null;

  const key = matchFoodKey(cat);
  const artKey = FOOD_ALIAS[key] || key;
  const hue = FOOD_HUE[key] || FOOD_HUE.generic;

  const id =
    (cat && (cat.id || cat.nameAr || cat.nameEn)) || title || photo || "moment";
  const full = !readSeenMoments().has(id);
  rememberMoment(id);

  const art = document.getElementById("momentArt");
  const img = document.getElementById("momentImg");
  const titleAr = document.getElementById("momentTitleAr");
  const titleEn = document.getElementById("momentTitleEn");

  let primary = "";
  let secondary = "";
  if (cat && (cat.nameAr || cat.nameEn)) {
    const pair = pickArabicPair(cat.nameAr, cat.nameEn);
    primary = pair[0];
    secondary = pair[1];
  }
  if (!primary && !secondary) primary = title || "";

  const disc = layer.querySelector(".moment-disc");

  layer.hidden = false;
  layer.classList.toggle("is-short", !full);
  layer.style.setProperty("--food", hue || "var(--accent)");
  layer.style.setProperty("--food-soft", withAlpha(hue || "#19a99d", 0.34));

  if (art) {
    art.innerHTML = full
      ? `<svg class="fa" viewBox="0 0 160 160" aria-hidden="true">${
          FOOD_ART[artKey] || FOOD_ART.generic
        }</svg>`
      : "";
  }
  if (titleAr) {
    titleAr.textContent = primary;
    titleAr.hidden = !primary;
  }
  if (titleEn) {
    titleEn.textContent = secondary;
    titleEn.hidden = !secondary;
  }
  if (img) {
    if (photo) img.setAttribute("src", photo);
    else img.removeAttribute("src");
  }

  // --- FLIP: start the photo exactly where the tapped card showed it -------
  let rect = null;
  if (photo && sourceEl && typeof sourceEl.querySelector === "function") {
    const media = sourceEl.querySelector(".cat-media, .homecat-media") || sourceEl;
    rect = media.getBoundingClientRect();
  }

  if (disc) {
    disc.style.transition = "none";
    disc.style.borderRadius = "50%";
    disc.style.transform = "";

    if (photo && rect && rect.width > 4) {
      const last = disc.getBoundingClientRect();
      if (last.width > 4) {
        const dx = rect.left + rect.width / 2 - (last.left + last.width / 2);
        const dy = rect.top + rect.height / 2 - (last.top + last.height / 2);
        const scale = Math.max(0.1, Math.min(4, rect.width / last.width));
        disc.style.borderRadius = "14px";
        disc.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
      } else {
        disc.style.transform = "scale(0.72)";
      }
    } else if (photo) {
      disc.style.transform = "scale(0.72)";
    } else {
      disc.style.display = "none";
    }
  }

  const dur = readMomentDuration(layer, full);
  momentActive = true;
  clearMomentTimers();

  // Everything downstream is a fraction of the scene duration, so CSS is the
  // single source of truth for how long the whole thing takes.
  return {
    full,
    dur,
    morph: dur * (full ? 0.51 : 0.654),
    dockAt: dur * 0.8,
    dockDur: dur * 0.18,
    endAt: dur * 1.1
  };
}

/** CSS owns the length of the scene (`.moment { --moment-dur }`). Reading it
 *  back keeps JS and keyframes from ever drifting apart. */
function readMomentDuration(layer, full) {
  const fallback = full ? 900 : 520;
  if (!layer) return fallback;
  const raw = parseFloat(
    getComputedStyle(layer).getPropertyValue("--moment-dur")
  );
  return isFinite(raw) && raw >= 240 ? raw : fallback;
}

/** Kicks the flight + schedules the dock and the teardown. */
function runCategoryMoment(scene) {
  const layer = document.getElementById("momentLayer");
  const disc = layer && layer.querySelector(".moment-disc");
  if (!layer || !disc) return;

  if (disc.style.transform) {
    // Commit the starting box first, otherwise the browser never sees a
    // "before" value and the transition simply does not run.
    void disc.offsetWidth;
    disc.style.transition = `transform ${scene.morph}ms var(--e-out), ` +
      `border-radius ${scene.morph}ms var(--e-out)`;
    disc.style.transform = "none";
    disc.style.borderRadius = "50%";
  }

  // The category header settles in as the scrim dissolves, so the reveal is
  // not a static list appearing out of nowhere.
  const strip = document.querySelector("#pageRestaurants .cat-strip");
  if (strip && scene.full) {
    const delay = Math.round(scene.dur * 0.62);
    strip.style.animation = "none";
    void strip.offsetWidth;
    strip.style.animation = `reveal-in 420ms var(--e-out) ${delay}ms both`;
    momentTimers.push(
      setTimeout(() => {
        strip.style.animation = "";
      }, delay + 460)
    );
  }

  momentTimers.push(setTimeout(() => dockCategoryMoment(scene), scene.dockAt));
  momentTimers.push(setTimeout(endCategoryMoment, scene.endAt));
}

/** Photograph flies into the hero strip — then the layer is dropped with it
 *  sitting exactly on top of an identical photo, so nothing blinks. */
function dockCategoryMoment(scene) {
  const layer = document.getElementById("momentLayer");
  const disc = layer && layer.querySelector(".moment-disc");
  const hero = document.getElementById("categoryHeroImg");
  if (!disc || !hero || disc.style.display === "none") return;

  const to = hero.getBoundingClientRect();
  const from = disc.getBoundingClientRect();
  if (!to.width || !from.width || !isFinite(to.width)) return;

  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const scale = to.width / from.width;
  if (!isFinite(dx) || !isFinite(dy) || !isFinite(scale)) return;

  // Match the thumbnail's own corner radius exactly, and stand the
  // presentation down so the landing is invisible.
  const heroRadius = getComputedStyle(hero).borderRadius;
  layer.classList.add("is-docking");

  disc.style.transition =
    `transform ${scene.dockDur}ms var(--e-inout), ` +
    `border-radius ${scene.dockDur}ms var(--e-inout), ` +
    `box-shadow ${scene.dockDur}ms linear`;
  disc.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
  disc.style.borderRadius = heroRadius || "26%";
  disc.style.boxShadow = "none";
}

function endCategoryMoment() {
  const layer = document.getElementById("momentLayer");
  clearMomentTimers();
  momentActive = false;
  if (!layer || layer.hidden) return;

  layer.hidden = true;
  layer.classList.remove("is-skip", "is-short", "is-docking");

  const art = document.getElementById("momentArt");
  if (art) art.innerHTML = "";
  const img = document.getElementById("momentImg");
  if (img) img.removeAttribute("src");

  const disc = layer.querySelector(".moment-disc");
  if (disc) {
    disc.style.transition = "none";
    disc.style.transform = "";
    disc.style.borderRadius = "";
    disc.style.boxShadow = "";
    disc.style.display = "";
  }

  layer.style.removeProperty("--food");
  layer.style.removeProperty("--food-soft");
}

function skipCategoryMoment() {
  const layer = document.getElementById("momentLayer");
  if (!layer || layer.hidden || layer.classList.contains("is-skip")) return;
  clearMomentTimers();
  layer.classList.add("is-skip");
  momentTimers.push(setTimeout(endCategoryMoment, 200));
}

// ============================================================
// MOTION: scroll / section reveals + broken hero photo fallback
// ============================================================

function revealActivePage(pageEl) {
  if (!pageEl) return;
  const items = pageEl.querySelectorAll(".section-head, .profile-cta");
  items.forEach((el, index) => {
    if (el.classList.contains("reveal")) el.classList.remove("is-in");
    el.classList.add("reveal");
    el.style.setProperty("--ri", index);
  });
  void pageEl.offsetWidth;
  items.forEach(el => el.classList.add("is-in"));
}

/** The configured hero photo 404s. Falls back to real category photography
 *  before giving up on the block entirely. */
function fixRegionImage() {
  const img = document.querySelector(".region-img");
  if (!img) return;
  const failed = img.complete && img.naturalWidth === 0;
  if (!img.classList.contains("is-broken") && !failed) return;
  if (img.dataset.fallbackTried === "1") return;

  const withPhoto = allCategories.find(c => c.imgUrl);
  if (!withPhoto) return;

  img.dataset.fallbackTried = "1";
  img.classList.remove("is-broken");
  setImgSrc(img, withPhoto.imgUrl);
}

// ============================================================
// MOTION: home category rail — food discovery above the fold
// ============================================================

function renderHomeCategories() {
  const section = document.getElementById("homeCats");
  const rail = document.getElementById("homeCatsRail");
  if (!section || !rail) return;

  const items = allCategories.filter(c => c.nameAr || c.nameEn);
  if (!items.length) {
    section.hidden = true;
    homeRailSignature = "";
    return;
  }

  // The rail is fed the full category list, so a search keystroke that
  // re-runs the grid render must not rebuild (and re-animate) it.
  const signature = items
    .map(c => c.id + "|" + (c.imgUrl || ""))
    .join("~");
  if (rail.children.length && signature === homeRailSignature) return;
  homeRailSignature = signature;

  section.hidden = false;
  rail.innerHTML = items
    .map((data, index) => {
      const pair = pickArabicPair(data.nameAr, data.nameEn);
      const photo = data.imgUrl
        ? `<img class="fade-img" src="${escapeHtml(
            data.imgUrl
          )}" alt="${escapeHtml(pair[0])}" loading="lazy" decoding="async">`
        : "";

      return (
        `<button class="homecat${index < 6 ? " stagger-in" : ""}" type="button" ` +
        `data-cat="${escapeHtml(data.id)}" style="--i:${index}">` +
        `<span class="homecat-media">${photo}</span>` +
        `<span class="homecat-copy">` +
        `<span class="homecat-name">${escapeHtml(pair[0])}</span>` +
        (pair[1]
          ? `<span class="homecat-en">${escapeHtml(pair[1])}</span>`
          : "") +
        `</span></button>`
      );
    })
    .join("");

  rail.querySelectorAll(".homecat").forEach(btn => {
    btn.addEventListener("click", () => {
      const data = allCategories.find(c => c.id === btn.dataset.cat);
      if (!data) return;
      openRestaurantsByCategory(
        data.id,
        data.nameAr || data.nameEn,
        data.imgUrl,
        btn
      );
    });
  });

  sweepImages(rail);
}

/* Home shows what the user actually saved. Called whenever the restaurant
   data lands and whenever a heart is toggled, so the rail never lies. */
function renderHomeSaved() {
  const section = document.getElementById("homeCats");
  const rail = document.getElementById("homeSavedRail");
  const empty = document.getElementById("homeSavedEmpty");
  if (!section || !rail) return;

  const ids = readFavorites();
  const items = ids
    .map(id => allRestaurants.find(r => r && r.id === id))
    .filter(Boolean);

  section.hidden = false;

  if (empty) empty.hidden = items.length > 0;

  if (!items.length) {
    rail.innerHTML = "";
    rail.dataset.sig = "";
    return;
  }

  const signature = items
    .map(r => r.id + "|" + (r.cover || r.logo || ""))
    .join("~");
  if (rail.children.length && rail.dataset.sig === signature) return;
  rail.dataset.sig = signature;

  rail.innerHTML = items
    .map((r, index) => {
      const photo = r.cover || r.logo
        ? `<img class="fade-img" src="${escapeHtml(
            r.cover || r.logo
          )}" alt="${escapeHtml(r.name || "")}" loading="lazy" decoding="async">`
        : "";

      return (
        `<button class="homecat" type="button" ` +
        `data-rest="${escapeHtml(r.id)}" style="--i:${index}">` +
        `<span class="homecat-media">${photo}</span>` +
        `<span class="homecat-copy">` +
        `<span class="homecat-name">${escapeHtml(r.name || "")}</span>` +
        `</span></button>`
      );
    })
    .join("");

  rail.querySelectorAll(".homecat").forEach(btn => {
    btn.addEventListener("click", () => {
      const data = allRestaurants.find(r => r && r.id === btn.dataset.rest);
      if (data) openRestaurantProfile(data, btn);
    });
  });

  sweepImages(rail);
}

// ============================================================
// OPEN RESTAURANTS BY CATEGORY (WITH SAVED FILTER STATE)
// ============================================================

function openRestaurantsByCategory(catId, catName, catImg, event) {
  const cat = allCategories.find(c => c.id === catId) || null;

  currentCategoryFilter = catId;

  // حفظ القسم المحدد في الـ localStorage لكي لا يضيع عند إعادة التحميل
  const pair = cat ? pickArabicPair(cat.nameAr, cat.nameEn) : ["", ""];
  const display = (pair[0] || pair[1] || catName || "").trim() || "المطاعم";
  localStorage.setItem("currentCategoryFilter", catId);
  localStorage.setItem("currentCategoryName", display);
  if (catImg) localStorage.setItem("currentCategoryImg", catImg);

  // An Event (card click) or a plain element (home rail button).
  const sourceEl = event && (event.currentTarget || event);

  const applyHeader = () => {
    const heroTitle = document.getElementById("categoryHeroTitle");
    if (heroTitle) heroTitle.innerText = display;
    const heroImg = document.getElementById("categoryHeroImg");
    if (heroImg) setImgSrc(heroImg, catImg || "");
    renderRestaurantsList("", true);
    showPage("pageRestaurants");
  };

  const scene = startCategoryMoment(cat, display, catImg, sourceEl);

  if (scene) {
    // The overlay is already painted at full opacity, so the swap underneath
    // is invisible and navigation happens on this very frame.
    applyHeader();
    runCategoryMoment(scene);
    return;
  }

  const sourceImg =
    sourceEl && typeof sourceEl.querySelector === "function"
      ? sourceEl.querySelector(".cat-media img, .homecat-media img")
      : null;
  const heroImg = document.getElementById("categoryHeroImg");

  // Without a moment (reduced motion / no artwork) the photo morph simply
  // travels from card to hero, or the CSS crossfade takes over.
  runViewTransition(
    catImg && sourceImg ? sourceImg : null,
    catImg && sourceImg ? heroImg : null,
    catImg,
    applyHeader
  );
}


// ============================================================
// HELPER: CHECK IF RESTAURANT IS CLOSED
// ============================================================

function isRestaurantClosed(openTime, closeTime) {
  if (!openTime || !closeTime) return false;

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [openHour, openMin] = openTime.split(':').map(Number);
  const [closeHour, closeMin] = closeTime.split(':').map(Number);

  const openMinutes = openHour * 60 + openMin;
  const closeMinutes = closeHour * 60 + closeMin;

  if (openMinutes < closeMinutes) {
    return currentMinutes < openMinutes || currentMinutes >= closeMinutes;
  } else {
    return currentMinutes < openMinutes && currentMinutes >= closeMinutes;
  }
}

function format12HourTime(timeStr) {
  if (!timeStr) return "";
  const [hourStr, minStr] = timeStr.split(':');
  let hour = parseInt(hourStr, 10);
  if (!isFinite(hour)) return "";
  const meridiem = hour >= 12 ? "م" : "ص"; // PM / AM, in Arabic
  hour = hour % 12;
  hour = hour ? hour : 12;
  const minutes = String(minStr || "00").slice(0, 2).padStart(2, "0");
  return `${hour}:${minutes} ${meridiem}`;
}


// ============================================================
// FAVORITES (localStorage only — no account, no Firebase)
// ============================================================

const FAVORITES_KEY = "shu_badna_nekol_favorites";

function readFavorites() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(id => typeof id === "string" && id);
  } catch (e) {
    return [];
  }
}

function isFavorite(id) {
  if (!id) return false;
  return readFavorites().indexOf(id) !== -1;
}

function toggleFavorite(id) {
  if (!id) return false;

  const list = readFavorites();
  const index = list.indexOf(id);
  let nowFavorite;

  if (index === -1) {
    list.push(id);
    nowFavorite = true;
  } else {
    list.splice(index, 1);
    nowFavorite = false;
  }

  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(list));
  } catch (e) {
    console.error("favorites storage:", e);
  }

  syncFavoriteUI(id);
  renderHomeSaved();
  return nowFavorite;
}

/* Keeps every rendered heart (cards + open profile) on the same state. */
function syncFavoriteUI(id) {
  const active = isFavorite(id);
  const label = active
    ? "إزالة المطعم من المفضلة"
    : "أضف المطعم إلى المفضلة";

  document.querySelectorAll(`[data-fav-id="${id}"]`).forEach(btn => {
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
    btn.setAttribute("aria-label", label);
  });
}

function favoriteButtonHtml(id) {
  if (!id) return "";
  const active = isFavorite(id);
  return `
    <button
      type="button"
      class="fav-btn${active ? " is-active" : ""}"
      data-fav-id="${id}"
      aria-pressed="${active ? "true" : "false"}"
      aria-label="${active ? "إزالة المطعم من المفضلة" : "أضف المطعم إلى المفضلة"}"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.7 10.6 19.4C5.4 14.7 2 11.6 2 7.9 2 5.1 4.2 3 7 3c1.6 0 3.1.7 4.1 1.9L12 5.4l.9-.5C13.9 3.7 15.4 3 17 3c2.8 0 5 2.1 5 4.9 0 3.7-3.4 6.8-8.6 11.5L12 20.7Z"/></svg>
    </button>`;
}

/* Toggles, then gives feedback on the exact heart that was pressed: a pop, a
   ring, and a light haptic when something was actually added. */
function toggleFavoriteFeedback(btn, getId) {
  const nowFavorite = toggleFavorite(getId());
  popFavorite(btn);
  if (nowFavorite) pulseFavorite();
  return nowFavorite;
}

/* A heart sits inside a clickable card, so it must swallow the card's
   navigation — on pointer, on keyboard, and on bubbled key events. */
function wireFavoriteButton(btn, getId) {
  if (!btn) return;

  btn.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    toggleFavoriteFeedback(btn, getId);
  });

  btn.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      event.stopPropagation();
      toggleFavoriteFeedback(btn, getId);
    }
  });

  ["pointerdown", "mousedown", "touchstart"].forEach(type => {
    btn.addEventListener(type, event => event.stopPropagation());
  });
}

// ============================================================
// RATING (0–5, set by the admin — never invented by the UI)
// ============================================================

/* Returns a usable 0–5 number, or null when no rating is configured. */
function normalizeRating(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!isFinite(n)) return null;
  const rounded = Math.round(n * 10) / 10;
  if (rounded <= 0 || rounded > 5) return null;
  return rounded;
}

function ratingText(value) {
  const n = normalizeRating(value);
  if (n === null) return "";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function ratingHtml(value, extraClass = "") {
  const n = normalizeRating(value);
  if (n === null) return ""; // no rating configured → show nothing

  const label = ratingText(n);

  /* Compact single-star form: ★4.5 — one mark, one number, no star row. */
  return `
    <span class="rating ${extraClass}" role="img" aria-label="التقييم ${label} من 5">
      <span class="rating-star" aria-hidden="true">★</span>
      <span class="rating-value">${label}</span>
    </span>`;
}

/* --- Admin 5-star picker ------------------------------------------------ */
function getAdminRating() {
  const input = document.getElementById("adminRating");
  if (!input) return null;
  const n = Number(input.value);
  if (!isFinite(n) || n <= 0) return null;
  return Math.min(5, Math.max(1, Math.round(n)));
}

function setAdminRating(value) {
  const input = document.getElementById("adminRating");
  const picker = document.getElementById("adminRatingPicker");
  const meta = document.getElementById("adminRatingMeta");
  if (!input || !picker) return;

  const n = Number(value);
  const clean = isFinite(n) && n > 0 ? Math.min(5, Math.max(1, Math.round(n))) : 0;

  input.value = clean ? String(clean) : "";

  picker.querySelectorAll(".star-picker-btn").forEach(btn => {
    const v = Number(btn.dataset.value);
    const on = v <= clean;
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-checked", v === clean ? "true" : "false");
  });

  if (meta) {
    meta.textContent = clean
      ? `${clean} من 5`
      : "بدون تقييم";
  }
}

function setupRatingPicker() {
  const picker = document.getElementById("adminRatingPicker");
  if (!picker) return;

  picker.addEventListener("click", event => {
    const btn = event.target.closest(".star-picker-btn");
    if (!btn) return;

    const value = Number(btn.dataset.value);
    const current = Number(document.getElementById("adminRating")?.value || 0);

    // Tapping the current value clears the rating (0 = not configured).
    setAdminRating(value === current ? 0 : value);
  });

  picker.addEventListener("keydown", event => {
    const btn = event.target.closest(".star-picker-btn");
    if (!btn) return;

    const buttons = [...picker.querySelectorAll(".star-picker-btn")];
    const index = buttons.indexOf(btn);
    let next = -1;

    if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = index + 1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = index - 1;

    if (next >= 0 && next < buttons.length) {
      event.preventDefault();
      buttons[next].focus();
      setAdminRating(Number(buttons[next].dataset.value));
    }
  });

  setAdminRating(0);
}

// ============================================================
// RENDER RESTAURANTS (PAGE 3) - مع التشقليب العشوائي
// ============================================================

function renderRestaurantsList(
  searchQuery = "",
  shouldShuffle = true
) {

  const container =
    document.getElementById(
      "restaurantsListContainer"
    );


  if (!container)
    return;


  container.innerHTML = "";


  let filtered =
    allRestaurants.filter(
      r =>
        r.category ===
        currentCategoryFilter
    );


  if (searchQuery) {

    filtered =
      filtered.filter(
        r =>
          r.name &&
          r.name
            .toLowerCase()
            .includes(
              searchQuery.toLowerCase()
            )
      );

  }


  if (filtered.length === 0) {

    if (!restaurantsLoaded) {
      renderRestaurantSkeleton();
      return;
    }

    if (restaurantsLoadFailed) {
      container.innerHTML = loadErrorHtml("restaurants");
      return;
    }

    if (!currentCategoryFilter) {
      container.innerHTML = emptyStateHtml(
        "اختر قسم أولاً",
        "افتح أي قسم من الأقسام وبتظهرلك مطاعمه هون.",
        ["browse"]
      );
      return;
    }

    container.innerHTML = searchQuery
      ? emptyStateHtml(
          "لا توجد نتائج",
          "ما لقينا مطعم بهالاسم داخل هالقسم. جرّب اسم تاني.",
          ["clear"]
        )
      : emptyStateHtml(
          "ما في مطاعم هون لحدّا",
          "جرّب قسم تاني أو تصفّح الأقسام الرئيسية.",
          ["browse"]
        );

    return;

  }


  let openRestaurants = filtered.filter(r => !isRestaurantClosed(r.openTime, r.closeTime));
  let closedRestaurants = filtered.filter(r => isRestaurantClosed(r.openTime, r.closeTime));

  // تشقليب عشوائي للمطاعم المفتوحة وللمغلقة بشكل مستقل عند الدخول أو Refresh
  if (shouldShuffle && !searchQuery) {
    openRestaurants = shuffleArray(openRestaurants);
    closedRestaurants = shuffleArray(closedRestaurants);
  }

  const finalOrderedList = [...openRestaurants, ...closedRestaurants];

  // Entrance runs only on list entry — never while the user is typing.
  const animateEntrance = shouldShuffle && !searchQuery;


  finalOrderedList.forEach((r, index) => {

    const card =
      document.createElement("div");


    const closed = isRestaurantClosed(r.openTime, r.closeTime);

    card.className =
      `restaurant-card ${closed ? 'is-closed' : 'is-open'}`;

    if (animateEntrance && index < 6) {
      card.classList.add("stagger-in");
      card.style.setProperty("--i", index);
    }


    card.onclick = (event) =>
      openRestaurantProfile(r, event);

    makeCardInteractive(card, card.onclick);

    const formattedOpenTime = format12HourTime(r.openTime || "11:00");
    const formattedCloseTime = format12HourTime(r.closeTime || "");

    const hasCover = !!(r.cover && String(r.cover).trim());
    const logoHtml = r.logo
      ? `<img class="rc-logo fade-img" src="${r.logo}" alt="" loading="lazy" decoding="async">`
      : "";
    const brandHtml = r.logo
      ? `<img class="rc-brand fade-img" src="${r.logo}" alt="" loading="lazy" decoding="async">`
      : "";

    const mediaHtml = hasCover
      ? `
        <div class="rc-media">
          <img class="rc-cover fade-img" src="${r.cover}" alt="" loading="lazy" decoding="async">
          <div class="rc-badge">
            ${logoHtml}
            <span class="rc-name">${r.name || ""}</span>
          </div>
        </div>`
      : `
        <div class="rc-media is-brand">
          <div class="rc-badge">
            ${brandHtml}
            <span class="rc-name">${r.name || ""}</span>
          </div>
        </div>`;

    let timeText = "";

    if (closed) {
      timeText = r.openTime
        ? `يفتح اليوم ${formattedOpenTime}`
        : "مغلق حالياً";
    } else {
      timeText = formattedCloseTime ? `يغلق ${formattedCloseTime}` : "مفتوح الآن";
    }

    card.innerHTML = `

      ${mediaHtml}
      ${favoriteButtonHtml(r.id)}

      <div class="rc-body">
        <div class="rc-head">
          <span class="status ${closed ? "is-closed" : "is-open"}"><i></i>${closed ? "مغلق" : "مفتوح"}</span>
          ${ratingHtml(r.rating, "rating--sm")}
        </div>

        <p class="rc-desc">${r.desc || ""}</p>

        <div class="rc-meta">
          <span class="rc-meta-time">${timeText}</span>
          <svg class="rc-meta-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
        </div>
      </div>

    `;


    wireFavoriteButton(card.querySelector(".fav-btn"), () => r.id);

    container.appendChild(card);

  });

  armRatings(container);
  sweepImages(container);
}


// ============================================================
// RESTAURANT PROFILE (مع دالة مستقلة لتعبئة العناصر لتجنب ضياع الداتا عند الـ Refresh)
// ============================================================

function fillRestaurantProfileDOM(r) {
  const profileLogo = document.getElementById("profileLogo");
  const profileName = document.getElementById("profileName");
  const profileDesc = document.getElementById("profileDesc");
  const profileGallery = document.getElementById("profileGalleryContainer");
  const menuBtn = document.getElementById("profileMenuBtn");
  const contactBtn = document.getElementById("profileContactBtn");
  const locationBtn = document.getElementById("profileLocationBtn");

  /* --- Cover banner (identity sits on top of it) --- */
  const coverWrap = document.getElementById("profileCover");
  const coverImg = document.getElementById("profileCoverImg");
  if (coverWrap && coverImg) {
    if (r.cover) {
      setImgSrc(coverImg, r.cover);
      coverImg.alt = (r.name || "") + " — صورة الغلاف";
      coverWrap.classList.remove("is-empty");
    } else {
      /* No cover photo: the panel stays so the logo + name keep their place,
         it just drops back to the flat surface. */
      setImgSrc(coverImg, "");
      coverWrap.classList.add("is-empty");
    }
  }

  if (profileLogo) setImgSrc(profileLogo, r.logo || "");

  if (profileName)
    profileName.innerText = r.name || "";

  if (profileDesc) {
    profileDesc.innerText = r.desc || "";
    profileDesc.hidden = !String(r.desc || "").trim();
  }

  /* --- Open / closed status chip --- */
  const statusEl = document.getElementById("profileStatus");
  if (statusEl) {
    const closed = isRestaurantClosed(r.openTime, r.closeTime);
    const openAt = format12HourTime(r.openTime || "");
    const closeAt = format12HourTime(r.closeTime || "");

    let statusLabel;
    if (closed) {
      statusLabel = openAt ? "مغلق · يفتح " + openAt : "مغلق الآن";
    } else {
      statusLabel = closeAt ? "مفتوح الآن · يغلق " + closeAt : "مفتوح الآن";
    }

    statusEl.className = "status " + (closed ? "is-closed" : "is-open");
    const statusText = statusEl.querySelector(".status-text");
    if (statusText) statusText.textContent = statusLabel;
    statusEl.hidden = false;
  }

  /* --- Rating chip (only when the admin configured one) --- */
  const ratingEl = document.getElementById("profileRating");
  if (ratingEl) {
    const ratingMarkup = ratingHtml(r.rating);
    ratingEl.innerHTML = ratingMarkup || "";
    ratingEl.hidden = !ratingMarkup;
    armRatings(ratingEl);
  }

  /* --- Favorite toggle (localStorage) --- */
  const favBtn = document.getElementById("profileFavBtn");
  if (favBtn) {
    favBtn.dataset.favId = r.id || "";
    favBtn.onclick = () => toggleFavoriteFeedback(favBtn, () => r.id);
    syncFavoriteUI(r.id);
  }

  /* --- Actions --- */
  const hasPhone = !!(r.phone && String(r.phone).trim());
  const hasMenu = !!(r.menu && String(r.menu).trim());
  const hasMap = !!(r.map && String(r.map).trim());

  if (menuBtn) {
    menuBtn.href = r.menu || "#";
    menuBtn.hidden = !hasMenu;
  }

  if (contactBtn) {
    contactBtn.href = r.phone ? `https://wa.me/${r.phone}` : "#";
    contactBtn.hidden = !hasPhone;
  }

  if (locationBtn) {
    locationBtn.href = r.map || "#";
    locationBtn.hidden = !hasMap;
  }

  const ctaRow = document.querySelector(".profile-cta-row");
  const visibleSecondary = (hasMenu ? 1 : 0) + (hasMap ? 1 : 0);
  if (ctaRow) {
    ctaRow.hidden = visibleSecondary === 0;
    ctaRow.classList.toggle("is-single", visibleSecondary === 1);
  }

  const ctaBlock = document.querySelector(".profile-cta");
  const profileLayout = document.querySelector(".profile-layout");
  if (ctaBlock) ctaBlock.hidden = !hasPhone && visibleSecondary === 0;

  /* --- Gallery + lightbox --- */
  const gallerySection = document.querySelector(".profile-gallery");

  if (profileGallery) {
    profileGallery.innerHTML = "";

    const images = (Array.isArray(r.gallery) ? r.gallery : []).filter(Boolean);

    if (images.length === 0) {
      if (gallerySection) gallerySection.hidden = true;
      if (profileLayout) profileLayout.classList.add("is-single");
    } else {
      if (gallerySection) gallerySection.hidden = false;
      if (profileLayout) profileLayout.classList.remove("is-single");

      images.forEach((imgUrl, index) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "gallery-item";
        item.setAttribute("aria-label", "عرض الصورة " + (index + 1));

        const img = document.createElement("img");
        img.src = imgUrl;
        img.alt = (r.name || "مطعم") + " — صورة " + (index + 1);
        img.loading = "lazy";
        img.decoding = "async";

        item.appendChild(img);
        item.addEventListener("click", () => openLightbox(images, index));
        profileGallery.appendChild(item);
      });
    }
  }
}

// Safety net: the profile WhatsApp CTA (kept available as a global export).
function sendSecureOrderWhatsApp() {
  const btn = document.getElementById("profileContactBtn");
  const href = btn ? btn.getAttribute("href") : "";
  if (href && href.indexOf("https://wa.me/") === 0) {
    window.open(href, "_blank", "noopener,noreferrer");
    return;
  }
  showToast("ما في رقم واتساب مسجل لهذا المطعم.", "error");
}

function openRestaurantProfile(r, event) {
  // حفظ بيانات المطعم الحالي في الـ localStorage لتفادي فقدانها عند عمل Refresh
  localStorage.setItem("currentRestaurantProfile", JSON.stringify(r));

  const sourceImg =
    event && event.currentTarget
      ? event.currentTarget.querySelector(".rc-cover")
      : null;
  const coverImg = document.getElementById("profileCoverImg");
  const hasCover = !!(r.cover && String(r.cover).trim());
  const targetImg = hasCover ? coverImg : null;

  runViewTransition(sourceImg, targetImg, r.cover, () => {
    fillRestaurantProfileDOM(r);
    showPage("pageRestProfile");
  });
}


// ============================================================
// LISTEN TO CATEGORIES
// ============================================================

function listenToCategories() {

  try {

    const q =
      query(
        collection(
          db,
          "categories"
        )
      );


    unsubscribeCategories = onSnapshot(
      q,
      snapshot => {
        // A cold offline cache reports "0 documents" before the server has
        // ever answered. Treating that as authoritative would tell the user
        // this app has no categories instead of that the connection is down —
        // hold the skeletons and let the 9s watchdog show the real error.
        if (snapshot.empty && snapshot.metadata.fromCache) return;

        allCategories =
          [];


        const adminCatContainer =
          document.getElementById(
            "adminManageCategoriesContainer"
          );


        const selectDropdown =
          document.getElementById(
            "adminCategory"
          );


        if (adminCatContainer)

          adminCatContainer.innerHTML =
            "";


        if (selectDropdown)

          selectDropdown.innerHTML =
            '<option value="">اختر القسم...</option>';


        snapshot.forEach(
          docSnap => {

            const data =
              docSnap.data();


            const id =
              docSnap.id;


            allCategories.push({
              id,
              ...data
            });

          }
        );

        allCategories.sort((a, b) => {
          const orderA = a.order !== undefined && a.order !== null ? Number(a.order) : 999;
          const orderB = b.order !== undefined && b.order !== null ? Number(b.order) : 999;
          return orderA - orderB;
        });

        categoriesLoaded = true;
        categoriesLoadFailed = false;

        allCategories.forEach(data => {
          const id = data.id;

          if (selectDropdown) {

            const option =
              document.createElement(
                "option"
              );


            option.value =
              id;


            option.textContent =
              data.nameAr ||
              data.nameEn;


            selectDropdown.appendChild(
              option
            );

          }


          if (adminCatContainer) {

            const item =
              document.createElement(
                "div"
              );


            item.className = "admin-row";


            item.innerHTML = `

              <div class="admin-row-main">
                <span class="admin-row-title">${data.nameAr || ""}</span>
                <span class="admin-row-sub">${
                  data.order !== undefined && data.order !== null
                    ? `#${data.order} · `
                    : ""
                }${data.nameEn || ""}</span>
              </div>

              <div class="admin-row-actions">

                <button
                  class="btn btn-sm btn-ghost"
                  type="button"
                  onclick="window.editCategory('${id}', '${String(data.nameAr || "").replace(/'/g, "\\'")}', '${String(data.nameEn || "").replace(/'/g, "\\'")}', ${data.order !== undefined && data.order !== null ? data.order : 'null'}, '${String(data.imgUrl || "").replace(/'/g, "\\'")}')"
                >
                  تعديل
                </button>

                <button
                  class="btn btn-sm btn-danger"
                  type="button"
                  onclick="window.deleteCategoryFromFirebase('${id}')"
                >
                  حذف
                </button>

              </div>

            `;


            adminCatContainer.appendChild(
              item
            );

          }
        });

        if (adminCatContainer && adminCatContainer.children.length === 0) {
          adminCatContainer.innerHTML =
            '<div class="admin-list-note">ما في أقسام منشورة بعد.</div>';
        }


        filterCategories();

      },
      error => handleSnapshotError("categories", error)
    );

  } catch (e) {

    handleSnapshotError("categories", e);

  }

}


// ============================================================
// LISTEN TO RESTAURANTS
// ============================================================

function listenToRestaurants() {

  try {

    const q =
      query(
        collection(
          db,
          "restaurants"
        ),
        orderBy(
          "createdAt",
          "desc"
        )
      );


    unsubscribeRestaurants = onSnapshot(
      q,
      snapshot => {
        // same as categories: an empty cache snapshot is not an answer
        if (snapshot.empty && snapshot.metadata.fromCache) return;

        allRestaurants =
          [];


        const adminRestContainer =
          document.getElementById(
            "adminManageListContainer"
          );


        if (adminRestContainer)

          adminRestContainer.innerHTML =
            "";


        snapshot.forEach(
          docSnap => {

            const data =
              docSnap.data();


            const id =
              docSnap.id;


            allRestaurants.push({
              id,
              ...data
            });


            if (adminRestContainer) {

              const item =
                document.createElement(
                  "div"
                );


              const restaurantObject = {
                id: id,
                category: data.category || "",
                name: data.name || "",
                desc: data.desc || "",
                openTime: data.openTime || "11:00",
                closeTime: data.closeTime || "02:00",
                cover: data.cover || "",
                logo: data.logo || "",
                gallery: data.gallery || [],
                phone: data.phone || "",
                menu: data.menu || "",
                map: data.map || "",
                rating: data.rating ?? "",
                coverStoragePath: data.coverStoragePath || "",
                logoStoragePath: data.logoStoragePath || "",
                galleryStoragePaths: data.galleryStoragePaths || []
              };


              const objectString =
                JSON.stringify(
                  restaurantObject
                ).replace(
                  /"/g,
                  "&quot;"
                );


              const matchedCategory = allCategories.find(
                c => c.id === (data.category || "")
              );

              const categoryLabel = matchedCategory
                ? matchedCategory.nameAr || matchedCategory.nameEn || ""
                : "";

              const metaLabel = [
                categoryLabel,
                `${data.openTime || "11:00"} – ${data.closeTime || "02:00"}`
              ]
                .filter(Boolean)
                .join(" · ");


              item.className = "admin-row";

              item.innerHTML = `

                <div class="admin-row-main">
                  <span class="admin-row-title">${data.name || ""}</span>
                  <span class="admin-row-sub">${metaLabel}</span>
                </div>

                <div class="admin-row-actions">

                  <button
                    class="btn btn-sm btn-ghost"
                    type="button"
                    onclick="window.editRestaurant(${objectString})"
                  >
                    تعديل
                  </button>

                  <button
                    class="btn btn-sm btn-danger"
                    type="button"
                    onclick="window.deleteRestaurantFromFirebase('${id}')"
                  >
                    حذف
                  </button>

                </div>

              `;


              adminRestContainer.appendChild(
                item
              );

            }

          }
        );

        restaurantsLoaded = true;
        restaurantsLoadFailed = false;

        if (adminRestContainer && adminRestContainer.children.length === 0) {
          adminRestContainer.innerHTML =
            '<div class="admin-list-note">ما في مطاعم منشورة بعد.</div>';
        }


        if (currentCategoryFilter) {
          // إعادة ملء معلومات الهيرو المخصصة للقسم في الصفحة الثالثة إذا تمت إعادتها بعد الـ Refresh
          const heroTitle = document.getElementById("categoryHeroTitle");
          const heroImg = document.getElementById("categoryHeroImg");
          if (heroTitle) heroTitle.innerText = localStorage.getItem("currentCategoryName") || "المطاعم";
          setImgSrc(heroImg, localStorage.getItem("currentCategoryImg") || "");

          const restaurantsPage = document.getElementById("pageRestaurants");
          const pageActive = !!(restaurantsPage && restaurantsPage.classList.contains("active"));
          const listContainer = document.getElementById("restaurantsListContainer");
          const waiting = !!(listContainer && listContainer.querySelector(".skel-card, .empty"));

          // Re-render on entry or while still waiting — but never wipe a search
          // the user is typing into, and never reshuffle under a rendered list.
          if (pageActive || waiting) {
            const searchInput = document.getElementById("restaurantsSearchInput");
            const activeQuery = ((searchInput && searchInput.value) || "").trim().toLowerCase();
            renderRestaurantsList(activeQuery, !activeQuery);
          }
        }

        renderHomeSaved();

      },
      error => handleSnapshotError("restaurants", error)
    );


  } catch (e) {

    handleSnapshotError("restaurants", e);

  }

}


// ============================================================
// EDIT RESTAURANT
// ============================================================

function editRestaurant(
  restaurant
) {

  const editDocId =
    document.getElementById(
      "editDocId"
    );


  const adminCategory =
    document.getElementById(
      "adminCategory"
    );


  const adminName =
    document.getElementById(
      "adminName"
    );


  const adminDesc =
    document.getElementById(
      "adminDesc"
    );

  const adminOpenTime =
    document.getElementById("adminOpenTime");

  const adminCloseTime =
    document.getElementById("adminCloseTime");

  const adminCover =
    document.getElementById("adminCover");


  const adminLogo =
    document.getElementById(
      "adminLogo"
    );


  const adminGallery =
    document.getElementById(
      "adminGallery"
    );


  const adminPhone =
    document.getElementById(
      "adminPhone"
    );


  const adminMenu =
    document.getElementById(
      "adminMenu"
    );


  const adminMap =
    document.getElementById(
      "adminMap"
    );


  if (editDocId)

    editDocId.value =
      restaurant.id;


  if (adminCategory)

    adminCategory.value =
      restaurant.category || "";


  if (adminName)

    adminName.value =
      restaurant.name || "";


  if (adminDesc)

    adminDesc.value =
      restaurant.desc || "";

  if (adminOpenTime)
    adminOpenTime.value = restaurant.openTime || "11:00";

  if (adminCloseTime)
    adminCloseTime.value = restaurant.closeTime || "02:00";

  if (adminCover)
    adminCover.value = restaurant.cover || "";


  if (adminLogo)

    adminLogo.value =
      restaurant.logo || "";


  if (adminGallery)

    adminGallery.value =
      Array.isArray(
        restaurant.gallery
      )
        ? restaurant.gallery.join(", ")
        : "";


  if (adminPhone)

    adminPhone.value =
      restaurant.phone || "";


  if (adminMenu)

    adminMenu.value =
      restaurant.menu || "";


  if (adminMap)

    adminMap.value =
      restaurant.map || "";


  setAdminRating(
    restaurant.rating
  );


  const formTitle =
    document.getElementById(
      "formTitle"
    );


  if (formTitle)

    formTitle.innerText =
      "تعديل المطعم";

  const coverFile =
    document.getElementById("adminCoverFile");


  const logoFile =
    document.getElementById(
      "adminLogoFile"
    );


  const galleryFiles =
    document.getElementById(
      "adminGalleryFiles"
    );

  if (coverFile) coverFile.value = "";


  if (logoFile)

    logoFile.value =
      "";


  if (galleryFiles)

    galleryFiles.value =
      "";

  const coverPreview =
    document.getElementById("coverPreview");


  const logoPreview =
    document.getElementById(
      "logoPreview"
    );


  const galleryPreview =
    document.getElementById(
      "galleryPreview"
    );

  if (coverPreview) {
    coverPreview.src = restaurant.cover || "";
    coverPreview.style.display = restaurant.cover ? "block" : "none";
  }


  if (logoPreview) {

    logoPreview.src =
      restaurant.logo || "";

    logoPreview.style.display =
      restaurant.logo
        ? "block"
        : "none";

  }


  if (galleryPreview)

    galleryPreview.innerHTML =
      "";

}


// ============================================================
// IMAGE PREVIEWS SETUP
// ============================================================

function setupImagePreviews() {

  const catInput = document.getElementById("adminCatFile");
  const catPreview = document.getElementById("catPreview");

  if (catInput) {
    catInput.addEventListener("change", () => {
      const file = catInput.files?.[0];
      if (!file) {
        if (catPreview) catPreview.style.display = "none";
        return;
      }
      if (!file.type.startsWith("image/")) {
        alert("يرجى اختيار صورة صحيحة.");
        catInput.value = "";
        return;
      }
      const reader = new FileReader();
      reader.onload = e => {
        if (catPreview) {
          catPreview.src = e.target.result;
          catPreview.style.display = "block";
        }
      };
      reader.readAsDataURL(file);
    });
  }

  const coverInput = document.getElementById("adminCoverFile");
  const coverPreview = document.getElementById("coverPreview");

  if (coverInput) {
    coverInput.addEventListener("change", () => {
      const file = coverInput.files?.[0];
      if (!file) {
        if (coverPreview) coverPreview.style.display = "none";
        return;
      }
      if (!file.type.startsWith("image/")) {
        alert("يرجى اختيار صورة صحيحة.");
        coverInput.value = "";
        return;
      }
      const reader = new FileReader();
      reader.onload = e => {
        if (coverPreview) {
          coverPreview.src = e.target.result;
          coverPreview.style.display = "block";
        }
      };
      reader.readAsDataURL(file);
    });
  }

  const logoInput =
    document.getElementById(
      "adminLogoFile"
    );


  const logoPreview =
    document.getElementById(
      "logoPreview"
    );


  const galleryInput =
    document.getElementById(
      "adminGalleryFiles"
    );


  const galleryPreview =
    document.getElementById(
      "galleryPreview"
    );


  if (logoInput) {

    logoInput.addEventListener(
      "change",
      () => {

        const file =
          logoInput.files?.[0];


        if (!file) {

          if (logoPreview)
            logoPreview.style.display =
              "none";

          return;

        }


        if (
          !file.type.startsWith(
            "image/"
          )
        ) {

          alert(
            "يرجى اختيار صورة صحيحة."
          );


          logoInput.value =
            "";

          return;

        }


        if (file.size > MAX_IMAGE_SIZE) {

          alert(
            "حجم صورة الشعار يجب أن يكون أقل من 5 MB."
          );


          logoInput.value =
            "";

          return;

        }


        const reader =
          new FileReader();


        reader.onload =
          event => {

            if (logoPreview) {

              logoPreview.src =
                event.target.result;

              logoPreview.style.display =
                "block";

            }

          };


        reader.readAsDataURL(
          file
        );

      }
    );

  }


  if (galleryInput) {

    galleryInput.addEventListener(
      "change",
      () => {

        if (galleryPreview)
          galleryPreview.innerHTML =
            "";


        const files =
          Array.from(
            galleryInput.files || []
          );


        if (
          files.length >
          MAX_GALLERY_IMAGES
        ) {

          alert(
            "يمكنك اختيار 20 صورة كحد أقصى."
          );


          galleryInput.value =
            "";

          return;

        }


        files.forEach(
          file => {

            if (
              !file.type.startsWith(
                "image/"
              )
            ) {

              return;

            }


            if (file.size > MAX_IMAGE_SIZE) {

              alert(
                `"${file.name}" أكبر من 5 MB.`
              );

              return;

            }


            const reader =
              new FileReader();


            reader.onload =
              event => {

                const img =
                  document.createElement(
                    "img"
                  );


                img.src =
                  event.target.result;


                img.alt =
                  "Gallery Preview";


                if (galleryPreview)
                  galleryPreview.appendChild(
                    img
                  );

              };


            reader.readAsDataURL(
              file
            );

          }
        );

      }
    );

  }

}


// ============================================================
// DOM READY & REALTIME STATUS CHECK
// ============================================================

document.addEventListener(
  "DOMContentLoaded",
  () => {

    listenToCategories();

    listenToRestaurants();

    setupImagePreviews();

    setInterval(() => {
      if (currentCategoryFilter) {
        renderRestaurantsList("", false);
      }
    }, 60000);

  }
);


// ============================================================
// PWA INSTALL MODAL LOGIC (زر أندرويد -> Chrome install prompt)
// ============================================================

// NOTE: window.deferredPrompt is captured early in index.html <head>.
// Here we only keep a fallback listener in case module loaded first.
window.deferredPrompt = window.deferredPrompt || null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.deferredPrompt = e;
  // Only Chrome fires this again after the app was removed from the device.
  if (isPwaInstalled()) showPwaInstallSection();
});

function isStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches ||
         window.navigator.standalone === true;
}

function isPwaInstalled() {
  try {
    return localStorage.getItem(window.PWA_INSTALLED_KEY) === '1';
  } catch (e) {
    return false;
  }
}

// Hides the whole "ثبّت التطبيق على شاشتك" block (title + both buttons).
function hidePwaInstallButtons(persist) {
  document.querySelectorAll('.pwa-download-container, #installSection').forEach((el) => {
    el.style.display = 'none';
  });
  const modal = document.getElementById('pwaModal');
  if (modal) modal.style.display = 'none';
  if (persist) {
    try { localStorage.setItem(window.PWA_INSTALLED_KEY, '1'); } catch (e) {}
  }
}

function showPwaInstallSection() {
  try { localStorage.removeItem(window.PWA_INSTALLED_KEY); } catch (e) {}
  const section = document.getElementById('installSection');
  if (section) section.style.display = '';
  document.querySelectorAll('.pwa-download-container').forEach((el) => {
    el.style.display = '';
  });
}

window.hidePwaInstallButtons = hidePwaInstallButtons;
window.showPwaInstallSection = showPwaInstallSection;

window.triggerInstallModal = function() {
  // لا تعرض أي شيء داخل التطبيق المثبت
  if (isStandaloneMode()) {
    hidePwaInstallButtons(true);
    return;
  }
  const modal = document.getElementById('pwaModal');
  // إذا توفر Chrome prompt نعرض نافذة التأكيد أولاً
  if (window.deferredPrompt && modal) {
    modal.style.display = 'flex';
    return;
  }
  // إذا توفر prompt بدون modal (حالة نادرة) نفّذه مباشرة
  if (window.deferredPrompt) {
    promptAndroidInstall();
    return;
  }
  // لا يوجد prompt: التطبيق مثبت أو المتصفح لا يدعم — إرشاد يدوي
  alert('للتثبيت يدوياً من Chrome: اضغط ⋮ ثم "Add to Home screen" أو "Install app".');
};

async function promptAndroidInstall() {
  const modal = document.getElementById('pwaModal');
  if (!window.deferredPrompt) {
    alert('ميزة التثبيت غير متاحة حالياً أو أن التطبيق مثبت مسبقاً على هاتفك. يمكنك تثبيته يدوياً من إعدادات المتصفح (إضافة إلى الشاشة الرئيسية).');
    if (modal) modal.style.display = 'none';
    return;
  }
  try {
    window.deferredPrompt.prompt();
    const { outcome } = await window.deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      console.log('User accepted the install prompt');
      hidePwaInstallButtons(true);
    }
  } catch (err) {
    console.error('Install prompt failed:', err);
  } finally {
    window.deferredPrompt = null;
    if (modal) modal.style.display = 'none';
  }
}

window.promptAndroidInstall = promptAndroidInstall;

window.addEventListener('appinstalled', () => {
  window.deferredPrompt = null;
  hidePwaInstallButtons(true);
});

document.addEventListener('DOMContentLoaded', () => {
  // إخفاء بلوك التثبيت كاملاً إذا فُتح الموقع كتطبيق مثبّت
  // أو إذا كان التثبيت مسجّلاً مسبقاً من زيارة سابقة
  if (isStandaloneMode()) {
    hidePwaInstallButtons(true);
    return;
  }
  if (isPwaInstalled()) {
    hidePwaInstallButtons(false);
    return;
  }

  const installBtn = document.getElementById('pwaInstallBtn');
  const closeBtn = document.getElementById('pwaCloseBtn');
  const modal = document.getElementById('pwaModal');

  if (installBtn) {
    installBtn.addEventListener('click', promptAndroidInstall);
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      if (modal) modal.style.display = 'none';
    });
  }

  // إغلاق النافذة عند الضغط خارجها
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });
  }
});


// ============================================================
// GLOBAL FUNCTIONS EXPORT
// ============================================================

window.showPage =
  showPage;

window.goBack =
  goBack;

window.openCategories =
  openCategories;

window.resetCategoryForm =
  resetCategoryForm;

window.saveCategoryToFirebase =
  saveCategoryToFirebase;

window.editCategory =
  editCategory;

window.deleteCategoryFromFirebase =
  deleteCategoryFromFirebase;

window.resetAdminForm =
  resetAdminForm;

window.saveRestaurantToFirebase =
  saveRestaurantToFirebase;

window.deleteRestaurantFromFirebase =
  deleteRestaurantFromFirebase;

window.checkAdminAccess =
  checkAdminAccess;

window.handleFooterTap =
  handleFooterTap;

window.toggleFavorite =
  toggleFavorite;

window.isFavorite =
  isFavorite;

window.ratingHtml =
  ratingHtml;

window.performAdminLogin =
  performAdminLogin;

window.logoutAdmin =
  logoutAdmin;

window.filterCategories =
  filterCategories;

window.filterRestaurants =
  filterRestaurants;

window.openRestaurantsByCategory =
  openRestaurantsByCategory;

window.openRestaurantProfile =
  openRestaurantProfile;

window.editRestaurant =
  editRestaurant;

window.sendSecureOrderWhatsApp =
  sendSecureOrderWhatsApp;

window.showToast =
  showToast;

window.showConfirm =
  showConfirm;


// ============================================================
// DESIGN SYSTEM WIRING (presentation only)
// ============================================================

function wireSearchField(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;

  const wrap = input.closest(".search-field");
  if (!wrap) return;

  const clear = wrap.querySelector(".search-clear");

  const sync = () => {
    wrap.classList.toggle("has-value", input.value.length > 0);
  };

  input.addEventListener("input", sync);

  if (clear) {
    clear.addEventListener("click", () => {
      input.value = "";
      sync();
      input.focus();
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  sync();
}

function initDesignSystem() {
  wireSearchField("categoriesSearchInput");
  wireSearchField("restaurantsSearchInput");
  setupRatingPicker();

  /* --- Lightbox controls --- */
  const lightbox = document.getElementById("lightbox");
  const closeBtn = document.getElementById("lightboxClose");
  const prevBtn = document.getElementById("lightboxPrev");
  const nextBtn = document.getElementById("lightboxNext");

  if (closeBtn) closeBtn.addEventListener("click", closeLightbox);
  if (prevBtn) prevBtn.addEventListener("click", () => stepLightbox(-1));
  if (nextBtn) nextBtn.addEventListener("click", () => stepLightbox(1));

  if (lightbox) {
    lightbox.addEventListener("click", event => {
      if (event.target === lightbox) closeLightbox();
    });
  }

  document.addEventListener("keydown", event => {
    const open = document.getElementById("lightbox");
    if (open && !open.hidden) {
      if (event.key === "Escape") closeLightbox();
      if (event.key === "ArrowLeft") stepLightbox(1);
      if (event.key === "ArrowRight") stepLightbox(-1);
      return;
    }
    if (event.key === "Escape") {
      const guide = document.getElementById("iosGuideModal");
      if (guide && guide.style.display === "flex" && typeof closeIosGuide === "function") {
        closeIosGuide();
      }
      const pwa = document.getElementById("pwaModal");
      if (pwa && pwa.style.display === "flex") pwa.style.display = "none";
    }
  });

  /* --- One delegated listener serves every empty/error state CTA --- */
  wireEmptyStateActions();

  /* --- The category moment is skippable: any tap while it plays --- */
  const momentLayer = document.getElementById("momentLayer");
  if (momentLayer) momentLayer.addEventListener("pointerdown", skipCategoryMoment);

  /* --- The broken hero photo retries against real category photography --- */
  const regionImg = document.querySelector(".region-img");
  if (regionImg && !regionImg.dataset.wired) {
    regionImg.dataset.wired = "1";
    regionImg.addEventListener("error", fixRegionImage);
  }

  /* --- Launch screen: the first open of this session only --- */
  initSplash();

  /* --- Homepage entrance waits for the screen to lift, never for data --- */
  whenShellReady(() => {
    if (document.body.classList.contains("is-home")) {
      document.body.classList.add("is-entering");
      setTimeout(() => document.body.classList.remove("is-entering"), 1500);
    }
    revealActivePage(document.querySelector(".view-page.active"));
  });

  /* --- Images already in cache finish their develop instantly --- */
  sweepImages(document);

  /* --- Loading skeletons until the first Firestore snapshot --- */
  if (!categoriesLoaded) renderCategorySkeleton();
  if (!restaurantsLoaded) renderRestaurantSkeleton();

  /* --- If Firestore never answers (offline), swap skeletons for a real
         error state instead of an endless shimmer --- */
  setTimeout(function () {
    const grid = document.getElementById("categoriesGridContainer");
    if (!categoriesLoaded && grid && !grid.querySelector(".category-card")) {
      grid.innerHTML = loadErrorHtml("categories");
      wireEmptyStateActions();
    }

    const list = document.getElementById("restaurantsListContainer");
    if (!restaurantsLoaded && list && !list.querySelector(".restaurant-card")) {
      list.innerHTML = loadErrorHtml("restaurants");
      wireEmptyStateActions();
    }
  }, 9000);
}

window.addEventListener("DOMContentLoaded", initDesignSystem);
window.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('install') === 'true') {
        // تأخير بسيط ثانية لضمان تحميل الصفحة، بعدين بتفتح نافذة التنزيل
        setTimeout(() => {
            if (window.triggerInstallModal) {
                window.triggerInstallModal();
            }
        }, 800);
    }
});
