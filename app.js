/* =========================================================
   JOM BATOKOK — ABSENSI KARYAWAN
   app.js — Frontend Logic
   ========================================================= */

/* ---------------------------------------------------------
   CONFIG — Arahkan URL ini ke Web App Google Apps Script Anda
   --------------------------------------------------------- */
const GOOGLE_SCRIPT_URL = "YOUR_APP_SCRIPT_URL_HERE";

/* ---------------------------------------------------------
   CONFIG — Sistem geofencing (absen hanya bisa di area lokasi)
   Koordinat 3 cabang di bawah ini diambil dari data resmi
   "Jom Batokok" di Google Maps. Untuk "Central Kitchen",
   silakan isi lat/lng-nya sendiri:
   caranya buka Google Maps > tekan lama titik lokasi dapur
   > salin 2 angka koordinat yang muncul di kotak pencarian.

   radiusMeters = toleransi jarak (radius) dari titik tersebut.
   Kalau lat/lng diisi `null`, pengecekan lokasi untuk cabang
   itu otomatis DILEWATI (tidak diblokir).
   --------------------------------------------------------- */
const LOCATIONS_GEO = {
  "Jom Sinpasa": { lat: -6.2294775, lng: 107.0005841, radiusMeters: 500 },
  "Jom Santa": { lat: -6.2398766, lng: 106.8121225, radiusMeters: 500 },
  "Jom Galaxy": { lat: -6.2748538, lng: 106.9733628, radiusMeters: 500 },
  "Central Kitchen": { lat: null, lng: null, radiusMeters: 500 }, // TODO: isi koordinat asli dapur
  "Office Puri": { lat: null, lng: null, radiusMeters: 500 }, // TODO: isi koordinat asli kantor
};

/**
 * Menghitung jarak antar 2 koordinat (meter) pakai rumus Haversine.
 */
function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // radius bumi dalam meter
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Mengecek apakah posisi HP saat ini berada dalam radius lokasi kerja.
 * @returns {Promise<{allowed: boolean, reason: string, distance?: number}>}
 */
function verifyGeofence(locationName) {
  const geo = LOCATIONS_GEO[locationName];

  if (!geo || geo.lat === null || geo.lng === null) {
    console.warn(`Koordinat untuk "${locationName}" belum diatur — geofencing dilewati.`);
    return Promise.resolve({ allowed: true, reason: "not_configured" });
  }

  if (!("geolocation" in navigator)) {
    return Promise.resolve({ allowed: false, reason: "unsupported" });
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const distance = getDistanceMeters(
          position.coords.latitude,
          position.coords.longitude,
          geo.lat,
          geo.lng
        );
        resolve({
          allowed: distance <= geo.radiusMeters,
          reason: "checked",
          distance,
        });
      },
      (error) => {
        resolve({ allowed: false, reason: "denied", error });
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  });
}

/* ---------------------------------------------------------
   STATE
   --------------------------------------------------------- */
const state = {
  step: 1,
  location: null,
  employeeName: null,
  status: null,       // "MASUK" | "KELUAR"
  photoBase64: null,
  timestamp: null,
};

let mediaStream = null;
let successTimer = null;

/* ---------------------------------------------------------
   DOM REFERENCES
   --------------------------------------------------------- */
const els = {
  stepPanels: document.querySelectorAll(".step-panel"),
  stepDots: document.querySelectorAll(".step-dot"),

  locationGrid: document.getElementById("locationGrid"),
  activeLocationName: document.getElementById("activeLocationName"),
  geoStatus: document.getElementById("geoStatus"),
  geoChecking: document.getElementById("geoChecking"),
  geoError: document.getElementById("geoError"),
  geoErrorText: document.getElementById("geoErrorText"),
  geoRetryBtn: document.getElementById("geoRetryBtn"),
  geoCancelBtn: document.getElementById("geoCancelBtn"),

  employeeNameInput: document.getElementById("employeeNameInput"),
  actionButtons: document.querySelectorAll(".action-btn"),

  summaryText: document.getElementById("summaryText"),
  cameraPreview: document.getElementById("cameraPreview"),
  captureCanvas: document.getElementById("captureCanvas"),
  cameraError: document.getElementById("cameraError"),
  captureBtn: document.getElementById("captureBtn"),
  sendingIndicator: document.getElementById("sendingIndicator"),

  successDetail: document.getElementById("successDetail"),
  successProgressBar: document.getElementById("successProgressBar"),

  backButtons: document.querySelectorAll("[data-back-to]"),

  leaderboardList: document.getElementById("leaderboardList"),
  leaderboardEmpty: document.getElementById("leaderboardEmpty"),
  leaderboardDate: document.getElementById("leaderboardDate"),
};

