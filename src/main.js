import "./style.css";
import { ACTIVITIES } from "./activities.js";
import { supabase, GAME_ID } from "./supabase.js";

/** Letras (incluye Ñ) */
const LETTERS = ["A","B","C","D","E","F","G","H","I","J","K","L","M","N","Ñ","O","P","Q","R","S","T","U","V","W","X","Y","Z"];

let session = null;
let completed = {}; // { A: { activity, photo_url } ... }

let currentLetter = null;
let currentActivity = "";
let revealedRatio = 0; // 0..1 (progreso del raspado)

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
        <button id="btnLogout" class="btn">Salir</button>
      </div>
    </div>

    <div class="metaRow">
      <div class="pill" id="pillCount">0/27 completadas</div>
      <div class="pill" id="pillHint">Elegí una letra pendiente o jugá random 😈</div>
    </div>

    <!-- AUTH -->
    <div id="authBox" class="card">
      <div class="authTitle">Entrar con Magic Link ✨</div>
      <p class="authSub">Te mando un link al mail. Abrilo y volvés acá.</p>
      <div class="row">
        <input id="email" class="input" placeholder="tu mail" />
        <button id="sendLink" class="btn primary">Enviar link</button>
      </div>
      <div id="authMsg" class="small"></div>
    </div>

    <!-- HOME (se ve tras login) -->
    <div id="homeBox" class="homeBox hidden">
      <button id="btnPlay" class="playBtn">🎉 A JUGAR!</button>
      <div class="footerLove">Feliz cumple amor! Te amo! 18.02.26 💖</div>
      <div id="homeMsg" class="small"></div>
    </div>

    <!-- MODAL JUEGO -->
    <div id="gameModal" class="modalOverlay hidden" role="dialog" aria-modal="true">
      <div class="modalCard">
        <div class="modalHead">
          <div class="modalTitle">Modo juego</div>
          <button id="btnCloseModal" class="btn">Cerrar</button>
        </div>

        <div class="modeRow">
          <button id="btnRandom" class="btn primary">🎲 Letra random</button>
          <button id="btnChoose" class="btn">🅰️ Elegir letra</button>

          <div id="chooseWrap" class="chooseWrap hidden">
            <select id="letterSelect" class="input select">
              <option value="">Elegí una letra…</option>
            </select>
            <button id="btnPickSelected" class="btn primary">Elegir</button>
          </div>
        </div>

        <div class="sectionTitle">Letra</div>
        <div class="letterBox">
          <div class="bigLetter" id="bigLetter">—</div>
          <div class="small" id="scratchHint">Raspá con el mouse o el dedo 👆</div>
        </div>

        <canvas id="scratch" class="scratchCanvas"></canvas>

        <div class="sectionTitle">Actividad</div>
        <div class="activityText" id="activityText">Elegí una letra…</div>

        <div class="fileRow">
          <div class="small" style="min-width:230px;">Foto (obligatoria para completar):</div>
          <input id="photo" class="fileInput" type="file" accept="image/*" />
          <button id="btnComplete" class="btn primary">✅ Marcar como hecha</button>
        </div>

        <div id="statusMsg" class="small"></div>
      </div>
    </div>
  </div>
