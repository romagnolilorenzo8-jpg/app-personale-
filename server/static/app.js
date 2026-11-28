/* LifeApp — interfaccia (nessuna dipendenza esterna).
   Funziona in due modi:
   - con il server di casa (le richieste /api/... vanno al server)
   - "modalità iPhone" (window.LOCALE: tutto salvato nella memoria del telefono) */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = $("#app");
const LOC = !!window.LOCALE;
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const STANDALONE = navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const MESI_L = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const GIORNI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
const COLORI = ["#5b5bf6", "#e5484d", "#0ea5a4", "#e8a23a", "#8b5cf6", "#2fa66a", "#ec4899", "#3b82f6", "#64748b"];
const GRUPPI_APP = {
  personale: { ico: "🙋", nome: "Personali", col: "#ec4899", cat: ["personale", "casa", "veicoli"] },
  universita: { ico: "🎓", nome: "Università", col: "#f59e0b", cat: ["universita"] },
  lavoro: { ico: "💼", nome: "Lavoro", col: "#14b8a6", cat: ["lavoro"] },
  salute: { ico: "🩺", nome: "Visite", col: "#ef4444", cat: ["salute"] },
  altro: { ico: "📌", nome: "Altro", col: "#64748b", cat: ["altro"] },
};
const gruppoDi = (cat) => Object.keys(GRUPPI_APP).find((k) => GRUPPI_APP[k].cat.includes(cat)) || "altro";
const COL_CAT = new Proxy({}, { get: (_, c) => GRUPPI_APP[gruppoDi(c)].col });
const CMD_CAL = "LifeApp Calendario";
const CMD_INVIA = "Invia a Scrigno";

const S = { cartelle: [], byId: {}, figli: {}, daSmistare: 0, stato: null };
const memo = { get: (k) => { try { return localStorage.getItem("scrigno-" + k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem("scrigno-" + k) : localStorage.setItem("scrigno-" + k, v); } catch { /* */ } } };

/* ================================================================== utilità */
/* Le pagine già viste si aprono subito: le risposte restano valide 20 secondi
   e vengono cancellate a ogni modifica (salvataggio, spostamento, eliminazione…). */
const memoria = new Map();
let giroMemoria = 0;   // cambia a ogni modifica: una lettura partita prima non rimette in memoria dati vecchi
const svuotaMemoria = () => { memoria.clear(); giroMemoria++; };
async function api(url, opts = {}) {
  const get = !opts.method || opts.method.toUpperCase() === "GET";
  if (get && !opts.fresco) { const c = memoria.get(url); if (c && Date.now() - c.t < 20000) return structuredClone(c.v); }
  if (!get) svuotaMemoria();
  const giro = giroMemoria;
  try {
    const dati = LOC ? await window.LOCALE.api(url, opts) : await apiRete(url, opts);
    if (get && giro === giroMemoria && !/cassaforte|impostazioni/.test(url)) memoria.set(url, { t: Date.now(), v: structuredClone(dati) });
    return dati;
  } finally { if (!get) svuotaMemoria(); }
}
// qualsiasi scrittura nella memoria del telefono (anche da altre parti dell'app) svuota la memoria a breve termine
if (LOC && window.LOCALE && !window.LOCALE._avvolto) {
  const api0 = window.LOCALE.api.bind(window.LOCALE), carica0 = window.LOCALE.carica.bind(window.LOCALE);
  window.LOCALE.api = (url, o = {}) => { if (o.method && o.method.toUpperCase() !== "GET") svuotaMemoria(); return api0(url, o); };
  window.LOCALE.carica = (...x) => { svuotaMemoria(); return carica0(...x).finally(svuotaMemoria); };
  window.LOCALE._avvolto = true;
}
async function apiRete(url, opts) {
  const o = { credentials: "same-origin", ...opts, headers: { ...(opts.headers || {}) } };
  if (o.json !== undefined) { o.body = JSON.stringify(o.json); o.headers["Content-Type"] = "application/json"; delete o.json; }
  const r = await fetch(url, o);
  if (r.status === 401 && !/accedi|sblocca|impostazioni\/password|importa/.test(url)) {
    S.stato = { configurato: true, accesso: false }; mostraAccesso(); throw new Error("Accesso richiesto");
  }
  const ct = r.headers.get("content-type") || "";
  const dati = ct.includes("json") ? await r.json() : await r.text();
  if (!r.ok) { const e = new Error((dati && dati.errore) || "Errore " + r.status); e.status = r.status; Object.assign(e, dati || {}); throw e; }
  return dati;
}

function toast(msg, ms = 2800) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), ms);
}
function dimensione(b) {
  if (b == null) return "";
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(0) + " KB";
  if (b < 1073741824) return (b / 1048576).toFixed(1).replace(".", ",") + " MB";
  return (b / 1073741824).toFixed(1).replace(".", ",") + " GB";
}
const dataIt = (iso) => { if (!iso) return ""; const d = new Date(iso.length === 10 ? iso + "T00:00" : iso); return `${d.getDate()} ${MESI[d.getMonth()]} ${d.getFullYear()}`; };
const oggiIso = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const giorniA = (iso) => Math.round((new Date(iso + "T00:00") - new Date(oggiIso() + "T00:00")) / 86400000);
const oraDa = (iso) => (iso && iso.length > 10 ? iso.slice(11, 16) : "");
const senzaEst = (n) => n.replace(/\.[a-z0-9]{1,5}$/i, "");

function iconaFile(d) {
  const m = d.mime || "", n = (d.nome || "").toLowerCase();
  if (m.includes("pdf")) return "📕";
  if (m.startsWith("image/")) return "🖼️";
  if (m.startsWith("video/")) return "🎞️";
  if (m.startsWith("audio/")) return "🎧";
  if (/\.(docx?|odt|pages|rtf)$/.test(n)) return "📝";
  if (/\.(xlsx?|ods|numbers|csv)$/.test(n)) return "📊";
  if (/\.(zip|rar|7z)$/.test(n)) return "🗜️";
  if (/\.url$/.test(n)) return "🔗";
  if (m.startsWith("text/")) return "📄";
  return "📎";
}
const urlFile = (d, scarica) => (LOC ? d._url : `/api/documenti/${d.id}/file${scarica ? "?scarica=1" : ""}`);
const urlMini = (d) => (LOC ? d._url : `/api/documenti/${d.id}/miniatura`);

function tagScadenza(iso) {
  if (!iso) return "";
  const g = giorniA(iso);
  if (g < 0) return `<span class="tag danger">Scaduto il ${dataIt(iso)}</span>`;
  if (g === 0) return `<span class="tag danger">Scade oggi</span>`;
  if (g <= 30) return `<span class="tag warn">Scade tra ${g} giorn${g === 1 ? "o" : "i"}</span>`;
  return `<span class="tag ok">Scade il ${dataIt(iso)}</span>`;
}
async function copia(testo, cosa = "Copiato") {
  try { await navigator.clipboard.writeText(testo); }
  catch { const t = document.createElement("textarea"); t.value = testo; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); }
  toast("✅ " + cosa);
}
/* Condividi / salva su File un file (foglio di condivisione di iPhone) */
async function condividiFile(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return true; } catch (e) { if (e.name === "AbortError") return false; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
  return true;
}
async function fileDi(d) {
  const blob = LOC ? await window.LOCALE.blobDoc(d.id) : await (await fetch(urlFile(d))).blob();
  return new File([blob], d.nome, { type: d.mime || blob.type });
}

/* ================================================================== fogli modali */
function foglio(html, { onClose, classe = "" } = {}) {
  const v = document.createElement("div");
  v.className = "velo";
  v.innerHTML = `<div class="foglio ${classe}" role="dialog"><div class="maniglia"></div>${html}</div>`;
  const chiudi = () => { v.remove(); onClose && onClose(); };
  v.addEventListener("click", (e) => { if (e.target === v || e.target.closest("[data-chiudi]")) chiudi(); });
  document.body.appendChild(v);
  v.chiudi = chiudi;
  return v;
}
const xBtn = `<button class="iconbtn x" data-chiudi aria-label="Chiudi">✕</button>`;

function conferma(testo, etichetta = "Elimina", spiegazione = "") {
  return new Promise((res) => {
    const v = foglio(`<h3>${esc(testo)}</h3>${spiegazione ? `<p class="muted" style="margin-top:-6px">${spiegazione}</p>` : ""}
      <div class="riga"><button class="btn sec" data-chiudi>Annulla</button><button class="btn danger" id="ok">${esc(etichetta)}</button></div>`, { onClose: () => res(false) });
    $("#ok", v).onclick = () => { res(true); v.remove(); };
  });
}
function chiedi(titolo, valore = "", { tipo = "text", etichetta = "Salva", placeholder = "", aiuto = "" } = {}) {
  return new Promise((res) => {
    const v = foglio(`<h3>${esc(titolo)} ${xBtn}</h3><form>${aiuto ? `<p class="muted small" style="margin-top:-8px">${aiuto}</p>` : ""}
      <input type="${tipo}" id="val" value="${esc(valore)}" placeholder="${esc(placeholder)}">
      <div style="height:12px"></div><button class="btn block">${esc(etichetta)}</button></form>`, { onClose: () => res(null) });
    $("form", v).onsubmit = (e) => { e.preventDefault(); res($("#val", v).value); v.remove(); };
    if (tipo !== "date") setTimeout(() => $("#val", v).focus(), 80);
  });
}

/* ================================================================== cartelle */
async function caricaCartelle() {
  const r = await api("/api/cartelle");
  S.cartelle = r.cartelle; S.daSmistare = r.da_smistare; S.byId = {}; S.figli = {};
  for (const c of r.cartelle) { S.byId[c.id] = c; (S.figli[c.padre ?? "root"] ||= []).push(c); }
  const b = $("#badge-smistare"); b.hidden = !S.daSmistare; b.textContent = S.daSmistare;
}
function radice(c) { while (c && c.padre != null) c = S.byId[c.padre]; return c; }
function coloreCartella(c) { const i = (S.figli.root || []).indexOf(radice(c)); return COLORI[(i < 0 ? 0 : i) % COLORI.length]; }
function percorso(id) { const out = []; let c = S.byId[id]; while (c) { out.unshift(c); c = S.byId[c.padre]; } return out; }
const nomePercorso = (id, n = 3) => percorso(id).slice(-n).map((p) => p.nome).join(" › ");

function htmlCartelle(lista) {
  return `<div class="griglia">${lista.map((c) => {
    const info = [c.sottocartelle ? `${c.sottocartelle} cartell${c.sottocartelle === 1 ? "a" : "e"}` : "", c.totale ? `${c.totale} document${c.totale === 1 ? "o" : "i"}` : ""].filter(Boolean).join(" · ") || "Vuota";
    return `<a class="cartella" href="#/c/${c.id}" style="--c:${coloreCartella(c)}"><div class="ico">${esc(c.icona)}</div>
      <div class="nome">${esc(c.nome)}</div><div class="info">${info}</div></a>`;
  }).join("")}</div>`;
}

function sceltaCartella(titolo, { attuale = null, consentiRadice = false, escludi = null, etichetta = "Scegli questa" } = {}) {
  return new Promise((res) => {
    const aperte = new Set(percorso(attuale).map((c) => c.id));
    let sel = attuale;
    const v = foglio(`<h3>${esc(titolo)} ${xBtn}</h3><p class="muted small" style="margin:-8px 4px 10px">Tocca una cartella per aprirla e sceglierla.</p>
      <div class="card albero" id="alb"></div>
      <div style="height:12px"></div><div class="riga"><button class="btn sec" id="nuova">＋ Nuova</button><button class="btn" id="ok">${esc(etichetta)}</button></div>`,
      { onClose: () => res(undefined) });
    const disegna = () => {
      const nodo = (c, liv) => {
        if (escludi && percorso(c.id).some((p) => p.id === escludi)) return "";
        const figli = S.figli[c.id] || [], ap = aperte.has(c.id);
        return `<div class="nodo ${sel === c.id ? "sel" : ""}" data-id="${c.id}" style="padding-left:${8 + liv * 20}px">
          <span class="freccia ${ap ? "aperta" : ""}" data-fr="${c.id}">${figli.length ? "▶" : ""}</span><span>${esc(c.icona)}</span>
          <span style="flex:1">${esc(c.nome)}</span>${sel === c.id ? "<b style='color:var(--accent)'>✓</b>" : ""}</div>${ap ? figli.map((f) => nodo(f, liv + 1)).join("") : ""}`;
      };
      $("#alb", v).innerHTML = (consentiRadice ? `<div class="nodo ${sel === null ? "sel" : ""}" data-id=""><span class="freccia"></span>🏠<span style="flex:1">Pagina principale</span>${sel === null ? "✓" : ""}</div>` : "") +
        (S.figli.root || []).map((c) => nodo(c, 0)).join("");
      $("#ok", v).textContent = sel != null ? `${etichetta}: ${S.byId[sel].nome}` : etichetta;
    };
    $("#alb", v).onclick = (e) => {
      const n = e.target.closest(".nodo"); if (!n) return;
      const id = n.dataset.id ? +n.dataset.id : null;
      const kids = id != null && (S.figli[id] || []).length;
      if (e.target.dataset.fr && kids) { aperte.has(id) ? aperte.delete(id) : aperte.add(id); } else { sel = id; if (kids) aperte.add(id); }
      disegna();
    };
    $("#ok", v).onclick = () => { if (sel === null && !consentiRadice) return toast("Scegli una cartella"); res(sel); v.remove(); };
    $("#nuova", v).onclick = async () => {
      const nome = await chiedi(sel ? `Nuova cartella dentro “${S.byId[sel].nome}”` : "Nuova cartella principale", "", { placeholder: "Es. Moto, Oculista, Polizza casa…" });
      if (!nome) return;
      const r = await api("/api/cartelle", { method: "POST", json: { nome, padre: sel } });
      await caricaCartelle(); if (sel) aperte.add(sel); sel = r.id; disegna();
    };
    disegna();
  });
}

/* ================================================================== suggerimenti di cartella */
const REGOLE = [
  [/contratto d.?affitto|locazione|contratto di affitto/, /^contratto d.affitto/], [/ricevuta.*affitto|affitto .*(?:pagato|ricevuta)|canone/, /^ricevute affitto/],
  [/rogito|\batto\b|mutuo|compravendita/, /^atto e mutuo/], [/condominio|condominial|amministratore/, /^condominio/],
  [/curriculum|\bcv\b|resume|europass/, /^curriculum/], [/fototessera|foto tessera|foto-tessera|passport photo/, /^fototessera/],
  [/bollo/, /^bollo/], [/assicura|polizza|rca\b|quietanza/, /^assicurazione/], [/revision/, /^revisione/],
  [/libretto|carta di circolazione/, /^libretto/], [/tagliando|manutenz|officina|gomme/, /^manutenzione/],
  [/analisi|emocromo|sangue|prelievo|laboratorio/, /^analisi del sangue/],
  [/panoramica|ortopan|rx.*dent|radiograf.*dent|dentist|odonto/, /^radiografie denti/],
  [/referto|visita|lettera di dimissione/, /^referti/], [/ecograf|risonanza|\btac\b|radiograf|\brx\b/, /^esami e radiografie/],
  [/ricetta|farmac/, /^ricette/], [/vaccin|green ?pass/, /^vaccini/],
  [/bolletta|enel|\bluce\b|\bgas\b|acqua|\btari\b|hera|a2a|iren|eni plenitude|tim\b|fastweb|vodafone|wind/, /^bollette/], [/contratto|affitto/, /^contratt/],
  [/garanzia|scontrino|fattura/, /^garanzie/], [/busta ?paga|buste paga|cedolino|\bbp\b/, /^buste paga/], [/contratto di lavoro|assunzione|contratto/, /^contratt/], [/\b730\b|redditi|\bf24\b|\bcud\b|certificazione unica/, /^dichiarazione/],
  [/carta d.?identit|\bcie\b/, /^carta d/], [/patente/, /^patente/], [/passaporto/, /^passaporto/], [/tessera sanitaria|codice fiscale/, /^tessera sanitaria/],
];
function suggerimenti(testo) {
  const n = (testo || "").toLowerCase().replace(/[_\-.]+/g, " ");
  const moto = /moto|scooter|ciclomotore/.test(n), auto = /\bauto\b|macchina|vettura/.test(n);
  for (const [chiave, cartella] of REGOLE) {
    if (!chiave.test(n)) continue;
    let c = S.cartelle.filter((x) => cartella.test(x.nome.toLowerCase()));
    const sotto = (x, nome) => percorso(x.id).some((p) => p.nome.toLowerCase() === nome);
    if (moto) c = c.filter((x) => !sotto(x, "auto"));
    if (auto) c = c.filter((x) => !sotto(x, "motorino"));
    if (c.length) return c.slice(0, 3);
  }
  return [];
}
const conScadenza = (id) => id != null && /bollo|assicura|revision|patente|carta d|passaporto|tessera|polizz|garanzi|contratt/i.test(percorso(id).map((p) => p.nome).join(" "));

/* ================================================================== aggiungere documenti */
function scegliFile({ cartella = null, foto = false, dopo } = {}) {
  const inp = $("#file-input");
  inp.value = ""; inp.accept = foto ? "image/*" : "";
  foto ? inp.setAttribute("capture", "environment") : inp.removeAttribute("capture");
  inp.onchange = () => inp.files.length && doveSalvo([...inp.files], { cartella, dopo });
  inp.click();
}

/* Foglio “Salva documento”: dove lo metto? quando scade? */
function doveSalvo(files, { cartella = null, dopo } = {}) {
  const uno = files.length === 1;
  const sugg = suggerimenti(files.map((f) => f.name).join(" "));
  let dest = cartella ?? (sugg.length === 1 ? sugg[0].id : null);
  const anteprima = files[0].type.startsWith("image/") ? `<img src="${URL.createObjectURL(files[0])}" alt="">` : `<span>${iconaFile({ mime: files[0].type, nome: files[0].name })}</span>`;
  const v = foglio(`<h3>Salva documento ${xBtn}</h3>
    <div class="salva-testa"><div class="salva-thumb">${anteprima}</div>
      <div style="flex:1;min-width:0">${uno ? `<label class="campo" style="margin:0"><span>Nome</span><input type="text" id="s-nome" value="${esc(senzaEst(files[0].name))}"></label>`
        : `<b>${files.length} file</b><div class="muted small">${dimensione(files.reduce((a, f) => a + f.size, 0))}</div>`}</div></div>
    <div class="etichetta">📁 Dove lo salvo?</div>
    <button class="dest" id="s-dest"></button>
    <div class="chips" id="s-sugg" style="margin-top:8px"></div>
    <div id="s-scad"></div>
    <button class="btn block" id="s-ok" style="margin-top:14px">Salva</button>
    ${cartella == null ? `<button class="btn sec block" id="s-dopo" style="margin-top:8px">Decido dopo (va in “Da smistare”)</button>` : ""}`);
  const disegna = () => {
    $("#s-dest", v).innerHTML = dest != null
      ? `<span class="ico" style="--c:${coloreCartella(S.byId[dest])}">${esc(S.byId[dest].icona)}</span><span style="flex:1;text-align:left"><b>${esc(S.byId[dest].nome)}</b><br><span class="muted small">${esc(nomePercorso(dest, 4))}</span></span><span class="muted">Cambia ›</span>`
      : `<span class="ico">📂</span><span style="flex:1;text-align:left"><b>Scegli una cartella</b><br><span class="muted small">Tocca per vedere tutte le cartelle</span></span><span class="muted">›</span>`;
    $("#s-sugg", v).innerHTML = sugg.filter((c) => c.id !== dest).map((c) => `<button class="chip" data-id="${c.id}">✨ ${esc(nomePercorso(c.id, 2))}</button>`).join("");
    const mostra = conScadenza(dest);
    const val = $("#s-data", v)?.value || "";
    $("#s-scad", v).innerHTML = mostra || val
      ? `<label class="campo" style="margin-top:14px"><span>⏰ Quando scade? <i class="muted">(facoltativo, ti avviso prima)</i></span><input type="date" id="s-data" value="${esc(val)}"></label>`
      : `<button class="link-btn" id="s-agg-scad">＋ Aggiungi una data di scadenza</button>`;
    $("#s-agg-scad", v) && ($("#s-agg-scad", v).onclick = () => { $("#s-scad", v).innerHTML = `<label class="campo" style="margin-top:14px"><span>⏰ Quando scade?</span><input type="date" id="s-data"></label>`; });
  };
  $("#s-dest", v).onclick = async () => { const c = await sceltaCartella("Dove lo salvo?", { attuale: dest }); if (c !== undefined) { dest = c; disegna(); } };
  $("#s-sugg", v).onclick = (e) => { const b = e.target.closest("[data-id]"); if (b) { dest = +b.dataset.id; disegna(); } };
  const salva = async (cart) => {
    const nome = uno ? $("#s-nome", v).value.trim() : null;
    const scadenza = $("#s-data", v)?.value || null;
    v.remove();
    await caricaFile(files, { cartella: cart, scadenza, nome });
    dopo && dopo();
  };
  $("#s-ok", v).onclick = () => { if (dest == null) return $("#s-dest", v).click(); salva(dest); };
  $("#s-dopo", v) && ($("#s-dopo", v).onclick = () => salva(null));
  disegna();
}

async function caricaFile(files, { cartella = null, scadenza = null, nome = null } = {}) {
  const v = foglio(`<h3>Salvataggio…</h3><p class="muted">${files.length} file · ${dimensione(files.reduce((a, f) => a + f.size, 0))}</p><div class="progresso"><div id="pb"></div></div>`);
  const fine = async (ok, msg) => {
    v.remove();
    if (ok) { toast(`✅ Salvat${files.length === 1 ? "o" : "i"} ${cartella != null ? "in " + S.byId[cartella].nome : "in Da smistare"}${scadenza ? " · ⏰ promemoria impostato" : ""}`); await caricaCartelle(); }
    else toast("⚠️ " + msg);
  };
  if (LOC) {
    $("#pb", v).style.width = "60%";
    try { svuotaMemoria(); await window.LOCALE.carica(files, { cartella, scadenza, nome }); svuotaMemoria(); await fine(true); }
    catch (e) { await fine(false, e.name === "QuotaExceededError" ? "Spazio esaurito sul telefono" : e.message); }
    return;
  }
  await new Promise((res) => {
    const fd = new FormData();
    svuotaMemoria();
    files.forEach((f) => fd.append("file", f, f.name));
    if (cartella != null) fd.append("cartella", cartella);
    if (scadenza) fd.append("scadenza", scadenza);
    if (nome) fd.append("nome", nome);
    const x = new XMLHttpRequest();
    x.open("POST", "/api/documenti");
    x.upload.onprogress = (e) => e.lengthComputable && ($("#pb", v).style.width = (e.loaded / e.total) * 100 + "%");
    x.onload = async () => {
      if (x.status < 300) await fine(true);
      else { let m = "Errore nel salvataggio"; try { m = JSON.parse(x.responseText).errore; } catch { /* */ } await fine(false, m); }
      res();
    };
    x.onerror = async () => { await fine(false, "Server non raggiungibile"); res(); };
    x.send(fd);
  });
}

/* trascina e rilascia (computer) */
let dragN = 0;
addEventListener("dragenter", (e) => { if (S.stato?.accesso && e.dataTransfer?.types?.includes("Files")) { dragN++; $("#drop").hidden = false; } });
addEventListener("dragleave", () => { if (--dragN <= 0) { dragN = 0; $("#drop").hidden = true; } });
addEventListener("dragover", (e) => e.preventDefault());
addEventListener("drop", (e) => {
  e.preventDefault(); dragN = 0; $("#drop").hidden = true;
  const files = [...(e.dataTransfer?.files || [])]; if (!files.length) return;
  const m = location.hash.match(/^#\/c\/(\d+)/);
  doveSalvo(files, { cartella: m ? +m[1] : null, dopo: render });
});

function fab(cartella, dopo) {
  const b = document.createElement("button"); b.className = "fab"; b.innerHTML = "<span>＋</span>"; b.setAttribute("aria-label", "Aggiungi");
  b.onclick = () => {
    b.classList.add("aperto"); setTimeout(() => b.classList.remove("aperto"), 600);
    const v = foglio(`<h3>Aggiungi ${cartella != null ? `in ${esc(S.byId[cartella].nome)}` : ""} ${xBtn}</h3><div class="azioni-grandi">
      <button data-m="foto"><span>📷</span>Fotografa un documento</button>
      <button data-m="file"><span>📄</span>Scegli un file o una foto</button>
      ${cartella !== undefined ? `<button data-m="cartella"><span>📁</span>Nuova cartella</button>` : ""}
    </div>`);
    v.addEventListener("click", async (e) => {
      const m = e.target.closest("[data-m]")?.dataset.m; if (!m) return; v.remove();
      if (m === "file" || m === "foto") scegliFile({ cartella: cartella ?? null, foto: m === "foto", dopo });
      if (m === "cartella") {
        const nome = await chiedi("Nome della nuova cartella", "", { placeholder: "Es. Moto, Oculista, Polizza casa…" }); if (!nome) return;
        await api("/api/cartelle", { method: "POST", json: { nome, padre: cartella ?? null } });
        await caricaCartelle(); toast("📁 Cartella creata"); dopo && dopo();
      }
    });
  };
  app.appendChild(b);
}

/* ================================================================== documenti */
function htmlDocs(docs, { mostraCartella = false, suggerisci = false } = {}) {
  if (!docs.length) return "";
  return `<div class="lista">${docs.map((d) => {
    const thumb = (d.mime || "").startsWith("image/") ? `<img loading="lazy" decoding="async" src="${urlMini(d)}" alt="" onerror="this.replaceWith('🖼️')">` : iconaFile(d);
    const sub = [mostraCartella ? (d.cartella ? "📁 " + esc(d.nome_cartella) : "📥 Da smistare") : "", dataIt(d.creato), dimensione(d.dimensione)].filter(Boolean).join(" · ");
    const sg = suggerisci ? suggerimenti(d.nome + " " + (d.note || "")) : [];
    return `<div class="voce" data-doc="${d.id}"><div class="thumb">${thumb}</div><div class="corpo"><div class="tit">${esc(d.nome)}</div>
      <div class="sub">${sub}</div>${d.scadenza ? `<div style="margin-top:4px">${tagScadenza(d.scadenza)}</div>` : ""}
      ${suggerisci ? `<div class="sugg-riga">${sg.map((c) => `<button class="sugg" data-sposta="${d.id}" data-in="${c.id}">✨ ${esc(nomePercorso(c.id, 2))}</button>`).join("")}<button class="sugg altro" data-scegli="${d.id}">📁 Scegli cartella</button></div>` : ""}
      </div><div class="dx">›</div></div>`;
  }).join("")}</div>`;
}
function collegaDocs(el, docs, ricarica) {
  el.addEventListener("click", async (e) => {
    const sp = e.target.closest("[data-sposta]"), sc = e.target.closest("[data-scegli]");
    if (sp || sc) {
      e.stopPropagation();
      const id = +(sp || sc).dataset[sp ? "sposta" : "scegli"];
      const dest = sp ? +sp.dataset.in : await sceltaCartella("Sposta in…", { etichetta: "Sposta qui" });
      if (dest === undefined) return;
      await api(`/api/documenti/${id}`, { method: "PATCH", json: { sposta: true, cartella: dest } });
      toast("📁 Spostato in " + S.byId[dest].nome); await caricaCartelle(); ricarica && ricarica(); return;
    }
    const v = e.target.closest("[data-doc]"); if (!v) return;
    const d = docs.find((x) => x.id === +v.dataset.doc); if (d) apriDoc(d, ricarica);
  });
}

/* Visualizzatore a schermo intero */
function visore(d) {
  const m = d.mime || "";
  let corpo = `<div class="vuoto" style="color:#fff"><span class="big">${iconaFile(d)}</span>Anteprima non disponibile per questo tipo di file.<br>Usa “Condividi” per aprirlo con un'altra app.</div>`;
  if (m.startsWith("image/")) corpo = `<img src="${urlFile(d)}" alt="">`;
  else if (m.includes("pdf") || m.startsWith("text/") || m.startsWith("video/") || m.startsWith("audio/"))
    corpo = m.startsWith("video/") ? `<video src="${urlFile(d)}" controls playsinline></video>` : m.startsWith("audio/") ? `<audio src="${urlFile(d)}" controls></audio>` : `<iframe src="${urlFile(d)}" title="Documento"></iframe>`;
  const v = document.createElement("div");
  v.className = "visore";
  v.innerHTML = `<div class="visore-barra"><button class="vbtn" data-x>✕ Chiudi</button><span class="vtit">${esc(d.nome)}</span><button class="vbtn" data-sh>📤</button></div><div class="visore-corpo">${corpo}</div>`;
  v.querySelector("[data-x]").onclick = () => v.remove();
  v.querySelector("[data-sh]").onclick = async () => condividiFile(await fileDi(d));
  document.body.appendChild(v);
}

function apriDoc(d, ricarica) {
  const m = d.mime || "";
  const prev = m.startsWith("image/") ? `<img src="${urlMini(d)}" alt="">` : `<div class="big">${iconaFile(d)}</div>`;
  const perc = d.cartella ? percorso(d.cartella).map((c) => esc(c.nome)).join(" › ") : "📥 Da smistare";
  const v = foglio(`<h3><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.nome)}</span> ${xBtn}</h3>
    <div class="anteprima-doc" data-a="apri">${prev}<div class="tocca">Tocca per aprire</div></div>
    <p class="small muted" style="margin:12px 4px 6px">${perc} · aggiunto il ${dataIt(d.creato)} · ${dimensione(d.dimensione)}</p>
    ${d.scadenza ? `<p style="margin:0 4px 8px">${tagScadenza(d.scadenza)}</p>` : ""}
    ${d.note ? `<div class="card small" style="margin-bottom:8px;white-space:pre-wrap">${esc(d.note)}</div>` : ""}
    <button class="btn block" data-a="apri">👁️ Apri documento</button>
    <div class="azioni">
      <button class="btn sec" data-a="condividi">📤 Condividi / Salva su File</button>
      <button class="btn sec" data-a="sposta">📁 Sposta</button>
      <button class="btn sec" data-a="rinomina">✏️ Rinomina</button>
      <button class="btn sec" data-a="scadenza">⏰ ${d.scadenza ? "Cambia scadenza" : "Aggiungi scadenza"}</button>
      <button class="btn sec" data-a="note">🗒️ Note</button>
      <button class="btn danger" data-a="elimina">🗑️ Elimina</button>
    </div>`);
  const fatto = async (msg) => { v.remove(); toast(msg); await caricaCartelle(); ricarica && ricarica(); };
  v.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-a]")?.dataset.a; if (!a) return;
    try {
      if (a === "apri") visore(d);
      else if (a === "sposta") {
        const dest = await sceltaCartella("Sposta in…", { attuale: d.cartella, etichetta: "Sposta qui" }); if (dest === undefined) return;
        await api(`/api/documenti/${d.id}`, { method: "PATCH", json: { sposta: true, cartella: dest } }); fatto("📁 Spostato in " + S.byId[dest].nome);
      } else if (a === "rinomina") {
        const n = await chiedi("Rinomina", d.nome); if (!n) return;
        await api(`/api/documenti/${d.id}`, { method: "PATCH", json: { nome: n } }); fatto("✏️ Rinominato");
      } else if (a === "note") {
        const n = await chiedi("Note", d.note || "", { placeholder: "Es. numero polizza, importo, targa…" }); if (n === null) return;
        await api(`/api/documenti/${d.id}`, { method: "PATCH", json: { note: n } }); fatto("🗒️ Note salvate");
      } else if (a === "scadenza") {
        const n = await chiedi("Quando scade?", d.scadenza || "", { tipo: "date", etichetta: "Salva", aiuto: "Lascia vuoto per togliere la scadenza." }); if (n === null) return;
        await api(`/api/documenti/${d.id}`, { method: "PATCH", json: n ? { scadenza: n } : { togli_scadenza: true } });
        fatto(n ? "⏰ Scadenza salvata" : "Scadenza rimossa");
      } else if (a === "elimina") {
        if (!(await conferma(`Eliminare “${d.nome}”?`, "Elimina", "Il documento verrà cancellato definitivamente."))) return;
        await api(`/api/documenti/${d.id}`, { method: "DELETE" }); fatto("🗑️ Eliminato");
      } else if (a === "condividi") await condividiFile(await fileDi(d));
    } catch (err) { if (err.name !== "AbortError") toast("⚠️ " + err.message); }
  });
}

/* ================================================================== calendario dell'iPhone */
function isoConFuso(local) {
  const d = new Date(local), off = -d.getTimezoneOffset(), s = off >= 0 ? "+" : "-", a = Math.abs(off);
  return `${local.length === 16 ? local + ":00" : local}${s}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}
function datiComando(a) {
  const i = a.tutto_il_giorno ? a.inizio + "T00:00" : a.inizio, f = a.tutto_il_giorno ? a.fine + "T23:59" : a.fine;
  const testo = (x) => { const d = new Date(x); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()} ${x.slice(11, 16)}`; };
  return { titolo: `${a.icona || ""} ${a.titolo}`.trim(), inizio: isoConFuso(i), fine: isoConFuso(f), inizio_testo: testo(i), fine_testo: testo(f),
    luogo: a.luogo || "", note: a.note || "", tutto_il_giorno: !!a.tutto_il_giorno };
}
const comandoCalPronto = () => !!memo.get("cmd-cal");
function eseguiComandoCal(a) {
  location.href = `shortcuts://run-shortcut?name=${encodeURIComponent(CMD_CAL)}&input=text&text=${encodeURIComponent(JSON.stringify(datiComando(a)))}`;
}
function apriIcs(a) {
  if (LOC) location.href = window.LOCALE.icsUrl(a);
  else location.href = `/api/appuntamenti/${a.id}.ics`;
}
const passo = (n, html) => `<div class="passo"><div class="num">${n}</div><div style="flex:1;min-width:0">${html}</div></div>`;
const cod = (t) => `<div class="codice"><span>${esc(t)}</span><button data-cp="${esc(t)}">Copia</button></div>`;
const istruzioniCal = () => `
  ${passo(1, `Apri l'app <b>Comandi Rapidi</b> (icona viola e rosa) → tocca <b>+</b> in alto a destra.`)}
  ${passo(2, `Tocca il nome in alto e chiamalo esattamente:${cod(CMD_CAL)}`)}
  ${passo(3, `Tocca <b>Aggiungi azione</b>, cerca <b>“Ottieni dizionario da”</b> e aggiungila. Deve dire: <i>Ottieni dizionario da <b>Input comando rapido</b></i>. Se c'è scritto “Ricevi … da”, imposta <b>Testo</b>.`)}
  ${passo(4, `Cerca e aggiungi <b>“Aggiungi nuovo evento”</b> (Calendario). Tocca <b>Mostra di più</b>.`)}
  ${passo(5, `Per ogni campo tocca il valore → <b>Seleziona variabile</b> → <b>Dizionario</b> → tocca di nuovo la variabile e scegli <b>Chiave</b>:<br>
     • Titolo → chiave <b>titolo</b><br>• Data inizio → chiave <b>inizio</b><br>• Data fine → chiave <b>fine</b><br>• Posizione → chiave <b>luogo</b><br>• Note → chiave <b>note</b><br>
     Imposta anche <b>Avviso: 1 giorno prima</b> (o come preferisci).`)}
  ${passo(6, `Tocca <b>Fine</b>. Torna qui e premi <b>“Ho creato il comando”</b>: alla prima prova iPhone ti chiederà il permesso di usare il Calendario, tocca <b>Consenti sempre</b>.`)}
  <p class="small muted">Se l'orario nel calendario risultasse sbagliato, nel passo 5 usa le chiavi <b>inizio_testo</b> e <b>fine_testo</b>.</p>`;

