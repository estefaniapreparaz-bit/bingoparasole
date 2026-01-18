import "./style.css";
import { ACTIVITIES } from "./activities.js";
import { supabase, GAME_ID } from "./supabase.js";

/** Letras (incluye Ñ) */
const LETTERS = ["A","B","C","D","E","F","G","H","I","J","K","L","M","N","Ñ","O","P","Q","R","S","T","U","V","W","X","Y","Z"];

// ACTIVITIES viene como array: ["A: ...", "B: ...", ...] -> lo pasamos a objeto
const ACTIVITY_MAP = ACTIVITIES.reduce((acc, line) => {
  const m = String(line).match(/^([A-ZÑ]):\s*(.*)$/i);
  if (!m) return acc;
  const key = m[1].toUpperCase();
  acc[key] = m[2].trim();
  return acc;
}, {});

let session = null;
let currentLetter = null;
let currentActivity = "";
let completed = {}; // { A: { activity, photo_url, photo_path } ... }

const $app = document.getElementById("app");

/** ---------- UI BASE ---------- */
$app.innerHTML = `
  <div class="appShell">
    <div class="headerRow">
      <div>
        <h1>Bingo Abecedario de Sole ✨</h1>
        <p class="sub">Elegimos una letra, raspás para revelar la actividad, y al completar suben una foto 📸💞</p>
      </div>
      <div class="topBtns">
        <button id="btnPlay" class="btn primary">🎉 A JUGAR</button>
        <button id="btnLogout" class="btn">Salir</button>
      </div>
    </div>

    <div class="card">
      <div class="metaRow">
        <div class="pill" id="pillCount">0/27 completadas</div>
        <div class="pill" id="pillHint">Elegí una letra pendiente o jugá random 😈</div>
      </div>

      <div id="authBox">
        <div class="authTitle">Entrar con Magic Link ✨</div>
        <p class="authSub">Te mando un link al mail. Abrilo y volvés acá.</p>
        <div class="row">
          <input id="email" class="input" placeholder="tu mail" />
          <button id="sendLink" class="btn primary">Enviar link</button>
        </div>
        <div id="authMsg" class="small"></div>
      </div>

      <div id="gameBox" class="hidden">
        <div class="fileRow" style="margin-top:0;">
          <button id="btnRandom" class="btn primary">🎲 Letra random</button>
          <button id="btnPick" class="btn">🅰️ Elegir letra</button>

          <select id="letterSelect" class="input" style="max-width:220px; display:none;">
            <option value="">Elegí una letra...</option>
          </select>

          <button id="btnChoose" class="btn primary" style="display:none;">Elegir</button>

          <button id="btnCloseGame" class="btn" style="margin-left:auto;">Cerrar</button>
        </div>

        <div class="sectionTitle">Letra</div>
        <div class="letterBox">
          <div class="bigLetter" id="bigLetter">—</div>
          <div class="small" id="scratchHint">Raspá con el mouse o el dedo 👆</div>
        </div>

        <canvas id="scratch" class="scratchCanvas" style="width:100%;height:140px;margin-top:12px;border-radius:18px;border:1px solid rgba(255,255,255,.10);background:rgba(0,0,0,.22)"></canvas>

        <div class="sectionTitle">Actividad</div>
        <div class="activityText" id="activityText">Raspá para revelar 👆</div>

        <div class="fileRow">
          <div class="small" style="min-width:230px;">Foto (obligatoria para completar):</div>
          <input id="photo" class="fileInput" type="file" accept="image/*" />
          <button id="btnComplete" class="btn primary">✅ Marcar como hecha</button>
        </div>

        <div id="statusMsg" class="small"></div>
      </div>

      <div class="footerLove">Feliz cumple amor! Te amo! 18.02.26 💖</div>
    </div>
  </div>

  <!-- LIGHTBOX -->
  <div id="lightbox" class="lightbox" role="dialog" aria-modal="true">
    <div class="lightboxCard">
      <div class="lightboxHeader">
        <div class="lightboxTitle" id="lbTitle">Letra</div>
        <button class="lightboxClose" id="lbClose">Cerrar</button>
      </div>
      <div class="lightboxBody">
        <div class="lightboxImgWrap">
          <img id="lbImg" class="lightboxImg" alt="Foto" />
        </div>
        <div class="lightboxText">
          <h3>Actividad</h3>
          <div id="lbText"></div>
        </div>
      </div>
    </div>
  </div>
`;