`;

/** ---------- ELEMENTS ---------- */
const elAuthBox = document.getElementById("authBox");
const elHomeBox = document.getElementById("homeBox");
const elHomeMsg = document.getElementById("homeMsg");

const elEmail = document.getElementById("email");
const elSendLink = document.getElementById("sendLink");
const elAuthMsg = document.getElementById("authMsg");

const elBtnLogout = document.getElementById("btnLogout");
const elPillCount = document.getElementById("pillCount");

const elBtnPlay = document.getElementById("btnPlay");

const elModal = document.getElementById("gameModal");
const elBtnCloseModal = document.getElementById("btnCloseModal");

const elBtnRandom = document.getElementById("btnRandom");
const elBtnChoose = document.getElementById("btnChoose");
const elChooseWrap = document.getElementById("chooseWrap");
const elLetterSelect = document.getElementById("letterSelect");
const elBtnPickSelected = document.getElementById("btnPickSelected");

const elBigLetter = document.getElementById("bigLetter");
let elScratch = document.getElementById("scratch");
const elActivityText = document.getElementById("activityText");

const elPhoto = document.getElementById("photo");
const elBtnComplete = document.getElementById("btnComplete");
const elStatusMsg = document.getElementById("statusMsg");

/** ---------- WALL ---------- */
function showWall(visible) {
  const wall = document.getElementById("wall");
  if (!wall) return;
  wall.classList.toggle("hidden", !visible);
  wall.setAttribute("aria-hidden", String(!visible));
}

function initWall() {
  const wall = document.getElementById("wall");
  if (!wall) return;
  wall.innerHTML = "";

  for (const letter of LETTERS) {
    const tile = document.createElement("div");
    tile.className = "wallTile";
    tile.dataset.letter = letter;

    const label = document.createElement("div");
    label.className = "wallLabel";
    label.textContent = letter;

    const caption = document.createElement("div");
    caption.className = "wallCaption";
    caption.innerHTML = `<span class="tag">${letter}:</span> <span class="txt">Pendiente</span>`;

    tile.appendChild(label);
    tile.appendChild(caption);
    wall.appendChild(tile);
  }

  // click para jugar esa letra (si está pendiente y hay sesión)
  wall.addEventListener("click", (e) => {
    const tile = e.target.closest?.(".wallTile");
    if (!tile) return;
    if (!session) return;

    const letter = tile.dataset.letter;
    if (!letter) return;

    if (completed[letter]) {
      elHomeMsg.textContent = `La letra ${letter} ya está completada 😌`;
      return;
    }

    openGameModal();
    pickLetter(letter);
  });
}

/** setea foto en el tile + pie de foto */
function setWallPhoto(letter, photoUrl, activityText) {
  const wall = document.getElementById("wall");
  const tile = wall?.querySelector?.(`.wallTile[data-letter="${letter}"]`);
  if (!tile) return;

  tile.classList.add("hasPhoto");
  ensureWallStyle(letter, photoUrl);

  const txt = tile.querySelector(".wallCaption .txt");
  if (txt) txt.textContent = activityText || "Completada 💜";
}

/** pone background-image en el ::before de cada tile */
function ensureWallStyle(letter, photoUrl) {
  let styleTag = document.getElementById("wall-dynamic-style");
  if (!styleTag) {
    styleTag = document.createElement("style");
    styleTag.id = "wall-dynamic-style";
    document.head.appendChild(styleTag);
  }

  const safeLetter = String(letter).replace(/"/g, '\\"');
  const safeUrl = String(photoUrl).replace(/"/g, '\\"');

  const rule = `.wallTile[data-letter="${safeLetter}"]::before{ background-image: url("${safeUrl}"); }`;

  const lines = styleTag.textContent.split("\n").filter(Boolean);
  const filtered = lines.filter(l => !l.startsWith(`.wallTile[data-letter="${safeLetter}"]::before`));
  filtered.push(rule);
  styleTag.textContent = filtered.join("\n");
}

/** ---------- AUTH ---------- */
function renderAuth() {
  if (session) {
    elAuthBox.classList.add("hidden");
    elHomeBox.classList.remove("hidden");
  } else {
    elAuthBox.classList.remove("hidden");
    elHomeBox.classList.add("hidden");
    closeGameModal();
  }
}

async function refreshSession() {
  const { data } = await supabase.auth.getSession();
  session = data.session || null;

  renderAuth();
  showWall(!!session);

  if (session) {
    initWall();
    await loadGameState();
    fillLetterSelect();
  } else {
    completed = {};
    currentLetter = null;
    currentActivity = "";
    renderPills();
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
  completed = {};
  currentLetter = null;
  currentActivity = "";
  showWall(false);
  renderAuth();
  renderPills();
});

/** ---------- GAME STATE (SUPABASE) ---------- */
async function loadGameState() {
  elHomeMsg.textContent = "Cargando progreso…";

  const userId = session.user.id;

  const { data, error } = await supabase
    .from("bingo_entries")
    .select("letter, activity, photo_url")
    .eq("game_id", GAME_ID)
    .eq("user_id", userId);

  if (error) {
    console.error(error);
    elHomeMsg.textContent = "Error: Load failed";
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

  renderPills();
  elHomeMsg.textContent = "";
}

/** ---------- HOME / MODAL ---------- */
function openGameModal() {
  elModal.classList.remove("hidden");
  elStatusMsg.textContent = "";
  elPhoto.value = "";
  elChooseWrap.classList.add("hidden");
}

function closeGameModal() {
  elModal.classList.add("hidden");
}

elBtnPlay.addEventListener("click", () => {
  if (!session) return;
  openGameModal();
});

elBtnCloseModal.addEventListener("click", closeGameModal);

// cerrar tocando afuera
elModal.addEventListener("click", (e) => {
  if (e.target === elModal) closeGameModal();
});

/** ---------- LETRAS: random o elegir ---------- */
function fillLetterSelect() {
  const pending = LETTERS.filter(l => !completed[l]);
  elLetterSelect.innerHTML = `<option value="">Elegí una letra…</option>` +
    pending.map(l => `<option value="${l}">${l}</option>`).join("");
}

function pickRandomLetter() {
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
  pickLetter(letter);
}

function pickLetter(letter) {
  if (!letter) return;

  currentLetter = letter;
  currentActivity = ACTIVITIES[currentLetter] || "Actividad sorpresa 💫";

  elBigLetter.textContent = currentLetter;
  elActivityText.textContent = "Raspá para revelar 👆";

  resetScratch();
  fillLetterSelect();
}

elBtnRandom.addEventListener("click", () => {
  if (!session) return;
  pickRandomLetter();
});

elBtnChoose.addEventListener("click", () => {
  elChooseWrap.classList.toggle("hidden");
});

elBtnPickSelected.addEventListener("click", () => {
  const v = elLetterSelect.value;
  if (!v) return;
  pickLetter(v);
});

/** ---------- SCRATCH (revela de a poco) ---------- */
let isDown = false;
let rafPending = false;

function setupScratch() {
  const canvas = elScratch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  // tamaño responsivo
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * devicePixelRatio);
  canvas.height = Math.floor(rect.height * devicePixelRatio);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(devicePixelRatio, devicePixelRatio);

  // capa gris
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "rgba(255,255,255,.18)";
  ctx.fillRect(0, 0, rect.width, rect.height);

  // texto “RASPÁ”
  ctx.fillStyle = "rgba(0,0,0,.25)";
  ctx.font = "800 22px ui-sans-serif, system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("RASPÁ", rect.width / 2, rect.height / 2);

  // raspamos
  ctx.globalCompositeOperation = "destination-out";

  function draw(x, y) {
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
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
    scheduleProgress();
  }

  function onMove(e) {
    if (!isDown) return;
    const { x, y } = getXY(e);
    draw(x, y);
    scheduleProgress();
  }

  function onUp() { isDown = false; }

  canvas.addEventListener("mousedown", onDown);
  canvas.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);

  canvas.addEventListener("touchstart", onDown, { passive: true });
  canvas.addEventListener("touchmove", onMove, { passive: true });
  window.addEventListener("touchend", onUp);

  function scheduleProgress() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      updateRevealProgress(ctx, rect.width, rect.height);
    });
  }
}

function updateRevealProgress(ctx, w, h) {
  if (!currentLetter) return;

  // muestreo liviano (no pixel por pixel)
  const step = 10; // cuanto más alto, más rápido pero menos preciso
  const img = ctx.getImageData(0, 0, w, h).data;

  let total = 0;
  let cleared = 0;

  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const idx = (y * w + x) * 4 + 3; // alpha
      total++;
      if (img[idx] === 0) cleared++;
    }
  }

  revealedRatio = total ? (cleared / total) : 0;

  // Revelado progresivo del texto:
  // - hasta 15%: sigue “raspá…”
  // - de 15% a 70%: aparece de a poco
  // - >70%: full
  if (revealedRatio < 0.15) {
    elActivityText.textContent = "Raspá para revelar 👆";
    return;
  }

  const start = 0.15;
  const end = 0.70;
  const t = Math.min(1, Math.max(0, (revealedRatio - start) / (end - start)));

  const full = currentActivity;
  const n = Math.max(1, Math.floor(full.length * t));
  const partial = full.slice(0, n) + (t < 1 ? "…" : "");

  elActivityText.textContent = partial;
}

function resetScratch() {
  revealedRatio = 0;

  const old = document.getElementById("scratch");
  if (!old) return;

  const parent = old.parentElement;
  const fresh = old.cloneNode(true);
  parent.replaceChild(fresh, old);

  elScratch = fresh;
  setupScratch();
}

setupScratch();

/** ---------- COMPLETE (subir foto + guardar) ---------- */
elBtnComplete.addEventListener("click", async () => {
  if (!session) return;
  if (!currentLetter) return;

  // obligamos a raspar un poco para que “cuente”
  if (revealedRatio < 0.15) {
    elStatusMsg.innerHTML = `<span class="err">Primero raspá un poquito para revelar 😌</span>`;
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

    renderPills();
    fillLetterSelect();

    // opcional: cerrar modal al completar
    // closeGameModal();

    // o seguir jugando con otra letra
    currentLetter = null;
    currentActivity = "";
    elBigLetter.textContent = "—";
    elActivityText.textContent = "Elegí una letra…";
    resetScratch();

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
