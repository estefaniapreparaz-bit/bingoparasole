import "./style.css";
import { ACTIVITIES } from "./activities.js";
import { supabase, GAME_ID } from "./supabase.js";

/** Letras (incluye Ñ) */
const LETTERS = ["A","B","C","D","E","F","G","H","I","J","K","L","M","N","Ñ","O","P","Q","R","S","T","U","V","W","X","Y","Z"];

// ACTIVITIES viene como array ["A: ...", "B: ...", ...] -> lo pasamos a mapa
const ACTIVITY_MAP = (ACTIVITIES || []).reduce((acc, line) => {
  const m = String(line).match(/^([A-ZÑ]):\s*(.*)$/i);
  if (!m) return acc;
  acc[m[1].toUpperCase()] = (m[2] || "").trim();
  return acc;
}, {});

let session = null;
let currentLetter = null;
let currentActivity = "";
let completed = {}; // { A: { activity, photo_url } ... }

let revealedRatio = 0;

const $app = document.getElementById("app");

/** ---------- UI BASE ---------- */
$app.innerHTML = `
  <div class="fabBar">
    <button id="btnPlay" class="btn primary">🎉 A JUGAR</button>
    <button id="btnLogout" class="btn">Salir</button>
  </div>

  <!-- Lightbox -->
  <div id="lightbox" class="lightbox hidden" aria-hidden="true">
    <div class="lightboxCard">
      <div class="lbTop">
        <div class="lbTitle" id="lbTitle">Letra</div>
        <button id="lbClose" class="btn">Cerrar</button>
      </div>
      <img id="lbImg" class="lbImg" alt="Foto" />
      <div id="lbText" class="lbText"></div>
    </div>
  </div>

  <!-- Modal juego/login -->
  <div id="modal" class="modalOverlay hidden" aria-hidden="true">
    <div class="modalCard">
      <div class="headerRow">
        <div>
          <h1>Bingo Abecedario de Sole ✨</h1>
          <p class="sub">Elegimos una letra, raspás para revelar la actividad, y al completar suben una foto 📸💞</p>
        </div>
        <button id="btnCloseModal" class="btn">Cerrar</button>
      </div>

      <div class="metaRow">
        <div class="pill" id="pillCount">0/27 completadas</div>
        <div class="pill">Elegí una letra pendiente o jugá random 😈</div>
      </div>

      <div id="authBox" class="card">
        <div class="authTitle">Entrar con Magic Link ✨</div>
        <p class="authSub">Te mando un link al mail. Abrilo y volvés acá.</p>
        <div class="row">
          <input id="email" class="input" placeholder="tu mail" />
          <button id="sendLink" class="btn primary">Enviar link</button>
        </div>
        <div id="authMsg" class="small"></div>
      </div>

      <div id="gameBox" class="card hidden">
        <div class="row" style="gap:10px; flex-wrap:wrap; margin-bottom:12px;">
          <button id="btnRandom" class="btn primary">🎲 Letra random</button>
          <button id="btnChoose" class="btn">🅰️ Elegir letra</button>

          <select id="selLetter" class="input hidden" style="max-width:260px;">
            <option value="">Elegí una letra...</option>
          </select>
          <button id="btnPick" class="btn primary hidden">Elegir</button>
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

        <div class="footerLove">Feliz cumple amor! Te amo! 18.02.26 💖</div>
      </div>
    </div>
  </div>
`;

/** ---------- WALL INIT ---------- */
function initWall() {
  const wall = document.getElementById("wall");
  wall.innerHTML = "";

  for (const letter of LETTERS) {
    const tile = document.createElement("div");
    tile.className = "wallTile";
    tile.dataset.letter = letter;

    // IMG real (para que siempre se vea en iOS)
    const img = document.createElement("img");
    img.className = "wallImg";
    img.alt = `Foto ${letter}`;
    img.loading = "lazy";

    const label = document.createElement("div");
    label.className = "wallLabel";
    label.textContent = letter;

    const caption = document.createElement("div");
    caption.className = "wallCaption";
    caption.innerHTML = `<span class="tag">${letter}:</span> <span class="txt">Pendiente</span>`;

    tile.appendChild(img);
    tile.appendChild(label);
    tile.appendChild(caption);
    wall.appendChild(tile);
  }
}
initWall();

/** setea foto en el tile + pie de foto */
function setWallPhoto(letter, photoUrl, activityText) {
  const wall = document.getElementById("wall");
  const tile = wall.querySelector(`.wallTile[data-letter="${letter}"]`);
  if (!tile) return;

  const img = tile.querySelector(".wallImg");
  if (img) {
    // cache-bust suave para iOS (a veces no refresca background/img)
    img.src = `${photoUrl}${photoUrl.includes("?") ? "&" : "?"}t=${Date.now()}`;
  }

  tile.classList.add("hasPhoto");

  const txt = tile.querySelector(".wallCaption .txt");
  if (txt) txt.textContent = activityText || "Completada 💜";
}

