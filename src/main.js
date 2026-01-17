console.log("MAIN JS CARGÓ ✅");

import "./style.css";
import { LETTERS, ACTIVITIES } from "./activities.js";
import { supabase, GAME_ID } from "./supabase.js";

const $ = (s) => document.querySelector(s);

const authBox = $("#authBox");
const appBox = $("#appBox");
const album = $("#album");

const emailInput = $("#email");
const btnLogin = $("#btnLogin");
const authMsg = $("#authMsg");

const btnChange = $("#btnChange");
const btnSignOut = $("#btnSignOut");

const currentLetterEl = $("#currentLetter");
const doneCountEl = $("#doneCount");
const totalCountEl = $("#totalCount");

// Modal
const modal = $("#modal");
const btnClose = $("#btnClose");
const btnReveal = $("#btnReveal");
const btnDone = $("#btnDone");
const modalTitle = $("#modalTitle");
const bigLetter = $("#bigLetter");
const activityText = $("#activityText");
const hint = $("#hint");
const photoInput = $("#photoInput");
const photoPreview = $("#photoPreview");

const canvas = $("#scratch");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

// Estado
let letters = new Map(); // letter -> row
let currentLetter = "A";

let scratching = false;
let scratchMoves = 0;
let activityFull = "";
let activityChars = [];
let activityRevealed = false;
let selectedFile = null;
let uploadedPath = null;

// reveal gradual
const REVEAL_FULL_AT = 55;
const REVEAL_START_AT = 3;
const MASK_CHAR = "•";

totalCountEl.textContent = LETTERS.length;

// ---------- Auth ----------
async function refreshSession() {
  const { data } = await supabase.auth.getSession();
  const session = data.session || null;

  if (session) {
    authBox.classList.add("hidden");
    appBox.classList.remove("hidden");
    await ensureSeed();
    await loadAll();
  } else {
    authBox.classList.remove("hidden");
    appBox.classList.add("hidden");
  }
}

btnLogin.addEventListener("click", async () => {
  const email = emailInput.value.trim();
  if (!email) return;

  authMsg.textContent = "Enviando magic link…";
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: window.location.origin + window.location.pathname
    }
  });

  authMsg.textContent = error
    ? ("Error: " + error.message)
    : "Listo 💌 Revisá tu mail y abrí el link. Después volvés acá.";
});

btnSignOut.addEventListener("click", async () => {
  await supabase.auth.signOut();
  await refreshSession();
});

supabase.auth.onAuthStateChange(async () => {
  await refreshSession();
});

// ---------- DB seed ----------
function activityByIndex(i) {
  return ACTIVITIES[i] ?? `${LETTERS[i]}: (editá esta actividad en src/activities.js)`;
}

async function ensureSeed() {
  // Insertamos/actualizamos las 27 letras para el GAME_ID
  const rows = [];
  for (let i = 0; i < LETTERS.length; i++) {
    rows.push({
      game_id: GAME_ID,
      letter: LETTERS[i],
      activity_text: activityByIndex(i),
      status: "todo"
    });
  }
  await supabase.from("letters").upsert(rows, { onConflict: "game_id,letter" });
}

async function loadAll() {
  const g = await supabase.from("game").select("*").eq("id", GAME_ID).single();
  if (g.data) {
    currentLetter = g.data.current_letter;
    currentLetterEl.textContent = currentLetter;
  }

  const l = await supabase.from("letters").select("*").eq("game_id", GAME_ID);
  letters = new Map();
  for (const r of (l.data || [])) letters.set(r.letter, r);

  await renderAlbum();
  updateStats();
}

// ---------- UI album ----------
async function getThumbUrl(path) {
  const { data, error } = await supabase.storage
    .from("bingo-photos")
    .createSignedUrl(path, 60 * 10); // 10 min
  if (error) return null;
  return data.signedUrl;
}