/** ---------- WALL VISIBILITY ---------- */
function showWall(on = true){
  const wall = document.getElementById("wall");
  if (!wall) return;
  wall.classList.toggle("hidden", !on);
  wall.setAttribute("aria-hidden", String(!on));
}

/** ---------- WALL INIT ---------- */
function initWall() {
  const wall = document.getElementById("wall");
  if (!wall) return;

  showWall(true);
  wall.innerHTML = "";

  for (const letter of LETTERS) {
    const tile = document.createElement("div");
    tile.className = "wallTile";
    tile.dataset.letter = letter;

    const img = document.createElement("img");
    img.className = "wallImg";
    img.alt = `Foto ${letter}`;
    img.loading = "lazy";
    img.decoding = "async";

    img.addEventListener("error", () => {
      tile.classList.remove("hasPhoto");
      tile.classList.remove("clickable");
      const txt = tile.querySelector(".wallCaption .txt");
      if (txt) txt.textContent = "Pendiente";
    });

    const overlay = document.createElement("div");
    overlay.className = "wallOverlay";

    const label = document.createElement("div");
    label.className = "wallLabel";
    label.textContent = letter;

    const caption = document.createElement("div");
    caption.className = "wallCaption";
    caption.innerHTML = `<span class="tag">${letter}:</span> <span class="txt">Pendiente</span>`;

    tile.appendChild(img);
    tile.appendChild(overlay);
    tile.appendChild(label);
    tile.appendChild(caption);
    wall.appendChild(tile);
  }
}
initWall();

/** setea foto en el tile + pie de foto */
function setWallPhoto(letter, photoUrl, activityText) {
  const wall = document.getElementById("wall");
  if (!wall) return;

  const tile = wall.querySelector(`.wallTile[data-letter="${letter}"]`);
  if (!tile) return;

  const img = tile.querySelector(".wallImg");
  if (img) img.src = photoUrl;

  tile.classList.add("hasPhoto");
  tile.classList.add("clickable");

  const txt = tile.querySelector(".wallCaption .txt");
  const t = (activityText || "Completada 💜");
  if (txt) txt.textContent = t.slice(0, 24) + (t.length > 24 ? "…" : "");
}

/** ---------- LIGHTBOX ---------- */
const elLightbox = document.getElementById("lightbox");
const elLbClose = document.getElementById("lbClose");
const elLbImg = document.getElementById("lbImg");
const elLbTitle = document.getElementById("lbTitle");
const elLbText = document.getElementById("lbText");

function openLightbox(letter) {
  const item = completed[letter];
  if (!item?.photo_url) return;

  elLbTitle.textContent = `Letra ${letter}`;
  elLbImg.src = item.photo_url;
  elLbText.textContent = item.activity || "—";

  elLightbox.classList.add("open");
}

function closeLightbox() {
  elLightbox.classList.remove("open");
  elLbImg.src = "";
}

elLbClose.addEventListener("click", closeLightbox);
elLightbox.addEventListener("click", (e) => {
  if (e.target === elLightbox) closeLightbox();
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeLightbox();
});

// click en tiles con foto (captura en el wall)
document.getElementById("wall")?.addEventListener("click", (e) => {
  const tile = e.target.closest(".wallTile");
  if (!tile) return;
  const letter = tile.dataset.letter;
  if (!completed[letter]?.photo_url) return;
  openLightbox(letter);
});

/** ---------- ELEMENTS ---------- */
const elAuthBox = document.getElementById("authBox");
const elGameBox = document.getElementById("gameBox");
const elEmail = document.getElementById("email");
const elSendLink = document.getElementById("sendLink");
const elAuthMsg = document.getElementById("authMsg");

const elBtnPlay = document.getElementById("btnPlay");
const elBtnLogout = document.getElementById("btnLogout");
const elBtnCloseGame = document.getElementById("btnCloseGame");

const elPillCount = document.getElementById("pillCount");

const elBtnRandom = document.getElementById("btnRandom");
const elBtnPick = document.getElementById("btnPick");
const elLetterSelect = document.getElementById("letterSelect");
const elBtnChoose = document.getElementById("btnChoose");

const elBigLetter = document.getElementById("bigLetter");
let elScratch = document.getElementById("scratch");
const elActivityText = document.getElementById("activityText");
const elPhoto = document.getElementById("photo");
const elBtnComplete = document.getElementById("btnComplete");
const elStatusMsg = document.getElementById("statusMsg");