function configuraCalendario(a) {
  const v = foglio(`<h3>🗓️ Collega il Calendario ${xBtn}</h3>
    <p class="muted" style="margin-top:-6px">Si fa <b>una volta sola</b> (circa 2 minuti). Poi ogni visita che salvi in LifeApp finisce <b>da sola</b> nel Calendario dell'iPhone, con promemoria.</p>
    <div class="card">${istruzioniCal()}</div>
    <button class="btn block" id="fatto" style="margin-top:14px">✅ Ho creato il comando${a ? ": prova ora" : ""}</button>
    ${a ? `<button class="btn sec block" id="ics" style="margin-top:8px">Solo per questa volta: aggiungi con file calendario</button>` : ""}`);
  $("#fatto", v).onclick = () => { memo.set("cmd-cal", "1"); v.remove(); if (a) eseguiComandoCal(a); else toast("🗓️ Calendario collegato"); };
  $("#ics", v) && ($("#ics", v).onclick = () => { v.remove(); apriIcs(a); });
}
function aggiungiAlCalendario(a) { comandoCalPronto() ? eseguiComandoCal(a) : configuraCalendario(a); }

/* ================================================================== VISTE */
function bannerInstalla() {
  if (!IOS || STANDALONE || sessionStorage.getItem("no-installa")) return "";
  return `<div class="avviso install"><div class="av-ico">📲</div>
    <div style="flex:1"><b>Installa LifeApp sulla Home</b>
      <div class="small">Tocca <b>Condividi</b> <span class="ios-share">⎙</span> → <b>Aggiungi alla schermata Home</b>.${LOC ? " Poi apri LifeApp sempre dall'icona: lì i documenti restano al sicuro." : ""}</div>
      <button class="link-btn" id="non-ora">Più tardi</button></div></div>`;
}


/* Prossime cose da fare: solo gli appuntamenti in arrivo, in ordine di tempo */
const isoLocale = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
async function prossimeCose(max = 6) {
  const appts = await api("/api/appuntamenti");
  return appts.map((a) => { const g = GRUPPI_APP[gruppoDi(a.categoria)];
    return { tipo: "app", data: a.inizio.slice(0, 10), ora: a.tutto_il_giorno ? "" : oraDa(a.inizio), titolo: a.titolo, ico: a.icona || g.ico, col: g.col, etichetta: g.nome, rif: a }; })
    .sort((a, b) => (a.data + (a.ora || "00:00")).localeCompare(b.data + (b.ora || "00:00"))).slice(0, max);
}
function htmlProssime(lista) {
  if (!lista.length) return `<a class="card vuoto-mini" href="#/agenda">✨ Niente in programma. <b>Aggiungi un appuntamento →</b></a>`;
  return `<div class="lista prossime">${lista.map((x, i) => {
    const d = new Date(x.data + "T00:00"), g = giorniA(x.data);
    const quando = g < 0 ? `<span class="tag danger">${-g === 1 ? "Ieri" : `${-g} giorni fa`}</span>` : g === 0 ? `<span class="tag danger">Oggi</span>` : g === 1 ? `<span class="tag warn">Domani</span>` : `<span class="tag">Tra ${g} giorni</span>`;
    return `<div class="voce" data-pc="${i}"><div class="datebox" style="--c:${x.col}"><div class="m">${MESI[d.getMonth()]}</div><div class="g">${d.getDate()}</div></div>
      <div class="corpo"><div class="tit">${esc(x.ico)} ${esc(x.titolo)}</div><div class="sub">${GIORNI[d.getDay()]}${x.ora ? " · " + x.ora : ""} · ${esc(x.etichetta)}</div></div>${quando}</div>`;
  }).join("")}</div>`;
}
function collegaProssime(el, lista, ricarica) {
  el && el.addEventListener("click", (e) => {
    const v = e.target.closest("[data-pc]"); if (!v) return;
    const x = lista[+v.dataset.pc];
    if (x.tipo === "app") apriAppuntamento(x.rif, ricarica);
    if (x.tipo === "scad") apriDoc(x.rif, ricarica);
    if (x.tipo === "comp") modificaVoceDiario(x.rif, ricarica);
  });
}

/* ================================================================== FILTRI APPUNTAMENTI (Home e Calendario) */
/* All'inizio sono tutti accesi: toccandone uno lo spegni, e vedi solo le categorie rimaste accese. */
const filtriApp = () => { try { const s = JSON.parse(memo.get("filtri-app") || "null"); return Array.isArray(s) ? s.filter((k) => GRUPPI_APP[k]) : Object.keys(GRUPPI_APP); } catch { return Object.keys(GRUPPI_APP); } };
function htmlFiltriApp(conte = {}) {
  const on = filtriApp(), tutti = on.length === Object.keys(GRUPPI_APP).length;
  return `<div class="filtri-app">${Object.entries(GRUPPI_APP).map(([k, v]) => `<button type="button" class="fchip ${on.includes(k) ? "on" : ""}" data-fa="${k}" style="--c:${v.col}" aria-pressed="${on.includes(k)}"><i></i>${v.nome}${conte[k] ? `<b>${conte[k]}</b>` : ""}</button>`).join("")}
    ${tutti ? "" : `<button type="button" class="fchip reset" data-fa="*">Mostra tutti</button>`}</div>`;
}
function collegaFiltriApp(el, dopo) {
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-fa]"); if (!b) return;
    const k = b.dataset.fa; let on = filtriApp();
    on = k === "*" ? Object.keys(GRUPPI_APP) : on.includes(k) ? on.filter((x) => x !== k) : [...on, k];
    memo.set("filtri-app", JSON.stringify(on)); dopo();
  });
}
const vociProssime = (l) => l.map((a) => { const g = GRUPPI_APP[gruppoDi(a.categoria)];
  return { tipo: "app", data: a.inizio.slice(0, 10), ora: a.tutto_il_giorno ? "" : oraDa(a.inizio), titolo: a.titolo, ico: a.icona || g.ico, col: g.col, etichetta: g.nome, rif: a }; });

/* ================================================================== HOME */
function htmlProssimiColore(lista) {   // ogni appuntamento con il colore della sua categoria
  return `<div class="prossimi">${lista.map((x, i) => {
    const d = new Date(x.data + "T00:00"), g = giorniA(x.data);
    const quando = g < 0 ? "In corso" : g === 0 ? "Oggi" : g === 1 ? "Domani" : `Tra ${g} giorni`;
    return `<button type="button" class="pr-app" data-pc="${i}" style="--c:${x.col}"><span class="pr-data"><small>${MESI[d.getMonth()]}</small><b>${d.getDate()}</b></span>
      <span class="pr-corpo"><b>${esc(x.ico)} ${esc(x.titolo)}</b><span><i class="pr-cat">${esc(x.etichetta)}</i>${GIORNI[d.getDay()]}${x.ora ? " · " + x.ora : ""}</span></span>
      <span class="pr-quando ${g <= 1 ? "vicino" : ""}">${quando}</span></button>`;
  }).join("")}</div>`;
}
async function vistaHome() {
  const [info, comp, appts, allen, corse] = await Promise.all([LOC ? api("/api/impostazioni") : Promise.resolve(null), api("/api/diario?tipo=compleanno"),
    api("/api/appuntamenti"), api("/api/diario?tipo=allenamento"), api("/api/diario?tipo=corsa")]);
  const compOggi = comp.filter((x) => infoComp(x).g <= 1);
  const ora = new Date().getHours(), oggi = new Date();
  const saluto = ora < 6 ? "Buonanotte" : ora < 13 ? "Buongiorno" : ora < 18 ? "Buon pomeriggio" : "Buonasera";
  const backupVecchio = LOC && info.documenti > 0 && (!info.ultimo_backup || giorniA(info.ultimo_backup.slice(0, 10)) < -30);
  const ultAll = giorniAllenamento(allen)[0], stC = corse.length ? statCorse(corse) : null, ultC = stC?.l[stC.n - 1];
  const palestraSub = [ultAll ? `🏋️ ${dataIt(ultAll.data).replace(/ \d{4}$/, "")} · ${ultAll.esercizi.length} eserciz${ultAll.esercizi.length === 1 ? "io" : "i"}` : "",
    ultC ? `🏃 ${kmT(ultC.extra.km)} km a ${passoTesto(ultC.extra.passo)}/km` : ""].filter(Boolean).join(" · ") || "Allenamenti, corse e peso";
  app.innerHTML = `
    <div class="top home-top"><h1>${saluto}<small>${GIORNI[oggi.getDay()]} ${oggi.getDate()} ${MESI_L[oggi.getMonth()]}</small></h1>
      <a class="logo-app" href="#/io" aria-label="I miei dati"><img src="static/icona.svg" alt="LifeApp"></a></div>
    ${bannerInstalla()}
    ${compOggi.map((x) => `<a class="avviso festa" href="#/diario/compleanno"><div class="av-ico">🎂</div><div style="flex:1"><b>${infoComp(x).g === 0 ? "Oggi" : "Domani"} è il compleanno di ${esc(x.titolo)}!</b><div class="small">${infoComp(x).anni ? `Compie ${infoComp(x).anni} anni. ` : ""}Ricordati gli auguri 🎉</div></div></a>`).join("")}
    <div class="cerca-home"><svg class="ico"><use href="#i-cerca"/></svg><input type="search" id="q" placeholder="Cerca nei documenti…" enterkeyhint="search" autocomplete="off"></div>
    <div id="q-ris"></div>
    <div class="home-griglia">
      <div class="col">
        <div class="azioni-home">
          <button data-h="foto"><span class="ah-ico"><svg class="ico"><use href="#i-foto"/></svg></span>Fotografa</button>
          <button data-h="file"><span class="ah-ico"><svg class="ico"><use href="#i-carica"/></svg></span>Carica file</button>
          <button data-h="app"><span class="ah-ico"><svg class="ico"><use href="#i-appunt"/></svg></span>Appuntam.</button>
          <button data-h="pw"><span class="ah-ico"><svg class="ico"><use href="#i-chiave"/></svg></span>Password</button>
        </div>
        <section class="meteo" id="meteo" aria-label="Meteo"><div class="mt-carico">Carico il meteo…</div></section>
      </div>
      <div class="col">
        <div class="sezione"><h2>Prossimi appuntamenti</h2><button class="link-btn" id="h-nuovo">＋ Nuovo</button></div>
        <div id="h-app"></div>
        <a class="palestra-card" href="#/palestra"><span class="pc-ico">🏋️</span><div style="flex:1;min-width:0"><b>Palestra</b><div class="small muted">${palestraSub}</div></div><span class="dx">›</span></a>
        ${S.daSmistare ? `<a class="avviso" href="#/da-smistare"><div class="av-ico">📥</div><div style="flex:1"><b>${S.daSmistare} document${S.daSmistare === 1 ? "o" : "i"} da sistemare</b><div class="small muted">Tocca per metterl${S.daSmistare === 1 ? "o" : "i"} nella cartella giusta</div></div><span class="dx">›</span></a>` : ""}
        ${backupVecchio ? `<a class="avviso" href="#/altro"><div class="av-ico">💾</div><div style="flex:1"><b>Fai un backup</b><div class="small muted">${info.ultimo_backup ? "L'ultimo è del " + dataIt(info.ultimo_backup.slice(0, 10)) : "Non hai ancora salvato una copia"} — serve 1 minuto</div></div><span class="dx">›</span></a>` : ""}
      </div>
    </div>`;
  $("#non-ora") && ($("#non-ora").onclick = () => { sessionStorage.setItem("no-installa", "1"); $(".avviso.install").remove(); });
  $(".azioni-home").onclick = (e) => {
    const h = e.target.closest("[data-h]")?.dataset.h; if (!h) return;
    if (h === "foto" || h === "file") scegliFile({ foto: h === "foto", dopo: render });
    if (h === "app") schedaAppuntamento({}, render);
    if (h === "pw") location.hash = "#/password";
  };
  $("#h-nuovo").onclick = () => schedaAppuntamento({}, render);
  // appuntamenti con i filtri
  let visibili = [];
  const disegnaApp = () => {
    const on = filtriApp(), conte = {};
    appts.forEach((a) => { const k = gruppoDi(a.categoria); conte[k] = (conte[k] || 0) + 1; });
    visibili = vociProssime(appts.filter((a) => on.includes(gruppoDi(a.categoria))).slice(0, 8));
    $("#h-app").innerHTML = htmlFiltriApp(conte) + (!on.length ? `<div class="card vuoto-mini">Hai spento tutte le categorie: tocca quelle che vuoi vedere.</div>`
      : visibili.length ? htmlProssimiColore(visibili) : `<button class="card vuoto-mini" id="h-vuoto">✨ Niente in programma${on.length < Object.keys(GRUPPI_APP).length ? " in queste categorie" : ""}. <b>Aggiungi un appuntamento →</b></button>`);
  };
  collegaFiltriApp($("#h-app"), disegnaApp);
  $("#h-app").addEventListener("click", (e) => {
    if (e.target.closest("#h-vuoto")) return schedaAppuntamento({}, render);
    const v = e.target.closest("[data-pc]"); if (v) schedaAppuntamento(visibili[+v.dataset.pc].rif, render);
  });
  disegnaApp();
  // ricerca nei documenti mentre scrivi
  const q = $("#q"), ris = $("#q-ris");
  let tq;
  q.oninput = () => {
    clearTimeout(tq);
    const t = q.value.trim();
    if (t.length < 2) { ris.innerHTML = ""; return; }
    tq = setTimeout(async () => {
      const l = await api("/api/documenti?cerca=" + encodeURIComponent(t));
      if (q.value.trim() !== t) return;
      ris.innerHTML = `<div class="q-box">${l.length ? `<div id="q-docs">${htmlDocs(l.slice(0, 5), { mostraCartella: true })}</div>${l.length > 5 ? `<a class="q-tutti" href="#/cerca/${encodeURIComponent(t)}">Vedi tutti i ${l.length} risultati ›</a>` : ""}`
        : `<div class="q-vuoto">Nessun documento per “${esc(t)}”</div>`}</div>`;
      if (l.length) collegaDocs($("#q-docs"), l.slice(0, 5), render);
    }, 220);
  };
  q.onkeydown = (e) => { if (e.key === "Enter" && q.value.trim()) location.hash = "#/cerca/" + encodeURIComponent(q.value.trim()); };
  disegnaMeteo($("#meteo"));
}

/* ------------------------------------------------------------------ meteo (dati chiesti via https e mai salvati) */
const tileMeteo = (ico, et, val, sub = "") => `<div class="mt-t"><span class="mt-te">${ico} ${et}</span><b>${val}</b>${sub ? `<small>${esc(String(sub))}</small>` : ""}</div>`;
async function disegnaMeteo(el) {
  if (!el) return;
  const M = window.Meteo, l = M.luogo();
  if (!l) {
    el.innerHTML = `<div class="mt-vuoto"><div class="mt-big-ico">🌤️</div><b>Meteo</b><p class="small muted">Scegli dove vuoi vedere il meteo: lo ricordo per le prossime volte.</p>
      <div class="riga"><button class="btn" id="mt-gps">📍 Posizione attuale</button><button class="btn sec" id="mt-citta">🔎 Scegli città</button></div></div>`;
    $("#mt-gps", el).onclick = async () => { try { M.salvaLuogo(await M.posizioneAttuale()); disegnaMeteo(el); } catch (e) { toast("⚠️ " + e.message, 3500); sceltaCitta(() => disegnaMeteo(el)); } };
    $("#mt-citta", el).onclick = () => sceltaCitta(() => disegnaMeteo(el));
    return;
  }
  try {
    const d = await M.previsioni(l), a = d.adesso, o = d.oggi;
    if (!el.isConnected) return;
    const nomeG = (iso) => { const x = new Date(iso + "T00:00"), g = GIORNI[x.getDay()]; return `${g[0].toUpperCase()}${g.slice(1, 3)} ${x.getDate()}`; };
    el.innerHTML = `
      <div class="mt-testa"><button class="mt-luogo" id="mt-luogo">📍 ${esc(l.nome)} <span>⌄</span></button><span class="mt-agg">aggiornato alle ${a.ora}</span></div>
      ${htmlStoricoMeteo(l)}
      <div class="mt-ora"><div class="mt-ico">${a.ico}</div><div class="mt-temp">${Math.round(a.temp)}<sup>°</sup></div>
        <div class="mt-info"><b>${a.testo}</b><span>Percepita ${Math.round(a.percepita)}°</span><span>Max ${Math.round(o.max)}° · min ${Math.round(o.min)}°</span></div></div>
      <div class="mt-griglia">
        ${tileMeteo("💧", "Umidità", `${Math.round(a.umidita)}%`)}
        ${tileMeteo("🌬️", "Vento", `${Math.round(a.vento)} km/h`, `${a.dir}${a.raffiche ? ` · raffiche ${Math.round(a.raffiche)}` : ""}`)}
        ${tileMeteo("🌧️", "Pioggia oggi", `${o.pioggia ?? 0}%`, o.mm ? `${dec(o.mm, 1)} mm` : "")}
        ${tileMeteo("☀️", "Indice UV", `${Math.round(a.uv ?? 0)}`, a.uvTesto)}
        ${tileMeteo("🧭", "Pressione", `${Math.round(a.pressione)}`, "hPa")}
        ${tileMeteo("🌅", "Alba", o.alba, `tramonto ${o.tramonto}`)}
      </div>
      <div class="mt-ore" aria-label="Prossime ore">${d.ore.slice(0, 12).map((h, i) => `<div class="mt-h"><span>${i ? h.ora.slice(0, 2) : "Ora"}</span><i title="${esc(h.testo)}">${h.ico}</i><b>${Math.round(h.temp)}°</b><small>${h.pioggia ? "💧" + h.pioggia + "%" : "&nbsp;"}</small></div>`).join("")}</div>
      <div class="mt-giorni">${d.prossimi.map((g) => `<div class="mt-g"><div class="mt-gn">${nomeG(g.data)}</div><div class="mt-gi" title="${esc(g.testo)}">${g.ico}</div>
        <div class="mt-gt"><b>${Math.round(g.max)}°</b><span>${Math.round(g.min)}°</span></div>
        <div class="mt-gd"><span>Pioggia</span><b>${g.pioggia ?? 0}%</b></div><div class="mt-gd"><span>Umidità</span><b>${g.umidita ?? "—"}%</b></div><div class="mt-gd"><span>Vento</span><b>${Math.round(g.vento)} km/h</b></div></div>`).join("")}</div>`;
    $("#mt-luogo", el).onclick = () => sceltaCitta(() => disegnaMeteo(el));
    collegaStoricoMeteo(el);
  } catch (e) {
    if (!el.isConnected) return;
    el.innerHTML = `${htmlStoricoMeteo(l)}<div class="mt-vuoto"><div class="mt-big-ico">📡</div><b>Meteo non disponibile</b><p class="small muted">${esc(e.message)}</p><button class="btn sec" id="mt-riprova">Riprova</button></div>`;
    $("#mt-riprova", el).onclick = () => disegnaMeteo(el);
    collegaStoricoMeteo(el);
  }
}
/* le città già cercate restano qui: un tocco e vedi il loro meteo */
function htmlStoricoMeteo(l) {
  const st = window.Meteo.storico();
  return `<div class="mt-storico">${l?.gps ? "" : `<button type="button" class="mt-sc" data-gps="1">📍 Qui</button>`}
    ${st.map((c, i) => { const doppio = st.some((d, j) => j !== i && d.nome === c.nome) && c.zona;
      return `<button type="button" class="mt-sc ${window.Meteo.stesso(c, l) ? "on" : ""}" data-sc="${i}">${esc(c.nome)}${doppio ? ` <small>${esc(c.zona.split(",")[0])}</small>` : ""}</button>`; }).join("")}
    <button type="button" class="mt-sc piu" data-piu="1" aria-label="Cerca un'altra città">＋ Città</button></div>`;
}
function collegaStoricoMeteo(el) {
  const box = $(".mt-storico", el); if (!box) return;
  box.onclick = async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.piu) return sceltaCitta(() => disegnaMeteo(el));
    if (b.dataset.gps) { try { window.Meteo.salvaLuogo(await window.Meteo.posizioneAttuale()); } catch (err) { return toast("⚠️ " + err.message, 3500); } }
    else window.Meteo.salvaLuogo(window.Meteo.storico()[+b.dataset.sc]);
    disegnaMeteo(el);
  };
}
function sceltaCitta(dopo) {
  const v = foglio(`<h3>📍 Luogo del meteo ${xBtn}</h3>
    <button class="btn block" id="sc-gps">📍 Usa la mia posizione attuale</button>
    <form id="sc-f" class="riga" style="margin-top:12px"><input type="search" name="q" placeholder="Cerca una città…" autocomplete="off" enterkeyhint="search"><button class="btn">Cerca</button></form>
    <div class="lista" id="sc-ris" style="margin-top:10px"></div>
    ${window.Meteo.storico().length ? `<div class="sezione" style="margin-top:18px"><h2>Città cercate</h2></div><div class="lista" id="sc-storico">${window.Meteo.storico().map((c, i) =>
      `<div class="voce" data-st="${i}"><div class="thumb">🕘</div><div class="corpo"><div class="tit">${esc(c.nome)}</div><div class="sub">${esc(c.zona || "")}</div></div><button class="btn sec small" data-togli="${i}" aria-label="Togli ${esc(c.nome)}">✕</button></div>`).join("")}</div>` : ""}`);
  $("#sc-storico", v) && ($("#sc-storico", v).onclick = (e) => {
    const t = e.target.closest("[data-togli]");
    if (t) { window.Meteo.togliStorico(window.Meteo.storico()[+t.dataset.togli]); t.closest(".voce").remove(); return; }
    const r = e.target.closest("[data-st]"); if (r) { window.Meteo.salvaLuogo(window.Meteo.storico()[+r.dataset.st]); v.chiudi(); dopo(); }
  });
  $("#sc-gps", v).onclick = async () => { try { window.Meteo.salvaLuogo(await window.Meteo.posizioneAttuale()); v.chiudi(); dopo(); } catch (e) { toast("⚠️ " + e.message, 3500); } };
  $("#sc-f", v).onsubmit = async (e) => {
    e.preventDefault();
    const q = e.target.q.value.trim(); if (!q) return;
    try {
      const l = await window.Meteo.cercaCitta(q);
      $("#sc-ris", v).innerHTML = l.length ? l.map((c, i) => `<div class="voce" data-i="${i}"><div class="thumb">📍</div><div class="corpo"><div class="tit">${esc(c.nome)}</div><div class="sub">${esc(c.zona)}</div></div></div>`).join("")
        : `<div class="small muted" style="padding:12px">Nessuna città trovata</div>`;
      $$("#sc-ris [data-i]", v).forEach((b) => (b.onclick = () => { const c = l[+b.dataset.i]; window.Meteo.salvaLuogo({ nome: c.nome, zona: c.zona, lat: c.lat, lon: c.lon }); v.chiudi(); dopo(); }));
    } catch (err) { toast("⚠️ " + err.message); }
  };
  setTimeout(() => $("#sc-f [name=q]", v)?.focus(), 80);
}

/* ================================================================== CARTELLE (nella barra in basso) */
async function vistaCartelle() {
  const foto = await fotoProfilo().catch(() => null);
  const radici = S.figli.root || [];
  app.innerHTML = `<div class="top"><h1>Cartelle<small>${radici.length} cartelle · tutti i tuoi documenti</small></h1></div>
    <form class="cerca" id="f-cerca"><input type="search" id="q" placeholder="Cerca un documento…" enterkeyhint="search"></form>
    <div class="rapide">
      <a class="rapida" href="#/io"><span class="ri">${foto ? `<img src="${urlMini(foto)}" alt="">` : "👤"}</span><b>I miei dati</b><small>CV e fototessera</small></a>
      <a class="rapida" href="#/scadenze"><span class="ri">⏰</span><b>Scadenze</b><small>Bolli e assicurazioni</small></a>
      <a class="rapida" href="#/password"><span class="ri">🔑</span><b>Password</b><small>Cifrate</small></a>
      ${S.daSmistare ? `<a class="rapida evid" href="#/da-smistare"><span class="ri">📥</span><b>Da smistare</b><small>${S.daSmistare} document${S.daSmistare === 1 ? "o" : "i"}</small></a>` : ""}
    </div>
    <div class="sezione"><h2>Le tue cartelle</h2><a href="#" id="nuova-rad">＋ Nuova</a></div>${htmlCartelle(radici)}`;
  $("#f-cerca").onsubmit = (e) => { e.preventDefault(); const q = $("#q").value.trim(); if (q) location.hash = "#/cerca/" + encodeURIComponent(q); };
  $("#nuova-rad").onclick = async (e) => {
    e.preventDefault();
    const nome = await chiedi("Nuova cartella principale", "", { placeholder: "Es. Animali, Scuola, Viaggi…" }); if (!nome) return;
    await api("/api/cartelle", { method: "POST", json: { nome, padre: null } }); await caricaCartelle(); vistaCartelle();
  };
  fab(null, vistaCartelle);
}

/* ================================================================== CALENDARIO */
const FASCE = [["tutto", "📌", "Tutto il giorno"], ["notte", "🌙", "Notte", 0, 6], ["mattina", "🌅", "Mattina", 6, 12], ["pomeriggio", "☀️", "Pomeriggio", 12, 18], ["sera", "🌆", "Sera", 18, 24]];
const cal = { mese: null, giorno: null };
async function vistaAgenda() {
  const tutti = await api("/api/appuntamenti?tutti=true");
  if (!cal.giorno) { cal.giorno = oggiIso(); cal.mese = cal.giorno.slice(0, 7); }
  app.innerHTML = `<div class="top"><h1>Calendario<small>Tocca un giorno per vedere i suoi appuntamenti</small></h1><button class="btn sec small" id="cal-oggi">Oggi</button></div>
    <div id="cal-filtri"></div>
    <div class="cal" id="calendario">
      <div class="cal-testa"><button class="iconbtn" id="cal-prima" aria-label="Mese precedente">‹</button><b id="cal-titolo"></b><button class="iconbtn" id="cal-dopo" aria-label="Mese successivo">›</button></div>
      <div class="cal-sett">${["L", "M", "M", "G", "V", "S", "D"].map((x) => `<span>${x}</span>`).join("")}</div>
      <div class="cal-griglia" id="cal-griglia"></div>
    </div>
    <div class="cal-giorno" id="cal-giorno" aria-live="polite"></div>
    ${!comandoCalPronto() ? `<button class="avviso" id="collega" style="margin-top:14px;width:100%;text-align:left"><div class="av-ico">📲</div>
      <div style="flex:1"><b>Collega il Calendario dell'iPhone</b><div class="small muted">Una volta sola: poi gli appuntamenti finiscono da soli anche nel Calendario.</div></div><span class="dx">›</span></button>` : ""}`;
  const perGiorno = () => {
    const on = filtriApp(), m = {};
    tutti.filter((a) => on.includes(gruppoDi(a.categoria))).forEach((a) => {
      let d = a.inizio.slice(0, 10); const f = (a.fine || a.inizio).slice(0, 10);
      for (let i = 0; i < 62 && d <= f; i++) { (m[d] ||= []).push(a); d = piuGiorni(d, 1); }
    });
    return m;
  };
  let mappa = perGiorno();
  const disegnaFiltri = () => {
    const conte = {};
    tutti.filter((a) => a.inizio.slice(0, 7) === cal.mese).forEach((a) => { const k = gruppoDi(a.categoria); conte[k] = (conte[k] || 0) + 1; });
    $("#cal-filtri").innerHTML = htmlFiltriApp(conte);
  };
  const disegnaMese = () => {
    const [y, m] = cal.mese.split("-").map(Number), primo = new Date(y, m - 1, 1), inizio = new Date(y, m - 1, 1 - ((primo.getDay() + 6) % 7));
    $("#cal-titolo").textContent = `${MESI_L[m - 1][0].toUpperCase()}${MESI_L[m - 1].slice(1)} ${y}`;
    let h = "";
    for (let i = 0; i < 42; i++) {
      const d = new Date(inizio.getFullYear(), inizio.getMonth(), inizio.getDate() + i), k = isoLocale(d), l = mappa[k] || [];
      if (i === 35 && d.getMonth() !== m - 1) break;   // 5 righe quando bastano
      const cls = [d.getMonth() !== m - 1 ? "fuori" : "", k === oggiIso() ? "oggi" : "", k === cal.giorno ? "sel" : "", l.length ? "pieno" : ""].filter(Boolean).join(" ");
      const punti = [...new Set(l.map((a) => GRUPPI_APP[gruppoDi(a.categoria)].col))].slice(0, 3).map((c) => `<i style="--c:${c}"></i>`).join("");
      h += `<button type="button" class="cal-d ${cls}" data-g="${k}" aria-label="${d.getDate()} ${MESI_L[d.getMonth()]}${l.length ? `, ${l.length} appuntament${l.length === 1 ? "o" : "i"}` : ""}"><span>${d.getDate()}</span><em>${punti}</em></button>`;
    }
    $("#cal-griglia").innerHTML = h;
  };
  const rigaApp = (a) => {
    const gr = GRUPPI_APP[gruppoDi(a.categoria)];
    return `<div class="cg-app" data-app="${a.id}" style="--c:${gr.col}"><div class="cg-ora">${a.tutto_il_giorno ? "tutto il giorno" : `${oraDa(a.inizio)}<small>${oraDa(a.fine)}</small>`}</div>
      <div class="cg-corpo"><b>${esc(a.icona || gr.ico)} ${esc(a.titolo)}</b><span>${gr.nome}${a.luogo ? " · 📍 " + esc(a.luogo) : ""}</span></div><span class="dx">›</span></div>`;
  };
  const disegnaGiorno = () => {
    const g = cal.giorno, l = (mappa[g] || []).slice().sort((a, b) => a.inizio.localeCompare(b.inizio)), d = new Date(g + "T00:00"), rel = giorniA(g);
    const fascia = (a) => { if (a.tutto_il_giorno || a.inizio.slice(0, 10) !== g) return "tutto"; const h = +oraDa(a.inizio).slice(0, 2); return h < 6 ? "notte" : h < 12 ? "mattina" : h < 18 ? "pomeriggio" : "sera"; };
    const quando = rel === 0 ? "Oggi" : rel === 1 ? "Domani" : rel === -1 ? "Ieri" : "";
    $("#cal-giorno").innerHTML = `<div class="cg-testa"><div><b>${GIORNI[d.getDay()][0].toUpperCase() + GIORNI[d.getDay()].slice(1)} ${d.getDate()} ${MESI_L[d.getMonth()]}</b>${quando ? ` <span class="tag">${quando}</span>` : ""}
        <div class="small muted">${l.length ? `${l.length} appuntament${l.length === 1 ? "o" : "i"}` : "Nessun appuntamento"}</div></div><button class="btn small" id="cg-nuovo">＋ Aggiungi</button></div>
      ${l.length ? FASCE.map(([k, ico, nome, da, a]) => {
        const x = l.filter((y) => fascia(y) === k);
        return x.length ? `<div class="fascia"><div class="fascia-tit">${ico} ${nome}${da != null ? `<span>${String(da).padStart(2, "0")}–${String(a).padStart(2, "0")}</span>` : ""}</div>${x.map(rigaApp).join("")}</div>` : "";
      }).join("") : `<button class="cg-vuoto" id="cg-vuoto"><span>✨</span><b>Giornata libera</b><span class="small muted">Tocca per aggiungere un appuntamento</span></button>`}`;
  };
  const vai = (delta) => { const [y, m] = cal.mese.split("-").map(Number); cal.mese = isoLocale(new Date(y, m - 1 + delta, 1)).slice(0, 7); disegnaFiltri(); disegnaMese(); };
  $("#cal-prima").onclick = () => vai(-1);
  $("#cal-dopo").onclick = () => vai(1);
  $("#cal-oggi").onclick = () => { cal.giorno = oggiIso(); cal.mese = cal.giorno.slice(0, 7); disegnaFiltri(); disegnaMese(); disegnaGiorno(); };
  $("#cal-griglia").onclick = (e) => {
    const b = e.target.closest("[data-g]"); if (!b) return;
    cal.giorno = b.dataset.g;
    if (cal.giorno.slice(0, 7) !== cal.mese) { cal.mese = cal.giorno.slice(0, 7); disegnaFiltri(); disegnaMese(); }
    else $$("#cal-griglia .cal-d").forEach((x) => x.classList.toggle("sel", x === b));
    disegnaGiorno();
  };
  let x0 = null;   // scorri a destra/sinistra per cambiare mese
  $("#calendario").addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  $("#calendario").addEventListener("touchend", (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 55) vai(dx < 0 ? 1 : -1); });
  collegaFiltriApp($("#cal-filtri"), () => { mappa = perGiorno(); disegnaFiltri(); disegnaMese(); disegnaGiorno(); });
  $("#cal-giorno").onclick = (e) => {
    if (e.target.closest("#cg-nuovo, #cg-vuoto")) return schedaAppuntamento({ inizio: cal.giorno }, vistaAgenda);
    const v = e.target.closest("[data-app]"); if (v) schedaAppuntamento(tutti.find((a) => a.id === +v.dataset.app), vistaAgenda);
  };
  $("#collega") && ($("#collega").onclick = () => configuraCalendario());
  const b = document.createElement("button"); b.className = "fab"; b.innerHTML = "<span>＋</span>"; b.setAttribute("aria-label", "Nuovo appuntamento");
  b.onclick = () => schedaAppuntamento({ inizio: cal.giorno }, vistaAgenda); app.appendChild(b);
  disegnaFiltri(); disegnaMese(); disegnaGiorno();
}

