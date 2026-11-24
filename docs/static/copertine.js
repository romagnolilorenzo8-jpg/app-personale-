/* Scrigno — copertine di film, serie e libri.
   Fonti pubbliche e gratuite, senza registrazione: Wikipedia (locandine), Open Library e Apple Books (libri).
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
    const d = await json(u, { headers: { "Api-User-Agent": "Scrigno/1.0 (app personale)" } });
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
  window.Copertine = { cerca, riduci, attesa };
})();