async function renderAlbum() {
  album.innerHTML = "";

  for (let i = 0; i < LETTERS.length; i++) {
    const L = LETTERS[i];
    const row = letters.get(L);
    const status = row?.status || "todo";

    const card = document.createElement("div");
    card.className = "card";
    card.dataset.letter = L;

    const top = document.createElement("div");
    top.className = "cardTop";
    top.innerHTML = `
      <div class="letter">${L}</div>
      <div class="status">${status === "done" ? "✅ hecha" : "pendiente"}</div>
    `;

    const thumb = document.createElement("div");
    thumb.className = "thumb";

    if (row?.photo_path) {
      const url = await getThumbUrl(row.photo_path);
      if (url) thumb.style.backgroundImage = `url('${url}')`;
    }

    card.appendChild(top);
    card.appendChild(thumb);
    card.addEventListener("click", () => openLetter(L));
    album.appendChild(card);
  }

  // ✅ clonamos el álbum al mural para el fondo collage
  const mural = document.getElementById("mural");
  if (mural) mural.innerHTML = album.outerHTML;
}

function updateStats() {
  let done = 0;
  for (const L of LETTERS) {
    if (letters.get(L)?.status === "done") done++;
  }
  doneCountEl.textContent = String(done);
}

// ---------- Cambiar letra ----------
btnChange.addEventListener("click", async () => {
  const remaining = [];
  for (const L of LETTERS) {
    if (letters.get(L)?.status !== "done") remaining.push(L);
  }
  if (remaining.length === 0) return;

  let next = remaining[Math.floor(Math.random() * remaining.length)];
  if (remaining.length > 1) {
    while (next === currentLetter) {
      next = remaining[Math.floor(Math.random() * remaining.length)];
    }
  }

  await supabase.from("game").update({
    current_letter: next,
    updated_at: new Date().toISOString()
  }).eq("id", GAME_ID);

  currentLetter = next;
  currentLetterEl.textContent = currentLetter;

  openLetter(currentLetter);
});

// ---------- Modal ----------
function openModal() {
  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
}
function closeModal() {
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
}
btnClose.addEventListener("click", closeModal);
modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

// ---- reveal gradual de texto ----
function setActivityMasked(revealCount) {
  const n = Math.max(0, Math.min(revealCount, activityChars.length));
  const shown = activityChars.slice(0, n).join("");
  const hidden = activityChars.slice(n).map(ch => (ch === " " ? " " : MASK_CHAR)).join("");
  activityText.textContent = shown + hidden;
}

function setActivityProgress(percent) {
  if (activityRevealed) return;

  if (percent < REVEAL_START_AT) {
    setActivityMasked(0);
    return;
  }

  const p = Math.min(percent, REVEAL_FULL_AT);
  const t = (p - REVEAL_START_AT) / (REVEAL_FULL_AT - REVEAL_START_AT);
  const revealCount = Math.floor(t * activityChars.length);

  setActivityMasked(revealCount);

  if (percent >= REVEAL_FULL_AT) {
    revealAllScratch();
  }
}

// ---- Scratch layer ----
function fitCanvasToCSS() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.floor(rect.width * dpr));
  const h = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function resetScratchLayer() {
  fitCanvasToCSS();

  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "rgba(255,255,255,0.86)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.font = "700 18px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.textAlign = "center";
  ctx.fillText("RASPÁ ACÁ ✨", canvas.width / 2, canvas.height / 2);

  ctx.globalCompositeOperation = "destination-out";

  scratchMoves = 0;
  hint.style.opacity = "1";
}

function estimateClearedPercent() {
  const step = 10;
  const { width, height } = canvas;
  const img = ctx.getImageData(0, 0, width, height).data;

  let total = 0, transparent = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const idx = (y * width + x) * 4 + 3;
      total++;
      if (img[idx] === 0) transparent++;
    }
  }
  return (transparent / total) * 100;
}

function scratchAt(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;

  ctx.beginPath();
  ctx.arc(x, y, 26, 0, Math.PI * 2);
  ctx.fill();

  scratchMoves++;
  if (scratchMoves % 6 === 0) {
    const cleared = estimateClearedPercent();
    setActivityProgress(cleared);
  }
}

