import "./style.css";
import { ACTIVITIES } from "./activities.js";
import { supabase, GAME_ID } from "./supabase.js";

/** Letras (incluye Ñ) */
const LETTERS = ["A","B","C","D","E","F","G","H","I","J","K","L","M","N","Ñ","O","P","Q","R","S","T","U","V","W","X","Y","Z"];

let session = null;
let currentLetter = null;
let currentActivity = "";
let completed = {}; // { A: { activity, photo_url } ... }
let wallReady = false;

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
        <button id="btnChange" class="btn primary">🔁 Cambiar letra</button>
        <button id="btnLogout" class="btn">Salir</button>
      </div>
    </div>

    <div class="card">
      <div class="metaRow">
        <div class="pill" id="pillLetter">Letra actual: —</div>
        <div class="pill" id="pillCount">0/27 completadas</div>
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
        <div class="sectionTitle">Letra</div>
        <div class="letterBox">
          <div class="bigLetter" id="bigLetter">—</div>
          <div class="small" id="scratchHint">Raspá con el mouse o el dedo 👆</div>
        </div>

        <canvas id="scratch" style="width:100%;height:140px;margin-top:12px;border-radius:18px;border:1px solid rgba(255,255,255,.10);background:rgba(0,0,0,.22)"></canvas>

        <div class="sectionTitle">Actividad</div>
        <div class="activityText" id="activityText">—</div>

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
`;

/** ---------- WALL HELPERS (solo cuando hay sesión) ---------- */
function showWall(visible) {
  const wall = document.getElementById("wall");
  if (!wall) return;

  wall.classList.toggle("hidden", !visible);
  wall.setAttribute("aria-hidden", String(!visible));

  // opcional: estado para estilos tipo body.locked
  document.body.classList.toggle("locked", !visible);
}

/** ---------- WALL INIT ---------- */
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

  wallReady = true;
}

/** setea foto en el tile + pie de foto */
function setWallPhoto(letter, photoUrl, activityText) {
  const wall = document.getElementById("wall");
  if (!wall) return;

  const tile = wall.querySelector(`.wallTile[data-letter="${letter}"]`);
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

/** ---------- ELEMENTS ---------- */
const elAuthBox = document.getElementById("authBox");
const elGameBox = document.getElementById("gameBox");
const elEmail = document.getElementById("email");
const elSendLink = document.getElementById("sendLink");
const elAuthMsg = document.getElementById("authMsg");

const elBtnChange = document.getElementById("btnChange");
const elBtnLogout = document.getElementById("btnLogout");

const elPillLetter = document.getElementById("pillLetter");
const elPillCount = document.getElementById("pillCount");
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

  // gating del fondo: solo cuando hay sesión
  showWall(!!session);

  if (session) {
    // inicializar muro SOLO cuando hay sesión (y una sola vez)
    if (!wallReady) initWall();

    await loadGameState();
  } else {
    // si no hay sesión, reseteo visual del muro por si venías de estar logueada
    wallReady = false;
    const wall = document.getElementById("wall");
    if (wall) wall.innerHTML = "";
  }
}

function renderAuth() {
  if (session) {
    elAuthBox.classList.add("hidden");
    elGameBox.classList.remove("hidden");
  } else {
    elAuthBox.classList.remove("hidden");
    elGameBox.classList.add("hidden");
  }
}

elSendLink.addEventListener("click", async () => {
  const email = elEmail.value.trim();
  if (!email) return (elAuthMsg.textContent = "Poné un mail 🥺");

  elAuthMsg.textContent = "Enviando link…";

  const redirectTo = window.location.origin; // ✅ importante para Vercel/localhost
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

  // ocultar muro y limpiar
  showWall(false);
  wallReady = false;
  const wall = document.getElementById("wall");
  if (wall) wall.innerHTML = "";

  renderPills();
  resetScratch();
  renderAuth();
});

/** ---------- GAME STATE (SUPABASE) ---------- */
/*
  Requiere en Supabase:
  - bucket storage: bingo-photos (public o signed, según lo tengas)
  - tabla: bingo_entries
    columnas:
      id uuid default gen_random_uuid()
      game_id text
      user_id uuid
      letter text
      activity text
      photo_url text
      created_at timestamp default now()
    UNIQUE (game_id, user_id, letter)
*/

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
    elStatusMsg.textContent = "Error: Load failed";
    return;
  }

  completed = {};
  for (const row of data || []) {
    completed[row.letter] = { activity: row.activity, photo_url: row.photo_url };
  }

  // pintar muro (si el muro existe)
  if (wallReady) {
    for (const letter of Object.keys(completed)) {
      setWallPhoto(letter, completed[letter].photo_url, completed[letter].activity);
    }
  }

  // elegir letra actual
  if (!currentLetter) pickNextLetter();

  renderPills();
  elStatusMsg.textContent = "";
}

/** ---------- PICK LETTER ---------- */
function pickNextLetter() {
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

  // random dentro de pendientes
  currentLetter = pending[Math.floor(Math.random() * pending.length)];
  currentActivity = ACTIVITIES[currentLetter] || "Actividad sorpresa 💫";

  elBigLetter.textContent = currentLetter;
  elActivityText.textContent = "Raspá para revelar 👆";
  resetScratch();
  renderPills();
}

elBtnChange.addEventListener("click", () => {
  if (!session) return;
  pickNextLetter();
});

/** ---------- SCRATCH (raspar) ---------- */
let isDown = false;
let revealed = false;

function setupScratch() {
  const canvas = elScratch;
  const ctx = canvas.getContext("2d");

  // tamaño real
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * devicePixelRatio);
  canvas.height = Math.floor(rect.height * devicePixelRatio);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(devicePixelRatio, devicePixelRatio);

  // capa gris
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "rgba(255,255,255,.18)";
  ctx.fillRect(0, 0, rect.width, rect.height);

  // texto “RASPA”
  ctx.fillStyle = "rgba(0,0,0,.25)";
  ctx.font = "800 22px ui-sans-serif, system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("RASPÁ", rect.width / 2, rect.height / 2);

  // ahora raspamos
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
    checkReveal();
  }

  function onMove(e) {
    if (!isDown) return;
    const { x, y } = getXY(e);
    draw(x, y);
    checkReveal();
  }

  function onUp() { isDown = false; }

  canvas.addEventListener("mousedown", onDown);
  canvas.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);

  canvas.addEventListener("touchstart", onDown, { passive: true });
  canvas.addEventListener("touchmove", onMove, { passive: true });
  window.addEventListener("touchend", onUp);

  function checkReveal() {
    if (revealed) return;
    // tu lógica “simple” para revelar
    revealed = true;
    elActivityText.textContent = currentActivity;
  }
}

function resetScratch() {
  revealed = false;

  // reemplaza canvas para limpiar listeners
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

  if (!revealed) {
    elStatusMsg.innerHTML = `<span class="err">Primero raspá para revelar 😌</span>`;
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

    // sube al bucket
    const { error: upErr } = await supabase.storage
      .from("bingo-photos")
      .upload(path, file, { upsert: true });

    if (upErr) throw upErr;

    // obtener URL pública (si el bucket es PUBLIC)
    const { data: pub } = supabase.storage.from("bingo-photos").getPublicUrl(path);
    const photoUrl = pub.publicUrl;

    elStatusMsg.textContent = "Guardando…";

    // upsert en tabla
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

    // actualizar local + muro
    completed[currentLetter] = { activity: currentActivity, photo_url: photoUrl };
    if (wallReady) setWallPhoto(currentLetter, photoUrl, currentActivity);

    // limpiar input
    elPhoto.value = "";

    elStatusMsg.innerHTML = `<span class="ok">Listo 💜 Guardado.</span>`;

    // siguiente letra
    pickNextLetter();
  } catch (e) {
    console.error(e);
    elStatusMsg.innerHTML = `<span class="err">Error: ${e.message || "Load failed"}</span>`;
  }
});

function renderPills() {
  elPillLetter.textContent = `Letra actual: ${currentLetter || "—"}`;
  const count = Object.keys(completed).length;
  elPillCount.textContent = `${count}/27 completadas`;
}

/** ---------- INIT ---------- */
supabase.auth.onAuthStateChange(() => {
  refreshSession();
});

refreshSession();
renderPills();
