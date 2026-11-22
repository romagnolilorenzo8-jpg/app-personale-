/* Scrigno — interfaccia web (nessuna dipendenza esterna) */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = $("#app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const MESI_L = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const GIORNI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
const COLORI = ["#5b5bf6", "#e5484d", "#0ea5a4", "#e8a23a", "#8b5cf6", "#2fa66a", "#ec4899", "#3b82f6", "#64748b"];
const COL_CAT = { salute: "#e5484d", veicoli: "#3b82f6", casa: "#e8a23a", lavoro: "#0ea5a4", altro: "#8b5cf6" };

const S = { cartelle: [], byId: {}, figli: {}, daSmistare: 0, stato: null };

/* ------------------------------------------------------------------ utilità */
async function api(url, opts = {}) {
  const o = { credentials: "same-origin", ...opts, headers: { ...(opts.headers || {}) } };
  if (o.json !== undefined) { o.body = JSON.stringify(o.json); o.headers["Content-Type"] = "application/json"; delete o.json; }
  const r = await fetch(url, o);
  if (r.status === 401 && !url.startsWith("/api/accedi") && !url.includes("sblocca") && !url.includes("impostazioni/password")) {
    S.stato = { configurato: true, accesso: false }; mostraAccesso(); throw new Error("Accesso richiesto");
  }
  const ct = r.headers.get("content-type") || "";
  const dati = ct.includes("json") ? await r.json() : await r.text();
  if (!r.ok) { const e = new Error((dati && dati.errore) || "Errore " + r.status); e.status = r.status; throw e; }
  return dati;
}

function toast(msg, ms = 2600) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), ms);
}

function dimensione(b) {
  if (b == null) return "";
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(0) + " KB";
  return (b / 1048576).toFixed(1).replace(".", ",") + " MB";
}
const dataIt = (iso) => { if (!iso) return ""; const d = new Date(iso.length === 10 ? iso + "T00:00" : iso); return `${d.getDate()} ${MESI[d.getMonth()]} ${d.getFullYear()}`; };
const oggiIso = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const giorniA = (iso) => Math.round((new Date(iso + "T00:00") - new Date(oggiIso() + "T00:00")) / 86400000);

function iconaFile(d) {
  const m = d.mime || "", n = (d.nome || "").toLowerCase();
  if (m.includes("pdf")) return "📕";
  if (m.startsWith("image/")) return "🖼️";
  if (m.startsWith("video/")) return "🎞️";
  if (m.startsWith("audio/")) return "🎧";
  if (/\.(docx?|odt|pages|rtf)$/.test(n)) return "📝";
  if (/\.(xlsx?|ods|numbers|csv)$/.test(n)) return "📊";
  if (/\.(zip|rar|7z)$/.test(n)) return "🗜️";
  if (m.startsWith("text/")) return "📄";
  return "📎";
}
const urlFile = (d, scarica) => `/api/documenti/${d.id}/file${scarica ? "?scarica=1" : ""}`;

function tagScadenza(iso) {
  if (!iso) return "";
  const g = giorniA(iso);
  if (g < 0) return `<span class="tag danger">Scaduto il ${dataIt(iso)}</span>`;
  if (g === 0) return `<span class="tag danger">Scade oggi</span>`;
  if (g <= 30) return `<span class="tag warn">Scade tra ${g} gg</span>`;
  return `<span class="tag ok">Scade ${dataIt(iso)}</span>`;
}

async function copia(testo, cosa = "Copiato") {
  try { await navigator.clipboard.writeText(testo); }
  catch { const t = document.createElement("textarea"); t.value = testo; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); }
  toast("✅ " + cosa);
}

/* ------------------------------------------------------------------ fogli modali */
function foglio(html, { onClose } = {}) {
  const v = document.createElement("div");
  v.className = "velo";
  v.innerHTML = `<div class="foglio" role="dialog"><div class="maniglia"></div>${html}</div>`;
  const chiudi = () => { v.remove(); onClose && onClose(); };
  v.addEventListener("click", (e) => { if (e.target === v || e.target.closest("[data-chiudi]")) chiudi(); });
  document.body.appendChild(v);
  v.chiudi = chiudi;
  const f = v.querySelector("input:not([type=hidden]):not([readonly]), textarea");
  if (f && matchMedia("(pointer:fine)").matches) setTimeout(() => f.focus(), 50);
  return v;
}
const xBtn = `<button class="iconbtn x" data-chiudi aria-label="Chiudi">✕</button>`;

function conferma(testo, etichetta = "Elimina") {
  return new Promise((res) => {
    const v = foglio(`<h3>${esc(testo)}</h3><div class="riga"><button class="btn sec" data-chiudi>Annulla</button>
      <button class="btn danger" id="ok">${esc(etichetta)}</button></div>`, { onClose: () => res(false) });
    $("#ok", v).onclick = () => { res(true); v.remove(); };
  });
}

function chiedi(titolo, valore = "", { tipo = "text", etichetta = "Salva", placeholder = "" } = {}) {
  return new Promise((res) => {
    const v = foglio(`<h3>${esc(titolo)} ${xBtn}</h3><form><input type="${tipo}" id="val" value="${esc(valore)}" placeholder="${esc(placeholder)}">
      <div style="height:12px"></div><button class="btn block">${esc(etichetta)}</button></form>`, { onClose: () => res(null) });
    $("form", v).onsubmit = (e) => { e.preventDefault(); res($("#val", v).value); v.remove(); };
    setTimeout(() => $("#val", v).focus(), 60);
  });
}

/* ------------------------------------------------------------------ cartelle */
async function caricaCartelle() {
  const r = await api("/api/cartelle");
  S.cartelle = r.cartelle; S.daSmistare = r.da_smistare; S.byId = {}; S.figli = {};
  for (const c of r.cartelle) { S.byId[c.id] = c; (S.figli[c.padre ?? "root"] ||= []).push(c); }
  const b = $("#badge-smistare");
  b.hidden = !S.daSmistare; b.textContent = S.daSmistare;
}
function radice(c) { while (c && c.padre != null) c = S.byId[c.padre]; return c; }
function coloreCartella(c) {
  const r = radice(c); const i = (S.figli.root || []).indexOf(r);
  return COLORI[(i < 0 ? 0 : i) % COLORI.length];
}
function percorso(id) {
  const out = []; let c = S.byId[id];
  while (c) { out.unshift(c); c = S.byId[c.padre]; }
  return out;
}
function htmlCartelle(lista) {
  return `<div class="griglia">${lista.map((c) => {
    const info = [c.sottocartelle ? `${c.sottocartelle} cartell${c.sottocartelle === 1 ? "a" : "e"}` : "", c.totale ? `${c.totale} document${c.totale === 1 ? "o" : "i"}` : ""].filter(Boolean).join(" · ") || "Vuota";
    return `<a class="cartella" href="#/c/${c.id}" style="--c:${coloreCartella(c)}"><div class="ico">${esc(c.icona)}</div>
      <div class="nome">${esc(c.nome)}</div><div class="info">${info}</div></a>`;
  }).join("")}</div>`;
}