/** ---------- AUTH ---------- */
async function refreshSession() {
  const { data } = await supabase.auth.getSession();
  session = data.session || null;
  renderAuth();
  if (session) await loadGameState();
}

function renderAuth() {
  if (session) {
    elAuthBox.classList.add("hidden");
  } else {
    elAuthBox.classList.remove("hidden");
    elGameBox.classList.add("hidden");
  }
}

elSendLink.addEventListener("click", async () => {
  const email = elEmail.value.trim();
  if (!email) return (elAuthMsg.textContent = "Poné un mail 🥺");

  elAuthMsg.textContent = "Enviando link…";
  const redirectTo = window.location.origin;

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo }
  });

  if (error) {
    console.error(error);
    elAuthMsg.textContent = "Error enviando link: " + error.message;
  } else {
    elAuthMsg.textContent = "Listo ✨ Revisá tu mail y abrí el link.";
  }
});

/** Logout */
elBtnLogout.addEventListener("click", async () => {
  await supabase.auth.signOut();
  session = null;
  currentLetter = null;
  currentActivity = "";
  completed = {};
  elGameBox.classList.add("hidden");
  elAuthBox.classList.remove("hidden");
  renderPills();
  initWall();
});

/** ---------- GAME OPEN/CLOSE ---------- */
elBtnPlay.addEventListener("click", () => {
  if (!session) return;
  elGameBox.classList.remove("hidden");
});

elBtnCloseGame.addEventListener("click", () => {
  elGameBox.classList.add("hidden");
});

/** ---------- GAME STATE (SUPABASE) ---------- */
async function loadGameState() {
  elStatusMsg.textContent = "Cargando…";

  const userId = session.user.id;

  const { data, error } = await supabase
    .from("bingo_entries")
    .select("letter, activity, photo_url, photo_path")
    .eq("game_id", GAME_ID)
    .eq("user_id", userId);

  if (error) {
    console.error(error);
    elStatusMsg.textContent = `Error: ${error.message || "Load failed"}`;
    return;
  }

  completed = {};
  initWall();

  for (const row of data || []) {
    let viewUrl = row.photo_url || "";

    // signed URL para BUCKET PRIVATE
    if (row.photo_path) {
      const { data: signed, error: signErr } = await supabase.storage
        .from("bingo-photos")
        .createSignedUrl(row.photo_path, 60 * 60 * 24 * 7);
      if (!signErr && signed?.signedUrl) viewUrl = signed.signedUrl;
    }

    completed[row.letter] = {
      activity: row.activity,
      photo_url: viewUrl,
      photo_path: row.photo_path
    };

    if (viewUrl) setWallPhoto(row.letter, viewUrl, row.activity);
  }

  renderPills();
  elStatusMsg.textContent = "";
  fillLetterSelect();
}

/** ---------- UI helpers ---------- */
function renderPills() {
  const count = Object.keys(completed).length;
  elPillCount.textContent = `${count}/27 completadas`;
}

function fillLetterSelect() {
  const pending = LETTERS.filter(l => !completed[l]);
  elLetterSelect.innerHTML =
    `<option value="">Elegí una letra...</option>` +
    pending.map(l => `<option value="${l}">${l}</option>`).join("");
}

/** ---------- PICK LETTER ---------- */
function setCurrentLetter(letter) {
  currentLetter = letter;
  currentActivity = ACTIVITY_MAP[currentLetter] || "Actividad sorpresa 💫";

  elBigLetter.textContent = currentLetter;
  elActivityText.textContent = "Raspá para revelar 👆";
  resetScratch();
}

function pickRandomPendingLetter() {
  const pending = LETTERS.filter(l => !completed[l]);
  if (pending.length === 0) {
    currentLetter = null;
    currentActivity = "";
    elBigLetter.textContent = "💜";
    elActivityText.textContent = "¡Completaron todo! 🥹";
    resetScratch();
    return;
  }
  const letter = pending[Math.floor(Math.random() * pending.length)];
  setCurrentLetter(letter);
}

/** botones modo juego */
elBtnRandom.addEventListener("click", () => {
  if (!session) return;
  pickRandomPendingLetter();
});

elBtnPick.addEventListener("click", () => {
  elLetterSelect.style.display = "block";
  elBtnChoose.style.display = "inline-flex";
});

elBtnChoose.addEventListener("click", () => {
  const val = elLetterSelect.value;
  if (!val) return;
  setCurrentLetter(val);
});

/** ---------- SCRATCH (60%) ---------- */
let isDown = false;
let revealedRatio = 0;