/* ---------------------------------------------------------
   NAVIGATION HELPERS
   --------------------------------------------------------- */
function goToStep(stepNumber) {
  const currentPanel = document.querySelector(".step-panel.active");
  const nextPanel = document.querySelector(`[data-step-panel="${stepNumber}"]`);

  if (currentPanel && currentPanel !== nextPanel) {
    currentPanel.classList.add("exiting");
    currentPanel.classList.remove("active");
    setTimeout(() => currentPanel.classList.remove("exiting"), 300);
  }

  if (nextPanel) {
    nextPanel.classList.add("active");
  }

  state.step = stepNumber;
  updateStepIndicator(stepNumber);

  // Handle side-effects per step
  if (stepNumber === 3) {
    startCamera();
  } else {
    stopCamera();
  }
}

function updateStepIndicator(stepNumber) {
  els.stepDots.forEach((dot) => {
    const dotStep = parseInt(dot.dataset.step, 10);
    dot.classList.remove("active", "done");
    if (dotStep === stepNumber) {
      dot.classList.add("active");
    } else if (dotStep < stepNumber) {
      dot.classList.add("done");
    }
  });
}

/* ---------------------------------------------------------
   STEP 1 — PILIH LOKASI
   --------------------------------------------------------- */
els.locationGrid.addEventListener("click", (e) => {
  const btn = e.target.closest(".location-btn");
  if (!btn || btn.disabled) return;

  document.querySelectorAll(".location-btn").forEach((b) => b.classList.remove("selected"));
  btn.classList.add("selected");

  state.location = btn.dataset.location;
  els.activeLocationName.textContent = state.location;
  runGeofenceCheck(state.location);
});

function setLocationGridDisabled(disabled) {
  document.querySelectorAll(".location-btn").forEach((b) => (b.disabled = disabled));
}

function showGeoChecking() {
  els.geoStatus.hidden = false;
  els.geoChecking.hidden = false;
  els.geoError.hidden = true;
}

function hideGeoStatus() {
  els.geoStatus.hidden = true;
}

function showGeoError(result, locationName) {
  els.geoChecking.hidden = true;
  els.geoError.hidden = false;

  let message;
  if (result.reason === "denied") {
    message =
      "Izin lokasi ditolak atau GPS tidak aktif. Aktifkan GPS dan izinkan akses lokasi di browser untuk bisa absen.";
  } else if (result.reason === "unsupported") {
    message = "Perangkat/browser ini tidak mendukung deteksi lokasi (geolocation).";
  } else {
    message = `Anda berada ±${Math.round(result.distance)} meter dari ${locationName}. Absen hanya bisa dilakukan di area lokasi kerja.`;
  }
  els.geoErrorText.textContent = message;
}

async function runGeofenceCheck(locationName) {
  showGeoChecking();
  setLocationGridDisabled(true);

  const result = await verifyGeofence(locationName);

  setLocationGridDisabled(false);

  if (result.allowed) {
    hideGeoStatus();
    setTimeout(() => goToStep(2), 150);
    return;
  }

  showGeoError(result, locationName);
}

els.geoRetryBtn.addEventListener("click", () => {
  if (state.location) runGeofenceCheck(state.location);
});

els.geoCancelBtn.addEventListener("click", () => {
  document.querySelectorAll(".location-btn").forEach((b) => b.classList.remove("selected"));
  state.location = null;
  els.activeLocationName.textContent = "-";
  hideGeoStatus();
});

/* ---------------------------------------------------------
   STEP 2 — PILIH NAMA & STATUS
   --------------------------------------------------------- */
els.actionButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const employeeName = els.employeeNameInput.value.trim();

    if (!employeeName) {
      els.employeeNameInput.focus();
      els.employeeNameInput.style.borderColor = "var(--danger)";
      setTimeout(() => (els.employeeNameInput.style.borderColor = ""), 900);
      return;
    }

    state.employeeName = employeeName;
    state.status = btn.dataset.status;

    els.summaryText.textContent =
      `${state.employeeName} · ${state.location} · Absen ${state.status}`;

    goToStep(3);
  });
});