/** ---------- ELEMENTS ---------- */
const elWall = document.getElementById("wall");

const elBtnPlay = document.getElementById("btnPlay");
const elBtnLogout = document.getElementById("btnLogout");

const elModal = document.getElementById("modal");
const elBtnCloseModal = document.getElementById("btnCloseModal");

const elAuthBox = document.getElementById("authBox");
const elGameBox = document.getElementById("gameBox");
const elEmail = document.getElementById("email");
const elSendLink = document.getElementById("sendLink");
const elAuthMsg = document.getElementById("authMsg");

const elPillCount = document.getElementById("pillCount");

const elBtnRandom = document.getElementById("btnRandom");
const elBtnChoose = document.getElementById("btnChoose");
const elSelLetter = document.getElementById("selLetter");
const elBtnPick = document.getElementById("btnPick");

const elBigLetter = document.getElementById("bigLetter");
const elScratch = document.getElementById("scratch");
const elActivityText = document.getElementById("activityText");
const elPhoto = document.getElementById("photo");
const elBtnComplete = document.getElementById("btnComplete");
const elStatusMsg = document.getElementById("statusMsg");

/** Lightbox */
const elLightbox = document.getElementById("lightbox");
const elLbClose = document.getElementById("lbClose");
const elLbTitle = document.getElementById("lbTitle");
const elLbImg = document.getElementById("lbImg");
const elLbText = document.getElementById("lbText");

/** ---------- MODAL helpers ---------- */
function openModal() {
  elModal.classList.remove("hidden");
  elModal.setAttribute("aria-hidden", "false");
}
function closeModal() {
  elModal.classList.add("hidden");
  elModal.setAttribute("aria-hidden", "true");
}
elBtnPlay.addEventListener("click", openModal);
elBtnCloseModal.addEventListener("click", closeModal);

/** ---------- LIGHTBOX ---------- */
function openLightbox(letter, photoUrl, activity) {
  elLbTitle.textContent = `Letra ${letter}`;
  elLbImg.src = photoUrl;
  elLbText.textContent = activity || "";
  elLightbox.classList.remove("hidden");
  elLightbox.setAttribute("aria-hidden", "false");
}
function closeLightbox() {
  elLightbox.classList.add("hidden");
  elLightbox.setAttribute("aria-hidden", "true");
  elLbImg.src = "";
}
elLbClose.addEventListener("click", closeLightbox);
elLightbox.addEventListener("click", (e) => {
  if (e.target === elLightbox) closeLightbox();
});

/** Click en tiles -> abrir lightbox si está completada */
elWall.addEventListener("click", (e) => {
  const tile = e.target.closest(".wallTile");
  if (!tile) return;
  const letter = tile.dataset.letter;
  const entry = completed?.[letter];
  if (!entry?.photo_url) return;
  openLightbox(letter, entry.photo_url, entry.activity);
});

/** ---------- AUTH ---------- */
async function refreshSession() {
  try {
    const { data } = await supabase.auth.getSession();
    session = data.session || null;
    renderAuth();
    if (session) await loadGameState();
  } catch (e) {
    console.error(e);
    session = null;
    renderAuth();
  }
}

function renderAuth() {
  // Mostrar muro solo si hay sesión
  if (session) {
    document.getElementById("wall").classList.remove("hidden");
    document.getElementById("wall").setAttribute("aria-hidden", "false");
    elAuthBox.classList.add("hidden");
    elGameBox.classList.remove("hidden");
  } else {
    document.getElementById("wall").classList.add("hidden");
    document.getElementById("wall").setAttribute("aria-hidden", "true");
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
  renderPills();
  resetScratch();
  renderAuth();
});

/** ---------- GAME STATE (SUPABASE) ---------- */
async function loadGameState() {
  elStatusMsg.textContent = "Cargando…";
  const userId = session.user.id;

  const { data, error } = await supabase
    .from("bingo_entries")
    .select("letter, activity, photo_url")
    .eq("game_id", GAME_ID)
    .eq("user_id", userId);

  if (error) {
    console.error(error);
    elStatusMsg.textContent = `Error: ${error.message || "Load failed"}`;
    return;
  }

  completed = {};
  for (const row of data || []) {
    completed[row.letter] = { activity: row.activity, photo_url: row.photo_url };
  }

  // pintar muro
  for (const letter of Object.keys(completed)) {
    setWallPhoto(letter, completed[letter].photo_url, completed[letter].activity);
  }

  // refrescar selector
  rebuildSelect();

  renderPills();
  elStatusMsg.textContent = "";
}