function revealAllScratch() {
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  hint.style.opacity = "0";

  if (!activityRevealed) {
    activityRevealed = true;
    activityText.textContent = activityFull;
  }
  enableDoneIfReady();
}

btnReveal.addEventListener("click", () => {
  revealAllScratch();
});

canvas.addEventListener("pointerdown", (e) => {
  scratching = true;
  canvas.setPointerCapture?.(e.pointerId);
  scratchAt(e.clientX, e.clientY);
});
canvas.addEventListener("pointermove", (e) => {
  if (!scratching) return;
  scratchAt(e.clientX, e.clientY);
});
window.addEventListener("pointerup", () => { scratching = false; });
window.addEventListener("resize", () => {
  if (modal.classList.contains("show")) resetScratchLayer();
});

// ---------- Foto obligatoria ----------
photoInput.addEventListener("change", () => {
  const f = photoInput.files?.[0] || null;
  selectedFile = f;
  uploadedPath = null;

  if (!f) {
    photoPreview.classList.add("hidden");
    photoPreview.style.backgroundImage = "";
    enableDoneIfReady();
    return;
  }

  const url = URL.createObjectURL(f);
  photoPreview.style.backgroundImage = `url('${url}')`;
  photoPreview.classList.remove("hidden");
  enableDoneIfReady();
});

function enableDoneIfReady() {
  const ok = activityRevealed && (selectedFile || uploadedPath);
  btnDone.disabled = !ok;
}

async function openLetter(L) {
  const row = letters.get(L);

  modalTitle.textContent = `Letra ${L}`;
  bigLetter.textContent = L;

  activityFull = row?.activity_text || "";
  activityChars = Array.from(activityFull);
  activityRevealed = false;

  // reset foto UI
  selectedFile = null;
  uploadedPath = row?.photo_path || null;
  photoInput.value = "";
  photoPreview.classList.add("hidden");
  photoPreview.style.backgroundImage = "";

  if (row?.status === "done") {
    activityRevealed = true;
    activityText.textContent = activityFull;
    btnDone.disabled = true;

    resetScratchLayer();
    // levantar overlay
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    hint.style.opacity = "0";

    if (row.photo_path) {
      const url = await getThumbUrl(row.photo_path);
      if (url) {
        photoPreview.style.backgroundImage = `url('${url}')`;
        photoPreview.classList.remove("hidden");
      }
    }
  } else {
    setActivityMasked(0);
    btnDone.disabled = true;
    resetScratchLayer();
  }

  openModal();
}

btnDone.addEventListener("click", async () => {
  if (!activityRevealed) return;

  const L = bigLetter.textContent;
  const row = letters.get(L);

  let path = uploadedPath;

  if (!path) {
    if (!selectedFile) return;

    const ext = (selectedFile.name.split(".").pop() || "jpg").toLowerCase();
    const fileName = `${L}-${Date.now()}.${ext}`;
    path = `${GAME_ID}/${fileName}`;

    const up = await supabase.storage
      .from("bingo-photos")
      .upload(path, selectedFile, { upsert: false });

    if (up.error) {
      alert("No pude subir la foto: " + up.error.message);
      return;
    }
  }

  const now = new Date().toISOString();
  const upd = await supabase
    .from("letters")
    .update({
      status: "done",
      photo_path: path,
      done_at: now,
      updated_at: now
    })
    .eq("game_id", GAME_ID)
    .eq("letter", L);

  if (upd.error) {
    alert("Error guardando: " + upd.error.message);
    return;
  }

  letters.set(L, {
    ...(row || {}),
    game_id: GAME_ID,
    letter: L,
    activity_text: activityFull,
    status: "done",
    photo_path: path,
    done_at: now,
    updated_at: now
  });

  await renderAlbum();
  updateStats();
  closeModal();
});

// init
await refreshSession();