function setupScratch() {
  const canvas = elScratch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "rgba(255,255,255,.18)";
  ctx.fillRect(0, 0, rect.width, rect.height);

  ctx.fillStyle = "rgba(0,0,0,.25)";
  ctx.font = "800 22px ui-sans-serif, system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("RASPÁ", rect.width/2, rect.height/2);

  ctx.globalCompositeOperation = "destination-out";

  function draw(x, y) {
    ctx.beginPath();
    ctx.arc(x, y, 20, 0, Math.PI * 2);
    ctx.fill();
  }

  function getXY(e) {
    const r = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - r.left, y: clientY - r.top };
  }

  function onDown(e) {
    if (!currentLetter) return;
    isDown = true;
    const { x, y } = getXY(e);
    draw(x, y);
    updateRevealProgress(canvas, ctx);
  }

  function onMove(e) {
    if (!isDown) return;
    const { x, y } = getXY(e);
    draw(x, y);
    updateRevealProgress(canvas, ctx);
  }

  function onUp() { isDown = false; }

  canvas.addEventListener("mousedown", onDown);
  canvas.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);

  canvas.addEventListener("touchstart", onDown, { passive: true });
  canvas.addEventListener("touchmove", onMove, { passive: true });
  window.addEventListener("touchend", onUp);
}

function updateRevealProgress(canvas, ctx) {
  if (!currentLetter) return;

  const w = canvas.width;
  const h = canvas.height;

  const step = 8;
  const img = ctx.getImageData(0, 0, w, h).data;

  let total = 0;
  let cleared = 0;

  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const a = img[(y * w + x) * 4 + 3];
      total++;
      if (a < 20) cleared++;
    }
  }

  revealedRatio = total ? (cleared / total) : 0;

  const THRESHOLD = 0.60;
  if (revealedRatio < THRESHOLD) {
    elActivityText.textContent = "Raspá para revelar 👆";
    return;
  }

  elActivityText.textContent = currentActivity || "Actividad sorpresa 💫";
}

function resetScratch() {
  revealedRatio = 0;

  const old = elScratch;
  const parent = old.parentElement;
  const fresh = old.cloneNode(true);
  parent.replaceChild(fresh, old);

  elScratch = document.getElementById("scratch");
  setupScratch();
}

setupScratch();

/** ---------- COMPLETE (subir foto + guardar) ---------- */
elBtnComplete.addEventListener("click", async () => {
  if (!session) return;
  if (!currentLetter) return;

  if (revealedRatio < 0.60) {
    elStatusMsg.innerHTML = `<span class="err">Raspá un poquito más 😌 (60%)</span>`;
    return;
  }

  const file = elPhoto.files?.[0];
  if (!file) {
    elStatusMsg.innerHTML = `<span class="err">Tenés que subir una foto para completar 📸</span>`;
    return;
  }

  try {
    elStatusMsg.textContent = "Subiendo foto…";

    const userId = session.user.id;
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${GAME_ID}/${userId}/${currentLetter}-${Date.now()}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from("bingo-photos")
      .upload(path, file, { upsert: true });

    if (upErr) throw upErr;

    const { data: signed, error: signErr } = await supabase.storage
      .from("bingo-photos")
      .createSignedUrl(path, 60 * 60 * 24 * 7);

    if (signErr) throw signErr;

    const photoUrl = signed.signedUrl;

    elStatusMsg.textContent = "Guardando…";

    const { error: dbErr } = await supabase
      .from("bingo_entries")
      .upsert({
        game_id: GAME_ID,
        user_id: userId,
        letter: currentLetter,
        activity: currentActivity,
        photo_url: photoUrl,
        photo_path: path
      }, { onConflict: "game_id,user_id,letter" });

    if (dbErr) throw dbErr;

    completed[currentLetter] = { activity: currentActivity, photo_url: photoUrl, photo_path: path };
    setWallPhoto(currentLetter, photoUrl, currentActivity);

    elPhoto.value = "";
    elStatusMsg.innerHTML = `<span class="ok">Listo 💜 Guardado.</span>`;

    fillLetterSelect();
    pickRandomPendingLetter();
  } catch (e) {
    console.error(e);
    elStatusMsg.innerHTML = `<span class="err">Error: ${e.message || "Load failed"}</span>`;
  }
});

/** ---------- INIT ---------- */
supabase.auth.onAuthStateChange(() => {
  refreshSession();
});

refreshSession();
renderPills();