function sceltaCartella(titolo, { attuale = null, consentiRadice = false, escludi = null } = {}) {
  return new Promise((res) => {
    const aperte = new Set(percorso(attuale).map((c) => c.id));
    let sel = attuale;
    const v = foglio(`<h3>${esc(titolo)} ${xBtn}</h3><div class="card albero" id="alb"></div>
      <div style="height:12px"></div><div class="riga"><button class="btn sec" id="nuova">＋ Nuova cartella</button><button class="btn" id="ok">Sposta qui</button></div>`,
      { onClose: () => res(undefined) });
    const disegna = () => {
      const nodo = (c, liv) => {
        if (escludi && percorso(c.id).some((p) => p.id === escludi)) return "";
        const figli = S.figli[c.id] || [];
        const ap = aperte.has(c.id);
        return `<div class="nodo ${sel === c.id ? "sel" : ""}" data-id="${c.id}" style="padding-left:${8 + liv * 18}px">
          <span class="freccia ${ap ? "aperta" : ""}" data-fr="${c.id}">${figli.length ? "▶" : ""}</span><span>${esc(c.icona)}</span>
          <span style="flex:1">${esc(c.nome)}</span>${sel === c.id ? "✓" : ""}</div>${ap ? figli.map((f) => nodo(f, liv + 1)).join("") : ""}`;
      };
      $("#alb", v).innerHTML = (consentiRadice ? `<div class="nodo ${sel === null ? "sel" : ""}" data-id=""><span class="freccia"></span>🏠<span style="flex:1">Livello principale</span>${sel === null ? "✓" : ""}</div>` : "") +
        (S.figli.root || []).map((c) => nodo(c, 0)).join("");
    };
    $("#alb", v).onclick = (e) => {
      const n = e.target.closest(".nodo"); if (!n) return;
      const id = n.dataset.id ? +n.dataset.id : null;
      const kids = id != null && (S.figli[id] || []).length;
      if (e.target.dataset.fr && kids) { aperte.has(id) ? aperte.delete(id) : aperte.add(id); }
      else { sel = id; if (kids) aperte.add(id); }
      disegna();
    };
    $("#ok", v).onclick = () => { if (sel === null && !consentiRadice) return toast("Scegli una cartella"); res(sel); v.remove(); };
    $("#nuova", v).onclick = async () => {
      const nome = await chiedi(sel ? `Nuova cartella in “${S.byId[sel].nome}”` : "Nuova cartella principale");
      if (!nome) return;
      const r = await api("/api/cartelle", { method: "POST", json: { nome, padre: sel } });
      await caricaCartelle(); if (sel) aperte.add(sel); sel = r.id; disegna();
    };
    disegna();
  });
}

/* ------------------------------------------------------------------ suggerimenti cartella */
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
function suggerimenti(d) {
  const n = (d.nome + " " + (d.note || "")).toLowerCase().replace(/[_\-.]+/g, " ");
  const moto = /moto|scooter|ciclomotore/.test(n), auto = /\bauto\b|macchina|vettura/.test(n);
  for (const [chiave, cartella] of REGOLE) {
    if (!chiave.test(n)) continue;
    let c = S.cartelle.filter((x) => cartella.test(x.nome.toLowerCase()));
    const sotto = (x, nome) => percorso(x.id).some((p) => p.nome.toLowerCase() === nome);
    if (moto) c = c.filter((x) => !sotto(x, "auto")) ; if (auto) c = c.filter((x) => !sotto(x, "motorino"));
    if (c.length) return c.slice(0, 3);
  }
  return [];
}

/* ------------------------------------------------------------------ documenti */
function htmlDocs(docs, { mostraCartella = false, suggerisci = false } = {}) {
  if (!docs.length) return "";
  return `<div class="lista">${docs.map((d) => {
    const thumb = (d.mime || "").startsWith("image/") ? `<img loading="lazy" src="${urlFile(d)}" alt="" onerror="this.replaceWith('🖼️')">` : iconaFile(d);
    const sub = [mostraCartella ? (d.cartella ? "📁 " + esc(d.nome_cartella) : "📥 Da smistare") : "", dataIt(d.creato), dimensione(d.dimensione), d.origine === "iphone" ? "📲" : ""].filter(Boolean).join(" · ");
    return `<div class="voce" data-doc="${d.id}"><div class="thumb">${thumb}</div><div class="corpo"><div class="tit">${esc(d.nome)}</div>
      <div class="sub">${sub}</div>${d.scadenza ? `<div style="margin-top:3px">${tagScadenza(d.scadenza)}</div>` : ""}
      ${suggerisci ? suggerimenti(d).map((c) => `<button class="btn sec small sugg" data-sposta="${d.id}" data-in="${c.id}">✨ ${percorso(c.id).slice(-2).map((p) => esc(p.nome)).join(" › ")}</button>`).join("") : ""}</div><div class="dx">›</div></div>`;
  }).join("")}</div>`;
}
function collegaDocs(el, docs, ricarica) {
  el.addEventListener("click", async (e) => {
    const sp = e.target.closest("[data-sposta]");
    if (sp) {
      e.stopPropagation();
      await api(`/api/documenti/${sp.dataset.sposta}`, { method: "PATCH", json: { sposta: true, cartella: +sp.dataset.in } });
      toast("📁 Spostato in " + S.byId[sp.dataset.in].nome); await caricaCartelle(); ricarica && ricarica(); return;
    }
    const v = e.target.closest("[data-doc]"); if (!v) return;
    const d = docs.find((x) => x.id === +v.dataset.doc); if (d) apriDoc(d, ricarica);
  });
}