/* ------------------------------------------------------------------ scheda appuntamento: nuovo o modifica, tutto a tocchi */
const DURATE = [[30, "30 min"], [60, "1 ora"], [90, "1 h 30"], [120, "2 ore"], [180, "3 ore"]];
const minutiDi = (t) => { const [h, m] = String(t || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const hhmm = (n) => { n = Math.max(0, Math.min(23 * 60 + 59, n)); return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`; };
function schedaAppuntamento(a = {}, dopo) {
  const nuovo = !a.id;
  let gr = a.categoria ? gruppoDi(a.categoria) : memo.get("ultima-cat-app") && GRUPPI_APP[memo.get("ultima-cat-app")] ? memo.get("ultima-cat-app") : "personale";
  let tutto = !!a.tutto_il_giorno, capito = null;
  const g0 = (a.inizio || oggiIso()).slice(0, 10), da0 = oraDa(a.inizio) || "09:00", al0 = oraDa(a.fine) || hhmm(minutiDi(da0) + 60);
  let durata = Math.max(15, minutiDi(al0) - minutiDi(da0));
  const v = foglio(`<h3>${nuovo ? "Nuovo appuntamento" : "Appuntamento"} ${xBtn}</h3>
    ${nuovo ? `<input type="text" id="ap-veloce" class="ap-veloce" placeholder="✨ Scrivi veloce: “dentista martedì alle 10”" autocomplete="off" enterkeyhint="done">
      <div class="small muted ap-capito" id="ap-capito"></div>` : ""}
    <input type="text" id="ap-tit" class="ap-titolo" value="${esc(a.titolo || "")}" placeholder="Cosa devi fare?" autocomplete="off">
    <div class="ap-cat" id="ap-cat">${Object.entries(GRUPPI_APP).map(([k, x]) => `<button type="button" data-k="${k}" class="${k === gr ? "on" : ""}" style="--c:${x.col}"><span>${x.ico}</span>${x.nome}</button>`).join("")}</div>
    <div class="ap-et">Giorno</div>
    <div class="ap-giorni" id="ap-giorni"></div>
    <label class="ap-altra-data"><span>📅 Altra data</span><input type="date" id="ap-data" value="${esc(g0)}"></label>
    <div class="ap-et">Orario</div>
    <div class="ap-chips"><button type="button" class="chip ${tutto ? "on" : ""}" id="ap-tutto">Tutto il giorno</button></div>
    <div id="ap-ore" ${tutto ? "hidden" : ""}>
      <div class="riga"><label class="campo"><span>Dalle</span><input type="time" id="ap-da" value="${esc(da0)}"></label><label class="campo"><span>Alle</span><input type="time" id="ap-al" value="${esc(al0)}"></label></div>
      <div class="ap-chips" id="ap-durate">${DURATE.map(([m, t]) => `<button type="button" class="chip" data-m="${m}">${t}</button>`).join("")}</div>
    </div>
    <div class="ap-riepilogo" id="ap-riep"></div>
    <details class="ap-altro" ${a.luogo || a.note ? "open" : ""}><summary>📍 Luogo e note</summary>
      <label class="campo"><span>Dove</span><input type="text" id="ap-luogo" value="${esc(a.luogo || "")}" placeholder="Es. Studio dentistico, via Roma 12"></label>
      <label class="campo"><span>Note</span><input type="text" id="ap-note" value="${esc(a.note || "")}" placeholder="Es. portare le analisi"></label></details>
    <button class="btn block" id="ap-salva">${nuovo ? "Salva" + (comandoCalPronto() ? " e aggiungi al Calendario" : "") : "Salva modifiche"}</button>
    ${nuovo ? "" : `<div class="azioni"><button class="btn sec" id="ap-cal">📲 Al Calendario</button><button class="btn danger" id="ap-del">🗑️ Elimina</button></div>`}`);
  const q = (s) => $(s, v);
  const rapidi = Array.from({ length: 7 }, (_, i) => piuGiorni(oggiIso(), i));
  const disegnaGiorni = () => {
    const cur = q("#ap-data").value;
    q("#ap-giorni").innerHTML = rapidi.map((g, i) => { const d = new Date(g + "T00:00");
      return `<button type="button" class="ap-g ${g === cur ? "on" : ""}" data-g="${g}"><small>${i === 0 ? "Oggi" : i === 1 ? "Domani" : GIORNI[d.getDay()].slice(0, 3)}</small><b>${d.getDate()}</b></button>`; }).join("");
  };
  const riepilogo = () => {
    const g = q("#ap-data").value;
    $$("#ap-durate .chip", v).forEach((b) => b.classList.toggle("on", !tutto && minutiDi(q("#ap-al").value) - minutiDi(q("#ap-da").value) === +b.dataset.m));
    if (!g) { q("#ap-riep").textContent = ""; return; }
    const d = new Date(g + "T00:00");
    q("#ap-riep").innerHTML = `🗓️ <b>${GIORNI[d.getDay()]} ${d.getDate()} ${MESI_L[d.getMonth()]}</b> · ${tutto ? "tutto il giorno" : `${q("#ap-da").value} – ${q("#ap-al").value}`}`;
  };
  const scegliGruppo = (k) => { gr = k; $$("#ap-cat button", v).forEach((x) => x.classList.toggle("on", x.dataset.k === k)); };
  q("#ap-cat").onclick = (e) => { const b = e.target.closest("[data-k]"); if (b) scegliGruppo(b.dataset.k); };
  q("#ap-giorni").onclick = (e) => { const b = e.target.closest("[data-g]"); if (!b) return; q("#ap-data").value = b.dataset.g; disegnaGiorni(); riepilogo(); };
  q("#ap-data").onchange = () => { disegnaGiorni(); riepilogo(); };
  q("#ap-tutto").onclick = () => { tutto = !tutto; q("#ap-tutto").classList.toggle("on", tutto); q("#ap-ore").hidden = tutto; riepilogo(); };
  q("#ap-da").onchange = () => { q("#ap-al").value = hhmm(minutiDi(q("#ap-da").value) + durata); riepilogo(); };
  q("#ap-al").onchange = () => { const d = minutiDi(q("#ap-al").value) - minutiDi(q("#ap-da").value); if (d > 0) durata = d; riepilogo(); };
  q("#ap-durate").onclick = (e) => { const b = e.target.closest("[data-m]"); if (!b) return; durata = +b.dataset.m; q("#ap-al").value = hhmm(minutiDi(q("#ap-da").value) + durata); riepilogo(); };
  // scrittura veloce: riempie i campi da sola
  let tv;
  q("#ap-veloce") && (q("#ap-veloce").oninput = () => {
    clearTimeout(tv);
    tv = setTimeout(async () => {
      const t = q("#ap-veloce").value.trim();
      if (!t) { q("#ap-capito").textContent = ""; return; }
      const r = await api("/api/appuntamenti/analizza", { method: "POST", json: { testo: t } });
      if (q("#ap-veloce").value.trim() !== t) return;
      if (!r.data) { q("#ap-capito").textContent = "🤔 Scrivi anche il giorno (es. domani, lunedì, il 16 dicembre)"; return; }
      capito = r;
      q("#ap-tit").value = r.titolo || q("#ap-tit").value;
      scegliGruppo(gruppoDi(r.categoria));
      q("#ap-data").value = r.data;
      tutto = !!r.tutto_il_giorno; q("#ap-tutto").classList.toggle("on", tutto); q("#ap-ore").hidden = tutto;
      if (!tutto && r.inizio) { q("#ap-da").value = oraDa(r.inizio) || q("#ap-da").value; q("#ap-al").value = oraDa(r.fine) || hhmm(minutiDi(q("#ap-da").value) + 60); durata = Math.max(15, minutiDi(q("#ap-al").value) - minutiDi(q("#ap-da").value)); }
      q("#ap-capito").textContent = "✨ Ho compilato i campi qui sotto: controlla e salva";
      disegnaGiorni(); riepilogo();
    }, 350);
  });
  const leggi = () => {
    const g = q("#ap-data").value, da = q("#ap-da").value, al = q("#ap-al").value;
    const stesso = a.categoria && gruppoDi(a.categoria) === gr;
    const icona = stesso && a.icona ? a.icona : capito && gruppoDi(capito.categoria) === gr && capito.icona ? capito.icona : GRUPPI_APP[gr].ico;
    return { ...(nuovo ? {} : a), titolo: q("#ap-tit").value.trim(), categoria: stesso ? a.categoria : capito && gruppoDi(capito.categoria) === gr ? capito.categoria : gr, icona,
      tutto_il_giorno: tutto, inizio: tutto ? g : `${g}T${da}`, fine: tutto ? g : `${g}T${al}`, luogo: q("#ap-luogo").value.trim(), note: q("#ap-note").value.trim() };
  };
  q("#ap-salva").onclick = async () => {
    const dati = leggi();
    if (!dati.titolo) { toast("Scrivi cosa devi fare"); q("#ap-tit").focus(); return; }
    if (!q("#ap-data").value) { toast("Scegli il giorno"); return; }
    if (!tutto && minutiDi(q("#ap-al").value) <= minutiDi(q("#ap-da").value)) { toast("L'orario di fine deve essere dopo l'inizio"); return; }
    try {
      const x = await api(nuovo ? "/api/appuntamenti" : `/api/appuntamenti/${a.id}`, { method: nuovo ? "POST" : "PUT", json: dati });
      memo.set("ultima-cat-app", gr); cal.giorno = dati.inizio.slice(0, 10); cal.mese = cal.giorno.slice(0, 7);
      v.remove();
      if (nuovo) dopoSalvataggio(x, dopo); else { toast("✅ Salvato"); if (dopo) dopo(); }
    } catch (err) { toast("⚠️ " + err.message); }
  };
  q("#ap-cal") && (q("#ap-cal").onclick = () => { v.remove(); aggiungiAlCalendario(leggi()); });
  q("#ap-del") && (q("#ap-del").onclick = async () => {
    if (!(await conferma(`Eliminare “${a.titolo}”?`))) return;
    await api(`/api/appuntamenti/${a.id}`, { method: "DELETE" }); v.remove(); toast("🗑️ Eliminato"); if (dopo) dopo();
  });
  disegnaGiorni(); riepilogo();
  if (nuovo && matchMedia("(pointer:fine)").matches) setTimeout(() => q("#ap-tit").focus(), 80);
}

/* ================================================================== PALESTRA: schede in alto (Pesi · Corsa · Corpo, e in futuro altre) */
const SEZ_PALESTRA = [["palestra", "🏋️", "Pesi"], ["corsa", "🏃", "Corsa"], ["corpo", "⚖️", "Corpo"]];
const htmlTestaPalestra = (k, sotto) => `<div class="top"><a class="iconbtn" href="#/" aria-label="Indietro">‹</a><h1 style="font-size:28px">Palestra<small>${sotto}</small></h1></div>
  <nav class="tab-palestra">${SEZ_PALESTRA.map(([h, i, n]) => `<a href="#/${h}" class="${h === k ? "on" : ""}"><span>${i}</span>${n}</a>`).join("")}</nav>`;
async function vistaCorpo() {
  const [pesi, prof] = await Promise.all([api("/api/diario?tipo=peso"), api("/api/profilo")]);
  const pAtt = ultimoPeso(pesi), alt = +prof.altezza || null, b = bmi(pAtt?.extra?.peso, alt);
  const ord = pesi.slice().sort((x, y) => (x.data || "").localeCompare(y.data || "") || x.id - y.id);
  app.innerHTML = htmlTestaPalestra("corpo", "Peso, altezza e BMI") + `
    <div class="bilancio corpo"><div class="bil-griglia" style="margin-top:0">
      <button class="corpo-dato" id="agg-peso"><div class="bil-et">Peso</div><div class="bil-n">${pAtt ? kgTesto(pAtt.extra.peso) : "—"}</div><div class="bil-sub">${pAtt ? dataIt(pAtt.data) : "tocca per inserirlo"}</div></button>
      <button class="corpo-dato" id="agg-alt"><div class="bil-et">Altezza</div><div class="bil-n">${alt ? alt + " cm" : "—"}</div><div class="bil-sub">${alt ? "" : "tocca per inserirla"}</div></button>
      <div class="corpo-dato"><div class="bil-et">BMI</div><div class="bil-n">${b ? dec(b.v, 1) : "—"}</div><div class="bil-sub">${b ? b.etichetta : "serve peso e altezza"}</div></div>
    </div></div>
    <button class="btn block" id="nuovo-peso" style="margin:4px 0 10px">⚖️ Segna il peso di oggi</button>
    ${ord.length >= 2 ? `<div class="grafico-card"><div class="g-tit">Il mio peso</div><div id="g-peso"></div></div>` : `<p class="small muted" style="margin:6px 4px">Segna il peso ogni tanto: qui vedrai come cambia nel tempo.</p>`}
    ${ord.length ? `<div class="sezione"><h2>Storico</h2></div><div class="lista">${ord.slice().reverse().slice(0, 12).map((x) => { const d = new Date(x.data + "T00:00");
      return `<div class="voce"><div class="datebox" style="--c:var(--accent)"><div class="m">${MESI[d.getMonth()]}</div><div class="g">${d.getDate()}</div></div><div class="corpo"><div class="tit">${kgTesto(x.extra.peso)}</div><div class="sub">${dataIt(x.data)}</div></div></div>`; }).join("")}</div>` : ""}`;
  const ric = () => vistaCorpo();
  ["#agg-peso", "#agg-alt", "#nuovo-peso"].forEach((s) => ($(s).onclick = () => aggiornaCorpo(prof, pAtt, ric)));
  if ($("#g-peso")) {
    const vals = ord.map((x) => x.extra.peso);
    window.Grafici.linea($("#g-peso"), { categorie: ord.map((x) => dataIt(x.data).replace(/ \d{4}$/, "")), serie: [{ nome: "Peso", slot: 1, tipo: "linea", punti: true, valori: vals }],
      ...intervalloY(vals), formato: (v) => kgTesto(v).replace(" kg", ""), titoloTabella: "Vedi i pesi in tabella" });
  }
}

/* ------------------------------------------------------------------ le mie case: in affitto e di proprietà */
function htmlCase(figli) {
  const aff = figli.filter((f) => f.tipo === "affitto"), prop = figli.filter((f) => f.tipo === "proprieta"), altro = figli.filter((f) => !["affitto", "proprieta"].includes(f.tipo));
  const vuoto = (t) => `<div class="card vuoto-mini small">${t}</div>`;
  return `<div class="sezione" style="margin-top:6px"><h2>🔑 In affitto</h2></div>${aff.length ? htmlCartelle(aff) : vuoto("Nessuna casa in affitto. Tocca “Aggiungi una casa”.")}
    <div class="sezione"><h2>🏡 Di proprietà</h2></div>${prop.length ? htmlCartelle(prop) : vuoto("Nessuna casa di proprietà.")}
    ${altro.length ? `<div class="sezione"><h2>📂 Altro della casa</h2></div>${htmlCartelle(altro)}` : ""}`;
}
function nuovaCasa(padre) {
  let tipo = "affitto";
  const v = foglio(`<h3>🏠 Nuova casa ${xBtn}</h3><form id="fc">
    <label class="campo"><span>Nome o indirizzo</span><input type="text" name="nome" required placeholder="Es. Via Roma 12, Casa al mare, Appartamento Bologna"></label>
    <div class="campo"><span>È…</span><div class="scelta-gruppo due" id="tipo-casa">
      <button type="button" data-t="affitto" class="on" style="--c:#0ea5a4"><span>🔑</span>In affitto</button>
      <button type="button" data-t="proprieta" style="--c:#f59e0b"><span>🏡</span>Di proprietà</button></div></div>
    <p class="small muted" id="spiega-casa" style="margin:-2px 4px 14px"></p>
    <button class="btn block">Crea</button></form>`);
  const spiega = () => ($("#spiega-casa", v).textContent = tipo === "affitto"
    ? "Dentro troverai: Contratto d'affitto, Bollette, Ricevute affitto, Manutenzione e le note."
    : "Dentro troverai: Atto e mutuo, Bollette, Condominio, Assicurazione casa, Manutenzione e le note.");
  spiega();
  $("#tipo-casa", v).onclick = (e) => { const b = e.target.closest("[data-t]"); if (!b) return; tipo = b.dataset.t; $$("#tipo-casa button", v).forEach((x) => x.classList.toggle("on", x === b)); spiega(); };
  setTimeout(() => $("[name=nome]", v).focus(), 80);
  $("#fc", v).onsubmit = async (e) => {
    e.preventDefault();
    const nome = new FormData(e.target).get("nome").trim(); if (!nome) return;
    const r = await api("/api/cartelle", { method: "POST", json: { nome, padre, tipo } });
    v.chiudi(); await caricaCartelle(); toast(tipo === "affitto" ? "🔑 Casa in affitto aggiunta" : "🏡 Casa di proprietà aggiunta"); location.hash = `#/c/${r.id}`;
  };
}

/* ------------------------------------------------------------------ note nelle cartelle (es. appunti su un lavoro) */
const eCartellaLavori = (c) => c && c.padre == null && /^lavoro/i.test(c.nome);
const eCartellaCase = (c) => c && c.padre == null && /^casa\b/i.test(c.nome);
const CON_MODELLO = ["lavoro", "affitto", "proprieta"];
const TESTA_MODELLO = {
  lavoro: ["💼", "Il mio lavoro", "Contratto, buste paga e i riquadri con i tuoi appunti."],
  affitto: ["🔑", "Casa in affitto", "Contratto d'affitto, bollette, ricevute e i riquadri con i tuoi appunti."],
  proprieta: ["🏡", "Casa di proprietà", "Atto e mutuo, bollette, condominio e i riquadri con i tuoi appunti."],
};
/* Riquadri: ogni lavoro (o casa, o cartella) ha dei riquadri con un titolo, in cui si scrive direttamente.
   Si salvano da soli mentre scrivi. */
const RIQUADRI_PRONTI = [["📅", "Periodo"], ["🕒", "Orari e turni"], ["💶", "Paga"], ["👥", "Colleghi e responsabili"], ["🧰", "Mansioni"], ["💬", "Commenti"],
  ["📍", "Indirizzo"], ["📞", "Contatti"], ["⭐", "Com'è andata"], ["🔑", "Proprietario"], ["💡", "Utenze"], ["🛠️", "Lavori da fare"]];
function htmlNote(c) {
  const note = c.note || [];
  if (!note.length && !CON_MODELLO.includes(c.tipo)) return "";
  return `<div class="sezione"><h2>🗂️ Riquadri</h2><a href="#" id="nuovo-riquadro">＋ Aggiungi</a></div>
    ${note.length ? `<div class="riquadri">${note.map((n) => `<div class="riquadro" data-rq="${esc(String(n.id))}">
        <div class="rq-testa"><span class="rq-ico">${esc(n.icona || "📝")}</span><b>${esc(n.titolo || "Nota")}</b><i class="rq-stato"></i>
          <button class="rq-menu" aria-label="Opzioni">⋯</button></div>
        <textarea rows="2" placeholder="Tocca per scrivere…">${esc(n.testo || "")}</textarea></div>`).join("")}</div>`
      : `<button class="vuoto-cta" id="primo-riquadro" style="margin-top:0;padding:20px"><span style="font-size:30px">🗂️</span><b>Aggiungi i tuoi riquadri</b><span class="muted small">Periodo, orari, paga, colleghi… ognuno nel suo riquadro</span></button>`}`;
}
function cresci(t) { t.style.height = "auto"; t.style.height = Math.max(t.scrollHeight, 52) + "px"; }
function collegaNote(c, dopo) {
  const nuovo = (e) => { e && e.preventDefault(); aggiungiRiquadro(c, dopo); };
  $("#nuovo-riquadro") && ($("#nuovo-riquadro").onclick = nuovo);
  $("#primo-riquadro") && ($("#primo-riquadro").onclick = nuovo);
  $$(".riquadro").forEach((box) => {
    const t = $("textarea", box), stato = $(".rq-stato", box), id = box.dataset.rq;
    let timer;
    const salva = async () => {
      clearTimeout(timer);
      const n = (c.note || []).find((x) => String(x.id) === id);
      if (!n || n.testo === t.value) return;
      n.testo = t.value; stato.textContent = "…";
      try { await api(`/api/cartelle/${c.id}`, { method: "PATCH", json: { note: c.note } }); stato.textContent = "✓ Salvato"; setTimeout(() => (stato.textContent = ""), 1800); }
      catch (err) { stato.textContent = "⚠️ non salvato"; }
    };
    cresci(t);
    t.oninput = () => { cresci(t); stato.textContent = ""; clearTimeout(timer); timer = setTimeout(salva, 800); };
    t.onblur = salva;
    $(".rq-menu", box).onclick = () => menuRiquadro(c, (c.note || []).find((x) => String(x.id) === id), dopo);
  });
}
async function salvaNote(c, note) {
  await api(`/api/cartelle/${c.id}`, { method: "PATCH", json: { note } });
  await caricaCartelle();
}
function aggiungiRiquadro(c, dopo, titoloIniziale = "") {
  const presenti = (c.note || []).map((n) => (n.titolo || "").toLowerCase());
  const pronti = RIQUADRI_PRONTI.filter(([, t]) => !presenti.includes(t.toLowerCase()));
  let icona = "📝";
  const v = foglio(`<h3>🗂️ Nuovo riquadro <span class="muted small" style="font-weight:500">· ${esc(c.nome)}</span> ${xBtn}</h3>
    ${pronti.length ? `<div class="etichetta">Scegli un riquadro pronto</div><div class="pronti">${pronti.map(([ic, t]) => `<button class="chip" data-ic="${ic}" data-t="${esc(t)}">${ic} ${esc(t)}</button>`).join("")}</div>
      ${c.tipo === "lavoro" && pronti.length > 3 ? `<button class="link-btn" id="tutti-std">＋ Aggiungi tutti quelli del lavoro (Periodo, Orari, Paga, Colleghi, Mansioni, Commenti)</button>` : ""}` : ""}
    <form id="fr" style="margin-top:12px"><div class="etichetta">…oppure creane uno tuo</div>
      <div class="riga" style="gap:8px"><input type="text" name="icona" value="📝" style="flex:0 0 64px;text-align:center;font-size:20px" aria-label="Icona">
        <input type="text" name="titolo" value="${esc(titoloIniziale)}" placeholder="Es. Divisa, Parcheggio, Ferie…" style="flex:1"></div>
      <button class="btn block" style="margin-top:12px">Aggiungi</button></form>`);
  const crea = async (lista) => {
    c.note = [...(c.note || []), ...lista.map(([ic, t]) => ({ titolo: t, icona: ic, testo: "" }))];
    await salvaNote(c, c.note); v.chiudi(); toast(lista.length > 1 ? "🗂️ Riquadri aggiunti" : "🗂️ Riquadro aggiunto");
    if (dopo) await dopo();
    const ultimo = $$(".riquadro textarea").pop(); if (ultimo && lista.length === 1) { ultimo.focus(); ultimo.scrollIntoView({ block: "center" }); }
  };
  $$(".pronti [data-t]", v).forEach((b) => (b.onclick = () => crea([[b.dataset.ic, b.dataset.t]])));
  $("#tutti-std", v) && ($("#tutti-std", v).onclick = () => crea(RIQUADRI_PRONTI.slice(0, 6).filter(([, t]) => !presenti.includes(t.toLowerCase()))));
  $("#fr", v).onsubmit = (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    if (!d.titolo.trim()) return toast("Scrivi il titolo del riquadro");
    crea([[[...d.icona.trim()].slice(0, 2).join("") || "📝", d.titolo.trim()]]);
  };
}
function menuRiquadro(c, n, dopo) {
  if (!n) return;
  const v = foglio(`<h3>${esc(n.icona || "📝")} ${esc(n.titolo || "Nota")} ${xBtn}</h3><div class="lista">
    <div class="voce" data-m="rinomina"><div class="thumb">✏️</div><div class="corpo"><div class="tit">Rinomina</div></div></div>
    <div class="voce" data-m="icona"><div class="thumb">😀</div><div class="corpo"><div class="tit">Cambia icona</div></div></div>
    <div class="voce" data-m="su"><div class="thumb">⬆️</div><div class="corpo"><div class="tit">Sposta più in alto</div></div></div>
    ${n.testo ? `<div class="voce" data-m="copia"><div class="thumb">📋</div><div class="corpo"><div class="tit">Copia il testo</div></div></div>` : ""}
    <div class="voce" data-m="elimina"><div class="thumb">🗑️</div><div class="corpo"><div class="tit" style="color:var(--danger)">Elimina riquadro</div></div></div></div>`);
  v.addEventListener("click", async (e) => {
    const m = e.target.closest("[data-m]")?.dataset.m; if (!m) return; v.chiudi();
    const note = c.note || [];
    if (m === "rinomina") { const t = await chiedi("Nuovo titolo", n.titolo || ""); if (!t || !t.trim()) return; n.titolo = t.trim(); }
    if (m === "icona") { const t = await chiedi("Nuova icona", n.icona || "📝", { aiuto: "Apri la tastiera delle emoji e scegline una." }); if (!t) return; n.icona = [...t.trim()].slice(0, 2).join(""); }
    if (m === "su") { const i = note.indexOf(n); if (i > 0) { note.splice(i, 1); note.splice(i - 1, 0, n); } }
    if (m === "copia") return copia(n.testo, "Testo copiato");
    if (m === "elimina") {
      if (n.testo && !(await conferma(`Eliminare il riquadro “${n.titolo}”?`, "Elimina", "Anche il testo scritto dentro verrà cancellato."))) return;
      note.splice(note.indexOf(n), 1);
    }
    await salvaNote(c, note); toast("✅ Fatto"); if (dopo) dopo();
  });
}
// (compatibilità) aprire una "nota" ora significa aggiungere un riquadro
function modificaNota(c, n, dopo) { return aggiungiRiquadro(c, dopo); }

async function vistaCartella(id) {
  const c = S.byId[id];
  if (!c) { location.hash = "#/"; return; }
  const docs = await api(`/api/documenti?cartella=${id}`);
  const figli = S.figli[id] || [];
  const perc = percorso(id);
  const indietro = perc.length > 1 ? `#/c/${perc[perc.length - 2].id}` : "#/";
  app.innerHTML = `
    <div class="top"><a class="iconbtn" href="${indietro}" aria-label="Indietro">‹</a>
      <h1 style="font-size:26px"><span class="icona-titolo">${esc(c.icona)}</span> ${esc(c.nome)}</h1>
      <button class="iconbtn" id="menu" aria-label="Opzioni">⋯</button></div>
    <div class="crumbs"><a href="#/cartelle">📁 Cartelle</a>${perc.map((p) => ` › <a href="#/c/${p.id}">${esc(p.nome)}</a>`).join("")}</div>
    ${TESTA_MODELLO[c.tipo] ? `<div class="lavoro-testa ${c.tipo}"><span>${TESTA_MODELLO[c.tipo][0]}</span><div style="flex:1"><b>${TESTA_MODELLO[c.tipo][1]}</b><div class="small muted">${TESTA_MODELLO[c.tipo][2]}</div></div>
      ${c.tipo !== "lavoro" ? `<button class="btn sec small" id="cambia-tipo">${c.tipo === "affitto" ? "🏡 È mia" : "🔑 In affitto"}</button>` : ""}</div>` : ""}
    ${eCartellaLavori(c) ? `<button class="btn block" id="nuovo-lavoro" style="margin-bottom:14px">💼 Aggiungi un lavoro</button>` : ""}
    ${eCartellaCase(c) ? `<button class="btn block" id="nuova-casa" style="margin-bottom:14px">🏠 Aggiungi una casa</button>` : ""}
    ${eCartellaLavori(c) && figli.some((f) => f.tipo === "lavoro")
      ? `<div class="sezione" style="margin-top:6px"><h2>💼 I miei lavori</h2></div>${htmlCartelle(figli.filter((f) => f.tipo === "lavoro"))}
         ${figli.some((f) => f.tipo !== "lavoro") ? `<div class="sezione"><h2>🏛️ Tasse e altro</h2></div>${htmlCartelle(figli.filter((f) => f.tipo !== "lavoro"))}` : ""}`
      : eCartellaCase(c) ? htmlCase(figli)
      : c.tipo === "lavoro" && figli.some((f) => f.tipo === "lavoro")
      ? `${figli.some((f) => f.tipo !== "lavoro") ? htmlCartelle(figli.filter((f) => f.tipo !== "lavoro")) : ""}
         <div class="sezione"><h2>📦 Incarichi e sedi</h2></div>${htmlCartelle(figli.filter((f) => f.tipo === "lavoro"))}`
      : figli.length ? htmlCartelle(figli) : ""}
    ${htmlNote(c)}
    ${c.tipo === "lavoro" ? `<button class="btn sec block" id="nuovo-incarico" style="margin-top:16px">➕ Aggiungi un incarico o una sede</button>` : ""}
    ${docs.length ? `<div class="sezione"><h2>Documenti</h2><span class="muted small">${docs.length}</span></div><div id="docs">${htmlDocs(docs)}</div>` : ""}
    ${!docs.length && !CON_MODELLO.includes(c.tipo) && !eCartellaLavori(c) && !eCartellaCase(c) ? `<button class="vuoto-cta" id="agg"><span class="big">${figli.length ? "📄" : esc(c.icona)}</span><b>${figli.length ? "Aggiungi un documento qui" : "Questa cartella è vuota"}</b><span class="muted small">Tocca per fotografare o scegliere un file</span></button>` : ""}`;
  const ric = () => vistaCartella(id);
  if (docs.length) collegaDocs($("#docs"), docs, ric);
  collegaNote(c, ric);
  $("#nuova-casa") && ($("#nuova-casa").onclick = () => nuovaCasa(id));
  $("#nuovo-incarico") && ($("#nuovo-incarico").onclick = async () => {
    const nome = await chiedi(`Nuovo incarico in “${c.nome}”`, "", { placeholder: "Es. Inventario Coop Ancona",
      aiuto: "Creo una cartella con dentro Contratto, Buste paga e lo spazio per le note." });
    if (!nome || !nome.trim()) return;
    const r = await api("/api/cartelle", { method: "POST", json: { nome: nome.trim(), padre: id, tipo: "lavoro", icona: c.icona || "💼" } });
    await caricaCartelle(); toast("✅ Incarico aggiunto"); location.hash = `#/c/${r.id}`;
  });
  $("#cambia-tipo") && ($("#cambia-tipo").onclick = async () => {
    const nuovo = c.tipo === "affitto" ? "proprieta" : "affitto";
    if (!(await conferma(nuovo === "proprieta" ? "Segnare questa casa come di tua proprietà?" : "Segnare questa casa come in affitto?", "Conferma",
      "Aggiungo le cartelle che mancano (nessun documento viene spostato o cancellato)."))) return;
    await api(`/api/cartelle/${id}`, { method: "PATCH", json: { tipo: nuovo } }); await caricaCartelle(); toast("✅ Aggiornato"); ric();
  });
  $("#nuovo-lavoro") && ($("#nuovo-lavoro").onclick = async () => {
    const nome = await chiedi("Nome del lavoro", "", { placeholder: "Es. Bar Centrale, Amazon, Ripetizioni…", aiuto: "Creo la cartella con dentro Contratto e Buste paga, più lo spazio per le tue note." });
    if (!nome || !nome.trim()) return;
    const r = await api("/api/cartelle", { method: "POST", json: { nome: nome.trim(), padre: id, tipo: "lavoro", icona: "💼" } });
    await caricaCartelle(); toast("💼 Lavoro aggiunto"); location.hash = `#/c/${r.id}`;
  });
  $("#agg") && ($("#agg").onclick = () => $(".fab").click());
  $("#menu").onclick = () => {
    const v = foglio(`<h3>${esc(c.icona)} ${esc(c.nome)} ${xBtn}</h3><div class="lista">
      <div class="voce" data-m="nota"><div class="thumb">🗂️</div><div class="corpo"><div class="tit">Aggiungi un riquadro</div><div class="sub">Uno spazio con un titolo dove scrivere i tuoi appunti</div></div></div>
      <div class="voce" data-m="sotto"><div class="thumb">📁</div><div class="corpo"><div class="tit">Nuova sottocartella</div></div></div>
      <div class="voce" data-m="rinomina"><div class="thumb">✏️</div><div class="corpo"><div class="tit">Rinomina</div></div></div>
      <div class="voce" data-m="icona"><div class="thumb">😀</div><div class="corpo"><div class="tit">Cambia icona</div><div class="sub">Scegli una emoji</div></div></div>
      <div class="voce" data-m="sposta"><div class="thumb">↪️</div><div class="corpo"><div class="tit">Sposta cartella</div></div></div>
      <div class="voce" data-m="elimina"><div class="thumb">🗑️</div><div class="corpo"><div class="tit" style="color:var(--danger)">Elimina cartella</div><div class="sub">I documenti non vengono cancellati: tornano in “Da smistare”</div></div></div></div>`);
    v.addEventListener("click", async (e) => {
      const m = e.target.closest("[data-m]")?.dataset.m; if (!m) return; v.remove();
      try {
        if (m === "nota") return modificaNota(c, null, ric);
        if (m === "sotto") { const n = await chiedi(`Nuova cartella dentro “${c.nome}”`, "", { placeholder: "Es. 2026, Polizza, Fatture…" }); if (!n) return; await api("/api/cartelle", { method: "POST", json: { nome: n, padre: id } }); }
        if (m === "rinomina") { const n = await chiedi("Rinomina cartella", c.nome); if (!n) return; await api(`/api/cartelle/${id}`, { method: "PATCH", json: { nome: n } }); }
        if (m === "icona") { const n = await chiedi("Nuova icona", c.icona, { placeholder: "🚗", aiuto: "Apri la tastiera delle emoji (🙂 o 🌐) e scegline una." }); if (!n) return; await api(`/api/cartelle/${id}`, { method: "PATCH", json: { icona: [...n.trim()].slice(0, 2).join("") } }); }
        if (m === "sposta") { const p = await sceltaCartella("Sposta cartella in…", { attuale: c.padre, consentiRadice: true, escludi: id, etichetta: "Sposta qui" }); if (p === undefined) return; await api(`/api/cartelle/${id}`, { method: "PATCH", json: { padre: p, sposta_padre: true } }); }
        if (m === "elimina") {
          if (!(await conferma(`Eliminare la cartella “${c.nome}”?`, "Elimina", "Le sottocartelle vengono eliminate; i documenti finiscono in “Da smistare”."))) return;
          await api(`/api/cartelle/${id}`, { method: "DELETE" }); await caricaCartelle(); location.hash = indietro; return;
        }
        await caricaCartelle(); ric();
      } catch (err) { toast("⚠️ " + err.message); }
    });
  };
  fab(id, ric);
}

async function vistaDaSmistare() {
  const docs = await api("/api/documenti?da_smistare=true");
  app.innerHTML = `<div class="top"><h1>Da smistare<small>Documenti senza cartella</small></h1></div>
    ${docs.length ? `<p class="muted small" style="margin:-6px 4px 14px">Tocca un suggerimento ✨ per spostare il documento con un tocco.</p><div id="docs">${htmlDocs(docs, { suggerisci: true })}</div>`
      : `<div class="vuoto"><span class="big">✨</span><b>Tutto in ordine!</b><br>Qui finiscono i documenti che decidi di sistemare dopo${LOC ? "." : " e quelli inviati dal menu Condividi dell'iPhone."}</div>`}
    ${LOC ? `<div class="card" style="margin-top:16px"><b>📂 Hai salvato file nell'app File?</b><p class="small muted" style="margin:6px 0 12px">Se usi il comando “${CMD_INVIA}” dal menu Condividi, i file finiscono in <b>File › LifeApp › In arrivo</b>. Importali da qui:</p>
      <button class="btn block" id="importa">📂 Importa da File</button></div>` : ""}`;
  if (docs.length) collegaDocs($("#docs"), docs, vistaDaSmistare);
  $("#importa") && ($("#importa").onclick = () => scegliFile({ dopo: vistaDaSmistare }));
  fab(undefined, vistaDaSmistare);
}

async function vistaElenco(titolo, sotto, url) {
  const docs = await api(url);
  app.innerHTML = `<div class="top"><a class="iconbtn" href="#/cartelle">‹</a><h1 style="font-size:26px">${titolo}<small>${sotto}</small></h1></div>
    ${docs.length ? `<div id="docs">${htmlDocs(docs, { mostraCartella: true })}</div>` : `<div class="vuoto"><span class="big">🔎</span>Nessun documento trovato.</div>`}`;
  if (docs.length) collegaDocs($("#docs"), docs, render);
}

async function vistaScadenze() {
  const docs = await api("/api/scadenze");
  app.innerHTML = `<div class="top"><a class="iconbtn" href="#/cartelle">‹</a><h1 style="font-size:26px">⏰ Scadenze<small>Bolli, assicurazioni, revisioni, documenti</small></h1></div>
    ${docs.length ? `<div id="docs">${htmlDocs(docs, { mostraCartella: true })}</div>`
      : `<div class="vuoto"><span class="big">⏰</span>Nessuna scadenza impostata.<br>Quando salvi un bollo o un'assicurazione, LifeApp ti chiede quando scade.<br>Puoi anche aprire un documento e toccare <b>⏰ Aggiungi scadenza</b>.</div>`}`;
  if (docs.length) collegaDocs($("#docs"), docs, vistaScadenze);
}

/* ------------------------------------------------------------------ agenda */
function formAppuntamento(a) {
  const g = gruppoDi(a.categoria);
  return `<label class="campo"><span>Cosa</span><input type="text" id="a-tit" value="${esc(a.titolo)}"></label>
    <div class="campo"><span>Tipo</span><div class="scelta-gruppo" id="a-gruppo">${Object.entries(GRUPPI_APP).map(([k, v]) =>
      `<button type="button" data-g="${k}" class="${k === g ? "on" : ""}" style="--c:${v.col}"><span>${v.ico}</span>${v.nome}</button>`).join("")}</div></div>
    <label class="campo"><span>Giorno</span><input type="date" id="a-data" value="${esc((a.inizio || "").slice(0, 10))}"></label>
    <label class="switch"><span>Tutto il giorno</span><input type="checkbox" id="a-tutto" ${a.tutto_il_giorno ? "checked" : ""}></label>
    <div class="riga" id="a-ore" ${a.tutto_il_giorno ? "hidden" : ""}>
      <label class="campo"><span>Dalle</span><input type="time" id="a-da" value="${esc(oraDa(a.inizio) || "09:00")}"></label>
      <label class="campo"><span>Alle</span><input type="time" id="a-a" value="${esc(oraDa(a.fine) || "10:00")}"></label></div>
    <label class="campo"><span>Dove <i class="muted">(facoltativo)</i></span><input type="text" id="a-luogo" value="${esc(a.luogo || "")}" placeholder="Es. Studio dentistico, via Roma 12"></label>
    <label class="campo"><span>Note <i class="muted">(facoltativo)</i></span><input type="text" id="a-note" value="${esc(a.note || "")}" placeholder="Es. portare le analisi, a digiuno…"></label>`;
}
function leggiForm(el, base) {
  const tutto = $("#a-tutto", el).checked, g = $("#a-data", el).value;
  const gr = $("#a-gruppo .on", el)?.dataset.g || gruppoDi(base.categoria);
  const categoria = GRUPPI_APP[gr].cat.includes(base.categoria) ? base.categoria : gr;
  return { ...base, categoria, icona: gr === gruppoDi(base.categoria) && base.icona ? base.icona : GRUPPI_APP[gr].ico, titolo: $("#a-tit", el).value.trim(), tutto_il_giorno: tutto,
    inizio: tutto ? g : `${g}T${$("#a-da", el).value || "09:00"}`, fine: tutto ? g : `${g}T${$("#a-a", el).value || "10:00"}`,
    luogo: $("#a-luogo", el).value.trim(), note: $("#a-note", el).value.trim() };
}
function collegaForm(el) {
  $("#a-gruppo", el).onclick = (e) => { const b = e.target.closest("[data-g]"); if (!b) return; $$("#a-gruppo button", el).forEach((x) => x.classList.toggle("on", x === b)); };
  $("#a-tutto", el).onchange = (e) => ($("#a-ore", el).hidden = e.target.checked);
  $("#a-da", el).onchange = () => {
    const [h, m] = $("#a-da", el).value.split(":").map(Number), [h2, m2] = $("#a-a", el).value.split(":").map(Number);
    if (h * 60 + m >= h2 * 60 + m2) $("#a-a", el).value = `${String(Math.min(23, h + 1)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };
}
function htmlAppt(a) {
  const d = new Date(a.inizio.slice(0, 10) + "T00:00");
  const quando = a.tutto_il_giorno ? "Tutto il giorno" : `${oraDa(a.inizio)} – ${oraDa(a.fine)}`;
  const g = giorniA(a.inizio.slice(0, 10));
  const rel = g === 0 ? `<span class="tag danger">Oggi</span>` : g === 1 ? `<span class="tag warn">Domani</span>` : g > 0 && g <= 7 ? `<span class="tag warn">Tra ${g} giorni</span>` : "";
  const gr = GRUPPI_APP[gruppoDi(a.categoria)];
  return `<div class="voce" data-app="${a.id}"><div class="datebox" style="--c:${gr.col}"><div class="m">${MESI[d.getMonth()]}</div><div class="g">${d.getDate()}</div></div>
    <div class="corpo"><div class="tit">${esc(a.icona || gr.ico)} ${esc(a.titolo)}</div><div class="sub">${GIORNI[d.getDay()]} · ${quando}${a.luogo ? " · " + esc(a.luogo) : ""}</div>
    <div style="margin-top:4px"><span class="tag gruppo" style="--c:${gr.col}">${gr.ico} ${gr.nome}</span> ${rel}</div></div><div class="dx">›</div></div>`;
}

function dopoSalvataggio(a, dopo = vistaAgenda) {
  if (comandoCalPronto()) { toast("✅ Salvato. Lo aggiungo al Calendario…"); dopo(); setTimeout(() => eseguiComandoCal(a), 400); return; }
  foglio(`<div style="text-align:center;padding:6px 0 4px"><div style="font-size:54px">✅</div>
    <h3 style="justify-content:center">Appuntamento salvato</h3>
    <p class="muted" style="margin-top:-8px">${esc(a.icona)} <b>${esc(a.titolo)}</b><br>${dataIt(a.inizio)}${a.tutto_il_giorno ? "" : ` · ${oraDa(a.inizio)}–${oraDa(a.fine)}`}</p></div>
    <button class="btn block" id="cal">📲 Aggiungi al Calendario dell'iPhone</button>
    <div style="height:8px"></div><button class="btn sec block" data-chiudi>Fatto</button>`, { onClose: () => dopo() });
  $("#cal").onclick = () => { $$(".velo").forEach((x) => x.remove()); dopo(); aggiungiAlCalendario(a); };
}

function apriAppuntamento(a, ricarica) { schedaAppuntamento(a, ricarica); }

/* ------------------------------------------------------------------ password */
function generaPassword(n = 16) {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*?-_";
  const a = new Uint32Array(n); crypto.getRandomValues(a);
  return [...a].map((x) => c[x % c.length]).join("");
}
async function vistaPassword() {
  let voci;
  try { voci = await api("/api/cassaforte"); }
  catch (e) {
    if (e.status !== 423) throw e;
    const nuova = !!e.nuova;
    app.innerHTML = `<div class="top"><h1>Password</h1></div><div class="accesso" style="min-height:58vh"><form class="box" id="f">
      <div style="font-size:60px">🔐</div><h2>${nuova ? "Crea la tua cassaforte" : "Cassaforte bloccata"}</h2>
      <p class="muted">${nuova ? "Scegli una password principale: servirà per aprire le tue password salvate, che vengono cifrate." : "Inserisci la password principale per vedere le tue password."}</p>
      <input type="password" id="pw" placeholder="${nuova ? "Password principale (min. 6 caratteri)" : "Password principale"}" autocomplete="${nuova ? "new-password" : "current-password"}">
      ${nuova ? `<div style="height:10px"></div><input type="password" id="pw2" placeholder="Ripeti la password" autocomplete="new-password">` : ""}
      <div style="height:12px"></div><button class="btn block">${nuova ? "Crea cassaforte" : "Apri"}</button>
      ${nuova ? `<p class="small" style="margin-top:14px">⚠️ <b>Non dimenticarla</b>: per sicurezza nessuno può recuperarla, nemmeno noi.</p>` : ""}</form></div>`;
    $("#f").onsubmit = async (ev) => {
      ev.preventDefault();
      if (nuova && $("#pw").value !== $("#pw2").value) return toast("Le due password non coincidono");
      try { await api("/api/cassaforte/sblocca", { method: "POST", json: { password: $("#pw").value } }); vistaPassword(); }
      catch (err) { toast("⚠️ " + err.message); }
    };
    return;
  }
  const disegna = (filtro = "") => {
    const f = filtro.toLowerCase();
    const l = voci.filter((v) => !f || [v.titolo, v.utente, v.sito, v.categoria].some((x) => (x || "").toLowerCase().includes(f)));
    $("#lista").innerHTML = l.length ? `<div class="lista">${l.map((v) => `<div class="voce" data-v="${v.id}">
      <div class="thumb" style="background:${COLORI[(v.titolo.charCodeAt(0) || 0) % COLORI.length]};color:#fff;font-weight:700;font-size:19px">${esc(v.titolo[0]?.toUpperCase() || "?")}</div>
      <div class="corpo"><div class="tit">${esc(v.titolo)}</div><div class="sub">${esc(v.utente || v.sito || "—")}</div></div>
      <button class="btn sec small" data-copia="${v.id}">Copia</button></div>`).join("")}</div>`
      : `<div class="vuoto"><span class="big">🔑</span>${voci.length ? "Nessun risultato." : "Nessuna password salvata.<br>Tocca <b>＋</b> per aggiungerne una."}</div>`;
  };
  app.innerHTML = `<div class="top"><h1>Password<small>🔒 Cifrate e protette</small></h1><button class="iconbtn" id="blocca" title="Blocca">🔒</button></div>
    <div class="cerca"><input type="search" id="q" placeholder="Cerca…"></div><div style="height:10px"></div><div id="lista"></div>
    <p class="small muted" style="margin:14px 4px">La cassaforte si chiude da sola dopo 5 minuti che non usi l'app.</p>`;
  disegna();
  $("#q").oninput = (e) => disegna(e.target.value);
  $("#blocca").onclick = async () => { await api("/api/cassaforte/blocca", { method: "POST" }); vistaPassword(); };
  $("#lista").onclick = (e) => {
    const c = e.target.closest("[data-copia]");
    if (c) { e.stopPropagation(); return copia(voci.find((v) => v.id === +c.dataset.copia).segreto, "Password copiata"); }
    const r = e.target.closest("[data-v]"); if (r) dettaglioVoce(voci.find((v) => v.id === +r.dataset.v));
  };
  const b = document.createElement("button"); b.className = "fab"; b.innerHTML = "<span>＋</span>"; b.onclick = () => modificaVoce({}); app.appendChild(b);
}
function dettaglioVoce(v) {
  const f = foglio(`<h3>${esc(v.titolo)} ${xBtn}</h3><div class="card">
    ${v.utente ? `<div class="small muted">Utente / email</div><div class="codice"><span>${esc(v.utente)}</span><button data-c="u">Copia</button></div>` : ""}
    <div class="small muted">Password</div><div class="codice"><span class="occhio" id="pw">••••••••••</span><button data-c="vedi">Mostra</button><button data-c="p">Copia</button></div>
    ${v.sito ? `<div class="small muted">Sito</div><div class="codice"><span><a href="${esc(/^https?:/.test(v.sito) ? v.sito : "https://" + v.sito)}" target="_blank" rel="noopener">${esc(v.sito)}</a></span></div>` : ""}
    ${v.note ? `<div class="small muted">Note</div><div style="white-space:pre-wrap;margin-top:4px">${esc(v.note)}</div>` : ""}</div>
    <div class="azioni"><button class="btn sec" data-c="mod">✏️ Modifica</button><button class="btn danger" data-c="del">🗑️ Elimina</button></div>`);
  f.addEventListener("click", async (e) => {
    const c = e.target.dataset.c; if (!c) return;
    if (c === "u") copia(v.utente, "Utente copiato");
    if (c === "p") copia(v.segreto, "Password copiata");
    if (c === "vedi") { const s = $("#pw", f); const vis = s.textContent !== v.segreto; s.textContent = vis ? v.segreto : "••••••••••"; e.target.textContent = vis ? "Nascondi" : "Mostra"; }
    if (c === "mod") { f.remove(); modificaVoce(v); }
    if (c === "del" && (await conferma(`Eliminare “${v.titolo}”?`))) { await api(`/api/cassaforte/${v.id}`, { method: "DELETE" }); f.remove(); toast("🗑️ Eliminata"); vistaPassword(); }
  });
}
function modificaVoce(v) {
  const f = foglio(`<h3>${v.id ? "Modifica" : "Nuova password"} ${xBtn}</h3><form id="fv">
    <label class="campo"><span>Per cosa?</span><input type="text" name="titolo" value="${esc(v.titolo || "")}" placeholder="Es. Poste, Banca, Netflix, Wi-Fi casa" required></label>
    <label class="campo"><span>Utente / email</span><input type="text" name="utente" value="${esc(v.utente || "")}" autocapitalize="off" autocomplete="off"></label>
    <label class="campo"><span>Password</span><div class="riga" style="gap:8px"><input type="text" name="segreto" value="${esc(v.segreto || "")}" class="occhio" autocapitalize="off" autocomplete="off" style="flex:3">
      <button type="button" class="btn sec" id="gen" style="flex:1" title="Genera">🎲 Crea</button></div></label>
    <label class="campo"><span>Sito <i class="muted">(facoltativo)</i></span><input type="text" name="sito" value="${esc(v.sito || "")}" autocapitalize="off"></label>
    <label class="campo"><span>Note <i class="muted">(facoltativo)</i></span><textarea name="note" placeholder="PIN, codici di recupero, domande di sicurezza…">${esc(v.note || "")}</textarea></label>
    <button class="btn block">Salva</button></form>`);
  $("#gen", f).onclick = () => { $("[name=segreto]", f).value = generaPassword(); toast("🎲 Password sicura creata"); };
  $("#fv", f).onsubmit = async (e) => {
    e.preventDefault();
    const dati = Object.fromEntries(new FormData(e.target));
    try {
      await api(v.id ? `/api/cassaforte/${v.id}` : "/api/cassaforte", { method: v.id ? "PUT" : "POST", json: dati });
      f.remove(); toast("🔐 Salvata"); vistaPassword();
    } catch (err) { toast("⚠️ " + err.message); }
  };
}

/* ------------------------------------------------------------------ altro / impostazioni */
/* ------------------------------------------------------------------ Aspetto: temi e modo chiaro/scuro */
const TEMI = [["aurora", "Aurora", "linear-gradient(135deg,#8b5cf6,#d946ef 52%,#6366f1)"], ["oceano", "Oceano", "linear-gradient(135deg,#0ea5e9,#14b8a6 52%,#6366f1)"],
  ["tramonto", "Tramonto", "linear-gradient(135deg,#f97316,#ec4899 52%,#e11d48)"], ["foresta", "Foresta", "linear-gradient(135deg,#10b981,#22c55e 52%,#0d9488)"],
  ["oro", "Oro", "linear-gradient(135deg,#f59e0b,#eab308 52%,#d97706)"]];
function applicaAspetto(tema, modo) {
  const d = document.documentElement;
  if (tema) { d.dataset.tema = tema; memo.set("tema", tema); }
  if (modo !== undefined) { if (modo) d.dataset.modo = modo; else delete d.dataset.modo; memo.set("modo", modo || null); }
  const bg = getComputedStyle(d).getPropertyValue("--bg").trim();
  $$('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", bg));
}
const htmlAspetto = () => {
  const modo = document.documentElement.dataset.modo || "";
  return `<div class="sezione"><h2>🎨 Aspetto</h2></div>
    <div class="scelta-gruppo tre" id="modo">${[["", "🌗", "Automatico"], ["chiaro", "☀️", "Chiaro"], ["scuro", "🌙", "Scuro"]].map(([k, ic, n]) =>
      `<button type="button" data-modo="${k}" class="${k === modo ? "on" : ""}"><span>${ic}</span>${n}</button>`).join("")}</div>`;
};
function collegaAspetto() {
  $$("#modo [data-modo]").forEach((b) => (b.onclick = () => {
    const cambia = () => { applicaAspetto(null, b.dataset.modo); $$("#modo button").forEach((x) => x.classList.toggle("on", x === b)); };
    if (document.startViewTransition) { const vt = document.startViewTransition(cambia); vt.ready.catch(() => {}); vt.finished.catch(() => {}); } else cambia();
  }));
}

function cambiaPassword(titolo) {
  const v = foglio(`<h3>${titolo} ${xBtn}</h3><form id="fp"><label class="campo"><span>Password attuale</span><input type="password" name="attuale" autocomplete="current-password"></label>
    <label class="campo"><span>Nuova password</span><input type="password" name="nuova" autocomplete="new-password" minlength="6"></label><button class="btn block">Cambia</button></form>`);
  $("#fp", v).onsubmit = async (e) => {
    e.preventDefault();
    try { await api("/api/impostazioni/password", { method: "POST", json: Object.fromEntries(new FormData(e.target)) }); v.remove(); toast("🔑 Password cambiata"); }
    catch (err) { toast("⚠️ " + err.message); }
  };
}
const sezioneCal = () => `<details class="card"><summary><span class="sum-ico">🗓️</span><span>Calendario dell'iPhone<br><span class="small muted">${comandoCalPronto() ? "✅ Collegato" : "Da collegare (una volta sola)"}</span></span></summary><div class="dentro">
    <p class="small muted">LifeApp usa un Comando Rapido per inserire le visite nel Calendario, con promemoria.</p>${istruzioniCal()}
    <button class="btn block" id="cal-ok">${comandoCalPronto() ? "🧪 Prova il comando" : "✅ Ho creato il comando"}</button>
    ${comandoCalPronto() ? `<button class="link-btn" id="cal-reset">Scollega</button>` : ""}</div></details>`;
function collegaSezioneCal(ricarica) {
  $("#cal-ok").onclick = () => {
    memo.set("cmd-cal", "1");
    const d = new Date(); d.setDate(d.getDate() + 1);
    const g = new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    eseguiComandoCal({ titolo: "Prova LifeApp (puoi cancellarla)", icona: "🧪", inizio: g + "T10:00", fine: g + "T10:30", luogo: "", note: "Evento di prova creato da LifeApp" });
  };
  $("#cal-reset") && ($("#cal-reset").onclick = () => { memo.set("cmd-cal", null); ricarica(); });
}

async function vistaAltroLocale() {
  const s = await api("/api/impostazioni");
  const percentuale = s.uso && s.quota ? Math.max(1, Math.round((s.uso / s.quota) * 100)) : null;
  app.innerHTML = `<div class="top"><h1>Altro<small>Impostazioni e collegamenti con l'iPhone</small></h1></div>

  ${IOS && !STANDALONE ? `<details class="card" open><summary><span class="sum-ico">📲</span><span>Installa sulla schermata Home<br><span class="small muted">Da fare subito</span></span></summary><div class="dentro">
    ${passo(1, "In basso in Safari tocca <b>Condividi</b> (il quadrato con la freccia verso l'alto).")}
    ${passo(2, "Scorri e tocca <b>Aggiungi alla schermata Home</b> → <b>Aggiungi</b>.")}
    ${passo(3, "Da ora apri LifeApp <b>solo dall'icona</b> sulla Home.")}</div></details>` : ""}

  ${sezioneCal()}

  <details class="card"><summary><span class="sum-ico">📤</span><span>Ricevere file dal menu “Condividi”<br><span class="small muted">Da WhatsApp, Mail, Foto, Safari…</span></span></summary><div class="dentro">
    <p class="small muted">Senza server, iPhone non permette di mandare un file direttamente dentro LifeApp. Il modo più comodo:</p>
    <p class="small"><b>Metodo veloce (senza configurare niente):</b> da qualsiasi app tocca <b>Condividi</b> → <b>Salva su File</b> → scegli la cartella <b>LifeApp › In arrivo</b> (creala la prima volta). Poi in LifeApp: <b>Da smistare → Importa da File</b>.</p>
    <p class="small"><b>Metodo con un tocco solo</b>: crea un Comando Rapido che salva il file al posto tuo.</p>
    ${passo(1, `Comandi Rapidi → <b>+</b> → chiamalo ${cod(CMD_INVIA)}`)}
    ${passo(2, "Tocca <b>ⓘ</b> in basso → attiva <b>Mostra nel foglio di condivisione</b>.")}
    ${passo(3, "Aggiungi l'azione <b>Salva file</b>: salva <b>Input comando rapido</b>, disattiva <b>Chiedi dove salvare</b> e scegli la cartella <b>LifeApp › In arrivo</b> in iCloud Drive o Sul mio iPhone.")}
    ${passo(4, "Aggiungi <b>Mostra notifica</b> con il testo “Salvato per LifeApp ✅”.")}
    <p class="small muted">Quando avrai il server di casa, i file arriveranno direttamente in LifeApp, senza passare da File.</p></div></details>

  <details class="card" open><summary><span class="sum-ico">💾</span><span>Backup<br><span class="small muted">${s.ultimo_backup ? "Ultimo: " + dataIt(s.ultimo_backup.slice(0, 10)) : "Mai fatto"}</span></span></summary><div class="dentro">
    <p class="small muted">I documenti sono salvati <b>solo su questo iPhone</b>. Il backup crea un unico file con tutto (le password restano cifrate) da salvare nell'app <b>File</b> (meglio su iCloud Drive o su un computer). Ti servirà anche per spostare tutto sul server di casa.</p>
    <button class="btn block" id="bk">💾 Crea backup e salvalo su File</button>
    <button class="btn sec block" id="rip" style="margin-top:8px">♻️ Ripristina da un backup</button></div></details>

  ${htmlAspetto()}

  <div class="sezione"><h2>Copertine</h2></div>
  <div class="card"><label class="switch" style="padding:0"><span>🖼️ Cerca da solo le copertine di film, serie e libri<br><span class="small muted">Invia solo il titolo a Wikipedia, Open Library e Apple Books</span></span>
    <input type="checkbox" id="cop-auto" ${copertineAttive() ? "checked" : ""}></label></div>

  <div class="sezione"><h2>Memoria</h2></div>
  <div class="card"><b>${s.documenti} document${s.documenti === 1 ? "o" : "i"}</b> · ${s.uso != null ? dimensione(s.uso) + " usati" : ""}
    ${percentuale != null ? `<div class="progresso"><div style="width:${percentuale}%"></div></div><div class="small muted" style="margin-top:6px">Spazio disponibile per LifeApp: circa ${dimensione(s.quota)}</div>` : ""}
    <div class="small muted" style="margin-top:6px">${s.persistente ? "✅ iPhone conserverà questi dati." : "ℹ️ Installa LifeApp sulla Home e fai backup regolari: così i dati sono al sicuro."}</div></div>

  <div class="sezione"><h2>Sicurezza</h2></div>
  <div class="lista"><a class="voce" href="#/password"><div class="thumb">🔐</div><div class="corpo"><div class="tit">Le mie password</div></div><div class="dx">›</div></a><div class="voce" id="cambia"><div class="thumb">🔑</div><div class="corpo"><div class="tit">Cambia password della cassaforte</div></div><div class="dx">›</div></div>
    <div class="voce" id="intro"><div class="thumb">👋</div><div class="corpo"><div class="tit">Rivedi la presentazione</div></div><div class="dx">›</div></div></div>

  <div class="sezione"><h2>Server di casa</h2></div>
  <div class="card small">Quando il computer di casa sarà pronto: crea un backup qui, apri LifeApp dal server e vai su <b>Altro → Importa backup dall'iPhone</b>. Tutto (cartelle, documenti, visite, password) verrà copiato lì.</div>
  <input type="file" id="file-backup" accept=".zip,application/zip" hidden>`;
  collegaSezioneCal(vistaAltroLocale);
  collegaAspetto();
  $("#cop-auto").onchange = (e) => { memo.set("copertine", e.target.checked ? null : "no"); toast(e.target.checked ? "🖼️ Copertine automatiche attive" : "Copertine automatiche spente"); };
  $("#bk").onclick = async () => {
    const v = foglio(`<h3>Preparo il backup…</h3><div class="progresso"><div style="width:70%"></div></div>`);
    try { const f = await window.LOCALE.esportaBackup(); v.remove(); await condividiFile(f); toast("💾 Backup pronto: scegli “Salva su File”"); vistaAltroLocale(); }
    catch (e) { v.remove(); toast("⚠️ " + e.message); }
  };
  $("#rip").onclick = () => $("#file-backup").click();
  $("#file-backup").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (!(await conferma("Ripristinare questo backup?", "Ripristina", "Tutto quello che c'è ora in LifeApp su questo iPhone verrà sostituito dal contenuto del backup."))) return;
    try { svuotaMemoria(); const r = await window.LOCALE.ripristina(f); await caricaCartelle(); toast(`♻️ Ripristinati ${r.documenti} documenti e ${r.appuntamenti} visite`); location.hash = "#/"; }
    catch (err) { toast("⚠️ " + err.message); }
  };
  $("#cambia").onclick = () => cambiaPassword("Cambia password della cassaforte");
  $("#intro").onclick = () => benvenuto(true);
}

async function vistaAltroServer() {
  const s = await api("/api/impostazioni");
  const base = location.origin;
  const feed = `webcal://${location.host}/calendario/${s.token_calendario}.ics`;
  app.innerHTML = `<div class="top"><h1>Altro<small>Collega LifeApp al tuo iPhone</small></h1></div>

  <details class="card"><summary><span class="sum-ico">📤</span><span>Invia file dal menu “Condividi”</span></summary><div class="dentro">
    <p class="small muted">Crei una volta sola un Comando Rapido: comparirà nel menu Condividi di qualsiasi app. I file arrivano in <b>📥 Da smistare</b>.</p>
    ${passo(1, `Apri <b>Comandi Rapidi</b> → <b>+</b> → chiamalo ${cod(CMD_INVIA)}`)}
    ${passo(2, "Tocca <b>ⓘ</b> e attiva <b>Mostra nel foglio di condivisione</b>.")}
    ${passo(3, `Aggiungi <b>Ottieni contenuti dell'URL</b> con questo URL:${cod(base + "/api/documenti")}`)}
    ${passo(4, `<b>Mostra di più</b>: Metodo <b>POST</b>. In <b>Intestazioni</b> aggiungi chiave <b>X-Token</b> con valore:${cod(s.token_api)}`)}
    ${passo(5, "Corpo richiesta: <b>Modulo</b>. Aggiungi un campo <b>File</b> con chiave <b>file</b> e valore <b>Input comando rapido</b>.")}
    ${passo(6, "Aggiungi <b>Mostra notifica</b>: “Salvato in LifeApp ✅”.")}</div></details>

  ${sezioneCal()}

  <details class="card"><summary><span class="sum-ico">🔄</span><span>Calendario sempre aggiornato (abbonamento)</span></summary><div class="dentro">
    <p class="small muted">In alternativa al comando: l'iPhone si abbona al calendario di LifeApp e scarica da solo visite e scadenze ogni 15 minuti (funziona quando sei sulla rete di casa).</p>
    <a class="btn block" href="${feed}">📲 Abbonati al calendario</a>${cod(feed)}</div></details>

  <details class="card"><summary><span class="sum-ico">🎙️</span><span>“Ehi Siri, nuova visita”</span></summary><div class="dentro">
    ${passo(1, "Comandi Rapidi → <b>+</b> → chiamalo <b>Nuova visita</b>.")}
    ${passo(2, "Azione <b>Dettare testo</b> (Italiano).")}
    ${passo(3, `Azione <b>Ottieni contenuti dell'URL</b>: ${cod(base + "/api/appuntamenti/rapido")} Metodo <b>POST</b>, intestazione <b>X-Token</b> = ${cod(s.token_api)} Corpo <b>JSON</b>: chiave <b>testo</b> = <i>Testo dettato</i>.`)}
    ${passo(4, "Azione <b>Aggiungi nuovo evento</b> con le chiavi <b>titolo</b>, <b>inizio</b>, <b>fine</b>, <b>luogo</b> del risultato (come per il calendario).")}
    ${passo(5, "Azione <b>Pronuncia testo</b> con la chiave <b>frase</b>.")}</div></details>

  <details class="card"><summary><span class="sum-ico">📱</span><span>Installa sulla schermata Home</span></summary><div class="dentro">
    ${passo(1, "Apri con <b>Safari</b> sull'iPhone uno di questi indirizzi:" + s.indirizzi.map((i) => cod(i)).join(""))}
    ${passo(2, "Tocca <b>Condividi</b> → <b>Aggiungi alla schermata Home</b>.")}</div></details>

  ${htmlAspetto()}

  <div class="sezione"><h2>Dati</h2></div>
  <div class="lista">
    <a class="voce" href="/api/backup" download><div class="thumb">💾</div><div class="corpo"><div class="tit">Scarica backup completo</div><div class="sub">Documenti e password (cifrate) in un file .zip</div></div><div class="dx">›</div></a>
    <div class="voce" id="importa"><div class="thumb">📲</div><div class="corpo"><div class="tit">Importa backup dall'iPhone</div><div class="sub">Copia qui tutto quello che avevi salvato sul telefono</div></div><div class="dx">›</div></div>
  </div>
  <div class="sezione"><h2>Sicurezza</h2></div>
  <div class="lista">
    <a class="voce" href="#/password"><div class="thumb">🔐</div><div class="corpo"><div class="tit">Le mie password</div></div><div class="dx">›</div></a>
    <div class="voce" id="cambia"><div class="thumb">🔑</div><div class="corpo"><div class="tit">Cambia password</div><div class="sub">Usata anche per cifrare la cassaforte</div></div><div class="dx">›</div></div>
    <div class="voce" id="rig-api"><div class="thumb">♻️</div><div class="corpo"><div class="tit">Rigenera codice per i Comandi Rapidi</div></div></div>
    <div class="voce" id="rig-cal"><div class="thumb">♻️</div><div class="corpo"><div class="tit">Rigenera link del calendario</div></div></div>
    <div class="voce" id="esci"><div class="thumb">🚪</div><div class="corpo"><div class="tit" style="color:var(--danger)">Esci</div></div></div>
  </div>
  <p class="small muted" style="margin:18px 4px">Server: <b>${esc(s.nome_host)}</b><br>Dati salvati in: <span class="occhio">${esc(s.cartella_dati)}</span></p>
  <input type="file" id="file-backup" accept=".zip,application/zip" hidden>`;
  collegaSezioneCal(vistaAltroServer);
  collegaAspetto();
  $("#esci").onclick = async () => { await api("/api/esci", { method: "POST" }); location.reload(); };
  const rig = async (q, msg) => { if (!(await conferma(msg, "Rigenera"))) return; await api("/api/impostazioni/rigenera/" + q, { method: "POST" }); toast("♻️ Fatto: aggiorna i Comandi Rapidi"); vistaAltroServer(); };
  $("#rig-api").onclick = () => rig("token_api", "Rigenerare il codice? I Comandi Rapidi esistenti smetteranno di funzionare.");
  $("#rig-cal").onclick = () => rig("token_calendario", "Rigenerare il link? Il calendario in abbonamento smetterà di aggiornarsi.");
  $("#cambia").onclick = () => cambiaPassword("Cambia password");
  $("#importa").onclick = () => $("#file-backup").click();
  $("#file-backup").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const pw = await chiedi("Password della cassaforte dell'iPhone", "", { tipo: "password", etichetta: "Importa", aiuto: "Serve per copiare anche le password salvate sul telefono. Lascia vuoto se non avevi creato la cassaforte." });
    if (pw === null) return;
    const v = foglio(`<h3>Importazione…</h3><div class="progresso"><div style="width:60%"></div></div>`);
    try {
      const fd = new FormData(); fd.append("file", f, f.name); fd.append("password", pw);
      svuotaMemoria();
      const r = await fetch("/api/importa", { method: "POST", body: fd, credentials: "same-origin" });
      const d = await r.json(); v.remove();
      if (!r.ok) throw new Error(d.errore || "Errore");
      await caricaCartelle(); toast(`✅ Importati ${d.documenti} documenti, ${d.appuntamenti} visite, ${d.password} password`, 4500);
    } catch (err) { v.remove(); toast("⚠️ " + err.message); }
  };
}


/* ================================================================== IO: la mia pagina personale */
const CAMPI_PROFILO = [["nome", "Nome e cognome", "text"], ["nascita", "Data di nascita", "date"], ["luogo_nascita", "Luogo di nascita", "text"],
  ["cf", "Codice fiscale", "text"], ["indirizzo", "Indirizzo", "text"], ["telefono", "Telefono", "tel"], ["email", "Email", "email"],
  ["sangue", "Gruppo sanguigno", "text"], ["taglie", "Taglie (vestiti, scarpe…)", "text"], ["note", "Altre informazioni", "text"]];
/* Restituisce la cartella "Fototessera" / "Curriculum"; se non c'è la crea dentro "Documenti personali" */
async function assicuraCartella(nome, icona) {
  let c = cartellaPersonale(nome);
  if (c) return c.id;
  let dp = S.cartelle.find((x) => x.padre == null && x.nome === "Documenti personali");
  if (!dp) dp = { id: (await api("/api/cartelle", { method: "POST", json: { nome: "Documenti personali", padre: null, icona: "🪪" } })).id };
  const r = await api("/api/cartelle", { method: "POST", json: { nome, padre: dp.id, icona } });
  await caricaCartelle();
  return r.id;
}
const cartellaPersonale = (nome) => S.cartelle.find((c) => c.nome === nome && S.byId[c.padre]?.nome === "Documenti personali") || S.cartelle.find((c) => c.nome === nome);
async function fotoProfilo() {
  const c = cartellaPersonale("Fototessera");
  if (!c) return null;
  const docs = (await api(`/api/documenti?cartella=${c.id}`)).filter((d) => (d.mime || "").startsWith("image/"));
  return docs[0] || null;
}
function caricaIn(cartella, { foto = false, scatta = false, frontale = false, dopo } = {}) {
  const inp = $("#file-input");
  inp.value = ""; inp.accept = foto ? "image/*" : "";
  scatta ? inp.setAttribute("capture", frontale ? "user" : "environment") : inp.removeAttribute("capture");
  inp.onchange = async () => { if (inp.files.length) { await caricaFile([...inp.files], { cartella }); if (dopo) dopo(); } };
  inp.click();
}
function eta(iso) {
  if (!iso) return null;
  const n = new Date(iso + "T00:00"), o = new Date();
  let a = o.getFullYear() - n.getFullYear();
  if (o.getMonth() < n.getMonth() || (o.getMonth() === n.getMonth() && o.getDate() < n.getDate())) a--;
  return a;
}

async function vistaIo() {
  await caricaCartelle();
  const cFoto = cartellaPersonale("Fototessera"), cCv = cartellaPersonale("Curriculum");
  if (!cFoto || !cCv) {
    if (!cFoto) await assicuraCartella("Fototessera", "📸");
    if (!cCv) await assicuraCartella("Curriculum", "📄");
    return vistaIo();
  }
  const [prof, diario, foto, cv] = await Promise.all([api("/api/profilo"), api("/api/diario"),
    cFoto ? api(`/api/documenti?cartella=${cFoto.id}`) : [], cCv ? api(`/api/documenti?cartella=${cCv.id}`) : []]);
  const fotoImg = foto.filter((d) => (d.mime || "").startsWith("image/"));
  const quanti = (t) => diario.filter((x) => x.tipo === t).length;
  const st = statEsami(diario.filter((x) => x.tipo === "esame")), b = bilancio(diario.filter((x) => x.tipo === "acquisto"));
  const anni = eta(prof.nascita);
  const totDoc = S.cartelle.reduce((a, c) => a + (c.documenti || 0), 0) + S.daSmistare;
  app.innerHTML = `
    <div class="io-testa">
      <button class="io-foto" id="cambia-foto" aria-label="Fototessera">${fotoImg[0] ? `<img src="${urlMini(fotoImg[0])}" alt="">` : "<span>👤</span>"}<i>📷</i></button>
      <h1 class="grad">${esc(prof.nome || "Io")}</h1>
      <div class="muted">${[anni != null ? `${anni} anni` : "", prof.luogo_nascita ? esc(prof.luogo_nascita) : ""].filter(Boolean).join(" · ") || "Tocca “Modifica” per aggiungere i tuoi dati"}</div>
    </div>
    <div class="sezione"><h2>La mia vita in numeri</h2></div>
    <div class="numeri">
      <a href="#/diario/film"><b data-conta="${quanti("film")}">${quanti("film")}</b><span>🎬 film</span></a>
      <a href="#/diario/libro"><b data-conta="${quanti("libro")}">${quanti("libro")}</b><span>📚 libri</span></a>
      <a href="#/diario/serie"><b data-conta="${quanti("serie")}">${quanti("serie")}</b><span>📺 serie</span></a>
      <a href="#/diario/compleanno"><b data-conta="${quanti("compleanno")}">${quanti("compleanno")}</b><span>🎂 compleanni</span></a>
      <a href="#/diario/esame"><b>${st.n ? dec(st.ponderata ?? st.media, 1) : "—"}</b><span>🎓 media</span></a>
      <a href="#/diario/acquisto"><b class="${b.saldo >= 0 ? "su" : "giu"}">${quanti("acquisto") ? segno(Math.round(b.saldo)) : "—"}</b><span>💶 bilancio</span></a>
      <a href="#/"><b data-conta="${totDoc}">${totDoc}</b><span>📄 documenti</span></a>
      <a href="#/password"><b>🔐</b><span>password</span></a>
    </div>
    <div class="grafico-card" style="margin-top:12px"><div class="g-tit">Film, libri e serie mese per mese</div><div id="g-vita"></div></div>
    <div class="sezione"><h2>Dati personali</h2><a href="#" id="mod-prof">✏️ Modifica</a></div>
    <div class="lista">${CAMPI_PROFILO.filter(([k]) => prof[k]).map(([k, n, tipo]) => `<div class="voce dato"><div class="corpo"><div class="sub">${n}</div>
      <div class="tit" style="white-space:normal">${esc(tipo === "date" ? dataIt(prof[k]) : prof[k])}</div></div><button class="btn sec small" data-cp="${esc(prof[k])}">Copia</button></div>`).join("")
      || `<button class="vuoto-cta" id="primo-prof" style="margin:0;border:0"><span class="big">🪪</span><b>Aggiungi i tuoi dati</b><span class="muted small">Codice fiscale, indirizzo, taglie… sempre a portata di mano</span></button>`}</div>
    <div class="sezione"><h2>Curriculum</h2>${cCv ? `<a href="#/c/${cCv.id}">Apri cartella</a>` : ""}</div>
    ${cv.length ? `<div id="cv">${htmlDocs(cv.slice(0, 3))}</div>` : ""}
    <button class="btn sec block" id="carica-cv" style="margin-top:${cv.length ? 10 : 0}px">📄 ${cv.length ? "Carica una nuova versione" : "Carica il tuo curriculum"}</button>
    <div class="sezione"><h2>Fototessere</h2>${cFoto ? `<a href="#/c/${cFoto.id}">Apri cartella</a>` : ""}</div>
    <div class="fototessere">${fotoImg.map((d) => `<button data-foto="${d.id}"><img src="${urlMini(d)}" alt=""></button>`).join("")}
      <button id="nuova-foto" class="aggiungi-foto"><span>＋</span>Aggiungi</button></div>`;
  const ric = () => vistaIo();
  const modifica = () => {
    const v = foglio(`<h3>🪪 I miei dati ${xBtn}</h3><form id="fp">${CAMPI_PROFILO.map(([k, n, tipo]) => `<label class="campo"><span>${n}</span><input type="${tipo}" name="${k}" value="${esc(prof[k] || "")}" ${k === "cf" ? 'autocapitalize="characters"' : ""}></label>`).join("")}
      <button class="btn block">Salva</button></form>`);
    $("#fp", v).onsubmit = async (e) => { e.preventDefault(); await api("/api/profilo", { method: "PUT", json: Object.fromEntries(new FormData(e.target)) }); v.chiudi(); toast("✅ Dati salvati"); ric(); };
  };
  $("#mod-prof").onclick = (e) => { e.preventDefault(); modifica(); };
  graficoVita($("#g-vita"), diario);
  window.Grafici.conta(app);
  $("#primo-prof") && ($("#primo-prof").onclick = modifica);
  const sceltaFoto = () => {
    const v = foglio(`<h3>📸 Fototessera ${xBtn}</h3><div class="azioni-grandi">
      <button data-m="selfie"><span>🤳</span>Scatta una foto</button><button data-m="galleria"><span>🖼️</span>Scegli dalle foto</button></div>`);
    v.addEventListener("click", async (e) => { const m = e.target.closest("[data-m]")?.dataset.m; if (!m) return; v.chiudi();
      caricaIn(cFoto?.id ?? await assicuraCartella("Fototessera", "📸"), { foto: true, scatta: m === "selfie", frontale: true, dopo: ric }); });
  };
  $("#cambia-foto").onclick = sceltaFoto;
  $("#nuova-foto").onclick = sceltaFoto;
  $("#carica-cv").onclick = async () => caricaIn(cCv?.id ?? await assicuraCartella("Curriculum", "📄"), { dopo: ric });
  if (cv.length) collegaDocs($("#cv"), cv, ric);
  $$("[data-foto]").forEach((b) => (b.onclick = () => apriDoc(fotoImg.find((d) => d.id === +b.dataset.foto), ric)));
}


/* ================================================================== PALESTRA */
/* Forza stimata = massimale stimato (formula di Epley): il peso che potresti sollevare una volta sola.
   carico × (1 + ripetizioni / 30). Rende confrontabili serie con carichi e ripetizioni diversi.
   Esercizi a corpo libero (carico 0): si segue il numero di ripetizioni. */
const forzaStimata = (kg, reps) => (kg > 0 ? (reps <= 1 ? kg : kg * (1 + reps / 30)) : reps);
const kgTesto = (n) => (n == null ? "—" : (Math.round(n * 10) / 10).toLocaleString("it-IT") + " kg");
const valoreForza = (kg, n) => (kg > 0 ? kgTesto(n) : `${Math.round(n)} rip.`);
const chiaveEs = (n) => n.trim().toLowerCase();
const serieDi = (e = {}) => (Array.isArray(e.set) && e.set.length ? e.set : Array.from({ length: Math.min(Math.max(1, e.serie || 1), 30) }, () => ({ kg: e.kg || 0, reps: e.reps || 0 })));
const kgCorto = (n) => (Math.round(n * 10) / 10).toLocaleString("it-IT");
function testoSerie(e = {}) {   // "20×12 · 30×10 · 40×8 kg" oppure "80 kg × 8 · 3 serie"
  const s = serieDi(e);
  if (s.length > 1 && s.every((x) => x.kg === s[0].kg && x.reps === s[0].reps)) return (s[0].kg ? `${kgTesto(s[0].kg)} × ${s[0].reps}` : `${s[0].reps} ripetizioni`) + ` · ${s.length} serie`;
  if (s.length > 1) return s.every((x) => !x.kg) ? s.map((x) => x.reps).join(" · ") + " ripetizioni" : s.map((x) => (x.kg ? `${kgCorto(x.kg)}×${x.reps}` : `${x.reps} rip.`)).join(" · ") + (s.some((x) => x.kg) ? " kg" : "");
  return (e.kg ? `${kgTesto(e.kg)} × ${e.reps}` : `${e.reps} ripetizioni`) + (e.serie > 1 ? ` · ${e.serie} serie` : "");
}
const forzaSerie = (s) => forzaStimata(s.kg || 0, s.reps || 0);
const extraGiorno = (d) => ({ set: d.set, kg: d.best.kg, reps: d.best.reps, serie: d.set.length });
function raggruppaEsercizi(allen) {
  const m = new Map();
  allen.slice().sort((a, b) => (a.data || "").localeCompare(b.data || "") || (a.creato || "").localeCompare(b.creato || "") || a.id - b.id)
    .forEach((x) => { const k = chiaveEs(x.titolo); if (!m.has(k)) m.set(k, { nome: x.titolo, voci: [] }); m.get(k).voci.push(x); });
  for (const g of m.values()) {
    g.corpoLibero = g.voci.every((x) => !x.extra?.kg);
    // tutte le serie dello stesso giorno = un allenamento; vale la serie migliore del giorno
    const gg = new Map();
    g.voci.forEach((x) => { const d = x.data || ""; if (!gg.has(d)) gg.set(d, { data: d, voci: [] }); gg.get(d).voci.push(x); });
    g.giorni = [...gg.values()].map((d) => {
      const set = d.voci.flatMap((x) => serieDi(x.extra)), best = set.reduce((a, x) => (forzaSerie(x) > forzaSerie(a) ? x : a), set[0]);
      return { ...d, set, best, forza: forzaSerie(best) };
    });
    g.forze = g.giorni.map((d) => d.forza);
    g.ultima = g.voci[g.voci.length - 1]; g.ultimoG = g.giorni[g.giorni.length - 1]; g.record = Math.max(...g.forze);
    g.progresso = g.forze[0] ? (g.forze[g.forze.length - 1] / g.forze[0] - 1) * 100 : 0;
  }
  return [...m.values()].sort((a, b) => (b.ultima.data || "").localeCompare(a.ultima.data || ""));
}
/* Giorni di allenamento: tutti gli esercizi fatti nello stesso giorno, il più recente per primo */
function giorniAllenamento(allen) {
  const m = new Map();
  for (const g of raggruppaEsercizi(allen)) for (const d of g.giorni) {
    if (!m.has(d.data)) m.set(d.data, { data: d.data, esercizi: [] });
    m.get(d.data).esercizi.push({ nome: g.nome, corpoLibero: g.corpoLibero, ...d });
  }
  const l = [...m.values()].sort((a, b) => b.data.localeCompare(a.data));
  l.forEach((d) => { d.esercizi.sort((a, b) => Math.min(...a.voci.map((x) => x.id)) - Math.min(...b.voci.map((x) => x.id)));
    d.serie = d.esercizi.reduce((t, e) => t + e.set.length, 0); d.volume = d.esercizi.reduce((t, e) => t + e.set.reduce((u, x) => u + (x.kg || 0) * (x.reps || 0), 0), 0); });
  return l;
}
const giornoLungo = (iso) => { const d = new Date(iso + "T00:00"); return `${GIORNI[d.getDay()]} ${d.getDate()} ${MESI_L[d.getMonth()]} ${d.getFullYear()}`; };
function htmlGiorno(d) {
  const x = new Date(d.data + "T00:00");
  return `<a class="voce" href="#/allenamento/${d.data}"><div class="datebox" style="--c:var(--accent)"><div class="m">${MESI[x.getMonth()]}</div><div class="g">${x.getDate()}</div></div>
    <div class="corpo"><div class="tit">${GIORNI[x.getDay()][0].toUpperCase() + GIORNI[x.getDay()].slice(1)} · ${d.esercizi.length} eserciz${d.esercizi.length === 1 ? "io" : "i"} · ${d.serie} serie</div>
    <div class="sub">${d.esercizi.map((e) => esc(e.nome)).join(" · ")}</div></div><div class="dx">›</div></a>`;
}
function graficoEsercizio(el, g) {
  el.innerHTML = "";
  if (g.giorni.length < 2) { el.innerHTML = `<div class="small muted" style="padding:14px 4px">Hai fatto <b>${esc(g.nome)}</b> in un solo allenamento: dal prossimo vedrai qui l'andamento.</div>`; return; }
  const lib = g.corpoLibero, vals = g.forze.map((v) => Math.round(v * 10) / 10);
  window.Grafici.linea(el, { categorie: g.giorni.map((d) => dataIt(d.data).replace(/ \d{4}$/, "")),
    etichette: g.giorni.map((d) => `Allenamento del ${dataIt(d.data)} · ${testoSerie(extraGiorno(d))}`),
    serie: [{ nome: lib ? "Ripetizioni (serie migliore)" : "Forza stimata (serie migliore)", slot: 1, tipo: "linea", punti: true, valori: vals }], ...intervalloY(vals),
    formato: (v) => (lib ? String(Math.round(v)) : kgTesto(v).replace(" kg", "")), titoloTabella: "Vedi i numeri in tabella" });
}

function bmi(peso, altezza) {
  if (!peso || !altezza) return null;
  const v = peso / Math.pow(altezza / 100, 2);
  return { v, etichetta: v < 18.5 ? "sottopeso" : v < 25 ? "normopeso" : v < 30 ? "sovrappeso" : "obesità" };
}
const ultimoPeso = (pesi) => pesi.slice().sort((a, b) => (b.data || "").localeCompare(a.data || "") || b.id - a.id)[0];
function scintilla(valori) {   // minigrafico della tendenza, nel colore della serie 1
  if (valori.length < 2) return "";
  const w = 84, h = 28, lo = Math.min(...valori), hi = Math.max(...valori), r = hi - lo || 1;
  const pts = valori.map((v, i) => `${(i / (valori.length - 1)) * (w - 4) + 2},${h - 3 - ((v - lo) / r) * (h - 6)}`);
  return `<svg class="scintilla" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts.join(" ")}"/><circle cx="${pts[pts.length - 1].split(",")[0]}" cy="${pts[pts.length - 1].split(",")[1]}" r="3"/></svg>`;
}
function intervalloY(valori) {   // asse con valori "tondi" (es. 70 · 80 · 90 · 100 · 110)
  const lo0 = Math.min(...valori), hi0 = Math.max(...valori), pad = (hi0 - lo0) * 0.15 || Math.max(2, hi0 * 0.08);
  const grezzo = (hi0 - lo0 + 2 * pad) / 4, mag = Math.pow(10, Math.floor(Math.log10(grezzo || 1)));
  const passo = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((k) => k >= grezzo) || 10 * mag;
  const lo = Math.max(0, Math.floor((lo0 - pad) / passo) * passo), hi = Math.ceil((hi0 + pad) / passo) * passo;
  const tickY = []; for (let v = lo; v <= hi + passo / 2; v += passo) tickY.push(Math.round(v * 100) / 100);
  return { yMin: lo, yMax: hi, tickY };
}

async function vistaPalestra() {
  const [allen, pesi, prof, corse] = await Promise.all([api("/api/diario?tipo=allenamento"), api("/api/diario?tipo=peso"), api("/api/profilo"), api("/api/diario?tipo=corsa")]);
  const stC = corse.length ? statCorse(corse) : null, ultC = stC?.l[stC.n - 1];
  const esercizi = raggruppaEsercizi(allen), esPrimo = Math.max(0, esercizi.findIndex((g) => g.giorni.length > 1)), giorni = giorniAllenamento(allen), pAtt = ultimoPeso(pesi), alt = +prof.altezza || null, b = bmi(pAtt?.extra?.peso, alt);
  app.innerHTML = htmlTestaPalestra("palestra", "Pesi, corsa e corpo") + `
    <button class="btn block" id="nuovo-es" style="margin:4px 0 6px">➕ Registra un esercizio</button>
    ${esercizi.length ? `<div class="grafico-card"><div class="g-tit">📈 Andamento per esercizio</div>
      <div class="pronti scorri" id="es-scelta">${esercizi.map((g, i) => `<button type="button" class="chip ${i === esPrimo ? "on" : ""}" data-es="${i}">${esc(g.nome)}</button>`).join("")}</div>
      <div id="g-es"></div><p class="small muted" style="margin:6px 4px 2px">Un punto per ogni allenamento: conta la serie migliore di quel giorno.</p></div>
      <div class="sezione"><h2>🗓️ Allenamenti</h2>${giorni.length > 4 ? `<a href="#/allenamento">Tutti (${giorni.length}) ›</a>` : `<span class="muted small">${giorni.length}</span>`}</div>
      <div class="lista" id="allenamenti">${giorni.slice(0, 4).map(htmlGiorno).join("")}</div>` : ""}
    ${esercizi.length ? `<div class="sezione"><h2>I miei esercizi</h2><span class="muted small">${esercizi.length}</span></div>
      <div class="esercizi">${esercizi.map((g, i) => { const u = extraGiorno(g.ultimoG);
        return `<a class="esercizio" href="#/palestra/${encodeURIComponent(g.nome)}">
          <div class="es-testa"><b>${esc(g.nome)}</b>${g.giorni.length > 1 ? `<span class="tag ${g.progresso >= 0 ? "ok" : "danger"}">${g.progresso >= 0 ? "▲" : "▼"} ${Math.abs(Math.round(g.progresso))}%</span>` : ""}</div>
          <div class="es-ultima">${testoSerie(u)}</div>
          <div class="es-piede"><span class="muted small">${g.corpoLibero ? "Record" : "Forza stimata"}: <b>${valoreForza(u.kg, g.corpoLibero ? g.record : g.forze[g.forze.length - 1])}</b><br>${g.giorni.length} allenament${g.giorni.length === 1 ? "o" : "i"} · ${dataIt(g.ultimoG.data).replace(/ \d{4}$/, "")}</span>${scintilla(g.forze)}</div></a>`; }).join("")}</div>`
      : `<div class="vuoto"><span class="big">🏋️</span>Nessun esercizio ancora.<br>Tocca <b>Registra un esercizio</b> per segnare carichi e ripetizioni.</div>`}`;
  const ric = () => vistaPalestra();
  $("#nuovo-es").onclick = () => registraEsercizio(null, ric);
  if ($("#g-es")) {
    graficoEsercizio($("#g-es"), esercizi[esPrimo]);
    $("#es-scelta").onclick = (e) => { const b = e.target.closest("[data-es]"); if (!b) return; $$("#es-scelta .chip").forEach((x) => x.classList.toggle("on", x === b)); graficoEsercizio($("#g-es"), esercizi[+b.dataset.es]); };
  }
}

async function vistaEsercizio(nome) {
  const allen = await api("/api/diario?tipo=allenamento");
  const g = raggruppaEsercizi(allen).find((x) => chiaveEs(x.nome) === chiaveEs(nome));
  if (!g) { location.hash = "#/palestra"; return; }
  const ultimaF = g.forze[g.forze.length - 1], lib = g.corpoLibero, n = g.giorni.length;
  app.innerHTML = `<div class="top"><a class="iconbtn" href="#/palestra" aria-label="Indietro">‹</a><h1 style="font-size:26px">${esc(g.nome)}<small>${n} allenament${n === 1 ? "o" : "i"}</small></h1></div>
    <div class="bilancio">
      <div class="bil-top"><div><div class="bil-et">${lib ? "Ripetizioni (ultimo allenamento)" : "Forza stimata (ultimo allenamento)"}</div><div class="bil-num">${valoreForza(g.ultimoG.best.kg, ultimaF)}</div>
        <div class="bil-sub">${lib ? "esercizio a corpo libero" : "il peso che potresti sollevare una volta sola"}</div></div><div class="bil-ico">🏋️</div></div>
      <div class="bil-griglia">
        <div><div class="bil-et">Record</div><div class="bil-n">${valoreForza(lib ? 0 : 1, g.record)}</div></div>
        <div><div class="bil-et">Progresso</div><div class="bil-n ${g.progresso >= 0 ? "su" : "giu"}">${n > 1 ? (g.progresso >= 0 ? "+" : "") + dec(g.progresso, 0) + "%" : "—"}</div><div class="bil-sub">dal primo allenamento</div></div>
      </div></div>
    <div class="grafico-card"><div class="g-tit">${lib ? "Ripetizioni" : "Forza stimata"} per allenamento</div><div id="g-forza"></div>
      <p class="small muted" style="margin:6px 4px 2px">Un punto per ogni giorno di allenamento, con la serie migliore di quel giorno.${lib ? "" : " Forza stimata = carico × (1 + ripetizioni ÷ 30): così 80 kg × 8 (≈ 101 kg) vale più di 100 kg × 1."}</p></div>
    <button class="btn block" id="agg-serie" style="margin:4px 0 4px">➕ Aggiungi ${esc(g.nome)}</button>
    <div class="sezione"><h2>Allenamenti</h2></div>
    <div class="lista" id="storico">${g.giorni.slice().reverse().map((d) => { const x = new Date(d.data + "T00:00"), com = d.voci.map((v) => v.commento).filter(Boolean).join(" · ");
      return `<div class="voce" ${d.voci.length > 1 ? `data-giorno="${d.data}"` : `data-al="${d.voci[0].id}"`}><div class="datebox" style="--c:var(--accent)"><div class="m">${MESI[x.getMonth()]}</div><div class="g">${x.getDate()}</div></div>
        <div class="corpo"><div class="tit">${testoSerie(extraGiorno(d))}</div>
        <div class="sub">${lib ? `${d.set.length} serie` : `Forza stimata ${kgTesto(d.forza)}`}${d.forza === g.record && n > 1 ? " · 🏆 record" : ""}${com ? " · " + esc(com) : ""}</div></div><div class="dx">›</div></div>`; }).join("")}</div>`;
  const ric = () => vistaEsercizio(g.nome);
  $("#agg-serie").onclick = () => registraEsercizio(g.nome, ric);
  $("#storico").onclick = (e) => {
    const v = e.target.closest("[data-al], [data-giorno]"); if (!v) return;
    if (v.dataset.giorno) location.hash = "#/allenamento/" + v.dataset.giorno;
    else registraEsercizio(g.nome, ric, g.voci.find((x) => x.id === +v.dataset.al));
  };
  graficoEsercizio($("#g-forza"), g);
}

/* Un giorno di allenamento (tutti gli esercizi di quel giorno) oppure l'elenco di tutti i giorni */
async function vistaAllenamento(data) {
  const allen = await api("/api/diario?tipo=allenamento"), giorni = giorniAllenamento(allen);
  if (!data) {
    app.innerHTML = `<div class="top"><a class="iconbtn" href="#/palestra" aria-label="Indietro">‹</a><h1 style="font-size:28px">🗓️ <span class="grad">Allenamenti</span><small>${giorni.length} giorni in palestra</small></h1></div>
      ${giorni.length ? `<div class="lista">${giorni.map(htmlGiorno).join("")}</div>` : `<div class="vuoto"><span class="big">🏋️</span>Nessun allenamento ancora.</div>`}`;
    return;
  }
  const i = giorni.findIndex((d) => d.data === data), d = giorni[i];
  const prima = giorni[i + 1], dopoG = i > 0 ? giorni[i - 1] : null;
  app.innerHTML = `<div class="top"><a class="iconbtn" href="#/palestra" aria-label="Indietro">‹</a><h1 style="font-size:26px">Allenamento<small>${giornoLungo(data)}</small></h1></div>
    <div class="giorno-nav">${prima ? `<a class="chip" href="#/allenamento/${prima.data}">‹ ${dataIt(prima.data).replace(/ \d{4}$/, "")}</a>` : "<span></span>"}
      ${dopoG ? `<a class="chip" href="#/allenamento/${dopoG.data}">${dataIt(dopoG.data).replace(/ \d{4}$/, "")} ›</a>` : "<span></span>"}</div>
    ${d ? `<div class="bilancio corpo"><div class="bil-griglia" style="margin-top:0">
        <div class="corpo-dato"><div class="bil-et">Esercizi</div><div class="bil-n">${d.esercizi.length}</div></div>
        <div class="corpo-dato"><div class="bil-et">Serie</div><div class="bil-n">${d.serie}</div></div>
        <div class="corpo-dato"><div class="bil-et">Volume</div><div class="bil-n">${Math.round(d.volume).toLocaleString("it-IT")} kg</div><div class="bil-sub">carico × ripetizioni</div></div></div></div>
      <div class="lista" id="giorno-es">${d.esercizi.map((e) => e.voci.map((v) => `<div class="voce" data-al="${v.id}"><div class="thumb">🏋️</div><div class="corpo"><div class="tit">${esc(e.nome)}</div>
        <div class="sub">${testoSerie(v.extra)}${v.commento ? " · " + esc(v.commento) : ""}</div></div>
        <a class="dx link-btn" href="#/palestra/${encodeURIComponent(e.nome)}" aria-label="Andamento di ${esc(e.nome)}">📈</a></div>`).join("")).join("")}</div>`
      : `<div class="vuoto"><span class="big">🏋️</span>Nessun esercizio in questo giorno.</div>`}
    <button class="btn block" id="agg-giorno" style="margin-top:12px">➕ Aggiungi un esercizio a questo allenamento</button>`;
  const ric = () => vistaAllenamento(data);
  $("#agg-giorno").onclick = () => registraEsercizio(null, ric, null, data);
  $("#giorno-es") && ($("#giorno-es").onclick = (ev) => {
    if (ev.target.closest("a")) return;
    const v = ev.target.closest("[data-al]"); if (!v) return;
    const x = allen.find((y) => y.id === +v.dataset.al); registraEsercizio(x.titolo, ric, x);
  });
}

async function registraEsercizio(nome, dopo, voce, dataPre = null) {
  const nomi = raggruppaEsercizi(await api("/api/diario?tipo=allenamento")).map((g) => g.nome);
  const e = voce?.extra || {};
  const v = foglio(`<h3>🏋️ ${voce ? "Modifica" : "Registra un esercizio"} ${xBtn}</h3><form id="fe">
    <label class="campo"><span>Esercizio</span><input type="text" name="titolo" list="nomi-es" value="${esc(nome || "")}" required placeholder="Es. Panca piana, Squat, Trazioni"></label>
    <datalist id="nomi-es">${nomi.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
    ${!nome && nomi.length ? `<div class="pronti" style="margin:-4px 0 12px">${nomi.slice(0, 8).map((n) => `<button type="button" class="chip" data-n="${esc(n)}">${esc(n)}</button>`).join("")}</div>` : ""}
    <div class="serie-intest"><span></span><span>Carico (kg)</span><span>Ripetizioni</span><span></span></div>
    <div id="righe-serie"></div>
    <button type="button" class="btn sec block" id="piu-serie" style="margin:2px 0 10px">➕ Aggiungi serie</button>
    <div class="anteprima-forza" id="ant-forza"></div>
    <label class="campo"><span>Data</span><input type="date" name="data" value="${esc(voce?.data || dataPre || oggiIso())}"></label>
    <label class="campo"><span>Note <i class="muted">(facoltativo)</i></span><input type="text" name="commento" value="${esc(voce?.commento || "")}" placeholder="Es. con fermo al petto, presa stretta…"></label>
    <button class="btn block">Salva</button>
    ${voce ? `<button type="button" class="btn danger block" id="del-es" style="margin-top:8px">🗑️ Elimina</button>` : ""}</form>`);
  const f = $("#fe", v), box = $("#righe-serie", v);
  const leggi = () => $$(".riga-serie", box).map((r) => ({ kg: parseFloat($("[name=kg]", r).value) || 0, reps: parseInt($("[name=reps]", r).value, 10) || 0 }));
  const anteprima = () => {
    const s = leggi().filter((x) => x.reps > 0);
    $$(".riga-serie", box).forEach((r, i) => { $(".n-serie", r).textContent = i + 1; $(".togli", r).hidden = $$(".riga-serie", box).length < 2; });
    if (!s.length) { $("#ant-forza", v).innerHTML = ""; return; }
    const best = s.reduce((a, x) => (forzaStimata(x.kg, x.reps) > forzaStimata(a.kg, a.reps) ? x : a));
    $("#ant-forza", v).innerHTML = best.kg > 0 ? `💪 Forza stimata: <b>${kgTesto(forzaStimata(best.kg, best.reps))}</b> <span class="muted">(${s.length > 1 ? `dalla serie migliore, ${kgCorto(best.kg)} kg × ${best.reps}` : "il peso che potresti sollevare una volta"})</span>` : `💪 Esercizio a corpo libero: conto le ripetizioni`;
  };
  const riga = (s = {}) => {
    box.insertAdjacentHTML("beforeend", `<div class="riga-serie"><span class="n-serie"></span>
      <input type="number" name="kg" inputmode="decimal" step="0.5" min="0" value="${s.kg ?? ""}" placeholder="0 = corpo libero" aria-label="Carico in kg">
      <input type="number" name="reps" inputmode="numeric" min="1" max="200" value="${s.reps || ""}" required aria-label="Ripetizioni">
      <button type="button" class="togli" aria-label="Togli serie">✕</button></div>`);
    const r = box.lastElementChild;
    $(".togli", r).onclick = () => { r.remove(); anteprima(); };
    $$("input", r).forEach((i) => (i.oninput = anteprima));
    return r;
  };
  const iniziali = voce ? (Array.isArray(e.set) && e.set.length ? e.set : Array.from({ length: Math.min(e.serie || 1, 20) }, () => ({ kg: e.kg, reps: e.reps }))) : [{}];
  iniziali.forEach((s) => riga(s)); anteprima();
  $("#piu-serie", v).onclick = () => { const s = leggi(), u = s[s.length - 1] || {}; const r = riga({ kg: u.kg || "", reps: u.reps || "" }); anteprima(); $("[name=kg]", r).focus(); $("[name=kg]", r).select?.(); };
  $$(".pronti [data-n]", v).forEach((b) => (b.onclick = () => { f.titolo.value = b.dataset.n; $("[name=kg]", box).focus(); }));
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const d = { titolo: f.titolo.value, data: f.data.value, commento: f.commento.value };
    const set = leggi().filter((x) => x.reps > 0);
    if (!set.length) { toast("⚠️ Indica le ripetizioni"); return; }
    const esistente = nomi.find((n) => chiaveEs(n) === chiaveEs(d.titolo));
    const best = set.reduce((a, x) => (forzaStimata(x.kg, x.reps) > forzaStimata(a.kg, a.reps) ? x : a));
    const dati = { tipo: "allenamento", titolo: esistente || d.titolo.trim(), data: d.data || oggiIso(), commento: d.commento,
      extra: set.length > 1 ? { kg: best.kg, reps: best.reps, serie: set.length, set } : { kg: best.kg, reps: best.reps, serie: null } };
    try { await api(voce ? `/api/diario/${voce.id}` : "/api/diario", { method: voce ? "PUT" : "POST", json: voce ? { ...voce, ...dati } : dati }); v.chiudi(); toast("💪 Salvato"); if (dopo) dopo(); }
    catch (err) { toast("⚠️ " + err.message); }
  };
  $("#del-es", v) && ($("#del-es", v).onclick = async () => {
    if (!(await conferma("Eliminare questa registrazione?"))) return;
    await api(`/api/diario/${voce.id}`, { method: "DELETE" }); v.chiudi(); toast("🗑️ Eliminata"); if (dopo) dopo();
  });
}

/* ================================================================== CORSA */
const d2 = (n) => String(n).padStart(2, "0");
const kmT = (n) => (Math.round((n || 0) * 100) / 100).toLocaleString("it-IT", { maximumFractionDigits: 2 });
const tempoTesto = (s) => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${d2(m)}:${d2(x)}` : `${m}:${d2(x)}`; };
const passoTesto = (s) => { if (!s) return "—"; s = Math.round(s); return `${Math.floor(s / 60)}:${d2(s % 60)}`; };
const ordinaCorse = (l) => l.slice().sort((a, b) => (a.data || "").localeCompare(b.data || "") || a.id - b.id);
function statCorse(corse) {
  const l = ordinaCorse(corse), mese = oggiIso().slice(0, 7);
  const km = l.reduce((t, x) => t + x.extra.km, 0), sec = l.reduce((t, x) => t + x.extra.secondi, 0);
  const valide = l.filter((x) => x.extra.km >= 1);   // il record di passo conta da 1 km in su
  return { l, n: l.length, km, sec, passo: km ? sec / km : null,
    migliore: (valide.length ? valide : l).reduce((a, x) => (x.extra.passo < a.extra.passo ? x : a), (valide.length ? valide : l)[0]),
    lunga: l.reduce((a, x) => (x.extra.km > a.extra.km ? x : a), l[0]),
    mese: l.filter((x) => (x.data || "").startsWith(mese)).reduce((t, x) => t + x.extra.km, 0) };
}
function ticksPasso(vals) {   // asse del passo con tacche "tonde" (es. 5:00 · 5:30 · 6:00), valori negativi = più in alto è più veloce
  const lo0 = Math.min(...vals), hi0 = Math.max(...vals), r = hi0 - lo0;
  const passo = [5, 10, 15, 30, 60, 120, 300].find((k) => (r + 2 * k) / k <= 6) || 600;
  const lo = Math.floor((lo0 - (r ? r * 0.1 : passo / 2)) / passo) * passo, hi = Math.ceil((hi0 + (r ? r * 0.1 : passo / 2)) / passo) * passo;
  const tickY = []; for (let v = lo; v <= hi + 0.1; v += passo) tickY.push(v);
  return { yMin: lo, yMax: hi, tickY };
}
const lunedi = (iso) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const piuGiorni = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function htmlCorsa(x, st) {
  const e = x.extra, d = new Date(x.data + "T00:00");
  const rec = st && st.n > 1 && x.id === st.migliore.id ? " · 🏆 miglior passo" : st && st.n > 1 && x.id === st.lunga.id ? " · 🏅 la più lunga" : "";
  return `<div class="voce" data-corsa="${x.id}"><div class="datebox" style="--c:var(--accent)"><div class="m">${MESI[d.getMonth()]}</div><div class="g">${d.getDate()}</div></div>
    <div class="corpo"><div class="tit">${kmT(e.km)} km · ${tempoTesto(e.secondi)}</div><div class="sub">${passoTesto(e.passo)} /km${rec}${x.commento ? " · " + esc(x.commento) : ""}</div></div><div class="dx">›</div></div>`;
}

async function vistaCorsa() {
  const corse = await api("/api/diario?tipo=corsa");
  const st = corse.length ? statCorse(corse) : null;
  app.innerHTML = htmlTestaPalestra("corsa", "Km, tempo e passo medio") + `
    ${st ? `<div class="bilancio"><div class="bil-top"><div><div class="bil-et">Km totali</div><div class="bil-num">${kmT(st.km)} km</div>
        <div class="bil-sub">${st.n} cors${st.n === 1 ? "a" : "e"} · ${tempoTesto(st.sec)} di corsa</div></div><div class="bil-ico">🏃</div></div>
      <div class="bil-griglia">
        <div><div class="bil-et">Passo medio</div><div class="bil-n">${passoTesto(st.passo)}</div><div class="bil-sub">min/km</div></div>
        <div><div class="bil-et">Miglior passo</div><div class="bil-n">${passoTesto(st.migliore.extra.passo)}</div><div class="bil-sub">${dataIt(st.migliore.data).replace(/ \d{4}$/, "")}</div></div>
        <div><div class="bil-et">La più lunga</div><div class="bil-n">${kmT(st.lunga.extra.km)} km</div><div class="bil-sub">${dataIt(st.lunga.data).replace(/ \d{4}$/, "")}</div></div>
        <div><div class="bil-et">Questo mese</div><div class="bil-n">${kmT(st.mese)} km</div></div>
      </div></div>` : ""}
    <button class="btn block" id="nuova-corsa" style="margin:4px 0 6px">➕ Registra una corsa</button>
    ${st && st.n >= 2 ? `<div class="grafico-card"><div class="g-tit">Passo medio</div><div id="g-passo"></div><p class="small muted" style="margin:6px 4px 2px">Minuti al km: più in alto = più veloce.</p></div>` : ""}
    ${st ? `<div class="grafico-card"><div class="g-tit">Km a settimana</div><div id="g-km"></div></div>` : ""}
    ${st && st.n >= 2 ? `<div class="grafico-card"><div class="g-tit">Km per corsa</div><div id="g-dist"></div></div>` : ""}
    ${st ? `<div class="sezione"><h2>Le mie corse</h2><span class="muted small">${st.n}</span></div>
      <div class="lista" id="corse">${st.l.slice().reverse().map((x) => htmlCorsa(x, st)).join("")}</div>`
      : `<div class="vuoto"><span class="big">🏃</span>Nessuna corsa ancora.<br>Tocca <b>Registra una corsa</b>: scrivi km e tempo, il passo lo calcolo io.</div>`}`;
  const ric = () => vistaCorsa();
  $("#nuova-corsa").onclick = () => registraCorsa(null, ric);
  $("#corse") && ($("#corse").onclick = (e) => { const v = e.target.closest("[data-corsa]"); if (v) registraCorsa(corse.find((x) => x.id === +v.dataset.corsa), ric); });
  const corto = (iso) => dataIt(iso).replace(/ \d{4}$/, "");
  if ($("#g-passo")) {
    const vals = st.l.map((x) => -Math.round(x.extra.passo));
    window.Grafici.linea($("#g-passo"), { categorie: st.l.map((x) => corto(x.data)), etichette: st.l.map((x) => `${corto(x.data)} · ${kmT(x.extra.km)} km in ${tempoTesto(x.extra.secondi)}`),
      serie: [{ nome: "Passo medio", slot: 1, tipo: "linea", punti: true, valori: vals }], ...ticksPasso(vals), formato: (v) => passoTesto(-v), titoloTabella: "Vedi i numeri in tabella" });
  }
  if ($("#g-km")) {
    const fine = lunedi(oggiIso()), sett = Array.from({ length: 12 }, (_, i) => piuGiorni(fine, (i - 11) * 7));
    const km = sett.map((w) => Math.round(st.l.filter((x) => lunedi(x.data) === w).reduce((t, x) => t + x.extra.km, 0) * 10) / 10);
    window.Grafici.colonne($("#g-km"), { categorie: sett.map(corto), serie: [{ nome: "Km", slot: 1, valori: km }], formato: (v) => kmT(v), titoloTabella: "Vedi i km in tabella",
      etichettaCategoria: (c) => c });
  }
  if ($("#g-dist")) {
    const ult = st.l.slice(-20);
    window.Grafici.colonne($("#g-dist"), { categorie: ult.map((x) => corto(x.data)), serie: [{ nome: "Km", slot: 3, valori: ult.map((x) => x.extra.km) }], formato: (v) => kmT(v), titoloTabella: "Vedi le corse in tabella" });
  }
}

/* Modulo: si scrivono due valori tra km, tempo e passo; il terzo lo calcolo io */
function registraCorsa(voce, dopo) {
  const e = voce?.extra || {}, t = Math.round(e.secondi || 0), pa = Math.round(e.passo || 0);
  const nm = (n, v, ph, extra = "") => `<input type="number" name="${n}" inputmode="numeric" min="0" ${extra} value="${v ?? ""}" placeholder="${ph}">`;
  const v = foglio(`<h3>🏃 ${voce ? "Modifica corsa" : "Registra una corsa"} ${xBtn}</h3>
    <p class="small muted" style="margin-top:-6px">Scrivi <b>due</b> di questi tre valori: il terzo lo calcolo io.</p>
    <form id="fco" novalidate>
      <label class="campo" data-g="km"><span>Distanza (km)</span><input type="number" name="km" inputmode="decimal" step="any" min="0" value="${e.km ?? ""}" placeholder="es. 5,2"></label>
      <div class="campo" data-g="tempo"><span>Tempo</span><div class="tempo-riga">${nm("th", t >= 3600 ? Math.floor(t / 3600) : "", "ore", 'max="48"')}<b>:</b>${nm("tm", t ? Math.floor((t % 3600) / 60) : "", "min", 'max="59"')}<b>:</b>${nm("ts", t ? t % 60 : "", "sec", 'max="59"')}</div></div>
      <div class="campo" data-g="passo"><span>Passo medio (min/km)</span><div class="tempo-riga passo">${nm("pm", pa ? Math.floor(pa / 60) : "", "min", 'max="30"')}<b>:</b>${nm("ps", pa ? pa % 60 : "", "sec", 'max="59"')}<span class="muted">/km</span></div></div>
      <div class="anteprima-forza" id="co-ant"></div>
      <label class="campo"><span>Data</span><input type="date" name="data" value="${esc(voce?.data || oggiIso())}"></label>
      <label class="campo"><span>Note <i class="muted">(facoltativo)</i></span><input type="text" name="commento" value="${esc(voce?.commento || "")}" placeholder="Es. lungomare, ripetute, gara…"></label>
      <button class="btn block">Salva</button>
      ${voce ? `<button type="button" class="btn danger block" id="co-del" style="margin-top:8px">🗑️ Elimina</button>` : ""}</form>`);
  const f = $("#fco", v);
  const n = (k) => (f[k].value === "" ? 0 : +f[k].value);
  const leggi = { km: () => (f.km.value === "" ? null : +f.km.value) || null, tempo: () => n("th") * 3600 + n("tm") * 60 + n("ts") || null, passo: () => n("pm") * 60 + n("ps") || null };
  const scrivi = {
    km: (x) => (f.km.value = Math.round(x * 100) / 100),
    tempo: (x) => { x = Math.round(x); f.th.value = x >= 3600 ? Math.floor(x / 3600) : ""; f.tm.value = Math.floor((x % 3600) / 60); f.ts.value = x % 60; },
    passo: (x) => { x = Math.round(x); f.pm.value = Math.floor(x / 60); f.ps.value = x % 60; },
  };
  let ordine = [];
  const calcola = () => {
    $$("[data-g]", v).forEach((g) => g.classList.remove("auto"));
    // tengo ferma la distanza quando possibile: si ricalcola il passo, oppure il tempo se hai cambiato il passo
    const L = ordine[0], km = leggi.km(), te = leggi.tempo(), pa = leggi.passo();
    const c = L === "passo" ? (km ? "tempo" : "km") : L === "km" ? (te ? "passo" : "tempo") : L === "tempo" ? (km ? "passo" : "km") : null;
    const servono = { passo: km && te, tempo: km && pa, km: te && pa };
    if (c && servono[c]) {
      if (c === "passo") scrivi.passo(te / km); else if (c === "tempo") scrivi.tempo(km * pa); else scrivi.km(te / pa);
      $(`[data-g=${c}]`, v).classList.add("auto");
    }
    const kmF = leggi.km(), teF = leggi.tempo();
    $("#co-ant", v).innerHTML = kmF && teF ? `🏃 <b>${kmT(kmF)} km</b> in <b>${tempoTesto(teF)}</b> · passo <b>${passoTesto(teF / kmF)} /km</b> · ${(kmF / (teF / 3600)).toLocaleString("it-IT", { maximumFractionDigits: 1 })} km/h` : "";
  };
  $$("[data-g]", v).forEach((g) => g.addEventListener("input", () => { ordine = [g.dataset.g, ...ordine.filter((x) => x !== g.dataset.g)]; calcola(); }));
  calcola();
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const km = leggi.km(), te = leggi.tempo();
    if (!km || !te) { toast("Scrivi due valori tra distanza, tempo e passo"); return; }
    const dati = { tipo: "corsa", titolo: "Corsa", data: f.data.value || oggiIso(), commento: f.commento.value.trim(), extra: { km, secondi: te } };
    try {
      const prima = (await api("/api/diario?tipo=corsa")).filter((x) => x.id !== voce?.id && x.extra.km >= 1);
      const x = await api(voce ? `/api/diario/${voce.id}` : "/api/diario", { method: voce ? "PUT" : "POST", json: voce ? { ...voce, ...dati } : dati });
      const rec = prima.length && x.extra.km >= 1 && x.extra.passo < Math.min(...prima.map((y) => y.extra.passo));
      v.chiudi(); toast(rec ? `🏆 Nuovo record di passo: ${passoTesto(x.extra.passo)} /km!` : `🏃 Salvata: ${kmT(x.extra.km)} km a ${passoTesto(x.extra.passo)} /km`, 3500); if (dopo) dopo();
    } catch (err) { toast("⚠️ " + err.message); }
  };
  $("#co-del", v) && ($("#co-del", v).onclick = async () => {
    if (!(await conferma("Eliminare questa corsa?"))) return;
    await api(`/api/diario/${voce.id}`, { method: "DELETE" }); v.chiudi(); toast("🗑️ Eliminata"); if (dopo) dopo();
  });
}

memo.set("strava", null); memo.set("cibi", null);   // pulizia di funzioni tolte

function aggiornaCorpo(prof, pAtt, dopo) {
  const v = foglio(`<h3>⚖️ Peso e altezza ${xBtn}</h3><form id="fc">
    <div class="riga"><label class="campo"><span>Peso di oggi (kg)</span><input type="number" name="peso" inputmode="decimal" step="0.1" min="20" max="400" value="" placeholder="${pAtt ? pAtt.extra.peso : "es. 72,5"}"></label>
      <label class="campo"><span>Altezza (cm)</span><input type="number" name="altezza" inputmode="numeric" min="100" max="230" value="${esc(prof.altezza || "")}" placeholder="es. 178"></label></div>
    <p class="small muted" style="margin:-4px 4px 12px">Ogni peso che inserisci viene salvato con la data, così vedi l'andamento nel grafico.</p>
    <button class="btn block">Salva</button></form>`);
  setTimeout(() => $("[name=peso]", v).focus(), 80);
  $("#fc", v).onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    try {
      if (d.peso) await api("/api/diario", { method: "POST", json: { tipo: "peso", titolo: "Peso", data: oggiIso(), extra: { peso: +d.peso } } });
      if (d.altezza && d.altezza !== String(prof.altezza || "")) await api("/api/profilo", { method: "PUT", json: { ...prof, altezza: d.altezza } });
      v.chiudi(); toast("✅ Salvato"); if (dopo) dopo();
    } catch (err) { toast("⚠️ " + err.message); }
  };
}

/* ================================================================== DIARIO: film, libri, serie, compleanni */
const TIPI_D = {
  film: { ico: "🎬", nome: "Film", plurale: "Film visti", verbo: "visto il", vuoto: "Scrivi in chat: “stasera ho visto After”" },
  libro: { ico: "📚", nome: "Libri", plurale: "Libri letti", verbo: "letto il", vuoto: "Scrivi in chat: “ho letto Il nome della rosa”" },
  serie: { ico: "📺", nome: "Serie TV", plurale: "Serie viste", verbo: "vista il", vuoto: "Scrivi in chat: “ho finito la serie Stranger Things”" },
  compleanno: { ico: "🎂", nome: "Compleanni", plurale: "Compleanni", verbo: "", vuoto: "Scrivi in chat: “il 6 agosto è il compleanno di Marco Rossi”" },
  esame: { ico: "🎓", nome: "Esami", plurale: "Esami superati", verbo: "", vuoto: "Scrivi in chat: “ho passato l'esame di Analisi 1 con 28”" },
  acquisto: { ico: "💶", nome: "Acquisti", plurale: "Acquisti", verbo: "", vuoto: "Scrivi in chat: “ho comprato una maglia a 40 euro” e poi “ho venduto la maglia a 50 euro”" },
};
const CATEGORIE_ACQ = { vestiti: "👕 Vestiti", veicoli: "🚗 Veicoli", tecnologia: "📱 Tecnologia", casa: "🛋️ Casa", collezionismo: "🃏 Collezionismo", altro: "📦 Altro" };
const euro = (n) => (n == null ? "—" : n.toLocaleString("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }));
const segno = (n) => (n > 0 ? "+" : "") + euro(n);
const votoTesto = (e) => { const c = esameCalcolato(e); return c.lode ? "30 e lode" : votoBreve(c.voto); };
function bilancio(lista) {
  const b = { speso: 0, incassato: 0, spesoRiv: 0, incassatoRiv: 0, nRiv: 0, magazzino: 0, nMag: 0 };
  for (const x of lista) {
    const e = x.extra || {}, p = e.prezzo || 0;
    b.speso += p;
    if (e.vendita != null) { b.incassato += e.vendita; if (e.prezzo != null) { b.spesoRiv += p; b.incassatoRiv += e.vendita; b.nRiv++; } }
    else { b.magazzino += p; b.nMag++; }
  }
  b.saldo = b.incassato - b.speso; b.guadagno = b.incassatoRiv - b.spesoRiv;
  return b;
}
/* Un esame può essere classico (un voto) o diviso in moduli (es. 12 CFU = 2 moduli da 6, ognuno col suo voto):
   il voto finale è la media dei moduli pesata sui crediti, e conta solo quando tutti i moduli sono superati. */
function esameCalcolato(e) {
  e = e || {};
  if (e.esito) return { voto: null, cfu: e.cfu || 0, completo: e.esito === "idoneo", fatti: e.esito === "idoneo" ? 1 : 0, totali: 1, lode: false, moduli: null, idoneita: true, esito: e.esito };
  if (e.moduli && e.moduli.length) {
    const cfu = e.moduli.reduce((a, m) => a + (m.cfu || 6), 0);
    const fatti = e.moduli.filter((m) => m.voto).length, completo = fatti === e.moduli.length;
    return { voto: completo ? e.moduli.reduce((a, m) => a + m.voto * (m.cfu || 6), 0) / cfu : null, cfu, completo, fatti, totali: e.moduli.length,
      lode: completo && e.moduli.every((m) => m.lode), moduli: e.moduli };
  }
  return { voto: e.voto ?? null, cfu: e.cfu || 6, completo: e.voto != null, fatti: 1, totali: 1, lode: !!e.lode, moduli: null };
}
const votoBreve = (v) => (v == null ? "⏳" : Number.isInteger(v) ? String(v) : dec(v, 1));
function statEsami(lista) {
  const tutti = lista.map((x) => esameCalcolato(x.extra)), v = tutti.filter((e) => e.completo && !e.idoneita);
  const idonei = tutti.filter((e) => e.idoneita && e.completo);
  const cfu = v.reduce((a, e) => a + e.cfu, 0) + idonei.reduce((a, e) => a + e.cfu, 0);
  const cfuVoto = v.reduce((a, e) => a + e.cfu, 0);
  const media = v.length ? v.reduce((a, e) => a + e.voto, 0) / v.length : null;
  const ponderata = cfuVoto ? v.reduce((a, e) => a + e.voto * e.cfu, 0) / cfuVoto : null;
  return { n: v.length, idonei: idonei.length, inCorso: tutti.filter((e) => !e.completo && !e.idoneita).length, nonIdonei: tutti.filter((e) => e.idoneita && !e.completo).length, media, ponderata, cfu, base: ponderata ? (ponderata * 110) / 30 : null, lodi: v.filter((e) => e.lode).length };
}
const dec = (n, c = 2) => (n == null ? "—" : n.toLocaleString("it-IT", { minimumFractionDigits: c, maximumFractionDigits: c }));
const stelle = (v) => (v ? "★".repeat(v) + "☆".repeat(5 - v) : "");
function prossimoComp(x) {
  const o = new Date(oggiIso() + "T00:00");
  let d = new Date(o.getFullYear(), x.mese - 1, x.giorno);
  if (d < o) d = new Date(o.getFullYear() + 1, x.mese - 1, x.giorno);
  return d;
}
function infoComp(x) {
  const d = prossimoComp(x), g = Math.round((d - new Date(oggiIso() + "T00:00")) / 86400000);
  const anni = x.anno ? d.getFullYear() - x.anno : null;
  const quando = g === 0 ? "🎉 Oggi!" : g === 1 ? "Domani" : `Tra ${g} giorni`;
  return { d, g, anni, quando, testo: `${x.giorno} ${MESI_L[x.mese - 1]}${anni ? ` · compie ${anni} anni` : ""}` };
}
function htmlVoceDiario(x) {
  if (x.tipo === "compleanno") {
    const i = infoComp(x);
    return `<div class="voce" data-dv="${x.id}"><div class="datebox" style="--c:#ec4899"><div class="m">${MESI[x.mese - 1]}</div><div class="g">${x.giorno}</div></div>
      <div class="corpo"><div class="tit">🎂 ${esc(x.titolo)}</div><div class="sub">${esc(i.testo)}</div>
      <div style="margin-top:4px"><span class="tag ${i.g <= 1 ? "danger" : i.g <= 14 ? "warn" : ""}">${i.quando}</span></div></div><div class="dx">›</div></div>`;
  }
  if (x.tipo === "esame") {
    const c = esameCalcolato(x.extra);
    if (c.idoneita) return `<div class="voce" data-dv="${x.id}"><div class="voto-esame ${c.completo ? "idoneo" : "non-idoneo"}">${c.completo ? "✓" : "✗"}</div>
      <div class="corpo"><div class="tit">${esc(x.titolo)}</div><div class="sub">${[c.completo ? "Idoneo" : "Non idoneo", c.cfu ? `${c.cfu} CFU` : "", x.data ? dataIt(x.data) : ""].filter(Boolean).join(" · ")}</div>
      ${x.commento ? `<div class="commento">“${esc(x.commento)}”</div>` : ""}</div><div class="dx">›</div></div>`;
    const dettaglio = c.moduli ? c.moduli.map((m) => `<span class="mod ${m.voto ? "ok" : ""}">${esc(m.nome)}: <b>${m.voto ? (m.lode ? "30L" : m.voto) : "—"}</b> <i>${m.cfu || 6} CFU</i></span>`).join("") : "";
    return `<div class="voce" data-dv="${x.id}"><div class="voto-esame ${c.lode ? "lode" : ""} ${c.completo ? "" : "attesa"}">${votoBreve(c.voto)}${c.lode ? "<small>L</small>" : ""}</div>
      <div class="corpo"><div class="tit">${esc(x.titolo)}</div><div class="sub">${[`${c.cfu} CFU`, c.moduli ? (c.completo ? `${c.totali} moduli` : `in corso: ${c.fatti}/${c.totali} moduli`) : "", x.data ? dataIt(x.data) : ""].filter(Boolean).join(" · ")}</div>
      ${dettaglio ? `<div class="moduli-riga">${dettaglio}</div>` : ""}
      ${x.commento ? `<div class="commento">“${esc(x.commento)}”</div>` : ""}</div><div class="dx">›</div></div>`;
  }
  if (x.tipo === "acquisto") {
    const e = x.extra || {}, venduto = e.vendita != null, diff = venduto && e.prezzo != null ? e.vendita - e.prezzo : null;
    return `<div class="voce" data-dv="${x.id}"><div class="thumb poster" style="--c:${venduto ? "#22c55e" : "#a855f7"}">${(CATEGORIE_ACQ[e.categoria] || "📦").split(" ")[0]}</div>
      <div class="corpo"><div class="tit">${esc(x.titolo)}</div>
      <div class="sub">🛒 Pagato <b>${euro(e.prezzo)}</b>${x.data ? " il " + dataIt(x.data) : ""}</div>
      ${venduto ? `<div class="sub">💰 Venduto <b>${euro(e.vendita)}</b>${e.data_vendita ? " il " + dataIt(e.data_vendita) : ""}</div>` : `<div class="sub muted">Non ancora venduto</div>`}</div>
      ${diff != null ? `<div class="delta ${diff >= 0 ? "su" : "giu"}">${segno(diff)}</div>` : `<div class="dx">›</div>`}</div>`;
  }
  const t = TIPI_D[x.tipo], cop = x.extra?.copertina;
  return `<div class="voce" data-dv="${x.id}"><div class="thumb poster ${cop ? "con-cop" : ""}" style="--c:${COLORI[(x.titolo.charCodeAt(0) || 0) % COLORI.length]}">${cop
      ? `<img loading="lazy" src="${esc(cop)}" alt="" referrerpolicy="no-referrer" onerror="this.parentNode.classList.remove('con-cop');this.replaceWith('${t.ico}')">` : t.ico}</div>
    <div class="corpo"><div class="tit">${esc(x.titolo)}</div>
    <div class="sub">${[x.autore ? esc(x.autore) : "", x.stato === "in corso" ? "📖 in corso" : "", x.data ? dataIt(x.data) : ""].filter(Boolean).join(" · ")}</div>
    ${x.extra?.attori?.length ? `<div class="cast-riga">👥 ${x.extra.attori.slice(0, 3).map((a) => esc(a.nome)).join(" · ")}</div>` : ""}
    ${x.voto ? `<div class="stelle">${stelle(x.voto)}</div>` : ""}
    ${x.commento ? `<div class="commento">“${esc(x.commento)}”</div>` : ""}</div><div class="dx">›</div></div>`;
}
const iniziali = (n) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
const facciaAttore = (a, cls = "cast-ini") => `<span class="${cls}"><span>${esc(iniziali(a.nome))}</span>${a.foto ? `<img src="${esc(a.foto)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}</span>`;
function htmlCast(x) {
  if (!["film", "serie"].includes(x.tipo) || !x.id) return "";
  const l = x.extra?.attori || [];
  if (!l.length) return `<div class="cast vuoto"><button type="button" class="link-btn" id="cerca-attori">👥 ${x.extra?.attori_cercati ? "Cerca di nuovo gli attori" : "Cerca gli attori principali"}</button></div>`;
  return `<div class="cast"><div class="cast-tit">👥 Attori principali</div><div class="cast-griglia" id="cast-griglia">${l.map((a, i) => `<button type="button" class="cast-a" data-att="${i}">${facciaAttore(a)}
    <span class="cast-n"><b>${esc(a.nome)}</b><small>${a.anno ? `classe ${a.anno}` : "anno non noto"}</small></span></button>`).join("")}</div>
    <div class="cast-fonte">Tocca un attore per vederlo in grande · Fonte: Wikidata</div></div>`;
}
function apriAttore(a) {
  const eta = a.anno ? new Date().getFullYear() - a.anno : null;
  const grande = a.foto ? { ...a, foto: a.foto.replace(/width=\d+/, "width=900") } : a;
  foglio(`<div class="attore">${facciaAttore(grande, "attore-foto")}
    <div class="attore-testo"><h3>${esc(a.nome)}</h3>${a.descr ? `<p>${esc(a.descr[0].toUpperCase() + a.descr.slice(1))}</p>` : ""}
      <div class="attore-dati">${a.anno ? `<span><small>Anno di nascita</small><b>${a.anno}</b></span><span><small>Età</small><b>circa ${eta} anni</b></span>` : `<span><small>Anno di nascita</small><b>non noto</b></span>`}</div>
      ${a.id ? `<a class="btn sec block" href="https://www.wikidata.org/wiki/Special:GoToLinkedPage/itwiki/${esc(a.id)}" target="_blank" rel="noopener">Apri su Wikipedia</a>` : ""}
      <button class="btn block" data-chiudi style="margin-top:8px">Chiudi</button></div></div>`, { classe: "foglio-attore" });
}

/* Menu principale del Diario: un riquadro per sezione, con un'anteprima di cosa c'è dentro */
const COLORI_D = { film: ["#6d28d9", "#db2777"], libro: ["#0369a1", "#0891b2"], serie: ["#b91c1c", "#ea580c"], compleanno: ["#be185d", "#f59e0b"], esame: ["#1d4ed8", "#7c3aed"], acquisto: ["#047857", "#0d9488"] };
async function vistaDiarioMenu() {
  const tutte = await api("/api/diario");
  const di = (t) => tutte.filter((x) => x.tipo === t).sort((a, b) => (b.data || "").localeCompare(a.data || "") || b.id - a.id);
  const comp = di("compleanno").map((x) => ({ x, i: infoComp(x) })).sort((a, b) => a.i.g - b.i.g)[0];
  const st = statEsami(di("esame")), bil = bilancio(di("acquisto")), inCorso = di("libro").find((x) => x.stato === "in corso");
  const sotto = {
    film: di("film")[0] ? `Ultimo: ${di("film")[0].titolo}` : "I film che hai visto",
    libro: inCorso ? `Stai leggendo: ${inCorso.titolo}` : di("libro")[0] ? `Ultimo: ${di("libro")[0].titolo}` : "I libri che hai letto",
    serie: di("serie")[0] ? `Ultima: ${di("serie")[0].titolo}` : "Le serie che hai visto",
    compleanno: comp ? `${comp.x.titolo} · ${comp.i.quando.replace("🎉 ", "").toLowerCase()}` : "Non dimenticarne nessuno",
    esame: st.n ? `Media ${dec(st.ponderata ?? st.media, 2)} · ${st.cfu} CFU` : "Voti, crediti e media",
    acquisto: di("acquisto").length ? `Bilancio ${segno(Math.round(bil.saldo))}` : "Spese e rivendite",
  };
  const copertine = (t) => di(t).filter((x) => x.extra?.copertina).slice(0, 3).map((x) => x.extra.copertina);
  app.innerHTML = `<div class="top"><h1>Diario<small>La tua vita, in un posto solo</small></h1></div>
    <div class="diario-menu">${Object.entries(TIPI_D).map(([k, v]) => `<a class="dm-tile" href="#/diario/${k}" style="--a:${COLORI_D[k][0]};--b:${COLORI_D[k][1]}">
      <span class="dm-alto"><span class="dm-ico">${v.ico}</span><span class="dm-n">${di(k).length}</span></span>
      ${copertine(k).length ? `<span class="dm-cop">${copertine(k).map((u) => `<img src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`).join("")}</span>` : ""}
      <span class="dm-testo"><b>${v.nome}</b><small>${esc(sotto[k])}</small></span></a>`).join("")}</div>`;
}
async function vistaDiario(tipo) {
  tipo = TIPI_D[tipo] ? tipo : "film";
  const tutte = await api("/api/diario");
  const conta = (t) => tutte.filter((x) => x.tipo === t).length;
  let lista = tutte.filter((x) => x.tipo === tipo);
  const t = TIPI_D[tipo];
  const filtro = tipo === "acquisto" ? memo.get("filtro-acq") || "tutti" : null;
  const tuttiAcq = lista;
  if (filtro === "venduti") lista = lista.filter((x) => x.extra?.vendita != null);
  if (filtro === "da-vendere") lista = lista.filter((x) => x.extra?.vendita == null);
  app.innerHTML = `<div class="top"><a class="iconbtn" href="#/diario" aria-label="Diario">‹</a><h1>${t.ico} ${t.nome}<small>${conta(tipo) ? `${conta(tipo)} nel diario` : "Ancora vuoto"}</small></h1></div>

    ${tipo === "acquisto" && tuttiAcq.length ? htmlBilancio(bilancio(tuttiAcq), filtro) + `<div class="grafico-card"><div class="g-tit">Spese e incassi mese per mese</div><div id="g-acq"></div></div>` : ""}
    ${tipo === "esame" && lista.length && (statEsami(lista).n || statEsami(lista).idonei) ? htmlStatEsami(statEsami(lista)) + `<div class="grafico-card"><div class="g-tit">Andamento dei voti</div><div id="g-voti"></div></div>` : ""}
    ${tipo === "compleanno" ? `<div class="riga" style="margin:4px 0 12px"><button class="btn sec" id="imp-comp">📥 Importa dai Promemoria</button>${lista.length ? `<button class="btn sec" id="cal-comp">🔔 Notifiche</button>` : ""}</div>` : ""}
    ${lista.length ? `<div class="lista" id="dl">${lista.map(htmlVoceDiario).join("")}</div>`
      : `<div class="vuoto"><span class="big">${t.ico}</span>Ancora niente qui.<br>Tocca <b>＋</b> per aggiungere.</div>`}`;
  $("#dl") && ($("#dl").onclick = (e) => { const v = e.target.closest("[data-dv]"); if (v) modificaVoceDiario(lista.find((x) => x.id === +v.dataset.dv), () => vistaDiario(tipo)); });
  if (["film", "libro", "serie"].includes(tipo)) cercaCopertineMancanti(lista, () => vistaDiario(tipo));
  $("#cal-comp") && ($("#cal-comp").onclick = () => notificheCompleanni(lista));
  $$("[data-filtro]").forEach((b) => (b.onclick = () => { memo.set("filtro-acq", b.dataset.filtro); vistaDiario("acquisto"); }));
  $("#g-acq") && graficoAcquisti($("#g-acq"), tuttiAcq);
  $("#g-voti") && graficoVoti($("#g-voti"), lista);
  window.Grafici.conta(app);
  $("#imp-comp") && ($("#imp-comp").onclick = () => importaCompleanni(() => vistaDiario("compleanno")));
  const b = document.createElement("button"); b.className = "fab"; b.innerHTML = "<span>＋</span>";
  b.onclick = () => modificaVoceDiario({ tipo, data: oggiIso(), extra: {} }, () => vistaDiario(tipo)); app.appendChild(b);
}
/* ------------------------------------------------------------------ copertine automatiche */
const copertineAttive = () => memo.get("copertine") !== "no";
let cercandoCopertine = false;
const VERS_ATTORI = 2;
async function cercaCopertineMancanti(lista, dopo) {
  if (!copertineAttive() || cercandoCopertine || !navigator.onLine) return;
  const serveCop = (x) => !x.extra?.copertina && !x.extra?.copertina_cercata;
  const serveAtt = (x) => ["film", "serie"].includes(x.tipo) && x.extra?.attori_v !== VERS_ATTORI;   // nuova ricerca (con le foto) anche per chi era già stato cercato
  const daFare = lista.filter((x) => ["film", "libro", "serie"].includes(x.tipo) && (serveCop(x) || serveAtt(x))).slice(0, 8);
  if (!daFare.length) return;
  cercandoCopertine = true;
  let trovate = 0;
  try {
    for (const x of daFare) {
      const agg = {};
      if (serveCop(x)) {
        const c = await window.Copertine.cerca(x.tipo, x.titolo, x.autore);
        if (c !== null) { agg.copertina = c[0]?.url || null; agg.copertina_cercata = true; if (c[0]) trovate++; }   // null: servizio non raggiungibile, riproverò
      }
      if (serveAtt(x)) {
        const at = await window.Copertine.attori(x.tipo, x.titolo);
        if (at !== null) { agg.attori = at; agg.attori_cercati = true; agg.attori_v = VERS_ATTORI; if (at.length) trovate++; }
      }
      if (!Object.keys(agg).length) continue;
      // rileggo la voce aggiornata, così non cancello un commento o un voto aggiunto nel frattempo
      const ora = (await api(`/api/diario?tipo=${x.tipo}`, { fresco: true })).find((y) => y.id === x.id);
      if (!ora) continue;
      if (ora.extra?.copertina) { delete agg.copertina; delete agg.copertina_cercata; }
      if (!Object.keys(agg).length) continue;
      await api(`/api/diario/${x.id}`, { method: "PUT", json: { ...ora, extra: { ...(ora.extra || {}), ...agg } } });
      await window.Copertine.attesa(400);
    }
  } finally { cercandoCopertine = false; }
  if (trovate && dopo && location.hash.startsWith("#/diario") && !$(".velo")) dopo();
}
function sceltaCopertina(x, dopo) {
  const v = foglio(`<h3>🖼️ Copertina · ${esc(x.titolo)} ${xBtn}</h3><p class="muted small" style="margin-top:-8px">Cerco su Wikipedia${x.tipo === "libro" ? ", Open Library e Apple Books" : ""}… tocca quella giusta.</p>
    <div class="copertine" id="cop-lista"><div class="muted small">Ricerca in corso…</div></div>
    <div class="riga" style="margin-top:12px"><button class="btn sec" id="cop-foto">📷 Usa una mia foto</button>${x.extra?.copertina ? `<button class="btn danger" id="cop-togli">Togli</button>` : ""}</div>`);
  const salva = async (url) => {
    await api(`/api/diario/${x.id}`, { method: "PUT", json: { ...x, extra: { ...(x.extra || {}), copertina: url, copertina_cercata: true } } });
    v.chiudi(); toast(url ? "🖼️ Copertina aggiornata" : "Copertina tolta"); if (dopo) dopo();
  };
  window.Copertine.cerca(x.tipo, x.titolo, x.autore).then((c) => {
    c = c || [];
    $("#cop-lista", v).innerHTML = c.length ? c.map((k, i) => `<button data-i="${i}" title="${esc(k.fonte)}"><img src="${esc(k.url)}" alt="" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></button>`).join("")
      : `<div class="muted small">Non ho trovato copertine${navigator.onLine ? "" : " (sei senza connessione)"}. Puoi usare una tua foto.</div>`;
    $$("#cop-lista [data-i]", v).forEach((b) => (b.onclick = () => salva(c[+b.dataset.i].url)));
  });
  $("#cop-foto", v).onclick = () => {
    const inp = $("#file-input"); inp.value = ""; inp.accept = "image/*"; inp.removeAttribute("capture");
    inp.onchange = async () => { if (inp.files[0]) salva(await window.Copertine.riduci(inp.files[0])); };
    inp.click();
  };
  $("#cop-togli", v) && ($("#cop-togli", v).onclick = () => salva(null));
}

/* ------------------------------------------------------------------ grafici */
function ultimiMesi(n = 12) {
  const o = new Date(), out = [];
  for (let i = n - 1; i >= 0; i--) { const d = new Date(o.getFullYear(), o.getMonth() - i, 1); out.push({ k: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, nome: `${MESI[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, breve: MESI[d.getMonth()] }); }
  return out;
}
function graficoVoti(el, esami) {
  const fatti = esami.map((x) => ({ x, c: esameCalcolato(x.extra) })).filter((e) => e.c.completo && !e.c.idoneita)
    .sort((a, b) => (a.x.data || a.x.creato || "").localeCompare(b.x.data || b.x.creato || ""));
  if (fatti.length < 2) { el.closest(".grafico-card")?.remove(); return; }
  let somma = 0, cfu = 0;
  const media = fatti.map((e) => { somma += e.c.voto * e.c.cfu; cfu += e.c.cfu; return somma / cfu; });
  window.Grafici.linea(el, {
    categorie: fatti.map((e) => (e.x.data ? dataIt(e.x.data).replace(/ \d{4}$/, "") : "")),
    etichette: fatti.map((e) => e.x.titolo),
    serie: [{ nome: "Voto", slot: 1, tipo: "punti", valori: fatti.map((e) => e.c.voto) }, { nome: "Media ponderata", slot: 2, tipo: "linea", valori: media }],
    yMin: 18, yMax: 30, tickY: [18, 22, 26, 30],
    formato: (v, asse) => (asse || Number.isInteger(v) ? String(Math.round(v * 100) / 100).replace(".", ",") : dec(v, 2)),
    titoloTabella: "Vedi i voti in tabella",
  });
}
function graficoAcquisti(el, acquisti) {
  const mesi = ultimiMesi(12);
  const speso = mesi.map((m) => acquisti.filter((x) => (x.data || "").startsWith(m.k)).reduce((a, x) => a + (x.extra?.prezzo || 0), 0));
  const incassato = mesi.map((m) => acquisti.filter((x) => (x.extra?.data_vendita || "").startsWith(m.k)).reduce((a, x) => a + (x.extra?.vendita || 0), 0));
  const primo = mesi.findIndex((_, i) => speso[i] || incassato[i]);
  if (primo < 0) { el.closest(".grafico-card")?.remove(); return; }
  const da = Math.min(primo, mesi.length - 6);
  window.Grafici.colonne(el, {
    categorie: mesi.slice(da).map((m) => m.nome), etichettaCategoria: (c) => c.split(" ")[0],
    serie: [{ nome: "Speso", slot: 1, valori: speso.slice(da) }, { nome: "Incassato", slot: 2, valori: incassato.slice(da) }],
    formato: (v, asse) => (asse && v >= 1000 ? Math.round(v / 100) / 10 + "K" : euro(v)), titoloTabella: "Vedi i numeri mese per mese",
  });
}
function graficoVita(el, diario) {
  const mesi = ultimiMesi(12);
  const conta = (tipo) => mesi.map((m) => diario.filter((x) => x.tipo === tipo && (x.data || x.creato || "").startsWith(m.k)).length);
  const serie = [{ nome: "Film", slot: 1, valori: conta("film") }, { nome: "Libri", slot: 2, valori: conta("libro") }, { nome: "Serie TV", slot: 3, valori: conta("serie") }];
  const primo = mesi.findIndex((_, i) => serie.some((x) => x.valori[i]));
  if (primo < 0) { el.closest(".grafico-card")?.remove(); return; }
  const da = Math.min(primo, mesi.length - 6);
  serie.forEach((x) => (x.valori = x.valori.slice(da)));
  window.Grafici.colonne(el, { categorie: mesi.slice(da).map((m) => m.nome), etichettaCategoria: (c) => c.split(" ")[0], serie, formato: (v) => String(Math.round(v)), titoloTabella: "Vedi i numeri mese per mese" });
}

function htmlBilancio(b, filtro) {
  return `<div class="bilancio">
    <div class="bil-top"><div><div class="bil-et">Bilancio complessivo</div><div class="bil-num ${b.saldo >= 0 ? "su" : "giu"}">${segno(b.saldo)}</div>
      <div class="bil-sub">Spesi ${euro(b.speso)} · incassati ${euro(b.incassato)}</div></div><div class="bil-ico">💶</div></div>
    <div class="bil-griglia">
      <div><div class="bil-et">Comprato e rivenduto</div><div class="bil-n ${b.guadagno >= 0 ? "su" : "giu"}">${segno(b.guadagno)}</div><div class="bil-sub">${b.nRiv} cos${b.nRiv === 1 ? "a" : "e"}: ${euro(b.spesoRiv)} → ${euro(b.incassatoRiv)}</div></div>
      <div><div class="bil-et">Ancora da vendere</div><div class="bil-n">${euro(b.magazzino)}</div><div class="bil-sub">${b.nMag} cos${b.nMag === 1 ? "a" : "e"} pagat${b.nMag === 1 ? "a" : "e"}</div></div>
    </div></div>
    <div class="filtri">${[["tutti", "Tutti"], ["da-vendere", "Da vendere"], ["venduti", "Venduti"]].map(([k, n]) => `<button class="chip ${filtro === k ? "on" : ""}" data-filtro="${k}">${n}</button>`).join("")}</div>`;
}
function htmlStatEsami(st) {
  return `<div class="bilancio">
    <div class="bil-top"><div><div class="bil-et">Media ${st.ponderata ? "ponderata" : ""}</div><div class="bil-num" data-conta="${st.ponderata ?? st.media ?? ""}" data-dec="2">${dec(st.ponderata ?? st.media)}</div>
      <div class="bil-sub">${st.n} esam${st.n === 1 ? "e" : "i"} superat${st.n === 1 ? "o" : "i"}${st.lodi ? ` · ${st.lodi} lod${st.lodi === 1 ? "e" : "i"} ✨` : ""}${st.inCorso ? ` · ${st.inCorso} in corso` : ""}${st.idonei ? ` · ${st.idonei} idoneit${st.idonei === 1 ? "à" : "à"} ✓` : ""}</div></div><div class="bil-ico">🎓</div></div>
    <div class="bil-griglia">
      <div><div class="bil-et">Media aritmetica</div><div class="bil-n">${dec(st.media)}</div></div>
      <div><div class="bil-et">Crediti</div><div class="bil-n">${st.cfu || "—"}</div></div>
      <div><div class="bil-et">Base di laurea</div><div class="bil-n">${dec(st.base, 1)}</div><div class="bil-sub">su 110</div></div>
    </div></div>`;
}

function modificaVoceDiario(x, dopo) {
  if (x.tipo === "esame" || x.tipo === "acquisto") return modificaVoceSpeciale(x, dopo);
  const comp = x.tipo === "compleanno", t = TIPI_D[x.tipo];
  let voto = x.voto || 0;
  const cop = x.extra?.copertina;
  const v = foglio(`<h3>${t.ico} ${x.id ? esc(x.titolo) : comp ? "Nuovo compleanno" : "Aggiungi " + t.nome.toLowerCase()} ${xBtn}</h3>
    ${x.id && !comp ? `<div class="scheda-cop"><button type="button" id="cambia-cop" class="cop-grande">${cop ? `<img src="${esc(cop)}" alt="" referrerpolicy="no-referrer">` : `<span>${t.ico}</span>`}<i>🖼️ ${cop ? "Cambia" : "Aggiungi"} copertina</i></button></div>` : ""}<form id="fd">
    ${htmlCast(x)}
    <label class="campo"><span>${comp ? "Nome" : "Titolo"}</span><input type="text" name="titolo" value="${esc(x.titolo || "")}" required placeholder="${comp ? "Es. Marco Rossi" : ""}"></label>
    ${comp ? `<div class="riga"><label class="campo"><span>Giorno</span><select name="giorno">${Array.from({ length: 31 }, (_, i) => `<option ${x.giorno === i + 1 ? "selected" : ""}>${i + 1}</option>`).join("")}</select></label>
      <label class="campo" style="flex:2"><span>Mese</span><select name="mese">${MESI_L.map((m, i) => `<option value="${i + 1}" ${x.mese === i + 1 ? "selected" : ""}>${m}</option>`).join("")}</select></label>
      <label class="campo"><span>Anno <i class="muted">(facolt.)</i></span><input type="number" name="anno" inputmode="numeric" min="1900" max="2100" value="${x.anno || ""}"></label></div>`
    : `${x.tipo === "libro" ? `<label class="campo"><span>Autore</span><input type="text" name="autore" value="${esc(x.autore || "")}"></label>
        <label class="campo"><span>Stato</span><select name="stato"><option value="">Letto</option><option value="in corso" ${x.stato === "in corso" ? "selected" : ""}>Sto leggendo</option><option value="da leggere" ${x.stato === "da leggere" ? "selected" : ""}>Da leggere</option></select></label>` : ""}
      <label class="campo"><span>${x.tipo === "libro" ? "Quando" : "Visto il"}</span><input type="date" name="data" value="${esc(x.data || "")}"></label>
      <div class="campo"><span>Voto</span><div class="stelle-input" id="si">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-s="${n}">★</button>`).join("")}</div></div>
      <label class="campo"><span>Commento</span><textarea name="commento" placeholder="Cosa ti è piaciuto? Con chi l'hai visto?">${esc(x.commento || "")}</textarea></label>`}
    <button class="btn block">Salva</button>
    ${x.id ? `<button type="button" class="btn danger block" id="del" style="margin-top:8px">🗑️ Elimina</button>` : ""}
    ${x.id && comp ? `<button type="button" class="btn sec block" id="cal1" style="margin-top:8px">📲 Promemoria ogni anno nel Calendario</button>` : ""}</form>`);
  $("#cambia-cop", v) && ($("#cambia-cop", v).onclick = () => { v.chiudi(); sceltaCopertina(x, dopo); });
  $("#cast-griglia", v) && ($("#cast-griglia", v).onclick = (e) => { const b = e.target.closest("[data-att]"); if (b) apriAttore(x.extra.attori[+b.dataset.att]); });
  $("#cerca-attori", v) && ($("#cerca-attori", v).onclick = async (e) => {
    e.target.textContent = "Cerco su Wikidata…";
    const at = await window.Copertine.attori(x.tipo, x.titolo);
    if (at === null) { toast("⚠️ Wikidata non risponde, riprova più tardi"); e.target.textContent = "👥 Riprova"; return; }
    if (!at.length) { toast("Non ho trovato gli attori di questo titolo"); e.target.textContent = "👥 Cerca di nuovo gli attori"; return; }
    const ora = (await api(`/api/diario?tipo=${x.tipo}`, { fresco: true })).find((y) => y.id === x.id) || x;
    const nuovo = await api(`/api/diario/${x.id}`, { method: "PUT", json: { ...ora, extra: { ...(ora.extra || {}), attori: at, attori_cercati: true, attori_v: VERS_ATTORI } } });
    v.chiudi(); modificaVoceDiario(nuovo, dopo); if (dopo) dopo();
  });
  const disegnaStelle = () => $$("#si button", v).forEach((b) => b.classList.toggle("on", +b.dataset.s <= voto));
  if (!comp) { disegnaStelle(); $("#si", v).onclick = (e) => { const s = e.target.dataset.s; if (s) { voto = voto === +s ? 0 : +s; disegnaStelle(); } }; }
  $("#fd", v).onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    const dati = { ...x, ...d, voto: comp ? null : voto || null, giorno: d.giorno ? +d.giorno : null, mese: d.mese ? +d.mese : null, anno: d.anno ? +d.anno : null };
    try { await api(x.id ? `/api/diario/${x.id}` : "/api/diario", { method: x.id ? "PUT" : "POST", json: dati }); v.remove(); toast("✅ Salvato"); dopo && dopo(); }
    catch (err) { toast("⚠️ " + err.message); }
  };
  $("#del", v) && ($("#del", v).onclick = async () => {
    if (!(await conferma(`Eliminare “${x.titolo}”?`))) return;
    await api(`/api/diario/${x.id}`, { method: "DELETE" }); v.remove(); toast("🗑️ Eliminato"); dopo && dopo();
  });
  $("#cal1", v) && ($("#cal1", v).onclick = () => apriIcsCompleanni([x]));
}


function modificaVoceSpeciale(x, dopo) {
  const t = TIPI_D[x.tipo], e = x.extra || {}, esame = x.tipo === "esame";
  const v = foglio(`<h3>${t.ico} ${x.id ? esc(x.titolo) : esame ? "Nuovo esame" : "Nuovo acquisto"} ${xBtn}</h3><form id="fs">
    <label class="campo"><span>${esame ? "Materia" : "Cosa"}</span><input type="text" name="titolo" value="${esc(x.titolo || "")}" required placeholder="${esame ? "Es. Analisi 1" : "Es. Maglia Nike"}"></label>
    ${esame ? `<div class="campo"><span>Valutazione</span><div class="scelta-gruppo tre" id="valutazione">
        <button type="button" data-val="voto" class="${!e.moduli?.length && !e.esito ? "on" : ""}"><span>🔢</span>Voto</button>
        <button type="button" data-val="moduli" class="${e.moduli?.length ? "on" : ""}"><span>🧩</span>A moduli</button>
        <button type="button" data-val="idoneita" class="${e.esito ? "on" : ""}"><span>✅</span>Idoneità</button></div></div>
      <div id="blocco-idoneita" ${e.esito ? "" : "hidden"}><div class="riga"><label class="campo"><span>Esito</span><select name="esito"><option value="idoneo">✅ Idoneo</option><option value="non idoneo" ${e.esito === "non idoneo" ? "selected" : ""}>❌ Non idoneo</option></select></label>
        <label class="campo"><span>Crediti (CFU)</span><input type="number" name="cfu_id" inputmode="numeric" min="0" max="30" value="${e.esito ? e.cfu ?? "" : ""}" placeholder="es. 3"></label></div>
        <p class="small muted" style="margin:-4px 4px 12px">Le idoneità (inglese, obblighi formativi…) contano nei crediti ma non nella media.</p></div>
      <div id="classico" ${e.moduli?.length || e.esito ? "hidden" : ""}><div class="riga"><label class="campo"><span>Voto</span><select name="voto">${Array.from({ length: 13 }, (_, i) => 18 + i).map((n) => `<option ${(e.voto || 30) === n ? "selected" : ""}>${n}</option>`).join("")}</select></label>
        <label class="campo"><span>Crediti (CFU)</span><input type="number" name="cfu" inputmode="numeric" min="1" max="30" value="${e.cfu ?? 6}"></label></div>
        <label class="switch"><span>✨ Con lode</span><input type="checkbox" name="lode" ${e.lode ? "checked" : ""}></label></div>
      <div id="blocco-moduli" ${e.moduli?.length && !e.esito ? "" : "hidden"}><div id="lista-moduli"></div>
        <button type="button" class="link-btn" id="agg-modulo">＋ Aggiungi modulo</button><div id="tot-moduli" class="totale-moduli"></div></div>
      <label class="campo"><span>Data</span><input type="date" name="data" value="${esc(x.data || "")}"></label>`
    : `<label class="campo"><span>Categoria</span><select name="categoria">${Object.entries(CATEGORIE_ACQ).map(([k, n]) => `<option value="${k}" ${(e.categoria || "altro") === k ? "selected" : ""}>${n}</option>`).join("")}</select></label>
      <div class="riga"><label class="campo"><span>🛒 Pagato (€)</span><input type="number" name="prezzo" inputmode="decimal" step="0.01" min="0" value="${e.prezzo ?? ""}"></label>
        <label class="campo"><span>Il</span><input type="date" name="data" value="${esc(x.data || "")}"></label></div>
      <label class="switch"><span>💰 L'ho venduto</span><input type="checkbox" id="venduto" ${e.vendita != null ? "checked" : ""}></label>
      <div class="riga" id="riga-vendita" ${e.vendita != null ? "" : "hidden"}><label class="campo"><span>Venduto a (€)</span><input type="number" name="vendita" inputmode="decimal" step="0.01" min="0" value="${e.vendita ?? ""}"></label>
        <label class="campo"><span>Il</span><input type="date" name="data_vendita" value="${esc(e.data_vendita || oggiIso())}"></label></div>
      <div id="anteprima-diff" class="muted small" style="margin:-4px 4px 10px"></div>`}
    <label class="campo"><span>Note</span><textarea name="commento" placeholder="${esame ? "Es. professore, com'è andata…" : "Es. taglia, dove l'hai comprato, a chi l'hai venduto…"}">${esc(x.commento || "")}</textarea></label>
    <button class="btn block">Salva</button>
    ${x.id ? `<button type="button" class="btn danger block" id="del" style="margin-top:8px">🗑️ Elimina</button>` : ""}</form>`);
  const f = $("#fs", v);
  const diff = () => {
    if (esame || !$("#venduto", v).checked) { $("#anteprima-diff", v) && ($("#anteprima-diff", v).textContent = ""); return; }
    const p = parseFloat(f.prezzo.value), ve = parseFloat(f.vendita.value);
    $("#anteprima-diff", v).innerHTML = !isNaN(p) && !isNaN(ve) ? `Risultato: <b class="${ve - p >= 0 ? "su" : "giu"}">${segno(ve - p)}</b>` : "";
  };
  let moduli = esame ? (e.moduli || []).map((m) => ({ ...m })) : [];
  const opzVoto = (vv) => `<option value="">—</option>` + Array.from({ length: 13 }, (_, i) => 18 + i).map((n) => `<option ${vv === n ? "selected" : ""}>${n}</option>`).join("");
  const leggiModuli = () => $$(".modulo", v).map((el, i) => ({ nome: $("[data-k=nome]", el).value.trim() || `Modulo ${i + 1}`, cfu: +$("[data-k=cfu]", el).value || 6,
    voto: +$("[data-k=voto]", el).value || null, lode: $("[data-k=lode]", el).checked, data: $("[data-k=data]", el).value || null }));
  const totale = () => {
    const c = esameCalcolato({ moduli: leggiModuli() });
    $("#tot-moduli", v).innerHTML = `Totale <b>${c.cfu} CFU</b> · ${c.completo ? `voto finale <b>${dec(c.voto, 2)}</b>${c.lode ? " e lode ✨" : ""}` : `superati ${c.fatti}/${c.totali}: il voto finale arriva quando li hai passati tutti`}`;
  };
  const disegnaModuli = () => {
    $("#lista-moduli", v).innerHTML = moduli.map((m, i) => `<div class="modulo"><div class="riga"><input type="text" data-k="nome" value="${esc(m.nome || `Modulo ${i + 1}`)}" style="flex:3">
      <label class="mini-cfu"><input type="number" data-k="cfu" inputmode="numeric" min="1" max="30" value="${m.cfu || 6}"><span>CFU</span></label>
      ${moduli.length > 1 ? `<button type="button" class="iconbtn" data-togli="${i}" aria-label="Togli">✕</button>` : ""}</div>
      <div class="riga"><select data-k="voto">${opzVoto(m.voto)}</select><label class="mini-lode"><input type="checkbox" data-k="lode" ${m.lode ? "checked" : ""}> lode</label>
      <input type="date" data-k="data" value="${esc(m.data || "")}" style="flex:2"></div></div>`).join("");
    totale();
  };
  if (esame) {
    $("#valutazione", v).onclick = (ev) => {
      const b = ev.target.closest("[data-val]"); if (!b) return;
      $$("#valutazione button", v).forEach((x) => x.classList.toggle("on", x === b));
      const val = b.dataset.val, on = val === "moduli";
      $("#classico", v).hidden = val !== "voto"; $("#blocco-moduli", v).hidden = !on; $("#blocco-idoneita", v).hidden = val !== "idoneita";
      if (on && !moduli.length) {
        const c = +f.cfu.value || 12, n = c > 6 && c % 6 === 0 ? c / 6 : 2;
        moduli = Array.from({ length: n }, (_, i) => ({ nome: `Modulo ${i + 1}`, cfu: 6 }));
      }
      if (on) disegnaModuli();
    };
    $("#agg-modulo", v).onclick = () => { moduli = leggiModuli(); moduli.push({ nome: `Modulo ${moduli.length + 1}`, cfu: 6 }); disegnaModuli(); };
    $("#lista-moduli", v).addEventListener("click", (ev) => { const t = ev.target.closest("[data-togli]"); if (t) { moduli = leggiModuli(); moduli.splice(+t.dataset.togli, 1); disegnaModuli(); } });
    $("#lista-moduli", v).addEventListener("input", totale);
    $("#lista-moduli", v).addEventListener("change", totale);
    if (moduli.length) disegnaModuli();
  }
  if (!esame) {
    $("#venduto", v).onchange = (ev) => { $("#riga-vendita", v).hidden = !ev.target.checked; diff(); };
    f.prezzo.oninput = diff; f.vendita.oninput = diff; diff();
  }
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    const val = esame ? $("#valutazione .on", v)?.dataset.val || "voto" : null;
    const extra = esame ? (val === "moduli" ? { moduli: leggiModuli() } : val === "idoneita" ? { esito: d.esito, cfu: d.cfu_id === "" ? null : +d.cfu_id } : { voto: +d.voto, lode: !!d.lode, cfu: d.cfu ? +d.cfu : 6 })
      : { categoria: d.categoria, prezzo: d.prezzo === "" ? null : +d.prezzo, vendita: $("#venduto", v).checked && d.vendita !== "" ? +d.vendita : null, data_vendita: $("#venduto", v).checked ? d.data_vendita : null };
    try {
      await api(x.id ? `/api/diario/${x.id}` : "/api/diario", { method: x.id ? "PUT" : "POST", json: { ...x, titolo: d.titolo, data: d.data || null, commento: d.commento, extra } });
      v.chiudi(); toast("✅ Salvato"); if (dopo) dopo();
    } catch (err) { toast("⚠️ " + err.message); }
  };
  $("#del", v) && ($("#del", v).onclick = async () => {
    if (!(await conferma(`Eliminare “${x.titolo}”?`))) return;
    await api(`/api/diario/${x.id}`, { method: "DELETE" }); v.chiudi(); toast("🗑️ Eliminato"); if (dopo) dopo();
  });
}

/* Importa i compleanni dall'app Promemoria (tramite un Comando Rapido che li copia negli appunti) */
const istruzioniPromemoria = () => `
  ${passo(1, `Apri <b>Comandi Rapidi</b> → <b>+</b> → chiamalo ${cod("Esporta compleanni")}`)}
  ${passo(2, `Aggiungi l'azione <b>Trova promemoria</b>. Tocca <b>Aggiungi filtro</b> → <b>Elenco</b> → <b>è</b> → scegli la tua lista <b>Compleanni</b>.`)}
  ${passo(3, `Aggiungi <b>Ripeti con ognuno</b>.`)}
  ${passo(4, `Dentro la ripetizione aggiungi l'azione <b>Testo</b>. Nel riquadro inserisci la variabile <b>Elemento ripetizione</b>, scrivi <b>&nbsp;|&nbsp;</b> (barra verticale), poi inserisci di nuovo <b>Elemento ripetizione</b>: toccala, scegli <b>Data di scadenza</b> e come formato <b>ISO 8601</b>.`)}
  ${passo(5, `Dopo <b>Fine ripetizione</b> aggiungi <b>Combina testo</b> con <b>Nuova riga</b>, poi <b>Copia negli appunti</b>.`)}
  ${passo(6, `Tocca <b>▶︎</b> per avviarlo e consenti l'accesso ai Promemoria. Torna qui e tocca <b>Incolla</b>.`)}`;

function importaCompleanni(dopo) {
  let righe = [], esistenti = [];
  const v = foglio(`<h3>📥 Importa compleanni ${xBtn}</h3>
    <p class="muted small" style="margin-top:-6px">Porta qui i compleanni dall'app <b>Promemoria</b> senza riscriverli.</p>
    <details class="card"><summary><span class="sum-ico">⚙️</span><span>Come copiarli dai Promemoria<br><span class="small muted">Una volta sola, circa 2 minuti</span></span></summary><div class="dentro">${istruzioniPromemoria()}</div></details>
    <button class="btn block" id="incolla">📋 Incolla dagli appunti</button>
    <textarea id="testo-imp" placeholder="…oppure incolla o scrivi qui, uno per riga. Es.&#10;Marco Rossi 6 agosto&#10;Compleanno Giulia | 2027-12-03" style="margin-top:10px;min-height:90px"></textarea>
    <div id="anteprima-imp"></div>`);
  const ta = $("#testo-imp", v), prev = $("#anteprima-imp", v);
  api("/api/diario?tipo=compleanno").then((l) => { esistenti = l; if (ta.value.trim()) disegna(); });
  const opzG = (g) => `<option value="">–</option>` + Array.from({ length: 31 }, (_, i) => `<option ${g === i + 1 ? "selected" : ""}>${i + 1}</option>`).join("");
  const opzM = (m) => `<option value="">–</option>` + MESI_L.map((x, i) => `<option value="${i + 1}" ${m === i + 1 ? "selected" : ""}>${x}</option>`).join("");
  const disegna = () => {
    righe = window.ScrignoChat.leggiCompleanni(ta.value);
    if (!righe.length) { prev.innerHTML = ""; return; }
    prev.innerHTML = `<div class="sezione"><h2>Ho trovato ${righe.length} compleann${righe.length === 1 ? "o" : "i"}</h2></div>
      <p class="small muted" style="margin:-4px 4px 8px">Controlla nomi e date; dove manca la data sceglila tu.</p>
      <div class="lista imp">${righe.map((r, i) => {
        const gia = esistenti.find((x) => x.titolo.toLowerCase() === r.nome.toLowerCase());
        return `<div class="imp-riga" data-i="${i}"><input type="checkbox" checked data-k="ok">
          <div style="flex:1;min-width:0"><input type="text" value="${esc(r.nome)}" data-k="nome">${gia ? `<span class="tag">già presente: verrà aggiornato</span>` : ""}</div>
          <select data-k="giorno">${opzG(r.giorno)}</select><select data-k="mese">${opzM(r.mese)}</select></div>`;
      }).join("")}</div>
      <button class="btn block" id="importa" style="margin-top:12px">Importa</button>`;
    $("#importa", v).onclick = salva;
  };
  const salva = async () => {
    const scelti = $$(".imp-riga", v).map((el) => ({ el, r: righe[+el.dataset.i] })).filter(({ el }) => $("[data-k=ok]", el).checked)
      .map(({ el, r }) => ({ ...r, nome: $("[data-k=nome]", el).value.trim(), giorno: +$("[data-k=giorno]", el).value || null, mese: +$("[data-k=mese]", el).value || null }));
    const senza = scelti.filter((x) => !x.nome || !x.giorno || !x.mese);
    if (senza.length) return toast(`⚠️ Manca la data per: ${senza.map((x) => x.nome || "?").join(", ")}`, 4000);
    const salvati = [];
    for (const x of scelti) {
      const gia = esistenti.find((y) => y.titolo.toLowerCase() === x.nome.toLowerCase());
      const voce = { tipo: "compleanno", titolo: x.nome, giorno: x.giorno, mese: x.mese, anno: x.anno || gia?.anno || null };
      salvati.push(gia ? await api(`/api/diario/${gia.id}`, { method: "PUT", json: { ...gia, ...voce } }) : await api("/api/diario", { method: "POST", json: voce }));
    }
    v.chiudi();
    if (dopo) dopo();
    notificheCompleanni(salvati, true);
  };
  ta.oninput = disegna;
  $("#incolla", v).onclick = async () => {
    try { ta.value = await navigator.clipboard.readText(); disegna(); if (!righe.length) toast("Negli appunti non ho trovato compleanni"); }
    catch { ta.focus(); toast("Tieni premuto nel riquadro e scegli “Incolla”", 3500); }
  };
}

/* Notifiche dei compleanni: eventi annuali nel Calendario dell'iPhone */
function notificheCompleanni(lista, importati) {
  const v = foglio(`<div style="text-align:center"><div style="font-size:54px">${importati ? "✅" : "🔔"}</div>
    <h3 style="justify-content:center">${importati ? `${lista.length} compleanni importati` : "Notifiche dei compleanni"}</h3></div>
    <p class="muted" style="margin-top:-6px">Per ricevere la <b>notifica</b> ogni anno, come con Promemoria, aggiungili al <b>Calendario</b>: alle 9 del giorno del compleanno (e la sera prima) l'iPhone ti avvisa.</p>
    <button class="btn block" id="cal">📲 Aggiungi ${lista.length === 1 ? "al" : `tutti e ${lista.length} al`} Calendario</button>
    <div class="card small" style="margin-top:12px">
      ${passo(1, "Tocca il pulsante qui sopra, poi <b>Aggiungi tutti</b> e scegli il calendario.")}
      ${passo(2, "Controlla nel Calendario che compaiano, ad esempio aprendo il giorno di un compleanno: devono avere la scritta “Ripeti: ogni anno”.")}
      ${passo(3, "Solo dopo cancellali dall'app <b>Promemoria</b>.")}
      <p class="muted" style="margin:8px 0 0">Per sicurezza imposta anche: <b>Impostazioni → App → Calendario → Avvisi predefiniti → Eventi di tutto il giorno → Il giorno dell'evento (09:00)</b>.</p></div>
    <button class="btn sec block" data-chiudi style="margin-top:10px">Lo faccio dopo</button>`);
  $("#cal", v).onclick = () => { memo.set("comp-cal", String(lista.length)); apriIcsCompleanni(lista); };
}

/* Compleanni nel Calendario dell'iPhone: evento che si ripete ogni anno, con avviso il giorno prima e il giorno stesso alle 9 */
function apriIcsCompleanni(lista) {
  const e = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  const anno = new Date().getFullYear();
  const r = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//LifeApp//IT", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const x of lista) {
    const g = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const d0 = new Date(anno, x.mese - 1, x.giorno), d1 = new Date(anno, x.mese - 1, x.giorno + 1);
    r.push("BEGIN:VEVENT", `UID:compleanno-${x.id}@scrigno`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
      `SUMMARY:${e("🎂 Compleanno di " + x.titolo)}`, `DTSTART;VALUE=DATE:${g(d0)}`, `DTEND;VALUE=DATE:${g(d1)}`, "RRULE:FREQ=YEARLY",
      ...(x.anno ? [`DESCRIPTION:${e("Nato/a nel " + x.anno)}`] : []),
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${e("Domani è il compleanno di " + x.titolo)}`, "TRIGGER:-PT15H", "END:VALARM",
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${e("Oggi è il compleanno di " + x.titolo + " 🎂")}`, "TRIGGER:PT9H", "END:VALARM", "END:VEVENT");
  }
  r.push("END:VCALENDAR");
  const file = new File([r.join("\r\n") + "\r\n"], lista.length === 1 ? `Compleanno ${lista[0].titolo}.ics` : "Compleanni.ics", { type: "text/calendar" });
  location.href = URL.createObjectURL(file);
}

/* ================================================================== CHAT */
const AIUTO = ["ho corso 5 km in 28 minuti", "corsa 8 km passo 5:30", "quanti km ho corso?", "panca piana 80 kg per 8", "oggi peso 72,5 kg", "importa i compleanni dai promemoria", "ho comprato una maglia a 40 euro", "ho passato l'esame di Analisi 1 con 28", "esame di Fisica da 12 cfu", "primo modulo di Fisica con 27", "bilancio", "il 6 agosto è il compleanno di Marco Rossi", "stasera ho visto il film After, bellissimo", "ho letto Il nome della rosa di Umberto Eco",
  "il 16 dicembre dentista dalle 10 alle 11", "quando è il compleanno di Marco?", "che film ho visto?"];
const chatStoria = () => { try { return JSON.parse(memo.get("chat") || "[]"); } catch { return []; } };
const chatSalva = (l) => memo.set("chat", JSON.stringify(l.slice(-150)));
let chatAttesa = null;

function htmlMsg(m) {
  const az = (m.azioni || []).map((a) => `<button class="chip" data-az='${esc(JSON.stringify(a))}'>${esc(a.etichetta)}</button>`).join("");
  return `<div class="msg ${m.da}"><div class="bolla">${m.html || esc(m.testo)}</div>${az ? `<div class="msg-az">${az}</div>` : ""}</div>`;
}
function vistaChat(precompila) {
  const storia = chatStoria();
  app.innerHTML = `<div class="top"><h1>Chat<small>Dimmi cosa è successo, al resto penso io</small></h1>
    ${storia.length ? `<button class="iconbtn" id="pulisci" title="Pulisci">🧹</button>` : ""}</div>
    <div id="msgs" class="chat">${storia.length ? storia.map(htmlMsg).join("")
      : htmlMsg({ da: "scrigno", html: `Ciao! 👋 Scrivimi in modo semplice e io lo salvo al posto giusto. Per esempio:`, azioni: AIUTO.map((t) => ({ t: "scrivi", testo: t, etichetta: t })) })}</div>
    <form class="chat-barra" id="cf"><textarea id="ci" rows="1" placeholder="Scrivi o detta… (es. ho visto After)" enterkeyhint="send"></textarea><button class="invia" aria-label="Invia">➤</button></form>`;
  const ci = $("#ci"), msgs = $("#msgs");
  const giu = () => setTimeout(() => scrollTo(0, document.body.scrollHeight), 30);
  giu();
  ci.oninput = () => { ci.style.height = "auto"; ci.style.height = Math.min(ci.scrollHeight, 120) + "px"; };
  ci.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#cf").requestSubmit(); } };
  const aggiungi = (m) => { const l = chatStoria(); l.push(m); chatSalva(l); msgs.insertAdjacentHTML("beforeend", htmlMsg(m)); giu(); };
  const invia = async (testo) => {
    testo = testo.trim(); if (!testo) return;
    if (msgs.querySelector(".msg.scrigno") && !chatStoria().length) msgs.innerHTML = "";
    aggiungi({ da: "io", testo });
    try { aggiungi(await rispondi(testo)); } catch (e) { aggiungi({ da: "scrigno", testo: "⚠️ Non sono riuscito a salvarlo: " + e.message }); }
  };
  $("#cf").onsubmit = (e) => { e.preventDefault(); const t = ci.value; ci.value = ""; ci.style.height = "auto"; invia(t); };
  $("#pulisci") && ($("#pulisci").onclick = async () => { if (await conferma("Cancellare la conversazione?", "Cancella", "Quello che hai salvato resta nel diario.")) { chatSalva([]); vistaChat(); } });
  msgs.onclick = async (e) => {
    const b = e.target.closest("[data-az]"); if (!b) return;
    const a = JSON.parse(b.dataset.az);
    try {
      if (a.t === "scrivi") return invia(a.testo);
      if (a.t === "annulla") { await api(a.url, { method: "DELETE" }); b.closest(".msg-az").remove(); aggiungi({ da: "scrigno", testo: "↩️ Annullato, non l'ho salvato." }); }
      if (a.t === "voto") { const cur = (await api("/api/diario")).find((y) => y.id === a.id) || a.voce; const x = await api(`/api/diario/${a.id}`, { method: "PUT", json: { ...cur, voto: a.v } }); b.closest(".msg-az").remove(); aggiungi({ da: "scrigno", html: `Fatto: <b>${esc(x.titolo)}</b> <span class="stelle">${stelle(a.v)}</span>` }); }
      if (a.t === "apri") location.hash = a.hash;
      if (a.t === "calComp") apriIcsCompleanni([a.voce]);
      if (a.t === "importaComp") importaCompleanni(null);
      if (a.t === "calApp") aggiungiAlCalendario(a.voce);
      if (a.t === "annullaTutti") { for (const u of a.urls) await api(u, { method: "DELETE" }); b.closest(".msg-az").remove(); aggiungi({ da: "scrigno", testo: "↩️ Annullato, non l'ho salvato." }); }
    } catch (err) { toast("⚠️ " + err.message); }
  };
  if (precompila) { history.replaceState(null, "", "#/chat"); invia(precompila); }
  else if (matchMedia("(pointer:fine)").matches) ci.focus();
}

const trova = (lista, testo) => {
  const n = testo.toLowerCase().trim();
  return lista.find((x) => x.titolo.toLowerCase() === n) || lista.find((x) => x.titolo.toLowerCase().includes(n)) || lista.find((x) => n.includes(x.titolo.toLowerCase()));
};
function rispostaVendita(x) {
  const e = x.extra, diff = e.prezzo != null ? e.vendita - e.prezzo : null;
  return { da: "scrigno", html: `💰 Venduto: <b>${esc(x.titolo)}</b><br>Pagato <b>${euro(e.prezzo)}</b> → venduto <b>${euro(e.vendita)}</b>${diff != null ? `<br>Risultato: <b class="${diff >= 0 ? "su" : "giu"}">${segno(diff)}</b> ${diff > 0 ? "🎉" : diff < 0 ? "😕" : ""}` : ""}`,
    azioni: [{ t: "scrivi", testo: "bilancio", etichetta: "📊 Fammi il bilancio" }, { t: "apri", hash: "#/diario/acquisto", etichetta: "💶 Acquisti" }] };
}
async function rispondi(testo) {
  if (chatAttesa) {
    const a = chatAttesa; chatAttesa = null;
    if (a.motivo === "data_compleanno") testo = `compleanno di ${a.nome} il ${testo}`;
    else if (a.motivo === "nome_compleanno") testo = `compleanno di ${testo} il ${a.giorno}/${a.mese}${a.anno ? "/" + a.anno : ""}`;
    else if (a.motivo === "titolo") testo = `${a.tipo === "libro" ? "ho letto" : a.tipo === "serie" ? "ho visto la serie" : "ho visto il film"} ${testo}`;
    else if (a.motivo === "prezzo") { const n = testo.match(/\d+(?:[.,]\d{1,2})?/); if (n) testo = `${a.frase} a ${n[0]} euro`; }
    else if (a.motivo === "prezzo_acquisto") {
      const n = testo.match(/\d+(?:[.,]\d{1,2})?/);
      const x = await api("/api/diario", { method: "POST", json: { tipo: "acquisto", titolo: a.nome, data: null, extra: { prezzo: n ? parseFloat(n[0].replace(",", ".")) : null, vendita: a.prezzo, data_vendita: a.data, categoria: a.categoria } } });
      return rispostaVendita(x);
    }
  }
  const r = window.ScrignoChat.capisci(testo);
  const giorno = (iso) => { const d = new Date(iso + "T00:00"); return `${GIORNI[d.getDay()]} ${d.getDate()} ${MESI_L[d.getMonth()]}`; };

  if (r.azione === "compleanno") {
    const esistenti = await api("/api/diario?tipo=compleanno");
    const gia = esistenti.find((x) => x.titolo.toLowerCase() === r.nome.toLowerCase());
    const voce = { tipo: "compleanno", titolo: r.nome, giorno: r.giorno, mese: r.mese, anno: r.anno || gia?.anno || null };
    const x = gia ? await api(`/api/diario/${gia.id}`, { method: "PUT", json: { ...gia, ...voce } }) : await api("/api/diario", { method: "POST", json: voce });
    const i = infoComp(x);
    return { da: "scrigno", html: `🎂 ${gia ? "Ho aggiornato" : "Ho segnato"} il compleanno di <b>${esc(x.titolo)}</b>: <b>${x.giorno} ${MESI_L[x.mese - 1]}</b>${i.anni ? ` (compirà ${i.anni} anni)` : ""}.<br>${i.g === 0 ? "È oggi! 🎉" : `Mancano ${i.g} giorni.`} Te lo ricorderò ogni anno qui in LifeApp; per l'avviso sull'iPhone mettilo nel Calendario:`,
      azioni: [{ t: "calComp", voce: x, etichetta: "📲 Promemoria annuale nel Calendario" }, ...(gia ? [] : [{ t: "annulla", url: `/api/diario/${x.id}`, etichetta: "↩️ Annulla" }])] };
  }
  if (r.azione === "diario") {
    const x = await api("/api/diario", { method: "POST", json: { tipo: r.tipo, titolo: r.titolo, autore: r.autore, data: r.data, voto: r.voto, commento: r.commento, stato: r.stato } });
    cercaCopertineMancanti([x]);   // la copertina arriva da sola, in sottofondo
    const t = TIPI_D[r.tipo];
    const dove = r.tipo === "libro" ? (r.stato === "in corso" ? "ai libri che stai leggendo" : "ai libri letti") : r.tipo === "serie" ? "alle serie viste" : "ai film visti";
    const azioni = [];
    if (!x.voto) [1, 2, 3, 4, 5].forEach((n) => azioni.push({ t: "voto", id: x.id, v: n, voce: x, etichetta: "★".repeat(n) }));
    azioni.push({ t: "apri", hash: `#/diario/${r.tipo}`, etichetta: `${t.ico} Apri il diario` }, { t: "annulla", url: `/api/diario/${x.id}`, etichetta: "↩️ Annulla" });
    return { da: "scrigno", html: `${t.ico} Aggiunto ${dove}: <b>${esc(x.titolo)}</b>${x.autore ? " di " + esc(x.autore) : ""}<br><span class="muted">${giorno(x.data)}</span>
      ${x.voto ? `<br><span class="stelle">${stelle(x.voto)}</span>` : ""}${x.commento ? `<br>“${esc(x.commento)}”` : ""}${!x.voto ? "<br>Che voto gli dai?" : ""}`, azioni };
  }
  if (r.azione === "esame" || r.azione === "esame_nuovo") {
    const esami = await api("/api/diario?tipo=esame");
    let x = trova(esami, r.materia);
    const salva = (dati) => (x ? api(`/api/diario/${x.id}`, { method: "PUT", json: { ...x, ...dati } }) : api("/api/diario", { method: "POST", json: { tipo: "esame", titolo: r.materia, ...dati } }));
    const creaModuli = (cfu, almeno) => { const n = Math.max(almeno || 0, cfu > 6 && cfu % 6 === 0 ? cfu / 6 : 2); return Array.from({ length: n }, (_, i) => ({ nome: `Modulo ${i + 1}`, cfu: cfu && cfu % n === 0 ? cfu / n : 6 })); };
    let nuovo = !x, salvato;
    if (r.azione === "esame_nuovo") {
      if (x) return { da: "scrigno", html: `<b>${esc(x.titolo)}</b> è già nei tuoi esami.`, azioni: [{ t: "apri", hash: "#/diario/esame", etichetta: "🎓 I miei esami" }] };
      const n = r.cfu > 6 && r.cfu % 6 === 0 ? r.cfu / 6 : 1;
      salvato = await salva({ data: null, extra: { moduli: Array.from({ length: n }, (_, i) => ({ nome: n > 1 ? `Modulo ${i + 1}` : r.materia, cfu: r.cfu / n })) } });
      return { da: "scrigno", html: `🎓 Ho aggiunto <b>${esc(salvato.titolo)}</b> (${r.cfu} CFU)${n > 1 ? `, diviso in ${n} moduli da ${r.cfu / n} CFU` : ""}.<br>Quando passi un modulo scrivimi ad esempio <i>primo modulo di ${esc(salvato.titolo.toLowerCase())} con 27</i>.`,
        azioni: [{ t: "apri", hash: "#/diario/esame", etichetta: "🎓 I miei esami" }, { t: "annulla", url: `/api/diario/${salvato.id}`, etichetta: "↩️ Annulla" }] };
    }
    if (r.esito) {
      salvato = await salva({ data: r.data, extra: { esito: r.esito, cfu: r.cfu ?? x?.extra?.cfu ?? null } });
      const st = statEsami(await api("/api/diario?tipo=esame"));
      return { da: "scrigno", html: r.esito === "idoneo"
          ? `✅ <b>${esc(salvato.titolo)}</b>: idoneo!${salvato.extra.cfu ? ` (${salvato.extra.cfu} CFU)` : ""} 🎉<br><span class="muted">Le idoneità contano nei crediti (ora ${st.cfu}) ma non nella media.</span>`
          : `❌ <b>${esc(salvato.titolo)}</b>: non idoneo, per questa volta. Lo trovi negli esami: quando lo ripassi scrivimi <i>${esc(salvato.titolo.toLowerCase())} idoneo</i>.`,
        azioni: [{ t: "apri", hash: "#/diario/esame", etichetta: "🎓 I miei esami" }, ...(nuovo ? [{ t: "annulla", url: `/api/diario/${salvato.id}`, etichetta: "↩️ Annulla" }] : [])] };
    }
    const mod = r.modulo || (x?.extra?.moduli && x.extra.moduli.filter((m) => !m.voto).length === 1 ? x.extra.moduli.findIndex((m) => !m.voto) + 1 : null);
    if (mod) {
      let moduli = x?.extra?.moduli?.length ? x.extra.moduli.map((m) => ({ ...m })) : creaModuli(r.cfu || x?.extra?.cfu || 12, mod);
      while (moduli.length < mod) moduli.push({ nome: `Modulo ${moduli.length + 1}`, cfu: 6 });
      moduli[mod - 1] = { ...moduli[mod - 1], voto: r.voto, lode: r.lode, data: r.data };
      salvato = await salva({ extra: { moduli }, data: r.data });
      const c = esameCalcolato(salvato.extra), m = salvato.extra.moduli[mod - 1];
      const mancano = salvato.extra.moduli.filter((q) => !q.voto).map((q) => q.nome);
      const st = statEsami(await api("/api/diario?tipo=esame"));
      return { da: "scrigno", html: `🧩 <b>${esc(salvato.titolo)}</b> — ${esc(m.nome)}: <b>${r.lode ? "30 e lode" : r.voto}</b> (${m.cfu} CFU) ✅<br>` +
        (c.completo ? `🎉 Esame completato! Voto finale <b>${dec(c.voto, 2)}</b>${c.lode ? " e lode" : ""} su ${c.cfu} CFU.<br>La tua media ora è <b>${dec(st.ponderata)}</b>.` : `Manca ancora: ${mancano.map(esc).join(", ")}.`),
        azioni: [{ t: "apri", hash: "#/diario/esame", etichetta: "🎓 I miei esami" }, ...(nuovo ? [{ t: "annulla", url: `/api/diario/${salvato.id}`, etichetta: "↩️ Annulla" }] : [])] };
    }
    salvato = await salva({ data: r.data, extra: { voto: r.voto, lode: r.lode, cfu: r.cfu || x?.extra?.cfu || 6 } });
    const st = statEsami(await api("/api/diario?tipo=esame"));
    return { da: "scrigno", html: `🎓 ${nuovo ? "Complimenti! Ho salvato" : "Ho aggiornato"} <b>${esc(salvato.titolo)}</b> con <b>${votoTesto(salvato.extra)}</b> (${salvato.extra.cfu} CFU${r.cfu ? "" : ", se sono di più cambialo nell'esame"}).<br>La tua media ora è <b>${dec(st.ponderata)}</b> su ${st.n} esam${st.n === 1 ? "e" : "i"}.`,
      azioni: [{ t: "apri", hash: "#/diario/esame", etichetta: "🎓 I miei esami" }, ...(nuovo ? [{ t: "annulla", url: `/api/diario/${salvato.id}`, etichetta: "↩️ Annulla" }] : [])] };
  }
  if (r.azione === "allenamento") {
    const prima = raggruppaEsercizi(await api("/api/diario?tipo=allenamento")).find((g) => chiaveEs(g.nome) === chiaveEs(r.esercizio));
    const x = await api("/api/diario", { method: "POST", json: { tipo: "allenamento", titolo: prima ? prima.nome : r.esercizio, data: r.data, extra: { kg: r.kg, reps: r.reps, serie: r.serie, set: r.set || undefined } } });
    const f = forzaStimata(r.kg, r.reps), record = prima && f > prima.record;
    return { da: "scrigno", html: `💪 Segnato: <b>${esc(x.titolo)}</b> — ${testoSerie(x.extra)}<br>` +
      (r.kg ? `Forza stimata: <b>${kgTesto(f)}</b>` : "") + (record ? `<br>🏆 <b>Nuovo record!</b> Prima era ${valoreForza(r.kg, prima.record)}.` : prima ? `<br><span class="muted">Il tuo record resta ${valoreForza(r.kg, prima.record)}.</span>` : ""),
      azioni: [{ t: "apri", hash: `#/palestra/${encodeURIComponent(x.titolo)}`, etichetta: "📈 Vedi il grafico" }, { t: "annulla", url: `/api/diario/${x.id}`, etichetta: "↩️ Annulla" }] };
  }
  if (r.azione === "corsa") {
    if (!r.km || !r.secondi) return { da: "scrigno", html: `🏃 Mi serve anche ${!r.km ? "la distanza in km" : "il tempo o il passo medio"}. Scrivi ad esempio <i>ho corso 5 km in 28 minuti</i> oppure <i>corsa 8 km passo 5:30</i>.`,
      azioni: [{ t: "apri", hash: "#/corsa", etichetta: "🏃 Apri Corsa" }] };
    const prima = (await api("/api/diario?tipo=corsa")).filter((x) => x.extra.km >= 1);
    const x = await api("/api/diario", { method: "POST", json: { tipo: "corsa", titolo: "Corsa", data: r.data, extra: { km: r.km, secondi: r.secondi } } });
    const best = prima.length ? Math.min(...prima.map((y) => y.extra.passo)) : null, rec = best != null && x.extra.km >= 1 && x.extra.passo < best;
    return { da: "scrigno", html: `🏃 Corsa segnata: <b>${kmT(x.extra.km)} km</b> in <b>${tempoTesto(x.extra.secondi)}</b>${r.data !== oggiIso() ? ` (${giorno(r.data)})` : ""}<br>Passo medio: <b>${passoTesto(x.extra.passo)} /km</b>`
      + (rec ? `<br>🏆 <b>Nuovo record di passo!</b> Prima era ${passoTesto(best)} /km.` : best != null ? `<br><span class="muted">Il tuo miglior passo resta ${passoTesto(best)} /km.</span>` : ""),
      azioni: [{ t: "apri", hash: "#/corsa", etichetta: "📈 Vedi i grafici" }, { t: "annulla", url: `/api/diario/${x.id}`, etichetta: "↩️ Annulla" }] };
  }
  if (r.azione === "peso") {
    const x = await api("/api/diario", { method: "POST", json: { tipo: "peso", titolo: "Peso", data: r.data, extra: { peso: r.peso } } });
    const prof = await api("/api/profilo"), b = bmi(r.peso, +prof.altezza);
    return { da: "scrigno", html: `⚖️ Peso segnato: <b>${kgTesto(r.peso)}</b>${b ? `<br>BMI ${dec(b.v, 1)} (${b.etichetta})` : "<br><span class='muted'>Dimmi anche la tua altezza (es. “sono alto 1,78”) e calcolo il BMI.</span>"}`,
      azioni: [{ t: "apri", hash: "#/palestra", etichetta: "🏋️ Palestra" }, { t: "annulla", url: `/api/diario/${x.id}`, etichetta: "↩️ Annulla" }] };
  }
  if (r.azione === "altezza") {
    const prof = await api("/api/profilo"); await api("/api/profilo", { method: "PUT", json: { ...prof, altezza: String(r.altezza) } });
    return { da: "scrigno", html: `📏 Altezza salvata: <b>${r.altezza} cm</b>.`, azioni: [{ t: "apri", hash: "#/palestra", etichetta: "🏋️ Palestra" }] };
  }
  if (r.azione === "acquisto") {
    const x = await api("/api/diario", { method: "POST", json: { tipo: "acquisto", titolo: r.nome, data: r.data, extra: { prezzo: r.prezzo, categoria: r.categoria } } });
    return { da: "scrigno", html: `🛒 Segnato: <b>${esc(x.titolo)}</b>, prezzo pagato <b>${euro(r.prezzo)}</b> (${CATEGORIE_ACQ[r.categoria] || ""}).<br>Quando lo vendi scrivimi <i>ho venduto ${esc(x.titolo.toLowerCase())} a …</i> e ti faccio il bilancio.`,
      azioni: [{ t: "apri", hash: "#/diario/acquisto", etichetta: "💶 Acquisti e bilancio" }, { t: "annulla", url: `/api/diario/${x.id}`, etichetta: "↩️ Annulla" }] };
  }
  if (r.azione === "vendita") {
    const acq = (await api("/api/diario?tipo=acquisto")).filter((x) => x.extra?.vendita == null);
    const x = trova(acq, r.nome);
    if (!x) {
      chatAttesa = { motivo: "prezzo_acquisto", nome: r.nome, prezzo: r.prezzo, data: r.data, categoria: r.categoria };
      return { da: "scrigno", html: `Non trovo “${esc(r.nome)}” tra le cose comprate e non ancora vendute. A quanto l'avevi pagato? Scrivimi solo il prezzo (oppure “non ricordo”).` };
    }
    const agg = await api(`/api/diario/${x.id}`, { method: "PUT", json: { ...x, extra: { ...x.extra, vendita: r.prezzo, data_vendita: r.data } } });
    return rispostaVendita(agg);
  }
  if (r.azione === "commento") {
    const tutte = (await api("/api/diario")).filter((x) => x.tipo !== "compleanno");
    const x = trova(tutte, r.titolo);
    const cart = !x && (S.cartelle.find((c) => c.nome.toLowerCase() === r.titolo.toLowerCase()) || S.cartelle.find((c) => c.tipo === "lavoro" && c.nome.toLowerCase().includes(r.titolo.toLowerCase())));
    if (cart) {
      const note = [...(cart.note || [])];
      let box = note.find((n) => (n.titolo || "").toLowerCase() === "commenti");
      if (box) box.testo = [box.testo, r.commento].filter(Boolean).join("\n"); else note.push(box = { titolo: "Commenti", icona: "💬", testo: r.commento });
      await salvaNote(cart, note);
      return { da: "scrigno", html: `💬 Ho scritto nel riquadro <b>Commenti</b> di <b>${esc(cart.nome)}</b>: “${esc(r.commento)}”`, azioni: [{ t: "apri", hash: `#/c/${cart.id}`, etichetta: `${cart.icona} Apri ${cart.nome}` }] };
    }
    if (!x) return { da: "scrigno", html: `Non trovo “${esc(r.titolo)}” nel diario. Prova a scrivere ad esempio: <i>ho visto ${esc(r.titolo)}, ${esc(r.commento.toLowerCase())}</i>` };
    const nuovo = x.commento ? `${x.commento}\n${r.commento}` : r.commento;
    await api(`/api/diario/${x.id}`, { method: "PUT", json: { ...x, commento: nuovo } });
    return { da: "scrigno", html: `🗒️ Ho aggiunto il commento a <b>${esc(x.titolo)}</b>: “${esc(r.commento)}”` };
  }
  if (r.azione === "appuntamento") {
    const a = await api("/api/appuntamenti", { method: "POST", json: { titolo: r.titolo, inizio: r.inizio, fine: r.fine, tutto_il_giorno: r.tutto_il_giorno, luogo: r.luogo, categoria: r.categoria, icona: r.icona } });
    if (comandoCalPronto()) setTimeout(() => eseguiComandoCal(a), 600);
    return { da: "scrigno", html: `${esc(a.icona)} Ho salvato in <b>${GRUPPI_APP[gruppoDi(a.categoria)].nome}</b>: <b>${esc(a.titolo)}</b><br>${giorno(a.inizio.slice(0, 10))}${a.tutto_il_giorno ? "" : `, dalle ${oraDa(a.inizio)} alle ${oraDa(a.fine)}`}${a.luogo ? `<br>📍 ${esc(a.luogo)}` : ""}
      ${comandoCalPronto() ? "<br>Lo aggiungo al Calendario…" : ""}`,
      azioni: [...(comandoCalPronto() ? [] : [{ t: "calApp", voce: a, etichetta: "📲 Aggiungi al Calendario" }]), { t: "annulla", url: `/api/appuntamenti/${a.id}`, etichetta: "↩️ Annulla" }] };
  }
  if (r.azione === "domanda") {
    if (r.cosa === "compleanno") {
      const x = trova(await api("/api/diario?tipo=compleanno"), r.nome);
      if (!x) return { da: "scrigno", html: `Non conosco ancora il compleanno di ${esc(r.nome)}. Dimmelo così: <i>il 6 agosto è il compleanno di ${esc(r.nome)}</i>` };
      const i = infoComp(x);
      return { da: "scrigno", html: `🎂 <b>${esc(x.titolo)}</b> compie gli anni il <b>${x.giorno} ${MESI_L[x.mese - 1]}</b>${i.anni ? ` (ne farà ${i.anni})` : ""}. ${i.quando}.` };
    }
    if (r.cosa === "compleanni") {
      const l = (await api("/api/diario?tipo=compleanno")).slice(0, 6);
      return { da: "scrigno", html: l.length ? `🎂 Prossimi compleanni:<br>${l.map((x) => `• <b>${esc(x.titolo)}</b> — ${x.giorno} ${MESI_L[x.mese - 1]} (${infoComp(x).quando.toLowerCase()})`).join("<br>")}` : "Non hai ancora salvato compleanni." };
    }
    if (["film", "libro", "serie"].includes(r.cosa)) {
      const l = (await api("/api/diario?tipo=" + r.cosa));
      const t = TIPI_D[r.cosa];
      return { da: "scrigno", html: l.length ? `${t.ico} ${t.plurale}: <b>${l.length}</b>. Gli ultimi:<br>${l.slice(0, 6).map((x) => `• <b>${esc(x.titolo)}</b>${x.voto ? " " + stelle(x.voto) : ""}${x.data ? ` <span class="muted">(${dataIt(x.data)})</span>` : ""}`).join("<br>")}` : `Non hai ancora salvato ${t.nome.toLowerCase()}.`,
        azioni: [{ t: "apri", hash: `#/diario/${r.cosa}`, etichetta: `${t.ico} Vedi tutti` }] };
    }
    if (r.cosa === "bilancio") {
      const l = await api("/api/diario?tipo=acquisto");
      if (!l.length) return { da: "scrigno", html: "Non hai ancora segnato acquisti. Scrivimi ad esempio <i>ho comprato una maglia a 40 euro</i>." };
      const b = bilancio(l);
      return { da: "scrigno", html: `💶 <b>Bilancio complessivo: <span class="${b.saldo >= 0 ? "su" : "giu"}">${segno(b.saldo)}</span></b><br>Spesi ${euro(b.speso)}, incassati ${euro(b.incassato)}.<br><br>
        🔁 <b>Solo comprato e rivenduto: <span class="${b.guadagno >= 0 ? "su" : "giu"}">${segno(b.guadagno)}</span></b><br>${b.nRiv} cos${b.nRiv === 1 ? "a" : "e"}: pagat${b.nRiv === 1 ? "a" : "e"} ${euro(b.spesoRiv)}, vendut${b.nRiv === 1 ? "a" : "e"} ${euro(b.incassatoRiv)}.<br><br>
        📦 Ancora da vendere: ${b.nMag} cos${b.nMag === 1 ? "a" : "e"} (${euro(b.magazzino)}).`, azioni: [{ t: "apri", hash: "#/diario/acquisto", etichetta: "💶 Vedi tutto" }] };
    }
    if (r.cosa === "esami") {
      const l = await api("/api/diario?tipo=esame");
      if (!l.length) return { da: "scrigno", html: "Non hai ancora segnato esami. Scrivimi ad esempio <i>ho passato l'esame di Analisi 1 con 28</i>." };
      const st = statEsami(l);
      return { da: "scrigno", html: `🎓 Esami superati: <b>${st.n}</b>${st.idonei ? ` + ${st.idonei} idoneità` : ""}, ${st.cfu} crediti${st.inCorso ? ` (+${st.inCorso} in corso)` : ""}<br>Media ponderata: <b>${dec(st.ponderata)}</b><br>Media aritmetica: <b>${dec(st.media)}</b><br>Base di laurea: <b>${dec(st.base, 1)}</b>/110${st.lodi ? `<br>Lodi: ${st.lodi} ✨` : ""}`,
        azioni: [{ t: "apri", hash: "#/diario/esame", etichetta: "🎓 I miei esami" }] };
    }
    if (r.cosa === "corsa") {
      const l = await api("/api/diario?tipo=corsa");
      if (!l.length) return { da: "scrigno", html: "Non hai ancora segnato corse. Scrivimi ad esempio <i>ho corso 5 km in 28 minuti</i>." };
      const st = statCorse(l), u = st.l[st.n - 1];
      return { da: "scrigno", html: `🏃 Hai corso <b>${kmT(st.km)} km</b> in ${st.n} cors${st.n === 1 ? "a" : "e"} (${kmT(st.mese)} km questo mese).<br>Passo medio: <b>${passoTesto(st.passo)} /km</b> · miglior passo: <b>${passoTesto(st.migliore.extra.passo)} /km</b><br>Ultima: ${kmT(u.extra.km)} km in ${tempoTesto(u.extra.secondi)} (${dataIt(u.data)})`,
        azioni: [{ t: "apri", hash: "#/corsa", etichetta: "📈 Grafici della corsa" }] };
    }
    if (r.cosa === "palestra") {
      const es = raggruppaEsercizi(await api("/api/diario?tipo=allenamento"));
      if (!es.length) return { da: "scrigno", html: "Non hai ancora segnato esercizi. Scrivimi ad esempio <i>panca piana 80 kg per 8</i>." };
      return { da: "scrigno", html: `🏋️ I tuoi esercizi:<br>${es.slice(0, 6).map((g) => `• <b>${esc(g.nome)}</b>: ${valoreForza(g.ultima.extra.kg, g.forze[g.forze.length - 1])}${g.voci.length > 1 ? ` (${g.progresso >= 0 ? "+" : ""}${Math.round(g.progresso)}% dalla prima volta)` : ""}`).join("<br>")}`,
        azioni: [{ t: "apri", hash: "#/palestra", etichetta: "🏋️ Apri Palestra" }] };
    }
    if (r.cosa === "visite") {
      const l = (await api("/api/appuntamenti")).slice(0, 5);
      return { da: "scrigno", html: l.length ? `🗓️ Prossimi appuntamenti:<br>${l.map((a) => `• <b>${esc(a.titolo)}</b> — ${giorno(a.inizio.slice(0, 10))}${a.tutto_il_giorno ? "" : " " + oraDa(a.inizio)}`).join("<br>")}` : "Nessun appuntamento in programma." };
    }
    if (r.cosa === "scadenze") {
      const l = (await api("/api/scadenze")).filter((d) => giorniA(d.scadenza) >= -30).slice(0, 5);
      return { da: "scrigno", html: l.length ? `⏰ Scadenze:<br>${l.map((d) => `• <b>${esc(d.nome)}</b> — ${dataIt(d.scadenza)}`).join("<br>")}` : "Nessuna scadenza impostata." };
    }
  }
  if (r.azione === "chiedi") {
    chatAttesa = r;
    if (r.motivo === "data_compleanno") return { da: "scrigno", html: `Quando è il compleanno${r.nome ? " di <b>" + esc(r.nome) + "</b>" : ""}? Scrivimi ad esempio <i>6 agosto</i>.` };
    if (r.motivo === "nome_compleanno") return { da: "scrigno", html: `Di chi è il compleanno del ${r.giorno} ${MESI_L[r.mese - 1]}?` };
    if (r.motivo === "titolo") return { da: "scrigno", html: `Qual è il titolo?` };
    if (r.motivo === "prezzo") return { da: "scrigno", html: r.vendita ? "A quanto l'hai venduto?" : "Quanto l'hai pagato?" };
  }
  if (r.azione === "importa_compleanni") return { da: "scrigno", html: "Certo! Posso prendere i compleanni dall'app Promemoria: tocca qui sotto e segui i passaggi.", azioni: [{ t: "importaComp", etichetta: "📥 Importa dai Promemoria" }] };
  if (r.azione === "saluto") return { da: "scrigno", html: r.grazie ? "Di niente! 😊" : `Ciao! 👋 Dimmi pure: un film visto, un libro letto, un compleanno da ricordare o una visita. Ad esempio:`, azioni: r.grazie ? [] : AIUTO.slice(0, 3).map((t) => ({ t: "scrivi", testo: t, etichetta: t })) };
  return { da: "scrigno", html: `Non ho capito bene 🤔 Prova a scrivere in uno di questi modi:`, azioni: AIUTO.map((t) => ({ t: "scrivi", testo: t, etichetta: t })) };
}

