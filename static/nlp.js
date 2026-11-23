/* Riconoscimento di appuntamenti scritti in italiano (versione per il telefono).
   Stessa logica di server/nlp_it.py: i test confrontano i risultati delle due versioni. */
(function (glob) {
  "use strict";
  const MESI = { gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7, agosto: 8, settembre: 9,
    ottobre: 10, novembre: 11, dicembre: 12, gen: 1, feb: 2, mar: 3, apr: 4, mag: 5, giu: 6, lug: 7, ago: 8, set: 9, sett: 9,
    ott: 10, nov: 11, dic: 12 };
  const GIORNI = { "lunedì": 0, lunedi: 0, "martedì": 1, martedi: 1, "mercoledì": 2, mercoledi: 2, "giovedì": 3, giovedi: 3,
    "venerdì": 4, venerdi: 4, sabato: 5, domenica: 6 };
  const NUMERI = { una: 1, uno: 1, primo: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10,
    undici: 11, dodici: 12, tredici: 13, quattordici: 14, quindici: 15, sedici: 16, diciassette: 17, diciotto: 18, diciannove: 19,
    venti: 20, ventuno: 21, ventidue: 22, ventitre: 23, "ventitré": 23, ventiquattro: 24, trenta: 30 };
  const CATEGORIE = [
    ["universita", "🎓", "\\besame\\b(?!\\s+(?:del|delle|dell|di controllo))|\\bappell|lezion|universit|\\bateneo|laurea|\\btesi\\b|professor|ricevimento|seminari|tirocinio|esercitazion|sessione d|\\bcfu\\b|\\besonero"],
    ["salute", "🩺", "dentist|odontoiatr|igien\\w* dentale|medic|\\bvisit|analisi del|analisi|prelievo|esami|urine|oculist|ortoped|dermatolog|cardiolog|ginecolog|urolog|neurolog|pediatr|fisioterap|osteopat|radiograf|ecograf|risonanza|tac\\b|vaccin|ospedal|ambulatori|controllo|dottor|dott\\.|psicolog|nutrizionist|farmac|\\botorino|allergolog|mammograf|holter|sangue|denti\\b|ortodonz"],
    ["veicoli", "🚗", "bollo|revisione|tagliando|gomm|pneumatic|meccanic|carrozz|assicurazion|motorino|scooter|auto\\b|macchina|moto\\b|officina|patente"],
    ["casa", "🏠", "bolletta|condominio|idraulic|elettricist|caldaia|affitto|trasloco"],
    ["lavoro", "💼", "riunione|meeting|colloquio|lavoro|ufficio|commercialist|cliente"],
    ["personale", "🙋", "\\bcena\\b|pranzo|colazione con|aperitiv|\\bfesta\\b|uscita|palestra|calcetto|partita|allenament|parrucchier|barbier|estetist|viaggio|vacanz|\\bvolo\\b|concerto|cinema|teatro|matrimonio|battesimo|compleanno|amic|fidanzat|ragazz[ao]\\b|mamma|pap[aà]\\b|nonn[ao]|zi[ao]\\b|cugin|spesa\\b"],
  ];
  // \b di JavaScript non conosce le lettere accentate: lo sostituiamo con un confine "Unicode"
  const W = "[\\p{L}\\p{N}_]";
  const WB = `(?:(?<!${W})(?=${W})|(?<=${W})(?!${W}))`;
  const rx = (s, fl = "giud") => new RegExp(s.replace(/\\b/g, WB), fl);
  const byLen = (o) => Object.keys(o).sort((a, b) => b.length - a.length);

  const NUM = "(\\d{1,2}|" + byLen(NUMERI).join("|") + ")";
  const MIN = "(?:[:.,](\\d{2})|\\s+e\\s+(mezza|mezzo|un quarto|quarto|tre quarti|\\d{1,2}))?";
  const TIME = NUM + MIN;
  const PERIODO = "(?:\\s*(?:di|del|della|nel|al)?\\s*(mattina|mattino|pomeriggio|sera|notte))?";
  const PRE = "(?:\\b(?:per il|entro il|il giorno|il|l'|giorno|per|di|del)\\s+)?";

  const num = (s) => (/^\d+$/.test(s.trim()) ? parseInt(s, 10) : NUMERI[s.trim().toLowerCase()]);
  const minuti = (m, e) => (m ? parseInt(m, 10) : e ? ({ mezza: 30, mezzo: 30, "un quarto": 15, quarto: 15, "tre quarti": 45 }[e.trim()] ?? parseInt(e, 10)) : 0);
  function ora(h, periodo, pmOk = true) {
    if ((periodo === "pomeriggio" || periodo === "sera") && h < 12) return h + 12;
    if (periodo === "notte" && h === 12) return 0;
    if (periodo == null && pmOk && h >= 1 && h <= 7) return h + 12;
    return h % 24;
  }
  const D = (y, m, d) => { const x = new Date(Date.UTC(y, m - 1, d)); return x.getUTCMonth() === m - 1 && x.getUTCDate() === d ? x : null; };
  const piu = (x, giorni) => new Date(x.getTime() + giorni * 86400000);
  const iso = (x) => x.toISOString().slice(0, 10);
  const wd = (x) => (x.getUTCDay() + 6) % 7;
  const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

  function Testo(s) {
    this.orig = s; this.low = s.toLowerCase(); this.usato = new Array(s.length).fill(false);
  }
  Testo.prototype.cerca = function (pat) {
    for (const m of this.low.matchAll(rx(pat))) {
      const a = m.index, b = a + m[0].length;
      if (!this.usato.slice(a, b).some(Boolean)) return m;
    }
    return null;
  };
  Testo.prototype.consuma = function (m) { for (let i = m.index; i < m.index + m[0].length; i++) this.usato[i] = true; };
  Testo.prototype.resto = function () { return [...this.orig].map((c, i) => (this.usato[i] ? " " : c)).join(""); };

  function analizza(testo, oggiIso) {
    const now = new Date();
    const oggi = oggiIso ? new Date(oggiIso + "T00:00:00Z") : new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const r = { titolo: "", data: null, ora_inizio: null, ora_fine: null, tutto_il_giorno: true, luogo: "", categoria: "altro", icona: "📅", capito: [] };
    const t = new Testo(" " + testo.trim() + " ");

    // ---------------------------------------------------------------- orari
    let inizio = null, fine = null, m;
    m = t.cerca("\\b(?:dalle|dall'|da|tra le|fra le)\\s*(?:ore\\s*)?" + TIME + PERIODO +
      "\\s*(?:alle|all'|a|fino alle|-)\\s*(?:ore\\s*)?" + TIME + PERIODO + "\\b");
    if (!m) {
      const m2 = t.cerca("\\b(\\d{1,2})[:.](\\d{2})()\\s*()-\\s*(\\d{1,2})[:.](\\d{2})()()\\b");
      if (m2) {
        inizio = [num(m2[1]), parseInt(m2[2], 10)]; fine = [num(m2[5]), parseInt(m2[6], 10)];
        t.consuma(m2); r.capito.push("orario");
      }
    }
    if (m) {
      const p1 = m[4], p2 = m[8];
      const h2 = ora(num(m[5]), p2 || p1);
      let h1 = ora(num(m[1]), p1 || (num(m[1]) <= num(m[5]) ? p2 : undefined));
      if (h1 > h2 && h1 - 12 >= 0 && !p1) h1 -= 12;
      inizio = [h1, minuti(m[2], m[3])]; fine = [h2, minuti(m[6], m[7])];
      t.consuma(m); r.capito.push("orario");
    }
    if (!inizio) {
      m = t.cerca("\\b(?:alle ore|alle|all'|ore|verso le|per le|a partire dalle|dalle)\\s*" + TIME + PERIODO + "\\b") ||
        t.cerca("\\b(\\d{1,2})[:.](\\d{2})(?![.\\d/])()" + PERIODO + "\\b");
      if (m) { inizio = [ora(num(m[1]), m[4]), minuti(m[2], m[3])]; t.consuma(m); r.capito.push("ora"); }
    }
    if (!inizio) {
      m = t.cerca("\\b(?:a |alle )?(mezzogiorno|mezzanotte)\\b");
      if (m) { inizio = [m[1] === "mezzogiorno" ? 12 : 0, 0]; t.consuma(m); }
    }
    let durata = null;
    m = t.cerca("\\bper\\s+(?:circa\\s+)?(un'ora|un ora|una ora|mezz'ora|mezzora|un'ora e mezza|(\\d+|due|tre|quattro)\\s+ore(?:\\s+e\\s+mezza)?|(\\d+)\\s+minuti)\\b");
    if (m) {
      const s = m[1];
      if (s.includes("e mezza")) durata = 30 + 60 * (s.startsWith("un") ? 1 : num(s.split(/\s+/)[0]));
      else if (s.startsWith("mezz")) durata = 30;
      else if (s.startsWith("un")) durata = 60;
      else if (s.includes("minuti")) durata = parseInt(m[3], 10);
      else durata = 60 * num(m[2]);
      t.consuma(m);
    }

    // ---------------------------------------------------------------- data
    let d = null;
    const giorniRe = Object.keys(GIORNI).join("|");
    m = t.cerca("(?:\\b(?:" + giorniRe + ")\\s+)?" + PRE + "\\b(\\d{1,2}|primo|" + Object.keys(NUMERI).join("|") +
      ")(?:°|º)?\\s+(?:di\\s+)?(" + byLen(MESI).join("|") + ")\\b\\.?(?:\\s+(?:del\\s+)?(\\d{4}))?");
    if (m) {
      const anno = m[3];
      d = D(anno ? +anno : oggi.getUTCFullYear(), MESI[m[2]], num(m[1]));
      if (d) { if (!anno && d < oggi) d = D(oggi.getUTCFullYear() + 1, MESI[m[2]], num(m[1])); t.consuma(m); }
    }
    if (!d) {
      m = t.cerca("(?:\\b(?:" + giorniRe + ")\\s+)?" + PRE + "\\b(\\d{1,2})[/-](\\d{1,2})(?:[/-](\\d{2,4}))?\\b") ||
        t.cerca(PRE + "\\b(\\d{1,2})\\.(\\d{1,2})\\.(\\d{2,4})\\b");
      if (m) {
        const anno = m[3];
        const y = anno ? +anno + (anno.length === 2 ? 2000 : 0) : oggi.getUTCFullYear();
        d = D(y, +m[2], +m[1]);
        if (d) { if (!anno && d < oggi) d = D(y + 1, +m[2], +m[1]); t.consuma(m); }
      }
    }
    if (!d) {
      m = t.cerca("\\b(oggi|stasera|stamattina|dopodomani|domani)\\b");
      if (m) {
        d = piu(oggi, { oggi: 0, stasera: 0, stamattina: 0, domani: 1, dopodomani: 2 }[m[1]]);
        if (m[1] === "stasera" && inizio && inizio[0] < 12) inizio = [inizio[0] + 12, inizio[1]];
        t.consuma(m);
      }
    }
    if (!d) {
      m = t.cerca("\\b(?:tra|fra)\\s+(\\d+|" + Object.keys(NUMERI).join("|") + "|una|un)\\s+(giorni|giorno|settimane|settimana|mesi|mese)\\b");
      if (m) {
        const n = m[1] === "un" || m[1] === "una" ? 1 : num(m[1]), u = m[2];
        if (u.startsWith("giorn")) d = piu(oggi, n);
        else if (u.startsWith("settiman")) d = piu(oggi, 7 * n);
        else { const mm = oggi.getUTCMonth() + n; d = D(oggi.getUTCFullYear() + Math.floor(mm / 12), (mm % 12) + 1, Math.min(oggi.getUTCDate(), 28)); }
        t.consuma(m);
      }
    }
    if (!d) {
      m = t.cerca("\\b(?:(?:il|la|di|per|questo|questa|prossimo|prossima)\\s+)?(" + giorniRe + ")(?:\\s+(prossimo|prossima|della prossima settimana))?\\b");
      if (m) {
        let delta = ((GIORNI[m[1]] - wd(oggi)) % 7 + 7) % 7 || 7;
        if (m[2] === "della prossima settimana") delta += 7;
        d = piu(oggi, delta); t.consuma(m);
      }
    }
    if (d) { r.data = iso(d); r.capito.push("data"); }

    if (inizio) {
      r.tutto_il_giorno = false;
      const s = (inizio[0] % 24) * 60 + (inizio[1] % 60);
      let e;
      if (fine) { e = (fine[0] % 24) * 60 + (fine[1] % 60); if (e <= s) e = s + 60; }
      else e = s + (durata ?? 60);
      if (e >= 24 * 60) e = 23 * 60 + 59;
      r.ora_inizio = hhmm(s); r.ora_fine = hhmm(e);
    }

    // ---------------------------------------------------------------- luogo
    m = t.cerca("\\b(?:presso(?: il| la| lo| l')?|in (?=via|viale|piazza|corso|largo)|all'ospedale|alla clinica|al centro|nello studio|allo studio)\\s*([^,;.\\n]+)");
    if (m) {
      const st = m.indices[1][0], en = m.indices[1][1];
      const pref = m[0].slice(0, st - m.index).trim();
      let luogo = m[1].trim();
      const basi = { "all'ospedale": "Ospedale", "alla clinica": "Clinica", "al centro": "Centro", "nello studio": "Studio", "allo studio": "Studio" };
      if (basi[pref]) luogo = `${basi[pref]} ${t.orig.slice(st, en).trim()}`.trim();
      r.luogo = !(pref.startsWith("all") || pref.startsWith("al ") || pref.startsWith("nello")) ? t.orig.slice(st, en).trim() : luogo;
      if (r.luogo) r.luogo = r.luogo[0].toUpperCase() + r.luogo.slice(1);
      t.consuma(m);
    }

    // ---------------------------------------------------------------- titolo
    let titolo = t.resto();
    titolo = titolo.replace(rx("\\b(?:ricordami(?: che)?|ricorda(?:mi)?|segna(?:mi)?|aggiungi|metti|inserisci|nuovo appuntamento|ho prenotato|prenotato|prenotata|avrò|avro|avrei|ho|devo andare|devo fare|devo|andrò|andro|vado|c'è|ci sarà|sarà|farò|faro|mi aspetta|tocca|che)\\b", "giu"), " ");
    titolo = titolo.replace(/\s+/g, " ").replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, "");
    for (let i = 0; i < 3; i++) titolo = titolo.replace(rx("^(?:il|lo|la|l'|i|gli|le|un|uno|una|un'|e|ed|poi|alle|a|per|di)\\s+", "iu"), "").trim();
    titolo = titolo.replace(rx("\\s+(?:il|lo|la|di|del|della|a|al|alla|e|per|dalle|alle|in|con)$", "iu"), "").replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, "");
    if (titolo) titolo = titolo[0].toUpperCase() + titolo.slice(1);
    r.titolo = titolo || "Appuntamento";

    const tutto = testo.toLowerCase();
    for (const [nome, icona, pat] of CATEGORIE) if (rx(pat, "iu").test(tutto)) { r.categoria = nome; r.icona = icona; break; }

    if (r.data) {
      r.inizio = r.tutto_il_giorno ? r.data : `${r.data}T${r.ora_inizio}`;
      r.fine = r.tutto_il_giorno ? r.data : `${r.data}T${r.ora_fine}`;
    } else { r.inizio = r.fine = null; }
    return r;
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { analizza };
  else (glob.ScrignoNLP = { analizza });
})(typeof window !== "undefined" ? window : globalThis);
