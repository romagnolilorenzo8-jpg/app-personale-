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
    if (rx("\\b(bilancio|quanto ho (?:speso|guadagnato|incassato)|guadagno|guadagni|profitto|quanto ci ho guadagnato)\\b").test(low)) return { azione: "domanda", cosa: "bilancio" };
    if (rx("\\b(la mia media|media (?:dei )?(?:voti|esami)|qual è la (?:mia )?media|quanti (?:crediti|cfu))\\b").test(low)) return { azione: "domanda", cosa: "esami" };
    if (rx("\\b(come va|com'è|progressi|andamento|record|massimal[ei]|quanto sollevo)\\b").test(low) && /palestra|forza|massimal|allenam|panca|squat|stacco|esercizi/.test(low)) return { azione: "domanda", cosa: "palestra" };
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
      if (/palestra|allenament|massimal|forza|esercizi/.test(low)) return { azione: "domanda", cosa: "palestra" };
      if (/\besam/.test(low)) return { azione: "domanda", cosa: "esami" };
      if (/acquist|comprat|vendut|spes[oi]\b/.test(low)) return { azione: "domanda", cosa: "bilancio" };
    }
    if (/^(aiuto|help|cosa (sai|puoi) fare|come funzion)/.test(low)) return { azione: "aiuto" };
    if (/importa|promemoria|reminders/.test(low) && /compleann|promemoria/.test(low)) return { azione: "importa_compleanni" };
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

    // ---------------------------------------------------------------- palestra: peso corporeo ed esercizi
    const KG = /(\d+(?:[.,]\d+)?)\s*(?:kg|chili|chilogrammi|kili|kilo|chilo)\b/i;
    const mPeso = low.match(rx("^(?:oggi\\s+|stamattina\\s+)?(?:peso|pesavo|il mio peso è|il mio peso|sono)\\s+(?:di\\s+)?(\\d+(?:[.,]\\d+)?)\\s*(?:kg|chili|kili)?\\s*$", "iu"))
      || low.match(rx("^(?:oggi\\s+)?(?:mi sono pesat[oa]|ho pesato)\\s*:?\\s*(\\d+(?:[.,]\\d+)?)\\s*(?:kg|chili)?", "iu"));
    if (mPeso && +mPeso[1].replace(",", ".") >= 25 && +mPeso[1].replace(",", ".") <= 300) return { azione: "peso", peso: +mPeso[1].replace(",", "."), data: iso(oggi) };
    const mAlt = low.match(rx("^(?:sono alto|sono alta|altezza|la mia altezza è|alto|alta)\\s+(\\d(?:[.,]\\d{1,2})?|\\d{3})\\s*(?:m|cm|metri)?\\s*$", "iu"));
    if (mAlt) { let h = +mAlt[1].replace(",", "."); if (h < 3) h = Math.round(h * 100); if (h >= 100 && h <= 230) return { azione: "altezza", altezza: h }; }
    const kgM = orig.match(KG);
    const repM = orig.match(/(\d+)\s*(?:ripetizioni|ripetizione|rip\b|reps?\b|volte)/i) || orig.match(/\bserie\s+da\s+(\d+)\b/i) || orig.match(/\b(?:x|per)\s*(\d+)\b(?!\s*(?:kg|chili|euro|€|cfu))/i)
      || orig.match(/(\d+)\s*x\s*\d+(?:[.,]\d+)?\s*(?:kg|chili)/i);
    const serM = orig.match(/(\d+)\s*(?:serie|set)\b/i) || orig.match(/\b(\d+)\s*x\s*(\d+)\b(?!\s*(?:kg|chili))/i);
    const corpoLibero = rx("\\b(trazioni|piegamenti|flessioni|dip|dips|addominali|crunch|plank|burpees?|squat a corpo libero|pull-?ups?|push-?ups?)\\b").test(low);
    if ((kgM && repM) || (corpoLibero && (repM || /\d+/.test(low)))) {
      const numSolo = !repM && orig.match(/\b(\d+)\b/);
      let reps = repM ? +repM[1] : numSolo ? +numSolo[1] : 0, serie = null;
      if (serM && serM[2]) { serie = +serM[1]; reps = +serM[2]; } else if (serM) serie = +serM[1];
      let kg = kgM ? +kgM[1].replace(",", ".") : 0;
      // più serie con pesi diversi nella stessa frase
      const coppie = [...orig.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:kg|chili|kili|kilo|chilo)\s*(?:x|×|per|da)\s*(\d+)\b/gi)]
        .map((m) => ({ kg: +m[1].replace(",", "."), reps: +m[2] }));
      let set = null;
      if (coppie.length >= 2) {
        set = coppie; serie = coppie.length;
        const best = coppie.reduce((a, s) => (s.kg * (1 + s.reps / 30) > a.kg * (1 + a.reps / 30) ? s : a));
        kg = best.kg; reps = best.reps;
      }
      const quando = dataPassata(low, oggi);
      let nome = orig;
      nome = nome.replace(/\d+(?:[.,]\d+)?\s*(?:kg|chili|chilogrammi|kili|kilo|chilo|ripetizioni|ripetizione|rip|reps?|volte|serie|set)?\b/gi, " ")
        .replace(/\b(?:serie\s+da|da\s*$|x)\b/gi, " ");
      if (quando.re) nome = nome.replace(new RegExp(quando.re.source, "iu"), " ");
      nome = nome.replace(rx("\\b(?:ho fatto|ho sollevato|ho alzato|fatto|oggi|ieri|in palestra|palestra|allenamento|esercizio|con|per|un|una|il|lo|la|al|alla|serie|ripetizioni|carico)\\b", "giu"), " ");
      nome = pulisci(pulisci(nome.replace(/[,.;:!×]+/g, " ").replace(/\s+x\s+|\s+x$/gi, " ")).replace(/\s+(?:da|di|con|a)$/i, ""));
      if (nome && reps > 0 && reps <= 200) return { azione: "allenamento", esercizio: cap(nome.toLowerCase()), kg, reps, serie, set, data: quando.data };
    }

    // ---------------------------------------------------------------- esami (università / scuola)
    // modulo di un esame diviso in parti: "primo modulo", "modulo 2", "seconda parte"…
    const MOD_RE = rx("\\b(?:(?:il |la )?(primo|secondo|terzo|1°|2°|3°|1|2|3)\\s+modulo|modulo\\s+(\\d|uno|due|tre|iii|ii|i|a|b)|(?:la )?(prima|seconda|terza)\\s+parte|parte\\s+(\\d|uno|due|tre))\\b", "iu");
    const NUM_MOD = { primo: 1, prima: 1, uno: 1, "1": 1, "1°": 1, i: 1, a: 1, secondo: 2, seconda: 2, due: 2, "2": 2, "2°": 2, ii: 2, b: 2, terzo: 3, terza: 3, tre: 3, "3": 3, "3°": 3, iii: 3 };
    const modM = low.match(MOD_RE);
    const modulo = modM ? NUM_MOD[(modM[1] || modM[2] || modM[3] || modM[4]).toLowerCase()] : null;
    const cfuM = low.match(/(\d{1,2})\s*(?:cfu|crediti)/);
    const lowSenza = low.replace(/\d{1,2}\s*(?:cfu|crediti)/g, " ").replace(MOD_RE, " ");
    const votoEsame = lowSenza.match(rx("\\b(?:con|preso|presa|voto:?|votazione)?\\s*\\b(1[89]|2\\d|30)\\s*(?:\\/\\s*30|trentesimi)?\\s*(e lode|con lode|cum laude|l\\b)?", "iu"));
    const parlaDiEsame = rx("\\b(esame|esami|ho passato|ho superato|ho dato|ho preso .* (?:a|in)\\b|trenta e lode|30 e lode)\\b").test(low) || modulo;
    const pulisciMateria = (t) => {
      let m = t.replace(/\d{1,2}\s*(?:cfu|crediti)/gi, " ").replace(new RegExp(MOD_RE.source, "iu"), " ");
      if (votoEsame) m = m.replace(new RegExp(votoEsame[0].trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), " ");
      m = m.replace(rx("\\b(?:ho|ho passato|ho superato|ho dato|ho fatto|ho preso|ho sostenuto|passato|superato|l'esame|un esame|esame|esami|di|del|della|dello|in|a|da|con|il|lo|la|voto|preso|presa|trenta|e lode|lode|oggi|ieri|stamattina|finalmente|che|trentesimi|modulo|diviso|in due|due moduli|moduli)\\b", "giu"), " ");
      return cap(pulisci(m.replace(/[,.;:!]+/g, " ")));
    };
    // idoneità (inglese, obblighi formativi…): nessun voto, solo idoneo / non idoneo
    const idon = rx("\\b(non idone[oa]|idone[oa]|idoneità|idoneita|obblighi formativi|ofa|non superat[oi]|superat[oi])\\b").test(low)
      && rx("\\b(idone|idoneità|idoneita|obblighi formativi|ofa)").test(low);
    if (idon && !votoEsame) {
      const esito = rx("\\b(non idone[oa]|non (?:l'ho |li ho )?(?:passat|superat)|bocciat)").test(low) ? "non idoneo" : "idoneo";
      let materia = orig.replace(/\d{1,2}\s*(?:cfu|crediti)/gi, " ");
      const quando = dataPassata(low, oggi);
      if (quando.re) materia = materia.replace(new RegExp(quando.re.source, "iu"), " ");
      materia = materia.replace(rx("\\b(?:ho|non|passato|superato|superati|superata|passati|preso|presa|ottenuto|l'idoneità|l'idoneita|idoneità|idoneita|idoneo|idonea|test|esame|prova|bocciato|bocciata|di|del|della|dello|in|a|al|con|il|lo|la|gli|i|le|oggi|ieri|finalmente|che|sono|risultato|risultata)\\b", "giu"), " ");
      materia = pulisci(materia.replace(/[,.;:!]+/g, " "));
      if (rx("\\b(obblighi formativi|ofa)\\b").test(low)) materia = "Obblighi formativi (OFA)";
      if (materia) return { azione: "esame", materia: cap(materia), esito, cfu: cfuM ? +cfuM[1] : null, data: quando.data };
    }
    if (parlaDiEsame && !/sangue|analisi del|medic|visita/.test(low)) {
      if (votoEsame) {
        const lode = !!votoEsame[2] || /trenta e lode/.test(low);
        let tmp = orig;
        const quando = dataPassata(lowSenza.replace(votoEsame[0], " "), oggi);
        if (quando.re) tmp = tmp.replace(new RegExp(quando.re.source, "iu"), " ");
        const materia = pulisciMateria(tmp);
        if (materia) return { azione: "esame", materia, voto: lode ? 30 : +votoEsame[1], lode, cfu: cfuM ? +cfuM[1] : null, modulo, data: quando.data };
      } else if (cfuM && rx("\\besame\\b").test(low)) {
        // "esame di Fisica da 12 cfu" → esame ancora da sostenere, diviso in moduli da 6
        const materia = pulisciMateria(orig);
        if (materia) return { azione: "esame_nuovo", materia, cfu: +cfuM[1] };
      }
    }

    // ---------------------------------------------------------------- acquisti e vendite
    const prezzoRe = /(?:€\s*(\d+(?:[.,]\d{1,2})?)|(\d+(?:[.,]\d{3})*(?:[.,]\d{1,2})?)\s*(?:€|euro\b|eur\b)|\b(?:a|per|da)\s+(\d+(?:[.,]\d{1,2})?)\s*$)/i;
    const leggiPrezzo = (t) => {
      const m = t.match(prezzoRe);
      if (!m) return null;
      let n = (m[1] || m[2] || m[3]);
      if (/^\d{1,3}([.]\d{3})+([,]\d{1,2})?$/.test(n)) n = n.replace(/\./g, "");
      return { v: parseFloat(n.replace(",", ".")), testo: m[0] };
    };
    const acquisto = rx("\\b(ho comprato|ho acquistato|ho preso|ho pagato|abbiamo comprato|comprato|acquistato|mi sono comprat[oa])\\b").test(low);
    const vendita = rx("\\b(ho venduto|ho rivenduto|abbiamo venduto|venduto|rivenduto)\\b").test(low);
    if (acquisto || vendita) {
      const pz = leggiPrezzo(orig);
      if (pz) {
        const quando = dataPassata(low.replace(pz.testo.toLowerCase(), " "), oggi);
        let nome = orig.replace(pz.testo, " ");
        if (quando.re) nome = nome.replace(new RegExp(quando.re.source, "iu"), " ");
        nome = nome.replace(rx("^.*?\\b(?:ho comprato|ho acquistato|ho preso|ho pagato|abbiamo comprato|mi sono comprat[oa]|comprato|acquistato|ho venduto|ho rivenduto|abbiamo venduto|venduto|rivenduto)\\b", "iu"), " ");
        nome = nome.replace(rx("\\b(?:a|per|da|al prezzo di|pagat[oaie]|pagandol[oaie]|intanto|anche|finalmente|oggi|ieri|stasera)\\s*$", "iu"), " ");
        nome = pulisci(nome).replace(/^(?:(?:un|uno|una|il|lo|la|i|gli|le|questo|questa|quel|quella|mio|mia)\s+|un'|l')/i, "");
        nome = pulisci(nome.replace(rx("\\s+(?:a|per|da|che)$", "iu"), ""));
        if (nome) return { azione: vendita ? "vendita" : "acquisto", nome: cap(nome), prezzo: pz.v, data: quando.data, categoria: categoriaAcquisto(nome) };
      }
      if (vendita || /\b(comprat|acquistat|pagat)/.test(low)) return { azione: "chiedi", motivo: "prezzo", vendita, frase: orig };
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

  function categoriaAcquisto(n) {
    n = n.toLowerCase();
    if (/magli|felp|scarp|sneaker|jeans|pantalon|giacc|giubbott|camici|cappell|vestit|gonn|borsa|zaino|cappott|maglion|tuta|calz|occhial|orologi|cintur|piumin|polo\b|t-?shirt|shorts|costume/.test(n)) return "vestiti";
    if (/\bauto\b|macchina|moto\b|motorino|scooter|bici|monopattino|gomme|pneumatic|cerchi/.test(n)) return "veicoli";
    if (/iphone|telefono|smartphone|cellulare|\bpc\b|computer|portatile|laptop|ipad|tablet|cuffie|airpods|\btv\b|televisore|console|playstation|ps5|xbox|nintendo|switch|fotocamera|apple watch|smartwatch/.test(n)) return "tecnologia";
    if (/divano|tavolo|sedia|letto|armadio|lampada|mobile|frigo|lavatrice|aspirapolvere|forno|cucina/.test(n)) return "casa";
    if (/carte|pokemon|figurin|collezion|vinile|lego|funko/.test(n)) return "collezionismo";
    return "altro";
  }

  /* Legge un elenco di compleanni incollato (ad esempio esportato dall'app Promemoria con un Comando Rapido).
     Una riga per persona, in qualsiasi di questi formati:
       "Compleanno Marco Rossi | 2027-08-06T09:00:00+02:00"   (titolo | data di scadenza ISO)
       "Marco Rossi 6 agosto"   "Compleanno di Giulia 12/03"   "Luca - 03/02/1990"  */
  function leggiCompleanni(testo) {
    const out = [];
    for (let riga of String(testo || "").split(/\r?\n/)) {
      riga = riga.trim();
      if (!riga) continue;
      const parti = riga.split(/\s*[|\t;]\s*/);
      let titolo = parti[0], resto = parti.slice(1).join(" ");
      let giorno = null, mese = null, anno = null, m;
      // data ISO di scadenza (dai Promemoria): conta solo giorno e mese, l'anno è quello del prossimo avviso
      if ((m = riga.match(/(\d{4})-(\d{2})-(\d{2})/))) { giorno = +m[3]; mese = +m[2]; titolo = titolo.replace(m[0], " "); }
      else {
        const d = dataCompleanno((titolo + " " + resto).toLowerCase(), new Date());
        if (d) {
          giorno = d.giorno; mese = d.mese; anno = d.anno;
          titolo = titolo.replace(new RegExp(d.re.source, "iu"), " ");
        }
      }
      // anno di nascita scritto nel titolo, ad esempio "Marco Rossi (1990)" o "nato nel 1990"
      if (!anno && (m = titolo.match(/\(?\b(?:nat[oa] nel |del )?(19\d{2}|20[0-2]\d)\b\)?/))) { anno = +m[1]; titolo = titolo.replace(m[0], " "); }
      let nome = titolo.replace(/[🎂🎉🎁🥳🎈]/gu, " ")
        .replace(rx("\\b(?:compleanno|compie gli anni|auguri|fare gli auguri|buon compleanno)\\b(?:\\s+(?:a|ad|di|del|della|dello|al|alla)\\b)?", "giu"), " ")
        .replace(rx("^\\s*(?:di|a|del|della)\\s+", "iu"), " ");
      nome = pulisci(nome.replace(/[()\[\],.:!-]+/g, " "));
      if (!nome) continue;
      out.push({ nome: capParole(nome), giorno, mese, anno, riga });
    }
    return out;
  }

  const api = { capisci, leggiCompleanni, categoriaAcquisto };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else glob.ScrignoChat = api;
})(typeof window !== "undefined" ? window : globalThis);