/* ------------------------------------------------------------------ presentazione */
function benvenuto(forza) {
  if (!forza && memo.get("benvenuto")) return;
  const pagine = [
    ["", "Benvenuto in LifeApp", "La tua app personale per documenti, scadenze, visite e password."],
    ["🗂️", "Tutti i tuoi documenti, in ordine", "Bollo, assicurazioni, analisi, patente, bollette: ogni cosa nella sua cartella, già pronta."],
    ["📷", "Aggiungere è facilissimo", "Fotografa un foglio o scegli un file. LifeApp ti suggerisce dove metterlo e ti ricorda quando scade."],
    ["💬", "Raccontami la tua giornata", "Nella chat scrivi “stasera ho visto After” o “il 6 agosto è il compleanno di Marco”: salvo tutto io nel tuo diario e ti ricordo i compleanni ogni anno."],
    ["🗓️", "Appuntamenti nel calendario", "Scrivi “il 16 dicembre dentista dalle 10 alle 11”: LifeApp capisce giorno e orario e lo mette nel Calendario dell'iPhone."],
    LOC ? ["🔒", "Tutto resta sul tuo iPhone", "Niente cloud: i documenti sono salvati solo sul telefono. Ogni tanto fai un backup su File (te lo ricordo io)."]
      : ["🔒", "Tutto resta a casa tua", "I documenti sono salvati sul tuo server, le password sono cifrate."],
  ];
  let i = 0;
  const v = document.createElement("div");
  v.className = "benvenuto";
  const chiudi = () => { memo.set("benvenuto", "1"); v.remove(); };
  const disegna = () => {
    const [ico, tit, txt] = pagine[i];
    v.innerHTML = `<div class="bv-box">${ico ? `<div class="bv-ico">${ico}</div>` : `<img class="logo" src="static/icona.svg" alt="">`}
      <h1>${tit}</h1><p>${txt}</p>
      <div class="punti">${pagine.map((_, k) => `<span class="${k === i ? "on" : ""}"></span>`).join("")}</div>
      <button class="btn block" id="bv-av">${i === pagine.length - 1 ? "Inizia" : "Avanti"}</button>
      ${i < pagine.length - 1 ? `<button class="link-btn" id="bv-salta">Salta</button>` : ""}</div>`;
    v.querySelector("#bv-av").onclick = () => { if (i < pagine.length - 1) { i++; disegna(); } else chiudi(); };
    v.querySelector("#bv-salta") && (v.querySelector("#bv-salta").onclick = chiudi);
  };
  disegna();
  document.body.appendChild(v);
}

