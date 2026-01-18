import "./style.css";
import { ACTIVITIES } from "./activities.js";
import { supabase, GAME_ID } from "./supabase.js";

const LETTERS = ["A","B","C","D","E","F","G","H","I","J","K","L","M","N","Ñ","O","P","Q","R","S","T","U","V","W","X","Y","Z"];

let session = null;
let completed = {}; // { A: { activity, photo_url } }

let currentLetter = null;
let currentActivity = "";
let revealedRatio = 0;

const $app = document.getElementById("app");

/** UI base */
$app.innerHTML = `
  <div class="fabBar">
    <button id="btnPlay" class="btn primary">🎉 A JUGAR</button>
    <button id="btnLogout" class="btn hidden">Salir</button>
  </div>

  <div id="gameModal" class="modalOverlay hidden" role="dialog" aria-modal="true">
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

      <div id="gameBox" class="hidden">
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
          <div class="small">Raspá con el mouse o el dedo 👆</div>
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
        <div class="footerLove">Feliz cumple amor! Te amo! 18.02.26 💖</div>
      </div>
    </div>
  </div>
`;

/** Elements */
const elBtnPlay = document.getElementById("btnPlay");
const elBtnLogout = document.getElementById("btnLogout");

const elModal = document.getElementById("gameModal");
const elBtnCloseModal = document.getElementById("btnCloseModal");

const elAuthBox = document.getElementById("authBox");
const elGameBox = document.getElementById("gameBox");

const elEmail = document.getElementById("email");
const elSendLink = document.getElementById("sendLink");
const elAuthMsg = document.getElementById("authMsg");

const elPillCount = document.getElementById("pillCount");

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

/** Wall helpers */
function showWall(visible) {
  const wall = document.getElementById("wall");
  if (!wall) return;
  wall.classList.toggle("hidden", !visible);
  wall.setAttribute("aria-hidden", String(!visible));
}

function initWall() {
  const wall = document.getElementById("wall");
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

  wall.addEventListener("click", (e) => {
    const tile = e.target.closest?.(".wallTile");
    if (!tile || !session) return;

    const letter = tile.dataset.letter;
    if (!letter || completed[letter]) return;

    openModal();
    pickLetter(letter);
  });
}

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

function setWallPhoto(letter, photoUrl, activityText) {
  const wall = document.getElementById("wall");
  const tile = wall.querySelector(`.wallTile[data-letter="${letter}"]`);
  if (!tile) return;

  tile.classList.add("hasPhoto");
  ensureWallStyle(letter, photoUrl);

  const txt = tile.querySelector(".wallCaption .txt");
  if (txt) txt.textContent = activityText || "Completada 💜";
}

/** Modal open/close */
function openModal() {
  elModal.classList.remove("hidden");
  // FIX: recalcular canvas SIEMPRE después de que el modal sea visible
  requestAnimationFrame(() => {
    resetScratch();
  });
}

function closeModal() {
  elModal.classList.add("hidden");
}

elBtnPlay.addEventListener("click", () => openModal());
elBtnCloseModal.addEventListener("click", closeModal);
elModal.addEventListener("click", (e) => { if (e.target === elModal) closeModal(); });

/** Auth UI */
function renderAuthUI() {
  if (session) {
    elAuthBox.classList.add("hidden");
    elGameBox.classList.remove("hidden");
    elBtnLogout.classList.remove("hidden");
    showWall(true);
  } else {
    elAuthBox.classList.remove("hidden");
    elGameBox.classList.add("hidden");
    elBtnLogout.classList.add("hidden");
    showWall(false);
  }
}

async function refreshSession() {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) console.error(error);
    session = data?.session || null;

    renderAuthUI();

    if (session) {
      initWall();
      await loadGameState();
      fillLetterSelect();
      renderPills();

      // 👇 FIX “no se ve nada hasta recargar”: al loguear, abrimos el modal
      openModal();
    }
  } catch (e) {
    console.error(e);
    // si algo falla, al menos que se vea el botón A JUGAR
    session = null;
    renderAuthUI();
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

  elAuthMsg.textContent = error
    ? ("Error enviando link: " + error.message)
    : "Listo ✨ Revisá tu mail y abrí el link.";
});