/* ---------------------------------------------------------
   STEP 3 — KAMERA
   --------------------------------------------------------- */
async function startCamera() {
  els.cameraError.hidden = true;
  els.captureBtn.disabled = false;

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 960 } },
      audio: false,
    });
    els.cameraPreview.srcObject = mediaStream;
  } catch (err) {
    console.error("Camera access error:", err);
    els.cameraError.hidden = false;
    els.captureBtn.disabled = true;
  }
}

function stopCamera() {
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
  els.cameraPreview.srcObject = null;
}

function capturePhotoAsBase64() {
  const video = els.cameraPreview;
  const canvas = els.captureCanvas;

  const width = video.videoWidth || 720;
  const height = video.videoHeight || 960;
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  // Mirror horizontally to match the preview the user saw
  ctx.translate(width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, width, height);

  return canvas.toDataURL("image/jpeg", 0.85); // "data:image/jpeg;base64,...."
}

els.captureBtn.addEventListener("click", async () => {
  els.captureBtn.disabled = true;

  const base64Image = capturePhotoAsBase64();
  state.photoBase64 = base64Image;
  state.timestamp = new Date().toISOString();

  els.sendingIndicator.hidden = false;

  try {
    await sendAttendanceToServer({
      cabang: state.location,
      nama: state.employeeName,
      status: state.status,
      foto: state.photoBase64,
      timestamp: state.timestamp,
    });
  } catch (err) {
    console.error("Gagal mengirim data absensi:", err);
    // no-cors mode tidak memberi kita status respons yang jelas,
    // jadi kita tetap lanjutkan alur UX ke layar sukses.
  } finally {
    addToLeaderboard({
      nama: state.employeeName,
      cabang: state.location,
      status: state.status,
      timestamp: state.timestamp,
    });
    els.sendingIndicator.hidden = true;
    stopCamera();
    showSuccessScreen();
  }
});

/* ---------------------------------------------------------
   KIRIM DATA KE GOOGLE APPS SCRIPT (Google Sheets backend)
   --------------------------------------------------------- */
async function sendAttendanceToServer(payload) {
  if (!GOOGLE_SCRIPT_URL || GOOGLE_SCRIPT_URL === "YOUR_APP_SCRIPT_URL_HERE") {
    console.warn(
      "GOOGLE_SCRIPT_URL belum diatur. Data tidak benar-benar terkirim ke server.",
      payload
    );
    return;
  }

  return fetch(GOOGLE_SCRIPT_URL, {
    method: "POST",
    mode: "no-cors", // Google Apps Script web app tidak mengembalikan header CORS
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify(payload),
  });
}

/* ---------------------------------------------------------
   STEP 4 — LAYAR SUKSES + AUTO RESET (KIOSK MODE)
   --------------------------------------------------------- */
function showSuccessScreen() {
  els.successDetail.textContent =
    `${state.employeeName} berhasil absen ${state.status} di ${state.location}.`;

  // restart the shrinking progress bar animation
  els.successProgressBar.style.animation = "none";
  void els.successProgressBar.offsetWidth; // force reflow
  els.successProgressBar.style.animation = "";

  // restart checkmark draw animation
  const checkmarkCircle = document.querySelector(".checkmark-circle");
  const checkmarkTick = document.querySelector(".checkmark-tick");
  [checkmarkCircle, checkmarkTick].forEach((el) => {
    el.style.animation = "none";
    void el.offsetWidth;
    el.style.animation = "";
  });

  goToStep(4);

  clearTimeout(successTimer);
  successTimer = setTimeout(resetToStepOne, 3000);
}

function resetToStepOne() {
  // Reset state (kecuali config)
  state.location = null;
  state.employeeName = null;
  state.status = null;
  state.photoBase64 = null;
  state.timestamp = null;

  // Reset UI
  document.querySelectorAll(".location-btn").forEach((b) => b.classList.remove("selected"));
  els.employeeNameInput.value = "";
  els.activeLocationName.textContent = "-";
  els.summaryText.textContent = "-";
  els.captureBtn.disabled = false;
  hideGeoStatus();
  setLocationGridDisabled(false);

  goToStep(1);
}