/* ------------------------------------------------------------------ accesso (solo con server) */
function mostraAccesso() {
  $("#tabbar").hidden = true;
  const nuovo = !S.stato.configurato;
  app.innerHTML = `<div class="accesso"><form class="box" id="f">
    <img class="logo" src="static/icona.svg" alt="">
    <h1>LifeApp</h1><p>${nuovo ? "Benvenuto! Scegli una password per proteggere i tuoi documenti e cifrare le tue password." : "Il tuo archivio personale"}</p>
    <input type="password" id="pw" placeholder="${nuovo ? "Scegli una password (min. 6 caratteri)" : "Password"}" autocomplete="${nuovo ? "new-password" : "current-password"}">
    ${nuovo ? `<div style="height:10px"></div><input type="password" id="pw2" placeholder="Ripeti la password" autocomplete="new-password">` : ""}
    <div style="height:14px"></div><button class="btn block">${nuovo ? "Inizia" : "Entra"}</button>
    ${nuovo ? `<p class="small" style="margin-top:16px">⚠️ Non dimenticarla: senza, le password salvate non si possono recuperare.</p>` : ""}
  </form></div>`;
  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    const pw = $("#pw").value;
    if (nuovo && pw !== $("#pw2").value) return toast("Le password non coincidono");
    try {
      await api(nuovo ? "/api/configura" : "/api/accedi", { method: "POST", json: { password: pw } });
      S.stato = { configurato: true, accesso: true }; await avvia();
    } catch (err) { toast("⚠️ " + err.message); }
  };
}

