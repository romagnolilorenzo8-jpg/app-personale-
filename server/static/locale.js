/* Scrigno — modalità iPhone: tutto salvato nella memoria del telefono, senza server.
   Risponde alle stesse richieste "/api/..." del server, così l'interfaccia è identica. */
(function () {
  "use strict";
  if (!window.SCRIGNO_LOCALE) return;

  const ARCHIVI = ["cartelle", "documenti", "blob", "password", "appuntamenti", "diario"];
  let _db, chiave = null, nascostoDa = 0;
  const urlCache = new Map();

  /* ------------------------------------------------------------ IndexedDB */
  function apri() {
    return (_db ||= new Promise((res, rej) => {
      const r = indexedDB.open("scrigno", 2);
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const s of ARCHIVI) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: "id", autoIncrement: true });
        if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv");
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
  }
  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const st = async (n, mode = "readonly") => (await apri()).transaction(n, mode).objectStore(n);
  const tutti = async (n) => req((await st(n)).getAll());
  const leggi = async (n, k) => req((await st(n)).get(k));
  const scrivi = async (n, v, k) => req((await st(n, "readwrite")).put(v, k));
  const aggiungi = async (n, v) => req((await st(n, "readwrite")).add(v));
  const togli = async (n, k) => req((await st(n, "readwrite")).delete(k));
  const svuota = async (n) => req((await st(n, "readwrite")).clear());
  const kv = { get: (k) => leggi("kv", k), set: (k, v) => scrivi("kv", v, k) };

  function errore(status, msg, extra) { const e = new Error(msg); e.status = status; Object.assign(e, extra || {}); return e; }
  const adesso = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19); };
  const oggi = () => adesso().slice(0, 10);

  /* ------------------------------------------------------------ cartelle iniziali */
  const INIZIALI = [
    ["Mezzi di trasporto", "🚗", [["Motorino", "🛵", ["Bollo", "Assicurazione", "Revisione", "Libretto", "Manutenzione"]],
      ["Auto", "🚙", ["Bollo", "Assicurazione", "Revisione", "Libretto", "Manutenzione"]]]],
    ["Salute", "🩺", [["Analisi del sangue", "🩸", []], ["Dentista", "🦷", ["Radiografie denti", "Preventivi e fatture"]],
      ["Referti e visite", "📋", []], ["Esami e radiografie", "🩻", []], ["Ricette e farmaci", "💊", []], ["Vaccini", "💉", []]]],
    ["Assicurazioni", "🛡️", [["Casa", "🏠", []], ["Vita e salute", "❤️", []], ["Viaggi", "✈️", []]]],
    ["Documenti personali", "🪪", [["Carta d'identità", "🪪", []], ["Patente", "🚦", []], ["Passaporto", "🛂", []], ["Tessera sanitaria", "💳", []]]],
    ["Casa", "🏠", [["Bollette", "💡", []], ["Contratti", "📝", []], ["Garanzie e scontrini", "🧾", []]]],
    ["Lavoro e tasse", "💼", [["Buste paga", "💶", []], ["Dichiarazione redditi", "🏛️", []]]],
    ["Varie", "🗂️", []],
  ];
  function iconaAuto(n) {
    n = n.toLowerCase();
    for (const [k, v] of [["bollo", "🧾"], ["assicura", "🛡️"], ["revision", "🔧"], ["libretto", "📘"], ["manutenz", "🛠️"], ["radiograf", "🩻"], ["fattur", "🧾"], ["preventiv", "🧾"]])
      if (n.includes(k)) return v;
    return "📁";
  }
  async function cartellePersonali() {
    if (await kv.get("cartelle_v2")) return;
    const cart = await tutti("cartelle");
    let dp = cart.find((c) => c.padre == null && c.nome === "Documenti personali");
    if (!dp) dp = { id: await aggiungi("cartelle", { nome: "Documenti personali", icona: "🪪", padre: null, ordine: 3 }) };
    const figli = cart.filter((c) => c.padre === dp.id);
    for (const [nome, icona] of [["Fototessera", "📸"], ["Curriculum", "📄"]])
      if (!figli.some((c) => c.nome === nome)) await aggiungi("cartelle", { nome, icona, padre: dp.id, ordine: -1 });
    await kv.set("cartelle_v2", true);
  }
  /* I miei lavori dentro "Lavoro e tasse": ognuno con Contratto e Buste paga (e le note) */
  const LAVORI = [["Xmasters", "💼"], ["Benzinaio", "⛽"], ["Inventari", "📦"]];
  /* Cartelle "con modello": un lavoro, una casa in affitto o di proprietà, già organizzate */
  const MODELLI = {"lavoro": [["Contratto", "📝"], ["Buste paga", "💶"]], "affitto": [["Contratto d'affitto", "📝"], ["Bollette", "💡"], ["Ricevute affitto", "🧾"], ["Manutenzione", "🛠️"]], "proprieta": [["Atto e mutuo", "📜"], ["Bollette", "💡"], ["Condominio", "🏢"], ["Assicurazione casa", "🛡️"], ["Manutenzione", "🛠️"]]};
  const ICONE_MODELLO = { lavoro: "💼", affitto: "🔑", proprieta: "🏡" };
  async function creaDaModello(nome, icona, padre, tipo) {
    const id = await aggiungi("cartelle", { nome, icona: icona || ICONE_MODELLO[tipo], padre, ordine: 0, tipo, note: [] });
    for (let i = 0; i < MODELLI[tipo].length; i++) await aggiungi("cartelle", { nome: MODELLI[tipo][i][0], icona: MODELLI[tipo][i][1], padre: id, ordine: i });
    return id;
  }
  const creaLavoro = (nome, icona, padre) => creaDaModello(nome, icona, padre, "lavoro");
  async function cartelleLavori() {
    if (await kv.get("lavori_v1")) return;
    const cart = await tutti("cartelle");
    let lt = cart.find((c) => c.padre == null && c.nome === "Lavoro e tasse");
    if (!lt) lt = { id: await aggiungi("cartelle", { nome: "Lavoro e tasse", icona: "💼", padre: null, ordine: 5 }) };
    for (const [nome, icona] of LAVORI) {
      const c = cart.find((x) => x.padre === lt.id && x.nome.toLowerCase() === nome.toLowerCase());
      if (!c) { await creaLavoro(nome, icona, lt.id); continue; }
      if (c.tipo !== "lavoro") { c.tipo = "lavoro"; c.note = c.note || []; await scrivi("cartelle", c); }
      for (const [sub, ic, o] of [["Contratto", "📝", 0], ["Buste paga", "💶", 1]])
        if (!cart.some((x) => x.padre === c.id && x.nome === sub)) await aggiungi("cartelle", { nome: sub, icona: ic, padre: c.id, ordine: o });
    }
    await kv.set("lavori_v1", true);
  }
  /* Ripara le cartelle create due volte da una versione precedente (succedeva al primo avvio):
     unisce le cartelle con lo stesso nome allo stesso livello, spostando documenti e sottocartelle
     in quella più vecchia. Non cancella mai documenti. */
  async function unisciDoppioni() {
    if (await kv.get("doppioni_riparati")) return;
    const cart = await tutti("cartelle"), docs = await tutti("documenti");
    const unisci = async (padre) => {
      const figli = cart.filter((c) => c.padre === padre && !c._via).sort((a, b) => a.id - b.id);
      const visti = {};
      for (const c of figli) {
        const k = c.nome.trim().toLowerCase();
        if (!visti[k]) { visti[k] = c; continue; }
        const tieni = visti[k];
        for (const sub of cart.filter((x) => x.padre === c.id)) { sub.padre = tieni.id; await scrivi("cartelle", sub); }
        for (const d of docs.filter((x) => x.cartella === c.id)) { d.cartella = tieni.id; await scrivi("documenti", d); }
        c._via = true; await togli("cartelle", c.id);
      }
      for (const c of cart.filter((x) => x.padre === padre && !x._via)) await unisci(c.id);
    };
    await unisci(null);
    await kv.set("doppioni_riparati", true);
  }
  let _avvio = null;
  function inizializza() { return (_avvio ||= preparaArchivio()); }   // una sola volta, anche con richieste in parallelo
  /* Crea le cartelle iniziali in un'unica transazione: se l'app viene chiusa a metà non resta niente
     di parziale (prima succedeva, e al riavvio le cartelle venivano create due volte). */
  function seminaCartelle() {
    return apri().then((d) => new Promise((res, rej) => {
      const t = d.transaction(["cartelle", "kv"], "readwrite");
      const cs = t.objectStore("cartelle"), kvs = t.objectStore("kv");
      const fatto = kvs.get("inizializzato");
      fatto.onsuccess = () => {
        if (fatto.result) return;
        const crea = (nome, icona, figli, padre, ordine) => {
          const r = cs.add({ nome, icona, padre, ordine });
          r.onsuccess = () => figli.forEach((f, i) => (typeof f === "string" ? crea(f, iconaAuto(f), [], r.result, i) : crea(f[0], f[1], f[2], r.result, i)));
        };
        INIZIALI.forEach((x, i) => crea(x[0], x[1], x[2], null, i));
        kvs.put(true, "inizializzato");
        kvs.put(true, "doppioni_riparati");
      };
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    }));
  }
  async function preparaArchivio() {
    await seminaCartelle();
    await unisciDoppioni();
    await cartellePersonali();
    await cartelleLavori();
  }

  async function discendenti(id) {
    const c = await tutti("cartelle"), out = [], coda = [id];
    while (coda.length) { const x = coda.pop(); out.push(x); c.filter((y) => y.padre === x).forEach((y) => coda.push(y.id)); }
    return out;
  }

  /* ------------------------------------------------------------ documenti */
  async function conUrl(d) {
    if (!urlCache.has(d.id)) {
      const b = await leggi("blob", d.id);
      if (b) urlCache.set(d.id, URL.createObjectURL(b.blob));
    }
    return { ...d, _url: urlCache.get(d.id) || "" };
  }
  async function blobDoc(id) { const b = await leggi("blob", id); return b && b.blob; }

  async function carica(files, { cartella = null, scadenza = null, nome = null } = {}) {
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { /* facoltativo */ }
    const ids = [];
    for (const f of files) {
      const dati = await f.arrayBuffer();
      let n = (files.length === 1 && nome) ? nome : (f.name || `Documento ${adesso().replace("T", " ").slice(0, 16)}`);
      const est = (f.name || "").match(/\.[a-z0-9]{1,5}$/i);
      if (est && !/\.[a-z0-9]{1,5}$/i.test(n)) n += est[0];
      const id = await aggiungi("documenti", { cartella, nome: n, mime: f.type || "application/octet-stream", dimensione: f.size,
        note: "", scadenza: scadenza || null, creato: adesso(), origine: "app" });
      await scrivi("blob", { id, blob: new Blob([dati], { type: f.type || "application/octet-stream" }) });
      ids.push(id);
    }
    return { ok: true, ids };
  }

  /* ------------------------------------------------------------ cassaforte (AES-GCM) */
  const b64 = (u8) => btoa(String.fromCharCode(...new Uint8Array(u8)));
  const deb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  async function deriva(pw, sale) {
    const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt: sale, iterations: 310000, hash: "SHA-256" }, k, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function cifra(k, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(JSON.stringify(obj)));
    return { iv: b64(iv), ct: b64(ct) };
  }
  async function decifra(k, x) {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: deb64(x.iv) }, k, deb64(x.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }
  async function sblocca(pw) {
    const v = await kv.get("cassaforte");
    if (!v) {
      if ((pw || "").length < 6) throw errore(400, "La password deve avere almeno 6 caratteri");
      const sale = crypto.getRandomValues(new Uint8Array(16));
      const k = await deriva(pw, sale);
      await kv.set("cassaforte", { sale: b64(sale), verifica: await cifra(k, "scrigno") });
      chiave = k; return;
    }
    const k = await deriva(pw, deb64(v.sale));
    try { await decifra(k, v.verifica); } catch (e) { throw errore(401, "Password errata"); }
    chiave = k;
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) nascostoDa = Date.now();
    else if (nascostoDa && Date.now() - nascostoDa > 5 * 60000) chiave = null; // blocco automatico dopo 5 minuti
  });

  /* ------------------------------------------------------------ appuntamenti */
  function normalizza(a) {
    a = { titolo: "", luogo: "", note: "", categoria: "altro", icona: "📅", ...a };
    if (!a.titolo.trim()) throw errore(400, "Titolo obbligatorio");
    if (!/^\d{4}-\d{2}-\d{2}/.test(a.inizio || "")) throw errore(400, "Data non valida");
    if (a.tutto_il_giorno || a.inizio.length === 10) {
      a.tutto_il_giorno = true; a.inizio = a.inizio.slice(0, 10); a.fine = (a.fine || a.inizio).slice(0, 10);
      if (a.fine < a.inizio) a.fine = a.inizio;
    } else {
      a.tutto_il_giorno = false;
      a.inizio = a.inizio.slice(0, 16);
      if (!a.fine || a.fine.length < 16 || a.fine.slice(0, 16) <= a.inizio) {
        const s = new Date(a.inizio); s.setHours(s.getHours() + 1);
        a.fine = new Date(s - s.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      } else a.fine = a.fine.slice(0, 16);
    }
    a.titolo = a.titolo.trim();
    return a;
  }

  /* ------------------------------------------------------------ calendario .ics */
  const esc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  const utc = (local) => new Date(local).toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  function ics(eventi) {
    const r = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Scrigno//IT", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
    for (const a of eventi) {
      r.push("BEGIN:VEVENT", `UID:${a.uid}`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`, `SUMMARY:${esc((a.icona ? a.icona + " " : "") + a.titolo)}`);
      if (a.tutto_il_giorno) {
        const fine = new Date(a.fine + "T00:00:00Z"); fine.setUTCDate(fine.getUTCDate() + 1);
        r.push(`DTSTART;VALUE=DATE:${a.inizio.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${fine.toISOString().slice(0, 10).replace(/-/g, "")}`);
      } else r.push(`DTSTART:${utc(a.inizio)}`, `DTEND:${utc(a.fine)}`);
      if (a.luogo) r.push(`LOCATION:${esc(a.luogo)}`);
      if (a.note) r.push(`DESCRIPTION:${esc(a.note)}`);
      for (const min of a.tutto_il_giorno ? [720] : [1440, 60])
        r.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(a.titolo)}`, `TRIGGER:-PT${min}M`, "END:VALARM");
      r.push("END:VEVENT");
    }
    r.push("END:VCALENDAR");
    return r.join("\r\n") + "\r\n";
  }

  /* ------------------------------------------------------------ zip (backup) */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  async function creaZip(voci) { // voci: [{nome, blob}]
    const parti = [], centrale = []; let pos = 0;
    const enc = new TextEncoder();
    for (const v of voci) {
      const dati = new Uint8Array(await v.blob.arrayBuffer());
      const nome = enc.encode(v.nome), crc = crc32(dati);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint32(14, crc, true); h.setUint32(18, dati.length, true); h.setUint32(22, dati.length, true); h.setUint16(26, nome.length, true);
      parti.push(h.buffer, nome, v.blob);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint32(16, crc, true); c.setUint32(20, dati.length, true); c.setUint32(24, dati.length, true); c.setUint16(28, nome.length, true);
      c.setUint32(42, pos, true);
      centrale.push(c.buffer, nome);
      pos += 30 + nome.length + dati.length;
    }
    const dimC = centrale.reduce((s, x) => s + x.byteLength, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, voci.length, true); e.setUint16(10, voci.length, true);
    e.setUint32(12, dimC, true); e.setUint32(16, pos, true);
    return new Blob([...parti, ...centrale, e.buffer], { type: "application/zip" });
  }
  async function leggiZip(blob) {
    const coda = new DataView(await blob.slice(Math.max(0, blob.size - 65557)).arrayBuffer());
    let i = coda.byteLength - 22;
    while (i >= 0 && coda.getUint32(i, true) !== 0x06054b50) i--;
    if (i < 0) throw errore(400, "Il file non è un backup di Scrigno");
    const n = coda.getUint16(i + 10, true), dimC = coda.getUint32(i + 12, true), offC = coda.getUint32(i + 16, true);
    const c = new DataView(await blob.slice(offC, offC + dimC).arrayBuffer());
    const dec = new TextDecoder(), out = {};
    for (let p = 0, k = 0; k < n; k++) {
      const metodo = c.getUint16(p + 10, true), dimComp = c.getUint32(p + 20, true);
      const ln = c.getUint16(p + 28, true), le = c.getUint16(p + 30, true), lc = c.getUint16(p + 32, true), off = c.getUint32(p + 42, true);
      const nome = dec.decode(new Uint8Array(c.buffer, p + 46, ln));
      out[nome] = async () => {
        const h = new DataView(await blob.slice(off, off + 30).arrayBuffer());
        const inizio = off + 30 + h.getUint16(26, true) + h.getUint16(28, true);
        const raw = blob.slice(inizio, inizio + dimComp);
        if (metodo === 0) return raw;
        if (metodo === 8) return new Response(raw.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
        throw errore(400, "Formato di compressione non supportato");
      };
      p += 46 + ln + le + lc;
    }
    return out;
  }
  const nomeSicuro = (s) => s.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 120);

  async function esportaBackup() {
    const docs = await tutti("documenti");
    const manifest = { formato: "scrigno-backup", versione: 1, creato: adesso(), cartelle: await tutti("cartelle"),
      documenti: docs.map((d) => ({ ...d, file: `file/${d.id}-${nomeSicuro(d.nome)}` })),
      appuntamenti: await tutti("appuntamenti"),
      diario: await tutti("diario"),
      profilo: (await kv.get("profilo")) || {},
      cassaforte: { chiave: await kv.get("cassaforte") || null, voci: await tutti("password") } };
    const voci = [{ nome: "scrigno.json", blob: new Blob([JSON.stringify(manifest, null, 1)], { type: "application/json" }) }];
    for (const d of manifest.documenti) { const b = await blobDoc(d.id); if (b) voci.push({ nome: d.file, blob: b }); }
    const zip = await creaZip(voci);
    await kv.set("ultimo_backup", adesso());
    return new File([zip], `Scrigno-backup-${oggi()}.zip`, { type: "application/zip" });
  }
  async function ripristina(file) {
    const z = await leggiZip(file);
    if (!z["scrigno.json"]) throw errore(400, "Il file non è un backup di Scrigno");
    const m = JSON.parse(await (await z["scrigno.json"]()).text());
    if (m.formato !== "scrigno-backup") throw errore(400, "Il file non è un backup di Scrigno");
    for (const s of ARCHIVI) await svuota(s);
    urlCache.forEach((u) => URL.revokeObjectURL(u)); urlCache.clear();
    for (const c of m.cartelle) await scrivi("cartelle", c);
    for (const d of m.documenti) {
      const f = z[d.file]; const rec = { ...d }; delete rec.file;
      await scrivi("documenti", rec);
      if (f) await scrivi("blob", { id: d.id, blob: new Blob([await (await f()).arrayBuffer()], { type: d.mime }) });
    }
    for (const a of m.appuntamenti) await scrivi("appuntamenti", a);
    for (const x of m.diario || []) await scrivi("diario", x);
    if (m.profilo) await kv.set("profilo", m.profilo);
    for (const p of m.cassaforte?.voci || []) await scrivi("password", p);
    await kv.set("cassaforte", m.cassaforte?.chiave || undefined);
    await kv.set("inizializzato", true);
    chiave = null;
    return { cartelle: m.cartelle.length, documenti: m.documenti.length, appuntamenti: m.appuntamenti.length };
  }

  /* ------------------------------------------------------------ diario */
  const TIPI = ["film", "libro", "serie", "compleanno", "esame", "acquisto"];
  const numero = (v) => (v === "" || v == null || isNaN(+v) ? null : Math.round(+v * 100) / 100);
  function normExtra(tipo, e) {
    e = e || {};
    if (tipo === "acquisto") {
      const x = { prezzo: numero(e.prezzo), vendita: numero(e.vendita), data_vendita: e.data_vendita || null, categoria: e.categoria || "altro" };
      if (x.prezzo == null && x.vendita == null) throw errore(400, "Manca il prezzo");
      if (x.vendita == null) x.data_vendita = null;
      return x;
    }
    if (tipo === "esame") {
      if (e.esito === "idoneo" || e.esito === "non idoneo") return { esito: e.esito, cfu: numero(e.cfu) };
      const votoOk = (v) => v == null || (v >= 18 && v <= 30);
      const moduli = Array.isArray(e.moduli) ? e.moduli.map((m, i) => ({
        nome: String(m.nome || `Modulo ${i + 1}`).trim() || `Modulo ${i + 1}`, cfu: numero(m.cfu) ?? 6, voto: numero(m.voto),
        lode: !!m.lode && numero(m.voto) === 30, data: m.data || null })) : [];
      if (moduli.length) {
        if (!moduli.every((m) => votoOk(m.voto))) throw errore(400, "Il voto di ogni modulo deve essere tra 18 e 30");
        return { moduli, cfu: moduli.reduce((a, m) => a + m.cfu, 0) };
      }
      const voto = numero(e.voto);
      if (voto == null || !votoOk(voto)) throw errore(400, "Il voto deve essere tra 18 e 30");
      return { voto, lode: !!e.lode && voto === 30, cfu: numero(e.cfu) ?? 6 };
    }
    return {};
  }
  function normDiario(b) {
    const x = { tipo: b.tipo, titolo: String(b.titolo || "").trim(), autore: String(b.autore || "").trim(), data: b.data || null,
      voto: b.voto ? Math.max(1, Math.min(5, +b.voto)) : null, commento: String(b.commento || "").trim(), stato: b.stato || "",
      giorno: b.giorno ? +b.giorno : null, mese: b.mese ? +b.mese : null, anno: b.anno ? +b.anno : null };
    if (!TIPI.includes(x.tipo)) throw errore(400, "Tipo non valido");
    x.extra = normExtra(x.tipo, b.extra);
    if (!x.titolo) throw errore(400, x.tipo === "compleanno" ? "Manca il nome" : "Manca il titolo");
    if (x.tipo === "compleanno" && !(x.giorno >= 1 && x.giorno <= 31 && x.mese >= 1 && x.mese <= 12)) throw errore(400, "Data del compleanno non valida");
    return x;
  }
  function prossimoCompleanno(x) {
    const o = new Date(oggi() + "T00:00:00");
    let d = new Date(o.getFullYear(), x.mese - 1, x.giorno);
    if (d < o) d = new Date(o.getFullYear() + 1, x.mese - 1, x.giorno);
    return d;
  }
  function ordinaDiario(l) {
    return l.sort((a, b) => a.tipo === "compleanno" && b.tipo === "compleanno"
      ? prossimoCompleanno(a) - prossimoCompleanno(b)
      : (b.data || b.creato || "").localeCompare(a.data || a.creato || "") || b.id - a.id);
  }

  /* ------------------------------------------------------------ "server" locale */
  async function api(url, o = {}) {
    await inizializza();
    const u = new URL(url, location.href);
    const path = u.pathname.slice(u.pathname.indexOf("/api/"));
    const q = u.searchParams, M = (o.method || "GET").toUpperCase(), B = o.json || {};
    let m;

    if (path === "/api/stato") return { configurato: true, accesso: true, locale: true, cassaforte_aperta: !!chiave };

    // ---- cartelle
    if (path === "/api/cartelle" && M === "GET") {
      const cart = (await tutti("cartelle")).sort((a, b) => (a.ordine - b.ordine) || a.nome.localeCompare(b.nome));
      const docs = await tutti("documenti"), conta = {};
      docs.forEach((d) => (conta[d.cartella ?? "null"] = (conta[d.cartella ?? "null"] || 0) + 1));
      const figli = {}; cart.forEach((c) => (figli[c.padre ?? "root"] ||= []).push(c.id));
      const tot = (id) => (conta[id] || 0) + (figli[id] || []).reduce((s, f) => s + tot(f), 0);
      return { cartelle: cart.map((c) => ({ ...c, documenti: conta[c.id] || 0, totale: tot(c.id), sottocartelle: (figli[c.id] || []).length })), da_smistare: conta["null"] || 0 };
    }
    if (path === "/api/cartelle" && M === "POST") {
      if (!(B.nome || "").trim()) throw errore(400, "Nome obbligatorio");
      const n = (await tutti("cartelle")).filter((c) => c.padre === (B.padre ?? null)).length;
      if (MODELLI[B.tipo]) return { id: await creaDaModello(B.nome.trim(), B.icona, B.padre ?? null, B.tipo) };
      return { id: await aggiungi("cartelle", { nome: B.nome.trim(), padre: B.padre ?? null, icona: B.icona || iconaAuto(B.nome), ordine: n }) };
    }
    if ((m = path.match(/^\/api\/cartelle\/(\d+)$/))) {
      const id = +m[1], c = await leggi("cartelle", id);
      if (!c) throw errore(404, "Cartella non trovata");
      if (M === "PATCH") {
        if (B.nome && B.nome.trim()) c.nome = B.nome.trim();
        if (B.icona) c.icona = B.icona;
        if (B.tipo && MODELLI[B.tipo] && B.tipo !== c.tipo) {
          c.tipo = B.tipo;
          if (!B.icona && Object.values(ICONE_MODELLO).includes(c.icona)) c.icona = ICONE_MODELLO[B.tipo];
          const figli = (await tutti("cartelle")).filter((x) => x.padre === c.id).map((x) => x.nome);
          for (const [n, ic] of MODELLI[B.tipo]) if (!figli.includes(n)) await aggiungi("cartelle", { nome: n, icona: ic, padre: c.id, ordine: 9 });
        }
        if (Array.isArray(B.note)) c.note = B.note.map((x) => ({ id: x.id || Date.now() + Math.random(), titolo: String(x.titolo || "").trim(), testo: String(x.testo || ""), data: x.data || adesso() }));
        if (B.sposta_padre) {
          if (B.padre != null && (await discendenti(id)).includes(B.padre)) throw errore(400, "Non puoi spostare una cartella dentro sé stessa");
          c.padre = B.padre ?? null;
        }
        await scrivi("cartelle", c); return { ok: true };
      }
      if (M === "DELETE") {
        const ids = await discendenti(id);
        for (const d of await tutti("documenti")) if (ids.includes(d.cartella)) { d.cartella = null; await scrivi("documenti", d); }
        for (const i of ids) await togli("cartelle", i);
        return { ok: true };
      }
    }

    // ---- documenti
    if (path === "/api/documenti" && M === "GET") {
      const cart = await tutti("cartelle"), nomi = Object.fromEntries(cart.map((c) => [c.id, c.nome]));
      let docs = await tutti("documenti");
      if (q.get("da_smistare") === "true") docs = docs.filter((d) => d.cartella == null);
      else if (q.get("cartella")) docs = docs.filter((d) => d.cartella === +q.get("cartella"));
      const cerca = (q.get("cerca") || "").toLowerCase();
      if (cerca) docs = docs.filter((d) => [d.nome, d.note, nomi[d.cartella]].some((x) => (x || "").toLowerCase().includes(cerca)));
      const rac = (q.get("raccolta") || "").toLowerCase();
      if (rac) {
        const ids = new Set();
        for (const c of cart.filter((c) => c.nome.toLowerCase().includes(rac))) (await discendenti(c.id)).forEach((i) => ids.add(i));
        docs = docs.filter((d) => ids.has(d.cartella));
      }
      docs.sort((a, b) => b.creato.localeCompare(a.creato));
      if (q.get("recenti") === "true") docs = docs.slice(0, 12);
      return Promise.all(docs.map((d) => conUrl({ ...d, nome_cartella: nomi[d.cartella] || null })));
    }
    if ((m = path.match(/^\/api\/documenti\/(\d+)$/))) {
      const id = +m[1], d = await leggi("documenti", id);
      if (!d) throw errore(404, "Documento non trovato");
      if (M === "PATCH") {
        if (B.nome && B.nome.trim()) d.nome = B.nome.trim();
        if (B.sposta) d.cartella = B.cartella ?? null;
        if (B.note != null) d.note = B.note;
        if (B.togli_scadenza) d.scadenza = null; else if (B.scadenza) d.scadenza = B.scadenza;
        await scrivi("documenti", d); return { ok: true };
      }
      if (M === "DELETE") {
        await togli("documenti", id); await togli("blob", id);
        if (urlCache.has(id)) { URL.revokeObjectURL(urlCache.get(id)); urlCache.delete(id); }
        return { ok: true };
      }
    }
    if (path === "/api/scadenze") {
      const cart = await tutti("cartelle"), byId = Object.fromEntries(cart.map((c) => [c.id, c]));
      const perc = (id) => { const p = []; while (id != null && byId[id]) { p.unshift(byId[id].nome); id = byId[id].padre; } return p.join(" › "); };
      const docs = (await tutti("documenti")).filter((d) => d.scadenza).sort((a, b) => a.scadenza.localeCompare(b.scadenza));
      return Promise.all(docs.map((d) => conUrl({ ...d, nome_cartella: byId[d.cartella]?.nome || null, percorso: perc(d.cartella) })));
    }

    // ---- cassaforte
    if (path === "/api/cassaforte/sblocca") { await sblocca(B.password); return { ok: true }; }
    if (path === "/api/cassaforte/blocca") { chiave = null; return { ok: true }; }
    if (path.startsWith("/api/cassaforte")) {
      if (!chiave) throw errore(423, "Cassaforte bloccata", { nuova: !(await kv.get("cassaforte")) });
      if (path === "/api/cassaforte" && M === "GET") {
        const out = [];
        for (const v of await tutti("password")) { try { out.push({ id: v.id, ...(await decifra(chiave, v)) }); } catch (e) { /* voce illeggibile */ } }
        return out.sort((a, b) => a.titolo.localeCompare(b.titolo, "it", { sensitivity: "base" }));
      }
      const voce = { titolo: B.titolo || "", utente: B.utente || "", segreto: B.segreto || "", sito: B.sito || "", note: B.note || "", categoria: B.categoria || "", modificato: adesso() };
      if (path === "/api/cassaforte" && M === "POST") return { id: await aggiungi("password", await cifra(chiave, { ...voce, creato: adesso() })) };
      if ((m = path.match(/^\/api\/cassaforte\/(\d+)$/))) {
        if (M === "PUT") { await scrivi("password", { id: +m[1], ...(await cifra(chiave, voce)) }); return { ok: true }; }
        if (M === "DELETE") { await togli("password", +m[1]); return { ok: true }; }
      }
    }
    if (path === "/api/impostazioni/password") {
      const v = await kv.get("cassaforte");
      if (!v) throw errore(400, "Non hai ancora creato la password della cassaforte");
      const vecchia = await deriva(B.attuale || "", deb64(v.sale));
      try { await decifra(vecchia, v.verifica); } catch (e) { throw errore(401, "Password attuale errata"); }
      if ((B.nuova || "").length < 6) throw errore(400, "La nuova password deve avere almeno 6 caratteri");
      const voci = [];
      for (const x of await tutti("password")) voci.push({ id: x.id, dati: await decifra(vecchia, x) });
      const sale = crypto.getRandomValues(new Uint8Array(16)), nuova = await deriva(B.nuova, sale);
      for (const x of voci) await scrivi("password", { id: x.id, ...(await cifra(nuova, x.dati)) });
      await kv.set("cassaforte", { sale: b64(sale), verifica: await cifra(nuova, "scrigno") });
      chiave = nuova; return { ok: true };
    }

    // ---- appuntamenti
    if (path === "/api/appuntamenti/analizza") return window.ScrignoNLP.analizza(B.testo || "");
    if (path === "/api/appuntamenti" && M === "GET") {
      let l = (await tutti("appuntamenti")).sort((a, b) => a.inizio.localeCompare(b.inizio));
      if (q.get("tutti") !== "true") l = l.filter((a) => a.fine.slice(0, 10) >= oggi());
      return l;
    }
    if (path === "/api/appuntamenti" && M === "POST") {
      const a = normalizza({ ...B }); delete a.id;
      a.uid = (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random()) + "@scrigno"; a.creato = adesso();
      a.id = await aggiungi("appuntamenti", a); return a;
    }
    if ((m = path.match(/^\/api\/appuntamenti\/(\d+)$/))) {
      const vecchio = await leggi("appuntamenti", +m[1]);
      if (!vecchio) throw errore(404, "Appuntamento non trovato");
      if (M === "PUT") { await scrivi("appuntamenti", { ...vecchio, ...normalizza({ ...B }), id: vecchio.id, uid: vecchio.uid }); return { ok: true }; }
      if (M === "DELETE") { await togli("appuntamenti", vecchio.id); return { ok: true }; }
    }

    // ---- diario: film, libri, serie, compleanni
    if (path === "/api/diario" && M === "GET") {
      let l = await tutti("diario");
      if (q.get("tipo")) l = l.filter((x) => x.tipo === q.get("tipo"));
      return ordinaDiario(l);
    }
    if (path === "/api/diario" && M === "POST") {
      const x = normDiario(B); delete x.id; x.creato = adesso();
      x.id = await aggiungi("diario", x); return x;
    }
    if ((m = path.match(/^\/api\/diario\/(\d+)$/))) {
      const vecchio = await leggi("diario", +m[1]);
      if (!vecchio) throw errore(404, "Elemento non trovato");
      if (M === "PUT") { const x = { ...vecchio, ...normDiario({ ...vecchio, ...B }), id: vecchio.id }; await scrivi("diario", x); return x; }
      if (M === "DELETE") { await togli("diario", vecchio.id); return { ok: true }; }
    }

    // ---- profilo personale
    if (path === "/api/profilo") {
      if (M === "PUT") { await kv.set("profilo", { ...(B || {}) }); return { ok: true }; }
      return (await kv.get("profilo")) || {};
    }

    // ---- impostazioni
    if (path === "/api/impostazioni") {
      let uso = null, quota = null;
      try { const e = await navigator.storage.estimate(); uso = e.usage; quota = e.quota; } catch (e) { /* non disponibile */ }
      let persistente = false;
      try { persistente = await navigator.storage.persisted(); } catch (e) { /* non disponibile */ }
      return { locale: true, uso, quota, persistente, ultimo_backup: await kv.get("ultimo_backup") || null, diario: (await tutti("diario")).length,
        documenti: (await tutti("documenti")).length };
    }
    throw errore(404, "Funzione non disponibile senza server");
  }

  window.LOCALE = {
    api, carica, esportaBackup, ripristina, blobDoc,
    icsUrl: (a) => URL.createObjectURL(new Blob([ics([a])], { type: "text/calendar" })),
    icsFile: (a) => new File([ics([a])], `${nomeSicuro(a.titolo).slice(0, 40) || "appuntamento"}.ics`, { type: "text/calendar" }),
    _zip: { creaZip, leggiZip, crc32 },
  };
})();
