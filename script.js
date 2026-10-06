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
function emptyStateHtml(title, text) {
  return (
    '<div class="empty">' +
      '<div class="empty-mark">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5L16.5 16.5"/>' +
        "</svg>" +
      "</div>" +
      '<div class="empty-title">' + title + "</div>" +
      '<div class="empty-text">' + text + "</div>" +
    "</div>"
  );
}

function renderCategorySkeleton() {
  const grid = document.getElementById("categoriesGridContainer");
  if (!grid) return;
  let html = "";
  for (let i = 0; i < 6; i++) html += '<div class="skel skel-cat"></div>';
  grid.innerHTML = html;
}

function renderRestaurantSkeleton() {
  const box = document.getElementById("restaurantsListContainer");
  if (!box) return;
  let html = "";
  for (let i = 0; i < 3; i++) html += '<div class="skel skel-rc"></div>';
  box.innerHTML = html;
}

/* --- Broken-image fallback ------------------------------------------- */
document.addEventListener(
  "error",
  event => {
    const target = event.target;
    if (target && target.tagName === "IMG" && target.getAttribute("src")) {
      target.classList.add("is-broken");
    }
  },
  true
);

document.addEventListener(
  "load",
  event => {
    const target = event.target;
    if (target && target.tagName === "IMG") target.classList.remove("is-broken");
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
    targetPage.classList.add("active");
    targetPage.style.display = "block";
  }

  const backBtn = document.getElementById("backBtn");
  if (backBtn) {
    backBtn.style.display = (pageId === "pageHome") ? "none" : "flex";
  }

  // Dynamic app-bar title — presentation only
  const titleEl = document.getElementById("headerTitleText");
  if (titleEl) {
    titleEl.textContent = getPageTitle(pageId);
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

  // إذا تم فتح صفحة المطاعم، نخلط المطاعم عشوائياً
  if (pageId === "pageRestaurants" && currentCategoryFilter) {
    renderRestaurantsList("", true);
  }

  window.scrollTo(0, 0);
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

    grid.innerHTML = queryStr
      ? emptyStateHtml(
          "لا توجد نتائج",
          "ما لقينا قسم بهذا الاسم. جرّب كلمة تانية."
        )
      : emptyStateHtml(
          "لا توجد أقسام بعد",
          "أضف الأقسام من لوحة الإدارة، ومنرجع تاني."
        );

    return;

  }


  filtered.forEach(data => {

    const card =
      document.createElement("div");


    card.className =
      "category-card";


    card.onclick = () =>
      openRestaurantsByCategory(
        data.id,
        data.nameAr ||
          data.nameEn,
        data.imgUrl
      );

    makeCardInteractive(card, card.onclick);


    card.innerHTML = `

      <div class="cat-media">
        <img
          src="${
            data.imgUrl ||
            "https://via.placeholder.com/400x300"
          }"
          alt="${data.nameAr || ""}"
          loading="lazy"
          decoding="async"
        >
      </div>

      <div class="cat-body">
        <span class="cat-name">${data.nameAr || ""}</span>
        <svg class="cat-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
      </div>

      ${
        data.nameEn
          ? `<div class="cat-en">${data.nameEn}</div>`
          : ""
      }

    `;


    grid.appendChild(card);

  });

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
// OPEN RESTAURANTS BY CATEGORY (WITH SAVED FILTER STATE)
// ============================================================

function openRestaurantsByCategory(
  catId,
  catName,
  catImg
) {

  currentCategoryFilter = catId;
  
  // حفظ القسم المحدد في الـ localStorage لكي لا يضيع عند إعادة التحميل
  localStorage.setItem("currentCategoryFilter", catId);
  if (catName) localStorage.setItem("currentCategoryName", catName);
  if (catImg) localStorage.setItem("currentCategoryImg", catImg);

  const heroTitle =
    document.getElementById(
      "categoryHeroTitle"
    );


  const heroImg =
    document.getElementById(
      "categoryHeroImg"
    );


  if (heroTitle)
    heroTitle.innerText = catName || "المطاعم";


  if (heroImg)
    heroImg.src =
      catImg ||
      "https://via.placeholder.com/400x150";


  renderRestaurantsList("", true);


  showPage(
    "pageRestaurants"
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
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12;
  hour = hour ? hour : 12;
  return `${hour}:${minStr} ${ampm}`;
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

    container.innerHTML = searchQuery
      ? emptyStateHtml(
          "لا توجد نتائج",
          "ما لقينا مطعم بهالاسم داخل هالقسم. جرّب اسم تاني."
        )
      : emptyStateHtml(
          "ما في مطاعم هون لحدّا",
          "جرّب قسم تاني أو تصفّح الأقسام الرئيسية."
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


  finalOrderedList.forEach(r => {

    const card =
      document.createElement("div");


    const closed = isRestaurantClosed(r.openTime, r.closeTime);

    card.className =
      `restaurant-card ${closed ? 'is-closed' : 'is-open'}`;


    card.onclick = () =>
      openRestaurantProfile(r);

    makeCardInteractive(card, card.onclick);

    const formattedOpenTime = format12HourTime(r.openTime || "11:00");
    const formattedCloseTime = format12HourTime(r.closeTime || "");

    const logoUrl = r.logo || "https://via.placeholder.com/200";
    const hasCover = !!(r.cover && String(r.cover).trim());

    const mediaHtml = hasCover
      ? `
        <div class="rc-media">
          <img class="rc-cover" src="${r.cover}" alt="" loading="lazy" decoding="async">
          <img class="rc-logo" src="${logoUrl}" alt="" loading="lazy" decoding="async">
        </div>`
      : `
        <div class="rc-media is-brand">
          <img class="rc-brand" src="${logoUrl}" alt="" loading="lazy" decoding="async">
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

      <div class="rc-body">
        <div class="rc-head">
          <h3 class="rc-name">${r.name || ""}</h3>
          <span class="status ${closed ? "is-closed" : "is-open"}"><i></i>${closed ? "مغلق" : "مفتوح"}</span>
        </div>

        <p class="rc-desc">${r.desc || ""}</p>

        <div class="rc-meta">
          <span class="rc-meta-time">${timeText}</span>
          <svg class="rc-meta-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
        </div>
      </div>

    `;


    container.appendChild(card);

  });

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

  /* --- Cover banner (new presentation element) --- */
  const coverWrap = document.getElementById("profileCover");
  const coverImg = document.getElementById("profileCoverImg");
  if (coverWrap && coverImg) {
    if (r.cover) {
      coverImg.src = r.cover;
      coverImg.alt = (r.name || "") + " — صورة الغلاف";
      coverWrap.hidden = false;
    } else {
      coverImg.removeAttribute("src");
      coverWrap.hidden = true;
    }
  }

  if (profileLogo)
    profileLogo.src = r.logo || "https://via.placeholder.com/200";

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

function openRestaurantProfile(r) {
  // حفظ بيانات المطعم الحالي في الـ localStorage لتفادي فقدانها عند عمل Refresh
  localStorage.setItem("currentRestaurantProfile", JSON.stringify(r));

  fillRestaurantProfileDOM(r);

  showPage("pageRestProfile");
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


    onSnapshot(
      q,
      snapshot => {

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

      }
    );


  } catch (e) {

    console.error(e);

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


    onSnapshot(
      q,
      snapshot => {

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

        if (adminRestContainer && adminRestContainer.children.length === 0) {
          adminRestContainer.innerHTML =
            '<div class="admin-list-note">ما في مطاعم منشورة بعد.</div>';
        }


        if (currentCategoryFilter) {
          // إعادة ملء معلومات الهيرو المخصصة للقسم في الصفحة الثالثة إذا تمت إعادتها بعد الـ Refresh
          const heroTitle = document.getElementById("categoryHeroTitle");
          const heroImg = document.getElementById("categoryHeroImg");
          if (heroTitle) heroTitle.innerText = localStorage.getItem("currentCategoryName") || "المطاعم";
          if (heroImg) heroImg.src = localStorage.getItem("currentCategoryImg") || "https://via.placeholder.com/400x150";

          renderRestaurantsList("", true);
        }

      }
    );


  } catch (e) {

    console.error(e);

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
});

function isStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches ||
         window.navigator.standalone === true;
}

function hidePwaInstallButtons() {
  document.querySelectorAll('.pwa-download-container').forEach((el) => {
    el.style.display = 'none';
  });
  const modal = document.getElementById('pwaModal');
  if (modal) modal.style.display = 'none';
}

window.hidePwaInstallButtons = hidePwaInstallButtons;

window.triggerInstallModal = function() {
  // لا تعرض أي شيء داخل التطبيق المثبت
  if (isStandaloneMode()) {
    hidePwaInstallButtons();
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
      hidePwaInstallButtons();
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
  hidePwaInstallButtons();
});

document.addEventListener('DOMContentLoaded', () => {
  // إخفاء زري التثبيت (أندرويد + آيفون) إذا فُتح الموقع كتطبيق standalone
  if (isStandaloneMode()) {
    hidePwaInstallButtons();
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

  /* --- Loading skeletons until the first Firestore snapshot --- */
  if (!categoriesLoaded) renderCategorySkeleton();
  if (!restaurantsLoaded && currentCategoryFilter) renderRestaurantSkeleton();

  /* --- If Firestore never answers (offline), swap skeletons for a real
         error state instead of an endless shimmer --- */
  setTimeout(function () {
    const grid = document.getElementById("categoriesGridContainer");
    if (!categoriesLoaded && grid && !grid.querySelector(".category-card")) {
      grid.innerHTML = emptyStateHtml(
        "تعذّر تحميل الأقسام",
        "تحقّق من اتصالك بالإنترنت ثم أعد تحميل الصفحة."
      );
    }

    const list = document.getElementById("restaurantsListContainer");
    if (!restaurantsLoaded && list && !list.querySelector(".restaurant-card")) {
      list.innerHTML = emptyStateHtml(
        "تعذّر تحميل المطاعم",
        "تحقّق من اتصالك بالإنترنت ثم أعد تحميل الصفحة."
      );
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