/* ------------------------------------------------------------------ navigazione */
/* Passaggio animato tra le pagine (View Transitions, dove il browser le supporta) */
function render() { return renderPagina(); }
async function renderPagina() {
  if (!S.stato?.accesso) return;
  $("#tabbar").hidden = false;
  $$(".velo, .visore").forEach((v) => v.remove());
  const h = decodeURIComponent(location.hash.slice(2));
  const [sez, arg] = [h.split("/")[0], h.split("/").slice(1).join("/")];
  const tab = { "": "home", c: "cartelle", cerca: "cartelle", raccolta: "cartelle", scadenze: "cartelle", "da-smistare": "cartelle", password: "cartelle", io: "cartelle", palestra: "home", corsa: "home", corpo: "home", allenamento: "home" }[sez] || sez;
  document.body.classList.toggle("in-chat", sez === "chat");
  $$("#tabbar a").forEach((a) => a.classList.toggle("on", a.dataset.tab === tab));
  scrollTo(0, 0);
  const RACCOLTE = { assicura: "🛡️ Assicurazioni", bollo: "🧾 Bolli", revision: "🔧 Revisioni", salute: "🩺 Salute", document: "🪪 Documenti" };
  try {
    if (sez === "c") await vistaCartella(+arg);
    else if (sez === "da-smistare") await vistaDaSmistare();
    else if (sez === "agenda") await vistaAgenda();
    else if (sez === "password") await vistaPassword();
    else if (sez === "diario") await (arg ? vistaDiario(arg) : vistaDiarioMenu());
    else if (sez === "io") await vistaIo();
    else if (sez === "palestra") await (arg ? vistaEsercizio(arg) : vistaPalestra());
    else if (sez === "corsa") await vistaCorsa();
    else if (sez === "corpo") await vistaCorpo();
    else if (sez === "cartelle") await vistaCartelle();
    else if (sez === "allenamento") await vistaAllenamento(arg);
    else if (sez === "chat") vistaChat(arg || "");
    else if (sez === "altro") await (LOC ? vistaAltroLocale() : vistaAltroServer());
    else if (sez === "scadenze") await vistaScadenze();
    else if (sez === "cerca") await vistaElenco("Risultati", `per “${esc(arg)}”`, "/api/documenti?cerca=" + encodeURIComponent(arg));
    else if (sez === "raccolta") await vistaElenco(RACCOLTE[arg] || esc(arg), "Da tutte le cartelle", "/api/documenti?raccolta=" + encodeURIComponent(arg));
    else await vistaHome();
  } catch (e) {
    console.error(e);
    if (S.stato?.accesso) app.innerHTML = `<div class="vuoto"><span class="big">⚠️</span>${esc(e.message)}<br><br><button class="btn" onclick="render()">Riprova</button></div>`;
  }
}

