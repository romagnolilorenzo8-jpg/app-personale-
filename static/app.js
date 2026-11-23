/* Scrigno — interfaccia (nessuna dipendenza esterna).
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
const COL_CAT = { salute: "#e5484d", veicoli: "#3b82f6", casa: "#e8a23a", lavoro: "#0ea5a4", altro: "#8b5cf6" };
const CMD_CAL = "Scrigno Calendario";
const CMD_INVIA = "Invia a Scrigno";

const S = { cartelle: [], byId: {}, figli: {}, daSmistare: 0, stato: null };
const memo = { get: (k) => { try { return localStorage.getItem("scrigno-" + k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem("scrigno-" + k) : localStorage.setItem("scrigno-" + k, v); } catch { /* */ } } };

/* ================================================================== utilità */
/* Le pagine già viste si aprono subito: le risposte restano valide 20 secondi
   e vengono cancellate a ogni modifica (salvataggio, spostamento, eliminazione…). */
const memoria = new Map();
const svuotaMemoria = () => memoria.clear();
async function api(url, opts = {}) {
  if (LOC) return window.LOCALE.api(url, opts);
  const get = !opts.method || opts.method.toUpperCase() === "GET";
  if (get) { const c = memoria.get(url); if (c && Date.now() - c.t < 20000) return c.v; }
  else svuotaMemoria();
  const dati = await apiRete(url, opts);
  if (get && !/cassaforte|impostazioni/.test(url)) memoria.set(url, { t: Date.now(), v: dati });
  return dati;
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
  [/bollo/, /^bollo/], [/assicura|polizza|rca\b|quietanza/, /^assicurazione/], [/revision/, /^revisione/],
  [/libretto|carta di circolazione/, /^libretto/], [/tagliando|manutenz|officina|gomme/, /^manutenzione/],
  [/analisi|emocromo|sangue|prelievo|laboratorio/, /^analisi del sangue/],
  [/panoramica|ortopan|rx.*dent|radiograf.*dent|dentist|odonto/, /^radiografie denti/],
  [/referto|visita|lettera di dimissione/, /^referti/], [/ecograf|risonanza|\btac\b|radiograf|\brx\b/, /^esami e radiografie/],
  [/ricetta|farmac/, /^ricette/], [/vaccin|green ?pass/, /^vaccini/],
  [/bolletta|enel|\bluce\b|\bgas\b|acqua|\btari\b/, /^bollette/], [/contratto|affitto/, /^contratti/],
  [/garanzia|scontrino|fattura/, /^garanzie/], [/busta paga|cedolino/, /^buste paga/], [/\b730\b|redditi|\bf24\b|\bcud\b|certificazione unica/, /^dichiarazione/],
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
    try { await window.LOCALE.carica(files, { cartella, scadenza, nome }); await fine(true); }
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
    <p class="muted" style="margin-top:-6px">Si fa <b>una volta sola</b> (circa 2 minuti). Poi ogni visita che salvi in Scrigno finisce <b>da sola</b> nel Calendario dell'iPhone, con promemoria.</p>
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
    <div style="flex:1"><b>Installa Scrigno sulla Home</b>
      <div class="small">Tocca <b>Condividi</b> <span class="ios-share">⎙</span> → <b>Aggiungi alla schermata Home</b>.${LOC ? " Poi apri Scrigno sempre dall'icona: lì i documenti restano al sicuro." : ""}</div>
      <button class="link-btn" id="non-ora">Più tardi</button></div></div>`;
}

async function vistaHome() {
  const [recenti, appts, scad, info, comp] = await Promise.all([api("/api/documenti?recenti=true"), api("/api/appuntamenti"), api("/api/scadenze"),
    LOC ? api("/api/impostazioni") : Promise.resolve(null), api("/api/diario?tipo=compleanno")]);
  const compVicini = comp.filter((x) => infoComp(x).g <= 30);
  const compOggi = comp.filter((x) => infoComp(x).g <= 1);
  const scadImm = scad.filter((d) => giorniA(d.scadenza) <= 60);
  const ora = new Date().getHours();
  const saluto = ora < 6 ? "Buonanotte" : ora < 13 ? "Buongiorno" : ora < 18 ? "Buon pomeriggio" : "Buonasera";
  const oggi = new Date();
  const backupVecchio = LOC && info.documenti > 0 && (!info.ultimo_backup || giorniA(info.ultimo_backup.slice(0, 10)) < -30);
  app.innerHTML = `
    <div class="top"><h1>${saluto} 👋<small>${GIORNI[oggi.getDay()]} ${oggi.getDate()} ${MESI_L[oggi.getMonth()]}</small></h1>
      <a class="iconbtn" href="#/altro" aria-label="Impostazioni">⚙️</a></div>
    ${bannerInstalla()}
    ${compOggi.map((x) => `<a class="avviso festa" href="#/diario/compleanno"><div class="av-ico">🎂</div><div style="flex:1"><b>${infoComp(x).g === 0 ? "Oggi" : "Domani"} è il compleanno di ${esc(x.titolo)}!</b><div class="small">${infoComp(x).anni ? `Compie ${infoComp(x).anni} anni. ` : ""}Ricordati di fargli gli auguri 🎉</div></div></a>`).join("")}
    <form class="chat-home" id="f-chat"><span>💬</span><input type="text" id="cq" placeholder="Scrivi a Scrigno: “ho visto After”…" enterkeyhint="send"><button aria-label="Invia">➤</button></form>
    <form class="cerca" id="f-cerca"><input type="search" id="q" placeholder="Cerca un documento…" enterkeyhint="search"></form>
    <div class="azioni-home">
      <button data-h="foto"><span class="ah-ico" style="--c:#5b5bf6">📷</span>Fotografa</button>
      <button data-h="file"><span class="ah-ico" style="--c:#0ea5a4">📄</span>Carica file</button>
      <button data-h="visita"><span class="ah-ico" style="--c:#e5484d">🗓️</span>Nuova visita</button>
      <button data-h="pw"><span class="ah-ico" style="--c:#e8a23a">🔑</span>Password</button>
    </div>
    ${S.daSmistare ? `<a class="avviso" href="#/da-smistare"><div class="av-ico">📥</div><div style="flex:1"><b>${S.daSmistare} document${S.daSmistare === 1 ? "o" : "i"} da sistemare</b><div class="small muted">Tocca per metterl${S.daSmistare === 1 ? "o" : "i"} nella cartella giusta</div></div><span class="dx">›</span></a>` : ""}
    ${backupVecchio ? `<a class="avviso" href="#/altro"><div class="av-ico">💾</div><div style="flex:1"><b>Fai un backup</b><div class="small muted">${info.ultimo_backup ? "L'ultimo è del " + dataIt(info.ultimo_backup.slice(0, 10)) : "Non hai ancora salvato una copia"} — serve 1 minuto</div></div><span class="dx">›</span></a>` : ""}
    <div class="sezione"><h2>Prossime visite</h2><a href="#/agenda">Tutte</a></div>
    ${appts.length ? `<div class="lista" id="h-appt">${appts.slice(0, 2).map(htmlAppt).join("")}</div>`
      : `<a class="card vuoto-mini" href="#/agenda">🗓️ Nessuna visita in programma. <b>Aggiungine una →</b></a>`}
    ${compVicini.length ? `<div class="sezione"><h2>Compleanni in arrivo</h2><a href="#/diario/compleanno">Tutti</a></div><div class="lista" id="h-comp">${compVicini.slice(0, 3).map(htmlVoceDiario).join("")}</div>` : ""}
    ${scadImm.length ? `<div class="sezione"><h2>Scadenze vicine</h2><a href="#/scadenze">Tutte</a></div><div id="h-scad">${htmlDocs(scadImm.slice(0, 3), { mostraCartella: true })}</div>` : ""}
    <div class="sezione"><h2>Le tue cartelle</h2><a href="#" id="nuova-rad">＋ Nuova</a></div>
    ${htmlCartelle(S.figli.root || [])}
    <div class="sezione"><h2>Raccolte</h2></div>
    <div class="chips">
      <a class="chip" href="#/raccolta/assicura">🛡️ Tutte le assicurazioni</a><a class="chip" href="#/raccolta/bollo">🧾 Tutti i bolli</a>
      <a class="chip" href="#/raccolta/revision">🔧 Revisioni</a><a class="chip" href="#/scadenze">⏰ Scadenze</a><a class="chip" href="#/raccolta/salute">🩺 Salute</a>
    </div>
    ${recenti.length ? `<div class="sezione"><h2>Aggiunti di recente</h2></div><div id="recenti">${htmlDocs(recenti.slice(0, 6), { mostraCartella: true })}</div>` : ""}`;
  $("#non-ora") && ($("#non-ora").onclick = () => { sessionStorage.setItem("no-installa", "1"); $(".avviso.install").remove(); });
  $("#f-chat").onsubmit = (e) => { e.preventDefault(); const t = $("#cq").value.trim(); location.hash = t ? "#/chat/" + encodeURIComponent(t) : "#/chat"; };
  $("#h-comp") && ($("#h-comp").onclick = (e) => { const v = e.target.closest("[data-dv]"); if (v) modificaVoceDiario(comp.find((x) => x.id === +v.dataset.dv), render); });
  $("#f-cerca").onsubmit = (e) => { e.preventDefault(); const q = $("#q").value.trim(); if (q) location.hash = "#/cerca/" + encodeURIComponent(q); };
  $(".azioni-home").onclick = (e) => {
    const h = e.target.closest("[data-h]")?.dataset.h; if (!h) return;
    if (h === "foto" || h === "file") scegliFile({ foto: h === "foto", dopo: render });
    if (h === "visita") location.hash = "#/agenda";
    if (h === "pw") location.hash = "#/password";
  };
  $("#nuova-rad").onclick = async (e) => {
    e.preventDefault();
    const nome = await chiedi("Nuova cartella principale", "", { placeholder: "Es. Animali, Scuola, Viaggi…" }); if (!nome) return;
    await api("/api/cartelle", { method: "POST", json: { nome, padre: null } }); await caricaCartelle(); render();
  };
  $("#h-appt") && ($("#h-appt").onclick = (e) => { const v = e.target.closest("[data-app]"); if (v) apriAppuntamento(appts.find((a) => a.id === +v.dataset.app), render); });
  if (recenti.length) collegaDocs($("#recenti"), recenti, render);
  if (scadImm.length) collegaDocs($("#h-scad"), scadImm, render);
}

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
    <div class="crumbs"><a href="#/">🏠 Home</a>${perc.map((p) => ` › <a href="#/c/${p.id}">${esc(p.nome)}</a>`).join("")}</div>
    ${figli.length ? htmlCartelle(figli) : ""}
    ${docs.length ? `<div class="sezione"><h2>Documenti</h2><span class="muted small">${docs.length}</span></div><div id="docs">${htmlDocs(docs)}</div>` : ""}
    ${!docs.length ? `<button class="vuoto-cta" id="agg"><span class="big">${figli.length ? "📄" : esc(c.icona)}</span><b>${figli.length ? "Aggiungi un documento qui" : "Questa cartella è vuota"}</b><span class="muted small">Tocca per fotografare o scegliere un file</span></button>` : ""}`;
  const ric = () => vistaCartella(id);
  if (docs.length) collegaDocs($("#docs"), docs, ric);
  $("#agg") && ($("#agg").onclick = () => $(".fab").click());
  $("#menu").onclick = () => {
    const v = foglio(`<h3>${esc(c.icona)} ${esc(c.nome)} ${xBtn}</h3><div class="lista">
      <div class="voce" data-m="sotto"><div class="thumb">📁</div><div class="corpo"><div class="tit">Nuova sottocartella</div></div></div>
      <div class="voce" data-m="rinomina"><div class="thumb">✏️</div><div class="corpo"><div class="tit">Rinomina</div></div></div>
      <div class="voce" data-m="icona"><div class="thumb">😀</div><div class="corpo"><div class="tit">Cambia icona</div><div class="sub">Scegli una emoji</div></div></div>
      <div class="voce" data-m="sposta"><div class="thumb">↪️</div><div class="corpo"><div class="tit">Sposta cartella</div></div></div>
      <div class="voce" data-m="elimina"><div class="thumb">🗑️</div><div class="corpo"><div class="tit" style="color:var(--danger)">Elimina cartella</div><div class="sub">I documenti non vengono cancellati: tornano in “Da smistare”</div></div></div></div>`);
    v.addEventListener("click", async (e) => {
      const m = e.target.closest("[data-m]")?.dataset.m; if (!m) return; v.remove();
      try {
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
    ${LOC ? `<div class="card" style="margin-top:16px"><b>📂 Hai salvato file nell'app File?</b><p class="small muted" style="margin:6px 0 12px">Se usi il comando “${CMD_INVIA}” dal menu Condividi, i file finiscono in <b>File › Scrigno › In arrivo</b>. Importali da qui:</p>
      <button class="btn block" id="importa">📂 Importa da File</button></div>` : ""}`;
  if (docs.length) collegaDocs($("#docs"), docs, vistaDaSmistare);
  $("#importa") && ($("#importa").onclick = () => scegliFile({ dopo: vistaDaSmistare }));
  fab(undefined, vistaDaSmistare);
}

async function vistaElenco(titolo, sotto, url) {
  const docs = await api(url);
  app.innerHTML = `<div class="top"><a class="iconbtn" href="#/">‹</a><h1 style="font-size:26px">${titolo}<small>${sotto}</small></h1></div>
    ${docs.length ? `<div id="docs">${htmlDocs(docs, { mostraCartella: true })}</div>` : `<div class="vuoto"><span class="big">🔎</span>Nessun documento trovato.</div>`}`;
  if (docs.length) collegaDocs($("#docs"), docs, render);
}

async function vistaScadenze() {
  const docs = await api("/api/scadenze");
  app.innerHTML = `<div class="top"><a class="iconbtn" href="#/">‹</a><h1 style="font-size:26px">⏰ Scadenze<small>Bolli, assicurazioni, revisioni, documenti</small></h1></div>
    ${docs.length ? `<div id="docs">${htmlDocs(docs, { mostraCartella: true })}</div>`
      : `<div class="vuoto"><span class="big">⏰</span>Nessuna scadenza impostata.<br>Quando salvi un bollo o un'assicurazione, Scrigno ti chiede quando scade.<br>Puoi anche aprire un documento e toccare <b>⏰ Aggiungi scadenza</b>.</div>`}`;
  if (docs.length) collegaDocs($("#docs"), docs, vistaScadenze);
}

/* ------------------------------------------------------------------ agenda */
function formAppuntamento(a) {
  return `<label class="campo"><span>Cosa</span><input type="text" id="a-tit" value="${esc(a.titolo)}"></label>
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
  return { ...base, titolo: $("#a-tit", el).value.trim(), tutto_il_giorno: tutto,
    inizio: tutto ? g : `${g}T${$("#a-da", el).value || "09:00"}`, fine: tutto ? g : `${g}T${$("#a-a", el).value || "10:00"}`,
    luogo: $("#a-luogo", el).value.trim(), note: $("#a-note", el).value.trim() };
}
function collegaForm(el) {
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
  return `<div class="voce" data-app="${a.id}"><div class="datebox" style="--c:${COL_CAT[a.categoria] || COL_CAT.altro}"><div class="m">${MESI[d.getMonth()]}</div><div class="g">${d.getDate()}</div></div>
    <div class="corpo"><div class="tit">${esc(a.icona)} ${esc(a.titolo)}</div><div class="sub">${GIORNI[d.getDay()]} · ${quando}${a.luogo ? " · " + esc(a.luogo) : ""}</div>${rel ? `<div style="margin-top:4px">${rel}</div>` : ""}</div><div class="dx">›</div></div>`;
}

async function vistaAgenda() {
  const appts = await api("/api/appuntamenti");
  const perMese = {};
  appts.forEach((a) => (perMese[a.inizio.slice(0, 7)] ||= []).push(a));
  app.innerHTML = `<div class="top"><h1>Visite<small>Scrivi o detta: al calendario ci penso io</small></h1></div>
    <div class="scrivi">
      <div class="scrivi-tit">✍️ Nuova visita o appuntamento</div>
      <textarea id="testo" rows="2" placeholder="Es. Il 16 dicembre controllo dal dentista dalle 10 alle 11"></textarea>
      <div class="small muted" style="margin:2px 4px 8px">🎙️ Puoi anche dettare: tocca il microfono sulla tastiera.</div>
      <div class="esempi" id="esempi"><span class="small muted">Prova:</span>
        <button>Domani alle 15 analisi del sangue</button><button>Lunedì oculista alle 9:30</button><button>Il 3 marzo revisione motorino</button></div>
      <div id="prev"></div>
    </div>
    ${!comandoCalPronto() ? `<button class="avviso" id="collega" style="margin-top:14px;width:100%;text-align:left"><div class="av-ico">📲</div>
      <div style="flex:1"><b>Collega il Calendario dell'iPhone</b><div class="small muted">Una volta sola: poi le visite finiscono da sole nel calendario.</div></div><span class="dx">›</span></button>` : ""}
    <div id="elenco">${appts.length ? Object.entries(perMese).map(([k, l]) => `<div class="mese">${MESI_L[+k.slice(5) - 1]} ${k.slice(0, 4)}</div><div class="lista">${l.map(htmlAppt).join("")}</div>`).join("")
      : `<div class="vuoto"><span class="big">🗓️</span>Nessuna visita in programma.</div>`}</div>`;
  $("#collega") && ($("#collega").onclick = () => configuraCalendario());
  const ta = $("#testo"), prev = $("#prev");
  let timer, ultimo;
  const analizza = async () => {
    const t = ta.value.trim();
    if (!t) { prev.innerHTML = ""; return; }
    const r = await api("/api/appuntamenti/analizza", { method: "POST", json: { testo: t } });
    if (ta.value.trim() !== t) return;
    ultimo = r;
    const capito = r.data ? `✨ Ho capito: <b>${esc(r.titolo)}</b>, ${GIORNI[new Date(r.data + "T00:00").getDay()]} ${dataIt(r.data)}${r.tutto_il_giorno ? "" : `, dalle ${r.ora_inizio} alle ${r.ora_fine}`}. Controlla e salva.`
      : "🤔 Non ho trovato il giorno. Scrivilo (es. “il 16 dicembre”, “domani”, “lunedì”) oppure sceglilo qui sotto.";
    prev.innerHTML = `<div class="anteprima"><div class="capito">${capito}</div>${formAppuntamento({ ...r, inizio: r.inizio || oggiIso() })}
      <button class="btn block" id="salva">🗓️ Salva${comandoCalPronto() ? " e aggiungi al Calendario" : ""}</button></div>`;
    collegaForm(prev);
    $("#salva").onclick = async () => {
      const dati = leggiForm(prev, { categoria: ultimo.categoria, icona: ultimo.icona });
      if (!dati.titolo) return toast("Scrivi cosa devi fare");
      if (!dati.inizio || dati.inizio.length < 10) return toast("Scegli il giorno");
      try {
        const a = await api("/api/appuntamenti", { method: "POST", json: dati });
        ta.value = ""; prev.innerHTML = "";
        dopoSalvataggio(a);
      } catch (err) { toast("⚠️ " + err.message); }
    };
  };
  ta.oninput = () => { clearTimeout(timer); timer = setTimeout(analizza, 300); };
  $("#esempi").onclick = (e) => { if (e.target.tagName === "BUTTON") { ta.value = e.target.textContent; analizza(); } };
  $("#elenco").onclick = (e) => { const v = e.target.closest("[data-app]"); if (v) apriAppuntamento(appts.find((a) => a.id === +v.dataset.app), vistaAgenda); };
}

function dopoSalvataggio(a) {
  if (comandoCalPronto()) { toast("✅ Salvato. Lo aggiungo al Calendario…"); vistaAgenda(); setTimeout(() => eseguiComandoCal(a), 400); return; }
  foglio(`<div style="text-align:center;padding:6px 0 4px"><div style="font-size:54px">✅</div>
    <h3 style="justify-content:center">Visita salvata</h3>
    <p class="muted" style="margin-top:-8px">${esc(a.icona)} <b>${esc(a.titolo)}</b><br>${dataIt(a.inizio)}${a.tutto_il_giorno ? "" : ` · ${oraDa(a.inizio)}–${oraDa(a.fine)}`}</p></div>
    <button class="btn block" id="cal">📲 Aggiungi al Calendario dell'iPhone</button>
    <div style="height:8px"></div><button class="btn sec block" data-chiudi>Fatto</button>`, { onClose: vistaAgenda });
  $("#cal").onclick = () => { $$(".velo").forEach((x) => x.remove()); vistaAgenda(); aggiungiAlCalendario(a); };
}

function apriAppuntamento(a, ricarica) {
  const v = foglio(`<h3>${esc(a.icona)} Visita ${xBtn}</h3>${formAppuntamento(a)}
    <button class="btn block" id="salva">Salva modifiche</button>
    <div class="azioni"><button class="btn sec" id="cal">📲 Al Calendario</button><button class="btn danger" id="elimina">🗑️ Elimina</button></div>
    <p class="small muted" style="margin:10px 4px 0">Se modifichi o elimini una visita già nel Calendario dell'iPhone, ricordati di cambiarla anche lì.</p>`);
  collegaForm(v);
  $("#salva", v).onclick = async () => {
    try { await api(`/api/appuntamenti/${a.id}`, { method: "PUT", json: leggiForm(v, { categoria: a.categoria, icona: a.icona }) }); v.remove(); toast("✅ Salvato"); ricarica(); }
    catch (err) { toast("⚠️ " + err.message); }
  };
  $("#cal", v).onclick = () => { v.remove(); aggiungiAlCalendario({ ...a, ...leggiForm(v, { categoria: a.categoria, icona: a.icona }) }); };
  $("#elimina", v).onclick = async () => {
    if (!(await conferma(`Eliminare “${a.titolo}”?`))) return;
    await api(`/api/appuntamenti/${a.id}`, { method: "DELETE" }); v.remove(); toast("🗑️ Eliminata"); ricarica();
  };
}

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
    <p class="small muted">Scrigno usa un Comando Rapido per inserire le visite nel Calendario, con promemoria.</p>${istruzioniCal()}
    <button class="btn block" id="cal-ok">${comandoCalPronto() ? "🧪 Prova il comando" : "✅ Ho creato il comando"}</button>
    ${comandoCalPronto() ? `<button class="link-btn" id="cal-reset">Scollega</button>` : ""}</div></details>`;
function collegaSezioneCal(ricarica) {
  $("#cal-ok").onclick = () => {
    memo.set("cmd-cal", "1");
    const d = new Date(); d.setDate(d.getDate() + 1);
    const g = new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    eseguiComandoCal({ titolo: "Prova Scrigno (puoi cancellarla)", icona: "🧪", inizio: g + "T10:00", fine: g + "T10:30", luogo: "", note: "Evento di prova creato da Scrigno" });
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
    ${passo(3, "Da ora apri Scrigno <b>solo dall'icona</b> sulla Home.")}</div></details>` : ""}

  ${sezioneCal()}

  <details class="card"><summary><span class="sum-ico">📤</span><span>Ricevere file dal menu “Condividi”<br><span class="small muted">Da WhatsApp, Mail, Foto, Safari…</span></span></summary><div class="dentro">
    <p class="small muted">Senza server, iPhone non permette di mandare un file direttamente dentro Scrigno. Il modo più comodo:</p>
    <p class="small"><b>Metodo veloce (senza configurare niente):</b> da qualsiasi app tocca <b>Condividi</b> → <b>Salva su File</b> → scegli la cartella <b>Scrigno › In arrivo</b> (creala la prima volta). Poi in Scrigno: <b>Da smistare → Importa da File</b>.</p>
    <p class="small"><b>Metodo con un tocco solo</b>: crea un Comando Rapido che salva il file al posto tuo.</p>
    ${passo(1, `Comandi Rapidi → <b>+</b> → chiamalo ${cod(CMD_INVIA)}`)}
    ${passo(2, "Tocca <b>ⓘ</b> in basso → attiva <b>Mostra nel foglio di condivisione</b>.")}
    ${passo(3, "Aggiungi l'azione <b>Salva file</b>: salva <b>Input comando rapido</b>, disattiva <b>Chiedi dove salvare</b> e scegli la cartella <b>Scrigno › In arrivo</b> in iCloud Drive o Sul mio iPhone.")}
    ${passo(4, "Aggiungi <b>Mostra notifica</b> con il testo “Salvato per Scrigno ✅”.")}
    <p class="small muted">Quando avrai il server di casa, i file arriveranno direttamente in Scrigno, senza passare da File.</p></div></details>

  <details class="card" open><summary><span class="sum-ico">💾</span><span>Backup<br><span class="small muted">${s.ultimo_backup ? "Ultimo: " + dataIt(s.ultimo_backup.slice(0, 10)) : "Mai fatto"}</span></span></summary><div class="dentro">
    <p class="small muted">I documenti sono salvati <b>solo su questo iPhone</b>. Il backup crea un unico file con tutto (le password restano cifrate) da salvare nell'app <b>File</b> (meglio su iCloud Drive o su un computer). Ti servirà anche per spostare tutto sul server di casa.</p>
    <button class="btn block" id="bk">💾 Crea backup e salvalo su File</button>
    <button class="btn sec block" id="rip" style="margin-top:8px">♻️ Ripristina da un backup</button></div></details>

  <div class="sezione"><h2>Memoria</h2></div>
  <div class="card"><b>${s.documenti} document${s.documenti === 1 ? "o" : "i"}</b> · ${s.uso != null ? dimensione(s.uso) + " usati" : ""}
    ${percentuale != null ? `<div class="progresso"><div style="width:${percentuale}%"></div></div><div class="small muted" style="margin-top:6px">Spazio disponibile per Scrigno: circa ${dimensione(s.quota)}</div>` : ""}
    <div class="small muted" style="margin-top:6px">${s.persistente ? "✅ iPhone conserverà questi dati." : "ℹ️ Installa Scrigno sulla Home e fai backup regolari: così i dati sono al sicuro."}</div></div>

  <div class="sezione"><h2>Sicurezza</h2></div>
  <div class="lista"><a class="voce" href="#/password"><div class="thumb">🔐</div><div class="corpo"><div class="tit">Le mie password</div></div><div class="dx">›</div></a><div class="voce" id="cambia"><div class="thumb">🔑</div><div class="corpo"><div class="tit">Cambia password della cassaforte</div></div><div class="dx">›</div></div>
    <div class="voce" id="intro"><div class="thumb">👋</div><div class="corpo"><div class="tit">Rivedi la presentazione</div></div><div class="dx">›</div></div></div>

  <div class="sezione"><h2>Server di casa</h2></div>
  <div class="card small">Quando il computer di casa sarà pronto: crea un backup qui, apri Scrigno dal server e vai su <b>Altro → Importa backup dall'iPhone</b>. Tutto (cartelle, documenti, visite, password) verrà copiato lì.</div>
  <input type="file" id="file-backup" accept=".zip,application/zip" hidden>`;
  collegaSezioneCal(vistaAltroLocale);
  $("#bk").onclick = async () => {
    const v = foglio(`<h3>Preparo il backup…</h3><div class="progresso"><div style="width:70%"></div></div>`);
    try { const f = await window.LOCALE.esportaBackup(); v.remove(); await condividiFile(f); toast("💾 Backup pronto: scegli “Salva su File”"); vistaAltroLocale(); }
    catch (e) { v.remove(); toast("⚠️ " + e.message); }
  };
  $("#rip").onclick = () => $("#file-backup").click();
  $("#file-backup").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (!(await conferma("Ripristinare questo backup?", "Ripristina", "Tutto quello che c'è ora in Scrigno su questo iPhone verrà sostituito dal contenuto del backup."))) return;
    try { const r = await window.LOCALE.ripristina(f); await caricaCartelle(); toast(`♻️ Ripristinati ${r.documenti} documenti e ${r.appuntamenti} visite`); location.hash = "#/"; }
    catch (err) { toast("⚠️ " + err.message); }
  };
  $("#cambia").onclick = () => cambiaPassword("Cambia password della cassaforte");
  $("#intro").onclick = () => benvenuto(true);
}

async function vistaAltroServer() {
  const s = await api("/api/impostazioni");
  const base = location.origin;
  const feed = `webcal://${location.host}/calendario/${s.token_calendario}.ics`;
  app.innerHTML = `<div class="top"><h1>Altro<small>Collega Scrigno al tuo iPhone</small></h1></div>

  <details class="card"><summary><span class="sum-ico">📤</span><span>Invia file dal menu “Condividi”</span></summary><div class="dentro">
    <p class="small muted">Crei una volta sola un Comando Rapido: comparirà nel menu Condividi di qualsiasi app. I file arrivano in <b>📥 Da smistare</b>.</p>
    ${passo(1, `Apri <b>Comandi Rapidi</b> → <b>+</b> → chiamalo ${cod(CMD_INVIA)}`)}
    ${passo(2, "Tocca <b>ⓘ</b> e attiva <b>Mostra nel foglio di condivisione</b>.")}
    ${passo(3, `Aggiungi <b>Ottieni contenuti dell'URL</b> con questo URL:${cod(base + "/api/documenti")}`)}
    ${passo(4, `<b>Mostra di più</b>: Metodo <b>POST</b>. In <b>Intestazioni</b> aggiungi chiave <b>X-Token</b> con valore:${cod(s.token_api)}`)}
    ${passo(5, "Corpo richiesta: <b>Modulo</b>. Aggiungi un campo <b>File</b> con chiave <b>file</b> e valore <b>Input comando rapido</b>.")}
    ${passo(6, "Aggiungi <b>Mostra notifica</b>: “Salvato in Scrigno ✅”.")}</div></details>

  ${sezioneCal()}

  <details class="card"><summary><span class="sum-ico">🔄</span><span>Calendario sempre aggiornato (abbonamento)</span></summary><div class="dentro">
    <p class="small muted">In alternativa al comando: l'iPhone si abbona al calendario di Scrigno e scarica da solo visite e scadenze ogni 15 minuti (funziona quando sei sulla rete di casa).</p>
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

/* ================================================================== DIARIO: film, libri, serie, compleanni */
const TIPI_D = {
  film: { ico: "🎬", nome: "Film", plurale: "Film visti", verbo: "visto il", vuoto: "Scrivi in chat: “stasera ho visto After”" },
  libro: { ico: "📚", nome: "Libri", plurale: "Libri letti", verbo: "letto il", vuoto: "Scrivi in chat: “ho letto Il nome della rosa”" },
  serie: { ico: "📺", nome: "Serie TV", plurale: "Serie viste", verbo: "vista il", vuoto: "Scrivi in chat: “ho finito la serie Stranger Things”" },
  compleanno: { ico: "🎂", nome: "Compleanni", plurale: "Compleanni", verbo: "", vuoto: "Scrivi in chat: “il 6 agosto è il compleanno di Marco Rossi”" },
};
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
  const t = TIPI_D[x.tipo];
  return `<div class="voce" data-dv="${x.id}"><div class="thumb poster" style="--c:${COLORI[(x.titolo.charCodeAt(0) || 0) % COLORI.length]}">${t.ico}</div>
    <div class="corpo"><div class="tit">${esc(x.titolo)}</div>
    <div class="sub">${[x.autore ? esc(x.autore) : "", x.stato === "in corso" ? "📖 in corso" : "", x.data ? dataIt(x.data) : ""].filter(Boolean).join(" · ")}</div>
    ${x.voto ? `<div class="stelle">${stelle(x.voto)}</div>` : ""}
    ${x.commento ? `<div class="commento">“${esc(x.commento)}”</div>` : ""}</div><div class="dx">›</div></div>`;
}

async function vistaDiario(tipo) {
  tipo = TIPI_D[tipo] ? tipo : "film";
  const tutte = await api("/api/diario");
  const conta = (t) => tutte.filter((x) => x.tipo === t).length;
  const lista = tutte.filter((x) => x.tipo === tipo);
  const t = TIPI_D[tipo];
  app.innerHTML = `<div class="top"><h1>Diario<small>La mia vita: film, libri, serie e compleanni</small></h1></div>
    <div class="segmenti">${Object.entries(TIPI_D).map(([k, v]) => `<a href="#/diario/${k}" class="${k === tipo ? "on" : ""}"><span>${v.ico}</span>${v.nome}<b>${conta(k) || ""}</b></a>`).join("")}</div>
    <a class="chat-invito" href="#/chat"><span>💬</span><span>${t.vuoto}</span></a>
    ${tipo === "compleanno" ? `<div class="riga" style="margin:4px 0 12px"><button class="btn sec" id="imp-comp">📥 Importa dai Promemoria</button>${lista.length ? `<button class="btn sec" id="cal-comp">🔔 Notifiche</button>` : ""}</div>` : ""}
    ${lista.length ? `<div class="lista" id="dl">${lista.map(htmlVoceDiario).join("")}</div>`
      : `<div class="vuoto"><span class="big">${t.ico}</span>Ancora niente qui.<br>Tocca <b>＋</b> oppure scrivilo in chat.</div>`}`;
  $("#dl") && ($("#dl").onclick = (e) => { const v = e.target.closest("[data-dv]"); if (v) modificaVoceDiario(lista.find((x) => x.id === +v.dataset.dv), () => vistaDiario(tipo)); });
  $("#cal-comp") && ($("#cal-comp").onclick = () => notificheCompleanni(lista));
  $("#imp-comp") && ($("#imp-comp").onclick = () => importaCompleanni(() => vistaDiario("compleanno")));
  const b = document.createElement("button"); b.className = "fab"; b.innerHTML = "<span>＋</span>";
  b.onclick = () => modificaVoceDiario({ tipo, data: oggiIso() }, () => vistaDiario(tipo)); app.appendChild(b);
}

function modificaVoceDiario(x, dopo) {
  const comp = x.tipo === "compleanno", t = TIPI_D[x.tipo];
  let voto = x.voto || 0;
  const v = foglio(`<h3>${t.ico} ${x.id ? esc(x.titolo) : comp ? "Nuovo compleanno" : "Aggiungi " + t.nome.toLowerCase()} ${xBtn}</h3><form id="fd">
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
  const r = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Scrigno//IT", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
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
const AIUTO = ["importa i compleanni dai promemoria", "il 6 agosto è il compleanno di Marco Rossi", "stasera ho visto il film After, bellissimo", "ho letto Il nome della rosa di Umberto Eco",
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
    } catch (err) { toast("⚠️ " + err.message); }
  };
  if (precompila) { history.replaceState(null, "", "#/chat"); invia(precompila); }
  else if (matchMedia("(pointer:fine)").matches) ci.focus();
}

const trova = (lista, testo) => {
  const n = testo.toLowerCase().trim();
  return lista.find((x) => x.titolo.toLowerCase() === n) || lista.find((x) => x.titolo.toLowerCase().includes(n)) || lista.find((x) => n.includes(x.titolo.toLowerCase()));
};
async function rispondi(testo) {
  if (chatAttesa) {
    const a = chatAttesa; chatAttesa = null;
    if (a.motivo === "data_compleanno") testo = `compleanno di ${a.nome} il ${testo}`;
    else if (a.motivo === "nome_compleanno") testo = `compleanno di ${testo} il ${a.giorno}/${a.mese}${a.anno ? "/" + a.anno : ""}`;
    else if (a.motivo === "titolo") testo = `${a.tipo === "libro" ? "ho letto" : a.tipo === "serie" ? "ho visto la serie" : "ho visto il film"} ${testo}`;
  }
  const r = window.ScrignoChat.capisci(testo);
  const giorno = (iso) => { const d = new Date(iso + "T00:00"); return `${GIORNI[d.getDay()]} ${d.getDate()} ${MESI_L[d.getMonth()]}`; };

  if (r.azione === "compleanno") {
    const esistenti = await api("/api/diario?tipo=compleanno");
    const gia = esistenti.find((x) => x.titolo.toLowerCase() === r.nome.toLowerCase());
    const voce = { tipo: "compleanno", titolo: r.nome, giorno: r.giorno, mese: r.mese, anno: r.anno || gia?.anno || null };
    const x = gia ? await api(`/api/diario/${gia.id}`, { method: "PUT", json: { ...gia, ...voce } }) : await api("/api/diario", { method: "POST", json: voce });
    const i = infoComp(x);
    return { da: "scrigno", html: `🎂 ${gia ? "Ho aggiornato" : "Ho segnato"} il compleanno di <b>${esc(x.titolo)}</b>: <b>${x.giorno} ${MESI_L[x.mese - 1]}</b>${i.anni ? ` (compirà ${i.anni} anni)` : ""}.<br>${i.g === 0 ? "È oggi! 🎉" : `Mancano ${i.g} giorni.`} Te lo ricorderò ogni anno qui in Scrigno; per l'avviso sull'iPhone mettilo nel Calendario:`,
      azioni: [{ t: "calComp", voce: x, etichetta: "📲 Promemoria annuale nel Calendario" }, ...(gia ? [] : [{ t: "annulla", url: `/api/diario/${x.id}`, etichetta: "↩️ Annulla" }])] };
  }
  if (r.azione === "diario") {
    const x = await api("/api/diario", { method: "POST", json: { tipo: r.tipo, titolo: r.titolo, autore: r.autore, data: r.data, voto: r.voto, commento: r.commento, stato: r.stato } });
    const t = TIPI_D[r.tipo];
    const dove = r.tipo === "libro" ? (r.stato === "in corso" ? "ai libri che stai leggendo" : "ai libri letti") : r.tipo === "serie" ? "alle serie viste" : "ai film visti";
    const azioni = [];
    if (!x.voto) [1, 2, 3, 4, 5].forEach((n) => azioni.push({ t: "voto", id: x.id, v: n, voce: x, etichetta: "★".repeat(n) }));
    azioni.push({ t: "apri", hash: `#/diario/${r.tipo}`, etichetta: `${t.ico} Apri il diario` }, { t: "annulla", url: `/api/diario/${x.id}`, etichetta: "↩️ Annulla" });
    return { da: "scrigno", html: `${t.ico} Aggiunto ${dove}: <b>${esc(x.titolo)}</b>${x.autore ? " di " + esc(x.autore) : ""}<br><span class="muted">${giorno(x.data)}</span>
      ${x.voto ? `<br><span class="stelle">${stelle(x.voto)}</span>` : ""}${x.commento ? `<br>“${esc(x.commento)}”` : ""}${!x.voto ? "<br>Che voto gli dai?" : ""}`, azioni };
  }
  if (r.azione === "commento") {
    const tutte = (await api("/api/diario")).filter((x) => x.tipo !== "compleanno");
    const x = trova(tutte, r.titolo);
    if (!x) return { da: "scrigno", html: `Non trovo “${esc(r.titolo)}” nel diario. Prova a scrivere ad esempio: <i>ho visto ${esc(r.titolo)}, ${esc(r.commento.toLowerCase())}</i>` };
    const nuovo = x.commento ? `${x.commento}\n${r.commento}` : r.commento;
    await api(`/api/diario/${x.id}`, { method: "PUT", json: { ...x, commento: nuovo } });
    return { da: "scrigno", html: `🗒️ Ho aggiunto il commento a <b>${esc(x.titolo)}</b>: “${esc(r.commento)}”` };
  }
  if (r.azione === "appuntamento") {
    const a = await api("/api/appuntamenti", { method: "POST", json: { titolo: r.titolo, inizio: r.inizio, fine: r.fine, tutto_il_giorno: r.tutto_il_giorno, luogo: r.luogo, categoria: r.categoria, icona: r.icona } });
    if (comandoCalPronto()) setTimeout(() => eseguiComandoCal(a), 600);
    return { da: "scrigno", html: `${esc(a.icona)} Ho salvato: <b>${esc(a.titolo)}</b><br>${giorno(a.inizio.slice(0, 10))}${a.tutto_il_giorno ? "" : `, dalle ${oraDa(a.inizio)} alle ${oraDa(a.fine)}`}${a.luogo ? `<br>📍 ${esc(a.luogo)}` : ""}
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
  }
  if (r.azione === "importa_compleanni") return { da: "scrigno", html: "Certo! Posso prendere i compleanni dall'app Promemoria: tocca qui sotto e segui i passaggi.", azioni: [{ t: "importaComp", etichetta: "📥 Importa dai Promemoria" }] };
  if (r.azione === "saluto") return { da: "scrigno", html: r.grazie ? "Di niente! 😊" : `Ciao! 👋 Dimmi pure: un film visto, un libro letto, un compleanno da ricordare o una visita. Ad esempio:`, azioni: r.grazie ? [] : AIUTO.slice(0, 3).map((t) => ({ t: "scrivi", testo: t, etichetta: t })) };
  return { da: "scrigno", html: `Non ho capito bene 🤔 Prova a scrivere in uno di questi modi:`, azioni: AIUTO.map((t) => ({ t: "scrivi", testo: t, etichetta: t })) };
}

/* ------------------------------------------------------------------ presentazione */
function benvenuto(forza) {
  if (!forza && memo.get("benvenuto")) return;
  const pagine = [
    ["", "Benvenuto in Scrigno", "La tua app personale per documenti, scadenze, visite e password."],
    ["🗂️", "Tutti i tuoi documenti, in ordine", "Bollo, assicurazioni, analisi, patente, bollette: ogni cosa nella sua cartella, già pronta."],
    ["📷", "Aggiungere è facilissimo", "Fotografa un foglio o scegli un file. Scrigno ti suggerisce dove metterlo e ti ricorda quando scade."],
    ["💬", "Raccontami la tua giornata", "Nella chat scrivi “stasera ho visto After” o “il 6 agosto è il compleanno di Marco”: salvo tutto io nel tuo diario e ti ricordo i compleanni ogni anno."],
    ["🗓️", "Le visite vanno nel calendario", "Scrivi “il 16 dicembre dentista dalle 10 alle 11”: Scrigno capisce giorno e orario e lo mette nel Calendario dell'iPhone."],
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
    <h1>Scrigno</h1><p>${nuovo ? "Benvenuto! Scegli una password per proteggere i tuoi documenti e cifrare le tue password." : "Il tuo archivio personale"}</p>
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
async function render() {
  if (!S.stato?.accesso) return;
  $("#tabbar").hidden = false;
  $$(".velo, .visore").forEach((v) => v.remove());
  const h = decodeURIComponent(location.hash.slice(2));
  const [sez, arg] = [h.split("/")[0], h.split("/").slice(1).join("/")];
  const tab = { "": "home", c: "home", cerca: "home", raccolta: "home", scadenze: "home", "da-smistare": "home", password: "home" }[sez] || sez;
  document.body.classList.toggle("in-chat", sez === "chat");
  $$("#tabbar a").forEach((a) => a.classList.toggle("on", a.dataset.tab === tab));
  scrollTo(0, 0);
  const RACCOLTE = { assicura: "🛡️ Assicurazioni", bollo: "🧾 Bolli", revision: "🔧 Revisioni", salute: "🩺 Salute", document: "🪪 Documenti" };
  try {
    if (sez === "c") await vistaCartella(+arg);
    else if (sez === "da-smistare") await vistaDaSmistare();
    else if (sez === "agenda") await vistaAgenda();
    else if (sez === "password") await vistaPassword();
    else if (sez === "diario") await vistaDiario(arg);
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
document.addEventListener("click", (e) => { const b = e.target.closest("[data-cp]"); if (b) copia(b.dataset.cp); });
document.addEventListener("visibilitychange", () => { if (!document.hidden && S.stato?.accesso) { svuotaMemoria(); caricaCartelle().catch(() => {}); } });
if ("serviceWorker" in navigator && window.isSecureContext) navigator.serviceWorker.register("sw.js").catch(() => {});
avvia();
