/* Scrigno — la chat: capisce frasi semplici in italiano e decide cosa fare.
   Restituisce un "intento", ad esempio:
     { azione: "compleanno", nome: "Marco Rossi", giorno: 6, mese: 8, anno: null }
     { azione: "diario", tipo: "film", titolo: "After", data: "2026-11-22", voto: 5, commento: "Bellissimo" }
     { azione: "commento", titolo: "After", commento: "..." }
     { azione: "domanda", cosa: "compleanno", nome: "Marco" } / { azione: "domanda", cosa: "film" } …
     { azione: "appuntamento", ... (risultato di ScrignoNLP.analizza) }
     { azione: "boh" } */
(function (glob) {
  "use strict";
  const MESI = { gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7, agosto: 8, settembre: 9,
    ottobre: 10, novembre: 11, dicembre: 12, gen: 1, feb: 2, mar: 3, apr: 4, mag: 5, giu: 6, lug: 7, ago: 8, set: 9, sett: 9,
    ott: 10, nov: 11, dic: 12 };
  const MESI_RE = Object.keys(MESI).sort((a, b) => b.length - a.length).join("|");
  const W = "[\\p{L}\\p{N}_]";
  const WB = `(?:(?<!${W})(?=${W})|(?<=${W})(?!${W}))`;
  const rx = (s, fl = "iu") => new RegExp(s.replace(/\\b/g, WB), fl);
  const GIORNI = { "lunedì": 1, lunedi: 1, "martedì": 2, martedi: 2, "mercoledì": 3, mercoledi: 3, "giovedì": 4, giovedi: 4,
    "venerdì": 5, venerdi: 5, sabato: 6, domenica: 0 };

  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const capParole = (s) => s.split(/\s+/).map((p) => (/^(di|de|da|del|della|van|von|la|le)$/i.test(p) ? p.toLowerCase() : p[0].toUpperCase() + p.slice(1))).join(" ");
  const pulisci = (s) => s.replace(/\s+/g, " ").replace(/^[\s,.;:!?\-–"'«»]+|[\s,.;:!?\-–"'«»]+$/g, "");
  const iso = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

  /* Data di un giorno PASSATO o di oggi (per film e libri): "stasera", "ieri", "sabato", "il 3 novembre"… */
  function dataPassata(low, oggi) {
    const giorni = (n) => iso(new Date(oggi.getTime() - n * 86400000));
    let m;
    if (rx("\\b(l'altro ieri|l'altroieri|altro ieri|avantieri)\\b").test(low)) return { data: giorni(2), re: rx("\\b(l'altro ieri|l'altroieri|altro ieri|avantieri)\\b") };
    if ((m = low.match(rx("\\bieri(?: sera| pomeriggio| mattina| notte)?\\b")))) return { data: giorni(1), re: rx("\\bieri(?: sera| pomeriggio| mattina| notte)?\\b") };
    if (rx("\\b(stasera|stanotte|stamattina|oggi|stamani|oggi pomeriggio)\\b").test(low)) return { data: giorni(0), re: rx("\\b(stasera|stanotte|stamattina|stamani|oggi pomeriggio|oggi)\\b") };
    const reG = rx("\\b(?:(?:lo |la |questo |questa |lo scorso |la scorsa |scorso |scorsa )?)(" + Object.keys(GIORNI).join("|") + ")(?: scorso| scorsa| sera)?\\b");
    if ((m = low.match(reG))) { let d = (oggi.getUTCDay() - GIORNI[m[1]] + 7) % 7 || 7; return { data: giorni(d), re: reG }; }
    const reM = rx("\\b(?:il |l')?(\\d{1,2}|primo)(?:°|º)?\\s+(" + MESI_RE + ")\\b(?:\\s+(\\d{4}))?");
    if ((m = low.match(reM))) {
      const g = m[1] === "primo" ? 1 : +m[1], mm = MESI[m[2]];
      let y = m[3] ? +m[3] : oggi.getUTCFullYear();
      let d = new Date(Date.UTC(y, mm - 1, g));
      if (!m[3] && d > oggi) d = new Date(Date.UTC(y - 1, mm - 1, g));
      return { data: iso(d), re: reM };
    }
    const reN = rx("\\b(?:il |l')?(\\d{1,2})[/.-](\\d{1,2})(?:[/.-](\\d{2,4}))?\\b");
    if ((m = low.match(reN)) && +m[2] <= 12) {
      let y = m[3] ? +m[3] + (m[3].length === 2 ? 2000 : 0) : oggi.getUTCFullYear();
      let d = new Date(Date.UTC(y, +m[2] - 1, +m[1]));
      if (!m[3] && d > oggi) d = new Date(Date.UTC(y - 1, +m[2] - 1, +m[1]));
      return { data: iso(d), re: reN };
    }
    return { data: iso(oggi), re: null, implicita: true };
  }

  /* Voto 1-5 stelle: "8/10", "voto 7", "4 stelle", oppure parole come "bellissimo" */
  function voto(low) {
    let m;
    if ((m = low.match(/(\d{1,2}(?:[.,]5)?)\s*(?:\/|su)\s*10\b/))) return { v: Math.max(1, Math.min(5, Math.round(parseFloat(m[1].replace(",", ".")) / 2))), re: /(\d{1,2}(?:[.,]5)?)\s*(?:\/|su)\s*10\b/ };
    if ((m = low.match(/(\d)\s*(?:\/\s*5|stell[ae])/))) return { v: Math.max(1, Math.min(5, +m[1])), re: /(\d)\s*(?:\/\s*5|stell[ae])/ };
    if ((m = low.match(/\bvoto:?\s*(\d{1,2}(?:[.,]5)?)\b/))) { const n = parseFloat(m[1].replace(",", ".")); return { v: Math.max(1, Math.min(5, Math.round(n > 5 ? n / 2 : n))), re: /\bvoto:?\s*(\d{1,2}(?:[.,]5)?)\b/ }; }
    const parole = [[5, /capolavoro|stupend|bellissim|fantastic|meraviglios|eccezional|perfett|top\b|da paura|mi è piaciuto tantissimo|mi è piaciuto molto|adorat/],
      [4, /\bbell[oa]\b|mi è piaciut|molto carin|ottim|consigliat|emozionant|divertente/],
      [3, /\bcarin[oa]\b|discret|niente di che|nella media|guardabile|così così|cosi cosi/],
      [2, /noios|deludent|mediocre|lent[oa]\b|non mi è piaciut/],
      [1, /bruttissim|\bbrutt[oa]\b|orribil|pessim|terribil|una schifezza|schifo/]];
    for (const [v, re] of parole) if (re.test(low)) return { v, re: null };
    return { v: null, re: null };
  }

  function dataCompleanno(low, oggi) {
    let m;
    const reM = rx("\\b(?:il |l')?(\\d{1,2}|primo)(?:°|º)?\\s+(?:di\\s+)?(" + MESI_RE + ")\\b(?:\\s+(?:del\\s+)?(\\d{4}))?");
    if ((m = low.match(reM))) return { giorno: m[1] === "primo" ? 1 : +m[1], mese: MESI[m[2]], anno: m[3] ? +m[3] : null, re: reM };
    const reN = rx("\\b(?:il |l')?(\\d{1,2})[/.-](\\d{1,2})(?:[/.-](\\d{2,4}))?\\b");
    if ((m = low.match(reN)) && +m[2] <= 12 && +m[1] <= 31) return { giorno: +m[1], mese: +m[2], anno: m[3] ? +m[3] + (m[3].length === 2 ? (+m[3] > 30 ? 1900 : 2000) : 0) : null, re: reN };
    if ((m = low.match(rx("\\b(oggi|domani|dopodomani)\\b")))) {
      const d = new Date(oggi.getTime() + { oggi: 0, domani: 1, dopodomani: 2 }[m[1]] * 86400000);
      return { giorno: d.getUTCDate(), mese: d.getUTCMonth() + 1, anno: null, re: rx("\\b(oggi|domani|dopodomani)\\b") };
    }
    return null;
  }

  function capisci(testo, oggiIso) {
    const now = new Date();
    const oggi = oggiIso ? new Date(oggiIso + "T00:00:00Z") : new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const orig = pulisci(testo || "");
    const low = orig.toLowerCase().replace(/[’`]/g, "'");
    if (!low) return { azione: "boh" };

    // ---------------------------------------------------------------- domande
    const domanda = /\?$/.test(orig) || rx("^(quando|quali|quale|quanti|quante|che|cosa|elenca|mostra|dimmi|fammi vedere|lista|prossimi|prossime|i miei|le mie|tutti i|tutte le)\\b").test(low)
      || /^(compleanni|film|libri|serie|visite|scadenze)( visti| letti| viste)?$/.test(low);
    if (domanda) {
      let m;
      if ((m = orig.match(rx("compleanno (?:di|del|della) (.+?)\\??$"))) || (m = orig.match(rx("quando (?:compie gli anni|è nat[oa]|e' nat[oa]) (.+?)\\??$"))))
        return { azione: "domanda", cosa: "compleanno", nome: pulisci(m[1]) };
      if (/compleann/.test(low)) return { azione: "domanda", cosa: "compleanni" };
      if (/\bserie\b/.test(low)) return { azione: "domanda", cosa: "serie" };
      if (/\bfilm\b|visto/.test(low)) return { azione: "domanda", cosa: "film" };
      if (/\blibr[oi]\b|lett[oi]\b/.test(low)) return { azione: "domanda", cosa: "libro" };
      if (/visit|appuntament|impegn|dentist|medic/.test(low)) return { azione: "domanda", cosa: "visite" };
      if (/scadenz|scade/.test(low)) return { azione: "domanda", cosa: "scadenze" };
    }
    if (/^(aiuto|help|cosa (sai|puoi) fare|come funzion)/.test(low)) return { azione: "aiuto" };
    if (/^(ciao|buongiorno|buonasera|buonanotte|salve|hey|ehi|grazie)\b/.test(low) && low.split(/\s+/).length <= 4) return { azione: "saluto", grazie: low.startsWith("grazie") };

    // ---------------------------------------------------------------- commento a qualcosa di già salvato
    let m = orig.match(rx("^(?:aggiungi (?:un )?)?(?:commento|nota|appunto)\\s+(?:a|al|alla|allo|su|sul|sulla|per|per il|per la)\\s+(?:film |libro |serie )?[\"«]?(.+?)[\"»]?\\s*[:,\\-–]\\s*(.+)$"));
    if (m) return { azione: "commento", titolo: pulisci(m[1]), commento: cap(pulisci(m[2])) };

    // ---------------------------------------------------------------- compleanni
    if (rx("\\b(compleanno|compie gli anni|compie \\d+ anni|è nat[oa]|e' nat[oa]|nat[oa] il|festeggia gli anni)\\b").test(low)) {
      const d = dataCompleanno(low, oggi);
      let resto = orig;
      if (d) resto = resto.replace(new RegExp(d.re.source, "iu"), " ");
      resto = resto.replace(rx("\\b(ricordami che|ricorda(?:mi)?|segna(?:mi)?|aggiungi|salva|che|il|lo|la|è|e'|e|di|del|della|dell'|compleanno|compie|gli|anni|\\d+ anni|nat[oa]|festeggia|giorno|mio|mia|miei|mie|amico|amica|cugino|cugina|collega)\\b", "giu"), " ");
      const nome = pulisci(resto.replace(/[,.;:!?]/g, " "));
      if (!d) return { azione: "chiedi", motivo: "data_compleanno", nome: nome ? capParole(nome) : "" };
      if (!nome) return { azione: "chiedi", motivo: "nome_compleanno", ...d };
      return { azione: "compleanno", nome: capParole(nome), giorno: d.giorno, mese: d.mese, anno: d.anno };
    }

    // ---------------------------------------------------------------- film, serie, libri
    const isLibro = rx("\\b(ho letto|abbiamo letto|ho finito di leggere|ho finito il libro|sto leggendo|ho iniziato a leggere|ho riletto|il libro|libro)\\b").test(low);
    const isSerie = !isLibro && rx("\\b(la serie|serie tv|serie|stagione|stagioni|episodi|puntate)\\b").test(low);
    const isFilm = !isLibro && !isSerie && rx("\\b(ho visto|abbiamo visto|ho guardato|abbiamo guardato|ho rivisto|sono andat[oi] al cinema|al cinema|il film|film)\\b").test(low);
    if (isLibro || isSerie || isFilm) {
      const tipo = isLibro ? "libro" : isSerie ? "serie" : "film";
      let corpo = orig;
      // 1. voto esplicito ("9/10", "4 stelle", "voto 8") e data, tolti dal testo
      const vt = voto(low.replace(/[a-zà-ü]+/g, (w) => (/stell|voto|su/.test(w) ? w : " ".repeat(w.length))));
      if (vt.re) corpo = corpo.replace(new RegExp(vt.re.source, "i"), " ");
      const quando = dataPassata(corpo.toLowerCase().replace(/[’`]/g, "'"), oggi);
      if (quando.re) corpo = corpo.replace(new RegExp(quando.re.source, "iu"), " ");
      // 2. titolo tra virgolette?
      const virg = corpo.match(/["“«]([^"”»]{1,120})["”»]/);
      let titolo = virg ? virg[1] : null, commento = "";
      if (virg) corpo = corpo.replace(virg[0], " \u0001 ");
      // 3. tutto ciò che sta prima del verbo ("ho visto", "ho letto"…) non fa parte del titolo
      const verbo = corpo.match(rx("\\b(?:(?:ho|abbiamo)\\s+(?:visto|guardato|rivisto|letto|riletto|finito di leggere|finito|iniziato a leggere|iniziato|cominciato)|sto leggendo|sto guardando|sono andat[oi] (?:al cinema )?a vedere)\\b", "iu"));
      if (verbo) corpo = corpo.slice(verbo.index + verbo[0].length);
      corpo = corpo.replace(rx("^\\s*(?:anche\\s+)?(?:al cinema\\s+)?(?:anche\\s+)?", "iu"), "");
      corpo = corpo.replace(rx("^\\s*(?:(?:il film|un film|il libro|un libro|la serie tv|la serie|una serie|serie tv|film|libro|serie)\\s*[:\\-]?\\s+)?", "iu"), "");
      // articolo minuscolo ("ho visto il film", "ho letto un libro") → non fa parte del titolo;
      // maiuscolo ("Il nome della rosa") → sì
      corpo = corpo.replace(/^\s*(?:(?:il|lo|la|i|gli|le|un|una|uno)\s+(?=\S)|l'(?=\S))/u, "");
      corpo = corpo.replace(rx("^(?:film|libro|serie tv|serie)\\s*[:\\-]?\\s*", "iu"), "");
      if (titolo) {
        commento = corpo.replace("\u0001", " ");
      } else {
        const sep = corpo.search(rx("\\s*(?:,|;|\\.\\s|!|\\s-\\s|\\s–\\s|\\be mi\\b|\\bed è\\b|\\be l'ho\\b|\\bmolto\\b|\\bche\\b|\\bcommento\\b|\\bcon\\b|\\binsieme\\b|\\bal cinema\\b|\\bbellissim|\\bstupend|\\bcapolavoro|\\bnoios|\\bbrutt|\\bcarin)", "iu"));
        titolo = pulisci(sep > 0 ? corpo.slice(0, sep) : corpo);
        commento = sep > 0 ? corpo.slice(sep) : "";
      }
      commento = pulisci(commento.replace(/^[\s,;.:!\-–]+/, "").replace(rx("^(?:e|ed|che|commento:?)\\s+", "iu"), ""));
      // 4. voto dalle parole del commento (non dal titolo: "La vita è bella" non è un voto!)
      const v = vt.v ?? voto(commento.toLowerCase()).v;
      let autore = "";
      if (tipo === "libro") {
        const a = titolo.match(/^(.+?)\s+di\s+((?:[A-ZÀ-Ý][\p{L}'.]+\s*){1,3})$/u);
        if (a) { titolo = a[1]; autore = a[2].trim(); }
      }
      titolo = pulisci(titolo);
      if (!titolo) return { azione: "chiedi", motivo: "titolo", tipo };
      return { azione: "diario", tipo, titolo: cap(titolo), autore, data: quando.data, voto: v, commento: cap(commento),
        stato: tipo === "libro" && rx("\\b(sto leggendo|ho iniziato|ho cominciato)\\b").test(low) ? "in corso" : "" };
    }

    // ---------------------------------------------------------------- appuntamenti / visite
    if (glob.ScrignoNLP) {
      const r = glob.ScrignoNLP.analizza(orig, iso(oggi));
      if (r.data) return { azione: "appuntamento", ...r };
    }
    return { azione: "boh" };
  }

  const api = { capisci };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else glob.ScrignoChat = api;
})(typeof window !== "undefined" ? window : globalThis);