async function avvia() {
  try { S.stato = await api("/api/stato"); }
  catch (e) {
    app.innerHTML = `<div class="vuoto"><span class="big">📡</span>${LOC ? "Non riesco ad aprire la memoria del telefono.<br>" + esc(e.message) : "Server non raggiungibile.<br>Sei connesso al Wi-Fi di casa?"}<br><br><button class="btn" onclick="avvia()">Riprova</button></div>`;
    return;
  }
  if (!S.stato.accesso) return mostraAccesso();
  await caricaCartelle();
  render();
  benvenuto();
}
addEventListener("hashchange", render);
document.addEventListener("pointerdown", (e) => {
  const el = e.target.closest(".voce, .cartella, .chip, .btn, .azioni-home button, .numeri a, .tabbar a, .sugg, .iconbtn");
  if (!el) return;
  el.classList.add("premuto");
  if (navigator.vibrate && e.pointerType === "touch") navigator.vibrate(6);
  const via = () => { el.classList.remove("premuto"); removeEventListener("pointerup", via); removeEventListener("pointercancel", via); };
  addEventListener("pointerup", via); addEventListener("pointercancel", via);
}, { passive: true });
document.addEventListener("click", (e) => { const b = e.target.closest("[data-cp]"); if (b) copia(b.dataset.cp); });
document.addEventListener("visibilitychange", () => { if (!document.hidden && S.stato?.accesso) { svuotaMemoria(); caricaCartelle().catch(() => {}); } });
if ("serviceWorker" in navigator && window.isSecureContext) navigator.serviceWorker.register("sw.js").catch(() => {});
applicaAspetto();
avvia();