elBtnLogout.addEventListener("click", async () => {
  await supabase.auth.signOut();
  session = null;
  completed = {};
  currentLetter = null;
  currentActivity = "";
  closeModal();
  renderAuthUI();
  renderPills();
});

/** Load from DB */
async function loadGameState() {
  const userId = session.user.id;

  const { data, error } = await supabase
    .from("bingo_entries")
    .select("letter, activity, photo_url")
    .eq("game_id", GAME_ID)
    .eq("user_id", userId);

  if (error) {
    console.error(error);
    return;
  }

  completed = {};
  for (const row of data || []) {
    completed[row.letter] = { activity: row.activity, photo_url: row.photo_url };
  }

  for (const letter of Object.keys(completed)) {
    setWallPhoto(letter, completed[letter].photo_url, completed[letter].activity);
  }
}

/** Letters */
function fillLetterSelect() {
  const pending = LETTERS.filter(l => !completed[l]);
  elLetterSelect.innerHTML =
    `<option value="">Elegí una letra…</option>` +
    pending.map(l => `<option value="${l}">${l}</option>`).join("");
}

function pickLetter(letter) {
  currentLetter = letter;
  currentActivity = ACTIVITIES[currentLetter] || "Actividad sorpresa 💫";
  elBigLetter.textContent = currentLetter;

  revealedRatio = 0;
  elActivityText.textContent = "Raspá para revelar 👆";

  // FIX: rearmar scratch para esa letra
  requestAnimationFrame(() => resetScratch());

  fillLetterSelect();
  elStatusMsg.textContent = "";
}

function pickRandomLetter() {
  const pending = LETTERS.filter(l => !completed[l]);
  if (!pending.length) {
    currentLetter = null;
    currentActivity = "";
    elBigLetter.textContent = "💜";
    elActivityText.textContent = "¡Completaron todo! 🥹";
    resetScratch();
    return;
  }
  pickLetter(pending[Math.floor(Math.random() * pending.length)]);
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

/** Scratch progressive */
let isDown = false;
let rafPending = false;

function setupScratch() {
  const canvas = elScratch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  // si todavía mide 0 (modal no visible), salimos
  if (!rect.width || !rect.height) return;

  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // capa
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
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.fill();
  }

  function getXY(e) {
    const r = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - r.left, y: clientY - r.top };
  }

  function scheduleProgress() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      updateRevealProgress(canvas, ctx);
    });
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
}

function updateRevealProgress(canvas, ctx) {
  if (!currentLetter) return;

  const w = canvas.width;
  const h = canvas.height;

  // muestreo un poco más sensible
  const step = Math.max(6, Math.floor((window.devicePixelRatio || 1) * 8));
  const img = ctx.getImageData(0, 0, w, h).data;

  let total = 0;
  let cleared = 0;

  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const idx = (y * w + x) * 4 + 3;
      total++;
      if (img[idx] === 0) cleared++;
    }
  }

  revealedRatio = total ? (cleared / total) : 0;

  // ✅ REVELADO PROGRESIVO (más fácil de activar)
  const start = 0.02; // antes era muy alto
  const end = 0.35;

  if (revealedRatio < start) {
    elActivityText.textContent = "Raspá para revelar 👆";
    return;
  }

  const t = Math.min(1, Math.max(0, (revealedRatio - start) / (end - start)));
  const full = currentActivity || "Actividad sorpresa 💫";
  const n = Math.max(1, Math.floor(full.length * t));

  elActivityText.textContent = full.slice(0, n) + (t < 1 ? "…" : "");
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

/** Complete */
elBtnComplete.addEventListener("click", async () => {
  if (!session || !currentLetter) return;

  if (revealedRatio < 0.02) {
    elStatusMsg.innerHTML = `<span class="err">Raspá un poquito para revelar 😌</span>`;
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

/** INIT */
supabase.auth.onAuthStateChange((_event, _sess) => {
  // esto cubre el regreso del magic link sin recargar
  refreshSession();
});
refreshSession();
renderPills();