/** ---------- SELECTOR ---------- */
function rebuildSelect() {
  const pending = LETTERS.filter(l => !completed[l]);
  elSelLetter.innerHTML = `<option value="">Elegí una letra...</option>` + pending.map(l => `<option value="${l}">${l}</option>`).join("");
}

/** ---------- PICK LETTER ---------- */
function pickLetter(letter) {
  const pending = LETTERS.filter(l => !completed[l]);
  if (pending.length === 0) {
    currentLetter = null;
    currentActivity = "";
    elBigLetter.textContent = "💜";
    elActivityText.textContent = "¡Completaron todo! 🥹";
    resetScratch();
    renderPills();
    return;
  }

  currentLetter = letter;
  currentActivity = ACTIVITY_MAP[currentLetter] || "Actividad sorpresa 💫";

  elBigLetter.textContent = currentLetter;
  elActivityText.textContent = "Raspá para revelar 👆";
  resetScratch();
  renderPills();
}

function pickRandomPending() {
  const pending = LETTERS.filter(l => !completed[l]);
  if (pending.length === 0) return pickLetter(null);
  pickLetter(pending[Math.floor(Math.random() * pending.length)]);
}

elBtnRandom.addEventListener("click", () => {
  if (!session) return;
  pickRandomPending();
});

elBtnChoose.addEventListener("click", () => {
  if (!session) return;
  elSelLetter.classList.toggle("hidden");
  elBtnPick.classList.toggle("hidden");
  rebuildSelect();
});

elBtnPick.addEventListener("click", () => {
  const val = elSelLetter.value;
  if (!val) return;
  pickLetter(val);
});

/** ---------- SCRATCH (raspar) ---------- */
let isDown = false;

function setupScratch() {
  const canvas = document.getElementById("scratch");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  // tamaño real (DPR)
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // capa “raspable”
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "rgba(255,255,255,.18)";
  ctx.fillRect(0, 0, rect.width, rect.height);

  ctx.fillStyle = "rgba(0,0,0,.25)";
  ctx.font = "800 22px ui-sans-serif, system-ui";
  ctx.textAlign = "center";
  ctx.fillText("RASPÁ", rect.width/2, rect.height/2);

  // borrar
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

  let raf = 0;
  function requestUpdate() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      updateRevealProgress(canvas, ctx);
    });
  }

  function onDown(e) {
    if (!currentLetter) return;
    isDown = true;
    const { x, y } = getXY(e);
    draw(x, y);
    requestUpdate();
  }

  function onMove(e) {
    if (!isDown) return;
    const { x, y } = getXY(e);
    draw(x, y);
    requestUpdate();
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

  const step = 8; // precisión vs performance
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

  revealedRatio = total ? cleared / total : 0;

  // mostrar a partir del 60%
  const THRESHOLD = 0.60;

  if (revealedRatio >= THRESHOLD) {
    elActivityText.textContent = currentActivity || "Actividad sorpresa 💫";
  } else {
    elActivityText.textContent = "Raspá para revelar 👆";
  }
}

function resetScratch() {
  revealedRatio = 0;
  const old = document.getElementById("scratch");
  const parent = old.parentElement;
  const fresh = old.cloneNode(true);
  parent.replaceChild(fresh, old);
  setupScratch();
}

setupScratch();

/** ---------- COMPLETE (subir foto + guardar) ---------- */
elBtnComplete.addEventListener("click", async () => {
  if (!session) return;
  if (!currentLetter) return;

  // exigir 60% para permitir completar
  if (revealedRatio < 0.60) {
    elStatusMsg.innerHTML = `<span class="err">Raspá un poquito más 😌</span>`;
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

    // URL pública (bucket debe ser PUBLIC)
    const { data: pub } = supabase.storage.from("bingo-photos").getPublicUrl(path);
    const photoUrl = pub.publicUrl;

    elStatusMsg.textContent = "Guardando…";

    const { error: dbErr } = await supabase
      .from("bingo_entries")
      .upsert({
        game_id: GAME_ID,
        user_id: userId,
        letter: currentLetter,
        activity: currentActivity,
        photo_url: photoUrl
      }, { onConflict: "game_id,user_id,letter" });

    if (dbErr) throw dbErr;

    completed[currentLetter] = { activity: currentActivity, photo_url: photoUrl };
    setWallPhoto(currentLetter, photoUrl, currentActivity);

    elPhoto.value = "";
    elStatusMsg.innerHTML = `<span class="ok">Listo 💜 Guardado.</span>`;

    rebuildSelect();
  } catch (e) {
    console.error(e);
    elStatusMsg.innerHTML = `<span class="err">Error: ${e.message || "Load failed"}</span>`;
  }
});

function renderPills() {
  const count = Object.keys(completed).length;
  elPillCount.textContent = `${count}/27 completadas`;
}

/** ---------- INIT ---------- */
supabase.auth.onAuthStateChange(() => {
  refreshSession();
});

refreshSession();
renderPills();
