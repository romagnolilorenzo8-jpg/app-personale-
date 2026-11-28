/* LifeApp — copertine di film, serie e libri.
   Fonti pubbliche e gratuite, senza registrazione: Wikipedia (locandine), Open Library e Apple Books (libri).
   Attori principali di film e serie: Wikidata.
   Viene inviato solo il titolo (e l'autore per i libri). Si può disattivare in Altro. */
(function () {
  "use strict";
  const attesa = (ms) => new Promise((r) => setTimeout(r, ms));
  async function json(url, opz = {}) {
    const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 9000);
    try { const r = await fetch(url, { ...opz, signal: ctrl.signal }); if (!r.ok) fallite++; return r.ok ? await r.json() : null; }
    catch (e) { fallite++; return null; } finally { clearTimeout(t); }
  }
  async function wiki(lingua, query, n = 6) {
    const u = `https://${lingua}.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=${n}` +
      `&prop=pageimages&piprop=thumbnail&pithumbsize=500&pilicense=any&format=json&origin=*`;
    const d = await json(u, { headers: { "Api-User-Agent": "LifeApp/1.0 (app personale)" } });
    const pagine = Object.values(d?.query?.pages || {}).sort((a, b) => a.index - b.index);
    return pagine.filter((p) => p.thumbnail && p.thumbnail.height >= p.thumbnail.width * 0.9)   // verticali: locandine e copertine, non loghi
      .map((p) => ({ url: p.thumbnail.source, fonte: `Wikipedia · ${p.title}` }));
  }
  async function openLibrary(titolo, autore) {
    const d = await json(`https://openlibrary.org/search.json?title=${encodeURIComponent(titolo)}${autore ? "&author=" + encodeURIComponent(autore) : ""}&limit=6&fields=title,author_name,cover_i`);
    return (d?.docs || []).filter((x) => x.cover_i).map((x) => ({ url: `https://covers.openlibrary.org/b/id/${x.cover_i}-L.jpg`, fonte: `Open Library · ${x.title}` }));
  }
  async function appleLibri(titolo, autore) {
    const d = await json(`https://itunes.apple.com/search?country=it&media=ebook&limit=4&term=${encodeURIComponent(titolo + (autore ? " " + autore : ""))}`);
    return (d?.results || []).filter((x) => x.artworkUrl100).map((x) => ({ url: x.artworkUrl100.replace("100x100", "600x600"), fonte: `Apple Books · ${x.trackName}` }));
  }
  /* Restituisce le copertine candidate, la migliore per prima */
  let fallite = 0;
  async function cerca(tipo, titolo, autore) {
    fallite = 0;
    let out = [];
    if (tipo === "libro") {
      out = [...await openLibrary(titolo, autore), ...await appleLibri(titolo, autore)];
      if (!out.length) out = await wiki("en", `${titolo} ${autore || ""} novel`);
    } else {
      const parola = tipo === "serie" ? "TV series" : "film";
      out = await wiki("en", `${titolo} ${parola}`);
      if (out.length < 3) out = [...out, ...await wiki("it", `${titolo} ${tipo === "serie" ? "serie televisiva" : "film"}`)];
    }
    const visti = new Set();
    out = out.filter((x) => !visti.has(x.url) && visti.add(x.url));
    // se un servizio non ha risposto e non c'è niente, restituisco null: si riproverà più tardi
    return !out.length && fallite ? null : out;
  }
  /* Rende piccola una foto scelta dall'utente (data URL JPEG ~300px) */
  function riduci(file, lato = 360) {
    return new Promise((res, rej) => {
      const img = new Image(), u = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, lato / Math.max(img.width, img.height)), c = document.createElement("canvas");
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u);
        res(c.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = rej; img.src = u;
    });
  }
  /* Attori principali di un film o di una serie, da Wikidata (nome e anno di nascita).
     Restituisce [] se non trova niente, null se il servizio non risponde (si riproverà). */
  const TIPI_FILM = ["Q11424", "Q24869", "Q202866", "Q229390", "Q506240", "Q20650540", "Q17123180", "Q1054574", "Q2484376"];
  const TIPI_SERIE = ["Q5398426", "Q1259759", "Q526877", "Q581714", "Q63952888", "Q117467246", "Q15416", "Q21191270"];
  const wd = (q) => json(`https://www.wikidata.org/w/api.php?${q}&format=json&origin=*`);
  const valori = (ent, p) => (ent?.claims?.[p] || []).map((c) => c.mainsnak?.datavalue?.value).filter(Boolean);
  async function attori(tipo, titolo, max = 8) {
    fallite = 0;
    const cerca = async (lingua) => (await wd(`action=wbsearchentities&search=${encodeURIComponent(titolo)}&language=${lingua}&uselang=it&type=item&limit=10`))?.search || [];
    let cand = await cerca("it");
    if (!cand.length && !fallite) cand = await cerca("en");
    if (fallite) return null;
    const parola = tipo === "serie" ? /serie|series|televisi|tv|sitcom|anime|miniserie|show/i : /film|movie|pellicola|cortometraggio|lungometraggio/i;
    const scelti = cand.filter((c) => parola.test(c.description || "")).slice(0, 4);
    if (!scelti.length) return [];
    const ent = (await wd(`action=wbgetentities&ids=${scelti.map((c) => c.id).join("|")}&props=claims`))?.entities;
    if (!ent) return null;
    const tipi = tipo === "serie" ? TIPI_SERIE : TIPI_FILM;
    const ordinati = scelti.map((c) => ent[c.id]).filter((e) => e && valori(e, "P161").length);
    const opera = ordinati.find((e) => valori(e, "P31").some((v) => tipi.includes(v.id))) || ordinati[0];
    if (!opera) return [];
    const ids = valori(opera, "P161").map((v) => v.id).filter((v, i, a) => a.indexOf(v) === i).slice(0, max);
    const pers = (await wd(`action=wbgetentities&ids=${ids.join("|")}&props=labels|claims&languages=it|en`))?.entities;
    if (!pers) return null;
    return ids.map((id) => {
      const e = pers[id], nome = e?.labels?.it?.value || e?.labels?.en?.value;
      const nascita = valori(e, "P569")[0]?.time;
      return nome ? { nome, anno: nascita ? +nascita.slice(1, 5) : null } : null;
    }).filter(Boolean);
  }
  window.Copertine = { cerca, riduci, attesa, attori };
})();