function apriDoc(d, ricarica) {
  const m = d.mime || "";
  let prev = `<div class="big">${iconaFile(d)}</div>`;
  if (m.startsWith("image/")) prev = `<img src="${urlFile(d)}" alt="">`;
  else if (m.includes("pdf") || m.startsWith("text/")) prev = `<iframe src="${urlFile(d)}" title="Anteprima"></iframe>`;
  const perc = d.cartella ? percorso(d.cartella).map((c) => esc(c.nome)).join(" › ") : "📥 Da smistare";
  const v = foglio(`<h3><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.nome)}</span> ${xBtn}</h3>
    <div class="anteprima-doc">${prev}</div>
    <p class="small muted" style="margin:12px 4px">${perc} · ${dataIt(d.creato)} · ${dimensione(d.dimensione)}</p>
    ${d.scadenza ? `<p style="margin:0 4px 8px">${tagScadenza(d.scadenza)}</p>` : ""}
    ${d.note ? `<div class="card small" style="margin-bottom:8px">${esc(d.note)}</div>` : ""}
    <div class="azioni">
      <a class="btn" href="${urlFile(d)}" target="_blank">↗︎ Apri</a>
      <button class="btn sec" data-a="condividi">📤 Condividi</button>
      <button class="btn sec" data-a="sposta">📁 Sposta</button>
      <button class="btn sec" data-a="rinomina">✏️ Rinomina</button>
      <button class="btn sec" data-a="scadenza">⏰ Scadenza</button>
      <button class="btn sec" data-a="note">🗒️ Note</button>
      <a class="btn sec" href="${urlFile(d, true)}" download>⬇︎ Scarica</a>
      <button class="btn danger" data-a="elimina">🗑️ Elimina</button>
    </div>`);
  const fatto = async (msg) => { v.remove(); toast(msg); await caricaCartelle(); ricarica && ricarica(); };
  v.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-a]")?.dataset.a; if (!a) return;
    try {
      if (a === "sposta") {
        const dest = await sceltaCartella("Sposta in…", { attuale: d.cartella });
        if (dest === undefined) return;
        await api(`/api/documenti/${d.id}`, { method: "PATCH", json: { sposta: true, cartella: dest } });
        fatto("📁 Spostato in " + S.byId[dest].nome);
      } else if (a === "rinomina") {
        const n = await chiedi("Rinomina", d.nome); if (!n) return;
        await api(`/api/documenti/${d.id}`, { method: "PATCH", json: { nome: n } }); fatto("✏️ Rinominato");
      } else if (a === "note") {
        const n = await chiedi("Note", d.note || "", { placeholder: "Es. numero polizza, importo…" }); if (n === null) return;
        await api(`/api/documenti/${d.id}`, { method: "PATCH", json: { note: n } }); fatto("🗒️ Note salvate");
      } else if (a === "scadenza") {
        const n = await chiedi("Data di scadenza", d.scadenza || "", { tipo: "date", etichetta: "Salva (vuoto = nessuna)" }); if (n === null) return;
        await api(`/api/documenti/${d.id}`, { method: "PATCH", json: n ? { scadenza: n } : { togli_scadenza: true } });
        fatto(n ? "⏰ Ti avviserò sul calendario 7 giorni prima" : "Scadenza rimossa");
      } else if (a === "elimina") {
        if (!(await conferma(`Eliminare “${d.nome}”?`))) return;
        await api(`/api/documenti/${d.id}`, { method: "DELETE" }); fatto("🗑️ Eliminato");
      } else if (a === "condividi") {
        const blob = await (await fetch(urlFile(d))).blob();
        const file = new File([blob], d.nome, { type: d.mime });
        if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: d.nome });
        else { location.href = urlFile(d, true); }
      }
    } catch (err) { if (err.name !== "AbortError") toast("⚠️ " + err.message); }
  });
}

/* ------------------------------------------------------------------ caricamento file */
function scegliFile(cartella, dopo, { foto = false } = {}) {
  const inp = $("#file-input");
  inp.value = ""; inp.accept = foto ? "image/*" : "";
  foto ? inp.setAttribute("capture", "environment") : inp.removeAttribute("capture");
  inp.onchange = () => inp.files.length && carica([...inp.files], cartella, dopo);
  inp.click();
}
function carica(files, cartella, dopo) {
  const v = foglio(`<h3>Caricamento…</h3><p class="muted">${files.length} file · ${dimensione(files.reduce((a, f) => a + f.size, 0))}</p>
    <div class="progresso"><div id="pb"></div></div>`);
  const fd = new FormData();
  files.forEach((f) => fd.append("file", f, f.name));
  if (cartella) fd.append("cartella", cartella);
  const x = new XMLHttpRequest();
  x.open("POST", "/api/documenti");
  x.upload.onprogress = (e) => e.lengthComputable && ($("#pb", v).style.width = (e.loaded / e.total) * 100 + "%");
  x.onload = async () => {
    v.remove();
    if (x.status >= 200 && x.status < 300) {
      toast(`✅ ${files.length} file salvat${files.length === 1 ? "o" : "i"}${cartella ? "" : " in Da smistare"}`);
      await caricaCartelle(); dopo && dopo();
    } else { try { toast("⚠️ " + JSON.parse(x.responseText).errore); } catch { toast("⚠️ Errore nel caricamento"); } }
  };
  x.onerror = () => { v.remove(); toast("⚠️ Server non raggiungibile"); };
  x.send(fd);
}
function menuAggiungi(cartella, dopo) {
  const v = foglio(`<h3>Aggiungi ${xBtn}</h3><div class="lista">
    <div class="voce" data-m="file"><div class="thumb">📄</div><div class="corpo"><div class="tit">Carica file</div><div class="sub">Da File, Foto o iCloud Drive</div></div></div>
    <div class="voce" data-m="foto"><div class="thumb">📷</div><div class="corpo"><div class="tit">Scatta una foto</div><div class="sub">Fotografa un documento cartaceo</div></div></div>
    ${cartella !== undefined ? `<div class="voce" data-m="cartella"><div class="thumb">📁</div><div class="corpo"><div class="tit">Nuova cartella</div><div class="sub">${cartella ? "Dentro “" + esc(S.byId[cartella].nome) + "”" : "Al livello principale"}</div></div></div>` : ""}
  </div>`);
  v.addEventListener("click", async (e) => {
    const m = e.target.closest("[data-m]")?.dataset.m; if (!m) return;
    v.remove();
    if (m === "file") scegliFile(cartella, dopo);
    if (m === "foto") scegliFile(cartella, dopo, { foto: true });
    if (m === "cartella") {
      const nome = await chiedi("Nome della nuova cartella", "", { placeholder: "Es. Moto, Oculista, Polizza casa…" });
      if (!nome) return;
      await api("/api/cartelle", { method: "POST", json: { nome, padre: cartella || null } });
      await caricaCartelle(); toast("📁 Cartella creata"); dopo && dopo();
    }
  });
}
const fab = (cartella, dopo) => { const b = document.createElement("button"); b.className = "fab"; b.textContent = "+"; b.onclick = () => menuAggiungi(cartella, dopo); app.appendChild(b); };