/* ---------------------------------------------------------
   BACK NAVIGATION
   --------------------------------------------------------- */
els.backButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = parseInt(btn.dataset.backTo, 10);
    if (target === 1) {
      document.querySelectorAll(".location-btn").forEach((b) => b.classList.remove("selected"));
      hideGeoStatus();
      setLocationGridDisabled(false);
    }
    goToStep(target);
  });
});

/* ---------------------------------------------------------
   CLEANUP ON PAGE HIDE (hemat baterai & privasi kamera)
   --------------------------------------------------------- */
document.addEventListener("visibilitychange", () => {
  if (document.hidden && state.step === 3) {
    stopCamera();
  } else if (!document.hidden && state.step === 3) {
    startCamera();
  }
});

/* ---------------------------------------------------------
   SERVICE WORKER REGISTRATION (opsional, untuk offline shell)
   --------------------------------------------------------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch((err) => {
      console.warn("Service worker registration gagal (opsional):", err);
    });
  });
}

/* ---------------------------------------------------------
   LEADERBOARD — "Absen Hari Ini"
   Cuma ditampilkan real-time di kiosk ini, TIDAK mengambil
   data dari Sheet. Otomatis kosong lagi besok (per tanggal).
   --------------------------------------------------------- */
const LEADERBOARD_PREFIX = "jombatokok_leaderboard_";

const BULAN_INDO = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const HARI_INDO = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

function getTodayKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${LEADERBOARD_PREFIX}${y}-${m}-${d}`;
}

function getTodayLabel() {
  const now = new Date();
  return `${HARI_INDO[now.getDay()]}, ${now.getDate()} ${BULAN_INDO[now.getMonth()]} ${now.getFullYear()}`;
}

function getTodayEntries() {
  try {
    const raw = localStorage.getItem(getTodayKey());
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveTodayEntries(entries) {
  localStorage.setItem(getTodayKey(), JSON.stringify(entries));
}

/**
 * Buang data leaderboard hari-hari sebelumnya supaya localStorage
 * gak numpuk terus (sesuai permintaan: gak perlu disimpan lama-lama).
 */
function cleanupOldLeaderboardEntries() {
  const todayKey = getTodayKey();
  Object.keys(localStorage)
    .filter((key) => key.startsWith(LEADERBOARD_PREFIX) && key !== todayKey)
    .forEach((key) => localStorage.removeItem(key));
}

function getInitials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function formatJamMenit(isoString) {
  const d = new Date(isoString);
  const jam = String(d.getHours()).padStart(2, "0");
  const menit = String(d.getMinutes()).padStart(2, "0");
  return `${jam}:${menit}`;
}

function createLeaderboardItemEl(entry) {
  const item = document.createElement("div");
  item.className = "leaderboard-item";

  const badgeClass = entry.status === "MASUK" ? "badge-masuk" : "badge-keluar";

  item.innerHTML = `
    <div class="leaderboard-avatar">${getInitials(entry.nama)}</div>
    <div class="leaderboard-info">
      <div class="leaderboard-name">${escapeHtml(entry.nama)}</div>
      <div class="leaderboard-meta">${escapeHtml(entry.cabang)}</div>
    </div>
    <div class="leaderboard-time">
      <span class="time">${formatJamMenit(entry.timestamp)}</span>
      <span class="leaderboard-badge ${badgeClass}">${entry.status}</span>
    </div>
  `;
  return item;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderLeaderboard() {
  const entries = getTodayEntries();

  els.leaderboardDate.textContent = getTodayLabel();
  els.leaderboardList.innerHTML = "";

  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "leaderboard-empty";
    empty.id = "leaderboardEmpty";
    empty.textContent = "Belum ada yang absen hari ini.";
    els.leaderboardList.appendChild(empty);
    return;
  }

  // terbaru di atas
  [...entries].reverse().forEach((entry) => {
    els.leaderboardList.appendChild(createLeaderboardItemEl(entry));
  });
}

function addToLeaderboard(entry) {
  const entries = getTodayEntries();
  entries.push(entry);
  saveTodayEntries(entries);
  renderLeaderboard();
}

/* ---------------------------------------------------------
   INIT
   --------------------------------------------------------- */
updateStepIndicator(1);
cleanupOldLeaderboardEntries();
renderLeaderboard();