/* trascina e rilascia (computer) */
let dragN = 0;
addEventListener("dragenter", (e) => { if (S.stato?.accesso && e.dataTransfer?.types?.includes("Files")) { dragN++; $("#drop").hidden = false; } });
addEventListener("dragleave", () => { if (--dragN <= 0) { dragN = 0; $("#drop").hidden = true; } });
addEventListener("dragover", (e) => e.preventDefault());
addEventListener("drop", (e) => {
  e.preventDefault(); dragN = 0; $("#drop").hidden = true;
  const files = [...(e.dataTransfer?.files || [])]; if (!files.length) return;
  const m = location.hash.match(/^#\/c\/(\d+)/);
  carica(files, m ? +m[1] : null, render);
});

/* ================================================================== VISTE */
async function vistaHome() {
  const [recenti, appts, scad] = await Promise.all([api("/api/documenti?recenti=true"), api("/api/appuntamenti"), api("/api/scadenze")]);
  const prossimo = appts[0];
  const scadImminenti = scad.filter((d) => giorniA(d.scadenza) <= 60);
  const ora = new Date().getHours();
  const saluto = ora < 6 ? "Buonanotte" : ora < 13 ? "Buongiorno" : ora < 18 ? "Buon pomeriggio" : "Buonasera";
  app.innerHTML = `
    <div class="top"><h1>${saluto} 👋<small>Il tuo archivio personale</small></h1>
      <a class="iconbtn" href="#/altro" aria-label="Impostazioni">⚙️</a></div>
    <form class="cerca" id="f-cerca"><input type="search" id="q" placeholder="Cerca documenti, cartelle, note…" enterkeyhint="search"></form>
    <div class="rapidi">
      <a class="rapido ${S.daSmistare ? "evid" : ""}" href="#/da-smistare"><span>📥</span><span class="n">${S.daSmistare}</span><span class="t">Da smistare</span></a>
      <a class="rapido" href="#/agenda"><span>🗓️</span><span class="n">${prossimo ? new Date(prossimo.inizio.slice(0, 10) + "T00:00").getDate() + " " + MESI[+prossimo.inizio.slice(5, 7) - 1] : "—"}</span>
        <span class="t">${prossimo ? esc(prossimo.titolo) : "Nessuna visita in programma"}</span></a>
      <a class="rapido" href="#/scadenze"><span>⏰</span><span class="n">${scadImminenti.length}</span><span class="t">Scadenze nei prossimi 60 giorni</span></a>
    </div>
    <div class="sezione"><h2>Raccolte rapide</h2></div>
    <div class="chips">
      <a class="chip" href="#/raccolta/assicura">🛡️ Tutte le assicurazioni</a>
      <a class="chip" href="#/raccolta/bollo">🧾 Tutti i bolli</a>
      <a class="chip" href="#/raccolta/revision">🔧 Revisioni</a>
      <a class="chip" href="#/raccolta/salute">🩺 Salute</a>
      <a class="chip" href="#/raccolta/document">🪪 Documenti</a>
    </div>
    <div class="sezione"><h2>Le tue cartelle</h2><a href="#" id="nuova-rad">＋ Nuova</a></div>
    ${htmlCartelle(S.figli.root || [])}
    ${recenti.length ? `<div class="sezione"><h2>Aggiunti di recente</h2></div><div id="recenti">${htmlDocs(recenti, { mostraCartella: true })}</div>` : ""}`;
  $("#f-cerca").onsubmit = (e) => { e.preventDefault(); const q = $("#q").value.trim(); if (q) location.hash = "#/cerca/" + encodeURIComponent(q); };
  $("#nuova-rad").onclick = async (e) => {
    e.preventDefault();
    const nome = await chiedi("Nuova cartella principale", "", { placeholder: "Es. Animali, Scuola, Viaggi…" }); if (!nome) return;
    await api("/api/cartelle", { method: "POST", json: { nome, padre: null } }); await caricaCartelle(); render();
  };
  if (recenti.length) collegaDocs($("#recenti"), recenti, render);
  fab(null, render);
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
    <div class="crumbs"><a href="#/">Archivio</a>${perc.map((p) => ` › <a href="#/c/${p.id}">${esc(p.nome)}</a>`).join("")}</div>
    ${figli.length ? htmlCartelle(figli) : ""}
    ${docs.length ? `<div class="sezione"><h2>Documenti</h2><span class="muted small">${docs.length}</span></div><div id="docs">${htmlDocs(docs)}</div>` : ""}
    ${!figli.length && !docs.length ? `<div class="vuoto"><span class="big">${esc(c.icona)}</span>Cartella vuota.<br>Tocca <b>+</b> per aggiungere un documento o una sottocartella.</div>` : ""}`;
  const ric = () => vistaCartella(id);
  if (docs.length) collegaDocs($("#docs"), docs, ric);
  $("#menu").onclick = () => {
    const v = foglio(`<h3>${esc(c.icona)} ${esc(c.nome)} ${xBtn}</h3><div class="lista">
      <div class="voce" data-m="rinomina"><div class="thumb">✏️</div><div class="corpo"><div class="tit">Rinomina</div></div></div>
      <div class="voce" data-m="icona"><div class="thumb">😀</div><div class="corpo"><div class="tit">Cambia icona</div><div class="sub">Scegli una emoji</div></div></div>
      <div class="voce" data-m="sposta"><div class="thumb">📁</div><div class="corpo"><div class="tit">Sposta cartella</div></div></div>
      <div class="voce" data-m="elimina"><div class="thumb">🗑️</div><div class="corpo"><div class="tit" style="color:var(--danger)">Elimina cartella</div><div class="sub">I documenti tornano in “Da smistare”</div></div></div></div>`);
    v.addEventListener("click", async (e) => {
      const m = e.target.closest("[data-m]")?.dataset.m; if (!m) return; v.remove();
      try {
        if (m === "rinomina") { const n = await chiedi("Rinomina cartella", c.nome); if (!n) return; await api(`/api/cartelle/${id}`, { method: "PATCH", json: { nome: n } }); }
        if (m === "icona") { const n = await chiedi("Nuova icona (emoji)", c.icona, { placeholder: "🚗" }); if (!n) return; await api(`/api/cartelle/${id}`, { method: "PATCH", json: { icona: [...n.trim()].slice(0, 2).join("") } }); }
        if (m === "sposta") { const p = await sceltaCartella("Sposta cartella in…", { attuale: c.padre, consentiRadice: true, escludi: id }); if (p === undefined) return; await api(`/api/cartelle/${id}`, { method: "PATCH", json: { padre: p, sposta_padre: true } }); }
        if (m === "elimina") {
          if (!(await conferma(`Eliminare “${c.nome}” e le sue sottocartelle?`))) return;
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
  app.innerHTML = `<div class="top"><h1>Da smistare<small>File arrivati dal menu Condividi</small></h1></div>
    ${docs.length ? `<p class="muted small" style="margin:-6px 4px 14px">Tocca un suggerimento ✨ oppure apri il documento e scegli <b>Sposta</b>.</p><div id="docs">${htmlDocs(docs, { suggerisci: true })}</div>`
      : `<div class="vuoto"><span class="big">📭</span>Tutto in ordine!<br>Quando condividi un file dall'iPhone a Scrigno, lo trovi qui.<br><br><a href="#/altro">Come configurare il menu Condividi →</a></div>`}`;
  if (docs.length) collegaDocs($("#docs"), docs, vistaDaSmistare);
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
    ${docs.length ? `<div id="docs">${htmlDocs(docs, { mostraCartella: true })}</div><p class="muted small" style="margin:14px 4px">Le scadenze compaiono anche nel calendario dell'iPhone (se collegato), con un avviso 7 giorni prima.</p>`
      : `<div class="vuoto"><span class="big">⏰</span>Nessuna scadenza impostata.<br>Apri un documento (es. il bollo) e tocca <b>⏰ Scadenza</b>.</div>`}`;
  if (docs.length) collegaDocs($("#docs"), docs, vistaScadenze);
}

/* ------------------------------------------------------------------ agenda */
function oraDa(iso) { return iso && iso.length > 10 ? iso.slice(11, 16) : ""; }

function formAppuntamento(a) {
  return `<label class="campo"><span>Titolo</span><input type="text" id="a-tit" value="${esc(a.titolo)}"></label>
    <div class="riga"><label class="campo"><span>Giorno</span><input type="date" id="a-data" value="${esc((a.inizio || "").slice(0, 10))}"></label></div>
    <label class="switch"><span>Tutto il giorno</span><input type="checkbox" id="a-tutto" ${a.tutto_il_giorno ? "checked" : ""}></label>
    <div class="riga" id="a-ore" ${a.tutto_il_giorno ? "hidden" : ""}>
      <label class="campo"><span>Dalle</span><input type="time" id="a-da" value="${esc(oraDa(a.inizio) || "09:00")}"></label>
      <label class="campo"><span>Alle</span><input type="time" id="a-a" value="${esc(oraDa(a.fine) || "10:00")}"></label></div>
    <label class="campo"><span>Luogo</span><input type="text" id="a-luogo" value="${esc(a.luogo || "")}" placeholder="Facoltativo"></label>
    <label class="campo"><span>Note</span><input type="text" id="a-note" value="${esc(a.note || "")}" placeholder="Es. portare le analisi, digiuno…"></label>`;
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
    const [h, m] = $("#a-da", el).value.split(":").map(Number);
    const [h2, m2] = $("#a-a", el).value.split(":").map(Number);
    if (h * 60 + m >= h2 * 60 + m2) $("#a-a", el).value = `${String(Math.min(23, h + 1)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };
}
function htmlAppt(a) {
  const d = new Date(a.inizio.slice(0, 10) + "T00:00");
  const quando = a.tutto_il_giorno ? "Tutto il giorno" : `${oraDa(a.inizio)} – ${oraDa(a.fine)}`;
  const g = giorniA(a.inizio.slice(0, 10));
  const rel = g === 0 ? `<span class="tag danger">Oggi</span>` : g === 1 ? `<span class="tag warn">Domani</span>` : g > 0 && g <= 7 ? `<span class="tag warn">Tra ${g} giorni</span>` : "";
  return `<div class="voce" data-app="${a.id}"><div class="datebox" style="--c:${COL_CAT[a.categoria] || COL_CAT.altro}"><div class="m">${MESI[d.getMonth()]}</div><div class="g">${d.getDate()}</div></div>
    <div class="corpo"><div class="tit">${esc(a.icona)} ${esc(a.titolo)}</div><div class="sub">${GIORNI[d.getDay()]} · ${quando}${a.luogo ? " · " + esc(a.luogo) : ""}</div>${rel ? `<div style="margin-top:3px">${rel}</div>` : ""}</div><div class="dx">›</div></div>`;
}

async function vistaAgenda() {
  const [appts, stato] = await Promise.all([api("/api/appuntamenti"), api("/api/impostazioni")]);
  const feed = `webcal://${location.host}/calendario/${stato.token_calendario}.ics`;
  const iscritto = localStorage.getItem("scrigno-cal-iscritto");
  let perMese = {};
  appts.forEach((a) => { const k = a.inizio.slice(0, 7); (perMese[k] ||= []).push(a); });
  app.innerHTML = `<div class="top"><h1>Visite e appuntamenti<small>Scrivi o detta, al calendario ci penso io</small></h1></div>
    <div class="scrivi">
      <textarea id="testo" placeholder="Es. Il 16 dicembre ho il controllo dal dentista dalle 10 alle 11" enterkeyhint="done"></textarea>
      <div class="esempi" id="esempi">
        <button>Domani alle 15 analisi del sangue</button><button>Lunedì oculista alle 9:30</button><button>Il 3 marzo revisione motorino</button>
      </div>
      <div id="prev"></div>
    </div>
    ${!iscritto ? `<div class="card" style="margin-top:14px;display:flex;gap:12px;align-items:center">
      <div style="font-size:30px">📲</div><div style="flex:1"><b>Collega il Calendario di iPhone</b><div class="small muted">Una volta sola: poi ogni visita che scrivi qui comparirà da sola nel tuo calendario.</div></div>
      <a class="btn small" href="${feed}" id="iscriviti">Collega</a></div>` : ""}
    <div id="elenco">${appts.length ? Object.entries(perMese).map(([k, l]) => `<div class="mese">${MESI_L[+k.slice(5) - 1]} ${k.slice(0, 4)}</div><div class="lista">${l.map(htmlAppt).join("")}</div>`).join("")
      : `<div class="vuoto"><span class="big">🗓️</span>Nessun appuntamento in programma.</div>`}</div>`;
  $("#iscriviti") && ($("#iscriviti").onclick = () => localStorage.setItem("scrigno-cal-iscritto", "1"));

  const ta = $("#testo"), prev = $("#prev");
  let timer, ultimo;
  const analizza = async () => {
    const t = ta.value.trim();
    if (!t) { prev.innerHTML = ""; return; }
    const r = await api("/api/appuntamenti/analizza", { method: "POST", json: { testo: t } });
    if (ta.value.trim() !== t) return;
    ultimo = r;
    const capito = r.data ? `✨ Ho capito: <b>${esc(r.titolo)}</b>, ${GIORNI[new Date(r.data + "T00:00").getDay()]} ${dataIt(r.data)}${r.tutto_il_giorno ? "" : `, dalle ${r.ora_inizio} alle ${r.ora_fine}`}` : "🤔 Non ho trovato la data: scrivila (es. “il 16 dicembre”) o sceglila qui sotto.";
    prev.innerHTML = `<div class="anteprima"><div class="capito">${capito}</div>${formAppuntamento({ ...r, inizio: r.inizio || oggiIso() })}
      <button class="btn block" id="salva">🗓️ Salva appuntamento</button></div>`;
    collegaForm(prev);
    $("#salva").onclick = async () => {
      const dati = leggiForm(prev, { categoria: ultimo.categoria, icona: ultimo.icona });
      if (!dati.titolo) return toast("Scrivi un titolo");
      try {
        const a = await api("/api/appuntamenti", { method: "POST", json: dati });
        ta.value = ""; prev.innerHTML = "";
        dopoSalvataggio(a);
      } catch (err) { toast("⚠️ " + err.message); }
    };
  };
  ta.oninput = () => { clearTimeout(timer); timer = setTimeout(analizza, 350); };
  $("#esempi").onclick = (e) => { if (e.target.tagName === "BUTTON") { ta.value = e.target.textContent; analizza(); } };
  $("#elenco").onclick = (e) => {
    const v = e.target.closest("[data-app]"); if (!v) return;
    apriAppuntamento(appts.find((a) => a.id === +v.dataset.app));
  };
}

function dopoSalvataggio(a) {
  const iscritto = localStorage.getItem("scrigno-cal-iscritto");
  const v = foglio(`<div style="text-align:center;padding:6px 0 4px"><div style="font-size:54px">✅</div>
    <h3 style="justify-content:center">Appuntamento salvato</h3>
    <p class="muted" style="margin-top:-8px">${esc(a.icona)} <b>${esc(a.titolo)}</b><br>${dataIt(a.inizio)}${a.tutto_il_giorno ? "" : ` · ${oraDa(a.inizio)}–${oraDa(a.fine)}`}</p></div>
    ${iscritto ? `<p class="small muted" style="text-align:center">Comparirà da solo nel Calendario dell'iPhone entro pochi minuti.<br>Se vuoi aggiungerlo subito:</p>` : ""}
    <a class="btn block" href="/api/appuntamenti/${a.id}.ics" data-chiudi>📲 Aggiungi al Calendario iPhone</a>
    <div style="height:8px"></div><button class="btn sec block" data-chiudi>Fatto</button>`, { onClose: vistaAgenda });
  return v;
}

function apriAppuntamento(a) {
  const v = foglio(`<h3>${esc(a.icona)} Appuntamento ${xBtn}</h3>${formAppuntamento(a)}
    <button class="btn block" id="salva">Salva modifiche</button>
    <div class="azioni"><a class="btn sec" href="/api/appuntamenti/${a.id}.ics">📲 Al calendario</a><button class="btn danger" id="elimina">🗑️ Elimina</button></div>`);
  collegaForm(v);
  $("#salva", v).onclick = async () => {
    try { await api(`/api/appuntamenti/${a.id}`, { method: "PUT", json: leggiForm(v, { categoria: a.categoria, icona: a.icona }) }); v.remove(); toast("✅ Salvato"); vistaAgenda(); }
    catch (err) { toast("⚠️ " + err.message); }
  };
  $("#elimina", v).onclick = async () => {
    if (!(await conferma(`Eliminare “${a.titolo}”?`))) return;
    await api(`/api/appuntamenti/${a.id}`, { method: "DELETE" }); v.remove(); toast("🗑️ Eliminato"); vistaAgenda();
  };
}

/* ------------------------------------------------------------------ password */
function generaPassword(n = 18) {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*?-_";
  const a = new Uint32Array(n); crypto.getRandomValues(a);
  return [...a].map((x) => c[x % c.length]).join("");
}
async function vistaPassword() {
  let voci;
  try { voci = await api("/api/cassaforte"); }
  catch (e) {
    if (e.status !== 423) throw e;
    app.innerHTML = `<div class="top"><h1>Password</h1></div><div class="accesso" style="min-height:55vh"><form class="box" id="f">
      <div style="font-size:60px">🔐</div><h2>Cassaforte bloccata</h2><p class="muted">Inserisci la password di Scrigno per vedere le tue password.</p>
      <input type="password" id="pw" placeholder="Password" autocomplete="current-password"><div style="height:12px"></div><button class="btn block">Sblocca</button></form></div>`;
    $("#f").onsubmit = async (ev) => {
      ev.preventDefault();
      try { await api("/api/cassaforte/sblocca", { method: "POST", json: { password: $("#pw").value } }); vistaPassword(); }
      catch (err) { toast("⚠️ " + err.message); }
    };
    return;
  }
  const disegna = (filtro = "") => {
    const f = filtro.toLowerCase();
    const l = voci.filter((v) => !f || [v.titolo, v.utente, v.sito, v.categoria].some((x) => (x || "").toLowerCase().includes(f)));
    $("#lista").innerHTML = l.length ? `<div class="lista">${l.map((v) => `<div class="voce" data-v="${v.id}">
      <div class="thumb" style="background:${COLORI[v.titolo.charCodeAt(0) % COLORI.length]};color:#fff;font-weight:700;font-size:19px">${esc(v.titolo[0]?.toUpperCase() || "?")}</div>
      <div class="corpo"><div class="tit">${esc(v.titolo)}</div><div class="sub">${esc(v.utente || v.sito || "—")}</div></div>
      <button class="btn sec small" data-copia="${v.id}">Copia</button></div>`).join("")}</div>`
      : `<div class="vuoto"><span class="big">🔑</span>${voci.length ? "Nessun risultato." : "Nessuna password salvata.<br>Tocca <b>+</b> per aggiungerne una."}</div>`;
  };
  app.innerHTML = `<div class="top"><h1>Password<small>🔒 Cifrate sul tuo server</small></h1><button class="iconbtn" id="blocca" title="Blocca">🔒</button></div>
    <div class="cerca"><input type="search" id="q" placeholder="Cerca…"></div><div style="height:10px"></div><div id="lista"></div>`;
  disegna();
  $("#q").oninput = (e) => disegna(e.target.value);
  $("#blocca").onclick = async () => { await api("/api/cassaforte/blocca", { method: "POST" }); vistaPassword(); };
  $("#lista").onclick = (e) => {
    const c = e.target.closest("[data-copia]");
    if (c) { e.stopPropagation(); return copia(voci.find((v) => v.id === +c.dataset.copia).segreto, "Password copiata"); }
    const r = e.target.closest("[data-v]"); if (r) dettaglioVoce(voci.find((v) => v.id === +r.dataset.v));
  };
  const b = document.createElement("button"); b.className = "fab"; b.textContent = "+"; b.onclick = () => modificaVoce({}); app.appendChild(b);
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
    <label class="campo"><span>Nome</span><input type="text" name="titolo" value="${esc(v.titolo || "")}" placeholder="Es. Poste, Banca, Netflix, Wi-Fi casa" required></label>
    <label class="campo"><span>Utente / email</span><input type="text" name="utente" value="${esc(v.utente || "")}" autocapitalize="off" autocomplete="off"></label>
    <label class="campo"><span>Password</span><div class="riga" style="gap:8px"><input type="text" name="segreto" value="${esc(v.segreto || "")}" class="occhio" autocapitalize="off" autocomplete="off" style="flex:3">
      <button type="button" class="btn sec" id="gen" style="flex:1">🎲</button></div></label>
    <label class="campo"><span>Sito</span><input type="text" name="sito" value="${esc(v.sito || "")}" placeholder="facoltativo" autocapitalize="off"></label>
    <label class="campo"><span>Note</span><textarea name="note" placeholder="PIN, domande di sicurezza, codici di recupero…">${esc(v.note || "")}</textarea></label>
    <button class="btn block">Salva</button></form>`);
  $("#gen", f).onclick = () => { $("[name=segreto]", f).value = generaPassword(); };
  $("#fv", f).onsubmit = async (e) => {
    e.preventDefault();
    const dati = Object.fromEntries(new FormData(e.target));
    try {
      await api(v.id ? `/api/cassaforte/${v.id}` : "/api/cassaforte", { method: v.id ? "PUT" : "POST", json: dati });
      f.remove(); toast("🔐 Salvata"); vistaPassword();
    } catch (err) { toast("⚠️ " + err.message); }
  };
}

/* ------------------------------------------------------------------ altro / configurazione iPhone */
async function vistaAltro() {
  const s = await api("/api/impostazioni");
  const base = location.origin;
  const feed = `webcal://${location.host}/calendario/${s.token_calendario}.ics`;
  const cod = (t, id) => `<div class="codice"><span ${id ? `id="${id}"` : ""}>${esc(t)}</span><button data-cp="${esc(t)}">Copia</button></div>`;
  const passo = (n, html) => `<div class="passo"><div class="num">${n}</div><div style="flex:1;min-width:0">${html}</div></div>`;
  app.innerHTML = `<div class="top"><h1>Altro<small>Collega Scrigno al tuo iPhone</small></h1></div>

  <details class="card" open><summary><span style="font-size:24px">📤</span> Invia file dal menu “Condividi”</summary><div class="dentro">
    <p class="small muted">Crei una volta sola un Comando Rapido: comparirà nel menu Condividi di qualsiasi app (Foto, File, Mail, WhatsApp, Safari…). I file arrivano in <b>📥 Da smistare</b>.</p>
    ${passo(1, "Apri l'app <b>Comandi Rapidi</b> → tocca <b>+</b> → rinomina il comando in <b>Invia a Scrigno</b>.")}
    ${passo(2, "Tocca <b>ⓘ</b> (in basso) e attiva <b>Mostra nel foglio di condivisione</b>. In “Tipi” lascia <i>Qualsiasi</i>.")}
    ${passo(3, `Aggiungi l'azione <b>Ottieni contenuti dell'URL</b> e incolla questo URL:${cod(base + "/api/documenti")}`)}
    ${passo(4, `Tocca <b>Mostra di più</b>: Metodo <b>POST</b>. In <b>Intestazioni</b> aggiungi:<br>chiave <b>X-Token</b>, valore:${cod(s.token_api)}`)}
    ${passo(5, "Corpo della richiesta: <b>Modulo</b>. Aggiungi un campo di tipo <b>File</b>, chiave <b>file</b>, valore: la variabile <b>Input comando rapido</b>.")}
    ${passo(6, "(Facoltativo) Aggiungi l'azione <b>Mostra notifica</b> con testo “Salvato in Scrigno ✅”.")}
    <p class="small muted">Prova: apri una foto → Condividi → <b>Invia a Scrigno</b>. Funziona anche con più file insieme.</p>
  </div></details>

  <details class="card"><summary><span style="font-size:24px">🗓️</span> Calendario dell'iPhone</summary><div class="dentro">
    <p class="small muted">Collega il calendario <b>una volta sola</b>: da quel momento ogni visita che scrivi in Scrigno (e ogni scadenza di bollo o assicurazione) compare da sola nel Calendario dell'iPhone, con promemoria.</p>
    <a class="btn block" href="${feed}" onclick="localStorage.setItem('scrigno-cal-iscritto','1')">📲 Collega calendario (apri da iPhone)</a>
    <p class="small muted">Se il pulsante non funziona: <b>Impostazioni</b> → <b>App</b> → <b>Calendario</b> → <b>Account calendario</b> → <b>Aggiungi account</b> → <b>Altro</b> → <b>Aggiungi calendario</b> e incolla:</p>
    ${cod(feed)}
    <p class="small muted">Suggerimento: in Impostazioni › Calendario › Account › “Scrigno” imposta l'aggiornamento ogni <b>15 minuti</b>.</p>
  </div></details>

  <details class="card"><summary><span style="font-size:24px">🎙️</span> “Ehi Siri, nuova visita”</summary><div class="dentro">
    <p class="small muted">Detti l'appuntamento a Siri e l'evento viene creato <b>subito</b> nel Calendario dell'iPhone e salvato in Scrigno.</p>
    ${passo(1, "Comandi Rapidi → <b>+</b> → rinomina in <b>Nuova visita</b>.")}
    ${passo(2, "Azione <b>Dettare testo</b> (lingua Italiano).")}
    ${passo(3, `Azione <b>Ottieni contenuti dell'URL</b>: URL${cod(base + "/api/appuntamenti/rapido")}Metodo <b>POST</b>, intestazione <b>X-Token</b> = ${cod(s.token_api)}Corpo <b>JSON</b>: campo testo <b>testo</b> = <i>Testo dettato</i>.`)}
    ${passo(4, "Azione <b>Ottieni valore dizionario</b> per le chiavi <b>titolo</b>, <b>inizio_iphone</b>, <b>fine_iphone</b> e <b>luogo</b>.")}
    ${passo(5, "Azione <b>Aggiungi nuovo evento</b>: Titolo = titolo, Inizio = inizio_iphone, Fine = fine_iphone, Luogo = luogo. Imposta un avviso (es. 1 giorno prima).")}
    ${passo(6, "Azione <b>Pronuncia testo</b> con la chiave <b>frase</b> per sentire la conferma.")}
    <p class="small muted">Poi basta dire: <i>“Ehi Siri, nuova visita”</i> → <i>“il 16 dicembre controllo dal dentista dalle 10 alle 11”</i>.<br>Se usi già il calendario collegato, puoi saltare i passi 4-5 per non avere l'evento due volte.</p>
  </div></details>

  <details class="card"><summary><span style="font-size:24px">📱</span> Installa sulla schermata Home</summary><div class="dentro">
    ${passo(1, "Apri questo indirizzo con <b>Safari</b> sull'iPhone:" + cod(base))}
    ${passo(2, "Tocca <b>Condividi</b> (il quadrato con la freccia) → <b>Aggiungi alla schermata Home</b>.")}
    ${passo(3, "Scrigno si apre a schermo intero, come un'app.")}
    <p class="small muted">Indirizzi di questo server nella rete di casa:</p>${s.indirizzi.map((i) => cod(i)).join("")}
  </div></details>

  <div class="sezione"><h2>Sicurezza</h2></div>
  <div class="lista">
    <div class="voce" id="cambia"><div class="thumb">🔑</div><div class="corpo"><div class="tit">Cambia password</div><div class="sub">Usata anche per cifrare la cassaforte</div></div><div class="dx">›</div></div>
    <div class="voce" id="rig-api"><div class="thumb">♻️</div><div class="corpo"><div class="tit">Rigenera codice per i Comandi Rapidi</div><div class="sub">Se pensi che qualcuno l'abbia visto</div></div></div>
    <div class="voce" id="rig-cal"><div class="thumb">♻️</div><div class="corpo"><div class="tit">Rigenera link del calendario</div><div class="sub">Dovrai ricollegare il calendario</div></div></div>
    <a class="voce" href="/api/backup" download><div class="thumb">💾</div><div class="corpo"><div class="tit">Scarica backup completo</div><div class="sub">Tutti i documenti e le password (cifrate) in un file .zip</div></div><div class="dx">›</div></a>
    <div class="voce" id="esci"><div class="thumb">🚪</div><div class="corpo"><div class="tit" style="color:var(--danger)">Esci</div></div></div>
  </div>
  <p class="small muted" style="margin:18px 4px">Server: <b>${esc(s.nome_host)}</b><br>Dati salvati in: <span class="occhio">${esc(s.cartella_dati)}</span></p>`;

  $("#esci").onclick = async () => { await api("/api/esci", { method: "POST" }); location.reload(); };
  const rig = async (q, msg) => { if (!(await conferma(msg, "Rigenera"))) return; await api("/api/impostazioni/rigenera/" + q, { method: "POST" }); if (q === "token_calendario") localStorage.removeItem("scrigno-cal-iscritto"); toast("♻️ Fatto: aggiorna i Comandi Rapidi/calendario"); vistaAltro(); };
  $("#rig-api").onclick = () => rig("token_api", "Rigenerare il codice? I Comandi Rapidi esistenti smetteranno di funzionare.");
  $("#rig-cal").onclick = () => rig("token_calendario", "Rigenerare il link? Il calendario collegato smetterà di aggiornarsi.");
  $("#cambia").onclick = () => {
    const v = foglio(`<h3>Cambia password ${xBtn}</h3><form id="fp"><label class="campo"><span>Password attuale</span><input type="password" name="attuale" autocomplete="current-password"></label>
      <label class="campo"><span>Nuova password</span><input type="password" name="nuova" autocomplete="new-password" minlength="6"></label><button class="btn block">Cambia</button></form>`);
    $("#fp", v).onsubmit = async (e) => {
      e.preventDefault();
      try { await api("/api/impostazioni/password", { method: "POST", json: Object.fromEntries(new FormData(e.target)) }); v.remove(); toast("🔑 Password cambiata"); }
      catch (err) { toast("⚠️ " + err.message); }
    };
  };
}

/* ------------------------------------------------------------------ accesso */
function mostraAccesso() {
  $("#tabbar").hidden = true;
  const nuovo = !S.stato.configurato;
  app.innerHTML = `<div class="accesso"><form class="box" id="f">
    <img class="logo" src="/static/icona.svg" alt="">
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

/* ------------------------------------------------------------------ router */
async function render() {
  if (!S.stato?.accesso) return;
  $("#tabbar").hidden = false;
  $$(".velo").forEach((v) => v.remove());
  const h = decodeURIComponent(location.hash.slice(2));
  const [sez, arg] = [h.split("/")[0], h.split("/").slice(1).join("/")];
  const tab = { "": "home", c: "home", cerca: "home", raccolta: "home", scadenze: "home" }[sez] || sez;
  $$("#tabbar a").forEach((a) => a.classList.toggle("on", a.dataset.tab === tab));
  scrollTo(0, 0);
  const RACCOLTE = { assicura: "🛡️ Assicurazioni", bollo: "🧾 Bolli", revision: "🔧 Revisioni", salute: "🩺 Salute", document: "🪪 Documenti" };
  try {
    if (sez === "c") await vistaCartella(+arg);
    else if (sez === "da-smistare") await vistaDaSmistare();
    else if (sez === "agenda") await vistaAgenda();
    else if (sez === "password") await vistaPassword();
    else if (sez === "altro") await vistaAltro();
    else if (sez === "scadenze") await vistaScadenze();
    else if (sez === "cerca") await vistaElenco("Risultati", `per “${esc(arg)}”`, "/api/documenti?cerca=" + encodeURIComponent(arg));
    else if (sez === "raccolta") await vistaElenco(RACCOLTE[arg] || esc(arg), "Da tutte le cartelle", "/api/documenti?raccolta=" + encodeURIComponent(arg));
    else await vistaHome();
  } catch (e) {
    if (S.stato?.accesso) app.innerHTML = `<div class="vuoto"><span class="big">📡</span>${esc(e.message)}<br><br><button class="btn" onclick="render()">Riprova</button></div>`;
  }
}

async function avvia() {
  try { S.stato = await api("/api/stato"); }
  catch { app.innerHTML = `<div class="vuoto"><span class="big">📡</span>Server non raggiungibile.<br>Sei connesso al Wi-Fi di casa?<br><br><button class="btn" onclick="avvia()">Riprova</button></div>`; return; }
  if (!S.stato.accesso) return mostraAccesso();
  await caricaCartelle();
  render();
}
addEventListener("hashchange", render);
document.addEventListener("click", (e) => { const b = e.target.closest("[data-cp]"); if (b) copia(b.dataset.cp); });
document.addEventListener("visibilitychange", () => { if (!document.hidden && S.stato?.accesso) caricaCartelle().catch(() => {}); });
if ("serviceWorker" in navigator && window.isSecureContext) navigator.serviceWorker.register("/sw.js").catch(() => {});
avvia();
