/* LifeApp — cibo, calorie e attività.
   - tabella di alimenti comuni (valori per 100 g, approssimati da tabelle CREA/USDA)
   - lettura di frasi come "80 g di pasta e 2 uova" → grammi di ogni alimento
   - calorie bruciate (MET × peso × ore) e fabbisogno base (Mifflin-St Jeor)
   - Open Food Facts (codici a barre) e Strava (allenamenti), chiamati direttamente dal telefono */
(function (glob) {
  "use strict";

  // [nome, alias (regex), kcal, proteine, carboidrati, grassi, pezzo in g (o ml), porzione abituale in g, nome del pezzo]
  const T = [
    ["Pasta", "pasta|spaghetti|penne|fusilli|rigatoni|maccheroni|linguine|tagliatelle|farfalle", 353, 12.5, 72, 1.5, null, 80],
    ["Pasta integrale", "pasta integrale|spaghetti integrali|penne integrali", 340, 13, 66, 2.5, null, 80],
    ["Gnocchi di patate", "gnocchi", 150, 4, 33, 0.3, null, 200],
    ["Riso", "riso|risotto|basmati", 358, 7, 79, 0.6, null, 80],
    ["Pane", "pane|panino|rosetta|michetta|baguette", 265, 8.5, 51, 3, 30, 60, "fetta"],
    ["Pane integrale", "pane integrale", 245, 9, 44, 3.4, 30, 60, "fetta"],
    ["Piadina", "piadin[ae]", 320, 8, 50, 9, 120, 120],
    ["Pizza margherita", "pizz[ae]", 270, 11, 33, 10, 320, 320],
    ["Fette biscottate", "fett[ae] biscottat[ae]", 408, 11, 77, 6, 10, 30],
    ["Biscotti", "biscott[oi]|frollin[oi]|macine", 460, 7, 68, 17, 10, 30],
    ["Cornetto", "cornett[oi]|brioche|croissant", 410, 8, 45, 21, 60, 60],
    ["Cracker", "cracker", 430, 9.5, 72, 11, 25, 25, "pacchetto"],
    ["Grissini", "grissin[oi]", 411, 12, 68, 9.6, 5, 20],
    ["Fiocchi d'avena", "fiocchi d'avena|avena|porridge", 389, 16.9, 66, 6.9, null, 40],
    ["Cereali", "cereali|corn ?flakes", 370, 7.5, 82, 2, null, 30],
    ["Patate", "patat[ae](?! fritte)", 77, 2, 17, 0.1, 150, 200],
    ["Patatine fritte", "patatine|patate fritte", 312, 3.4, 41, 15, null, 120],
    ["Petto di pollo", "petto di pollo|pollo|petti di pollo", 110, 23, 0, 1.5, null, 150],
    ["Petto di tacchino", "tacchino", 107, 24, 0, 1, null, 150],
    ["Carne macinata", "macinat[ao]|hamburger|svizzera", 176, 20, 0, 10, 100, 120],
    ["Bistecca di manzo", "bistecc[ae]|manzo|vitello|tagliata|carne", 150, 22, 0, 6.5, null, 150],
    ["Maiale", "maiale|lonza|braciol[ae]", 157, 21, 0, 8, null, 150],
    ["Prosciutto crudo", "prosciutto crudo|crudo", 268, 25, 0, 18, 15, 50, "fetta"],
    ["Prosciutto cotto", "prosciutto cotto|cotto|prosciutto", 170, 20, 1, 9, 20, 50, "fetta"],
    ["Bresaola", "bresaola", 151, 32, 0, 2.6, 10, 50, "fetta"],
    ["Salame", "salame", 400, 26, 1, 33, 10, 40, "fetta"],
    ["Mortadella", "mortadella", 317, 15, 0, 28, 15, 50, "fetta"],
    ["Tonno in scatola", "tonno", 190, 25, 0, 10, 56, 56, "scatoletta"],
    ["Salmone", "salmone", 185, 20, 0, 12, null, 150],
    ["Merluzzo", "merluzzo|nasello|pesce", 71, 17, 0, 0.3, null, 150],
    ["Uova", "uov[oa]", 130, 12.5, 0.5, 9, 55, 110],
    ["Latte", "latte(?! intero)", 46, 3.4, 5, 1.6, 200, 200, "tazza"],
    ["Latte intero", "latte intero", 64, 3.3, 4.9, 3.6, 200, 200, "tazza"],
    ["Yogurt greco", "yogurt greco|greco", 73, 10, 3.6, 2, 170, 170, "vasetto"],
    ["Yogurt", "yogurt", 66, 3.8, 4.3, 3.9, 125, 125, "vasetto"],
    ["Mozzarella", "mozzarell[ae]", 253, 18.7, 0.7, 19.5, 125, 125],
    ["Parmigiano", "parmigiano|grana", 390, 33, 0, 28, null, 20],
    ["Ricotta", "ricotta", 146, 9, 3.5, 11, null, 100],
    ["Burro", "burro", 717, 0.9, 0.1, 81, null, 10],
    ["Olio d'oliva", "olio", 899, 0, 0, 99.9, null, 10],
    ["Zucchero", "zucchero", 392, 0, 100, 0, 5, 5, "cucchiaino"],
    ["Miele", "miele", 304, 0.6, 80, 0, 10, 10, "cucchiaino"],
    ["Marmellata", "marmellata|confettura", 240, 0.4, 58, 0, 20, 20],
    ["Nutella", "nutella|crema spalmabile", 539, 6.3, 57.5, 30.9, 15, 15, "cucchiaino"],
    ["Cioccolato fondente", "cioccolat[oa]", 546, 4.9, 61, 31, null, 20],
    ["Gelato", "gelat[oi]", 210, 3.5, 24, 11, null, 100],
    ["Mela", "mel[ae]", 52, 0.3, 14, 0.2, 170, 170],
    ["Banana", "banan[ae]", 89, 1.1, 23, 0.3, 120, 120],
    ["Arancia", "aranc[ie]a?|aranc[ie]", 47, 0.9, 12, 0.1, 130, 130],
    ["Pera", "per[ae]", 57, 0.4, 15, 0.1, 160, 160],
    ["Kiwi", "kiwi", 61, 1.1, 15, 0.5, 75, 75],
    ["Fragole", "fragol[ae]", 32, 0.7, 7.7, 0.3, null, 150],
    ["Uva", "uva", 69, 0.7, 18, 0.2, null, 150],
    ["Avocado", "avocado", 160, 2, 8.5, 14.7, 150, 150],
    ["Insalata", "insalata|lattuga|rucola|misticanza", 15, 1.4, 2.9, 0.2, null, 80],
    ["Pomodori", "pomodor[oi]", 18, 0.9, 3.9, 0.2, 120, 150],
    ["Carote", "carot[ae]", 41, 0.9, 10, 0.2, 70, 100],
    ["Zucchine", "zucchin[ae]", 17, 1.2, 3.1, 0.3, 200, 200],
    ["Broccoli", "broccol[oi]|verdur[ae]", 34, 2.8, 7, 0.4, null, 200],
    ["Ceci", "ceci", 164, 8.9, 27, 2.6, null, 150],
    ["Fagioli", "fagiol[oi]", 127, 8.7, 23, 0.5, null, 150],
    ["Lenticchie", "lenticchie", 116, 9, 20, 0.4, null, 150],
    ["Mandorle", "mandorl[ae]", 579, 21, 22, 50, 1.2, 30],
    ["Noci", "noc[ie]", 654, 15, 14, 65, 5, 30],
    ["Proteine in polvere", "proteine|whey|shake proteico", 380, 78, 8, 5, 30, 30, "misurino"],
    ["Birra", "birr[ae]", 43, 0.5, 3.6, 0, 330, 330],
    ["Vino", "vino", 83, 0.1, 2.6, 0, 125, 125, "bicchiere"],
    ["Coca-Cola", "coca[ -]?cola|coca", 42, 0, 10.6, 0, 330, 330, "lattina"],
    ["Succo di frutta", "succo", 45, 0.3, 11, 0, 200, 200, "bicchiere"],
    ["Caffè", "caffè|caffe|espresso", 2, 0.1, 0.3, 0, 30, 30, "tazzina"],
    ["Acqua", "acqua", 0, 0, 0, 0, 500, 500],
  ].map(([nome, alias, kcal, p, c, g, pezzo, porz, unita]) => ({ nome, re: new RegExp(`(?:^|\\s)(?:${alias})(?=$|\\s)`, "iu"), lung: alias.length, kcal, p, c, g, pezzo, porz, unita }));

  const pulisci = (s) => s.replace(/\s+/g, " ").replace(/^[\s,.;:!?\-"'«»]+|[\s,.;:!?\-"'«»]+$/g, "");
  const norm = (s) => " " + s.toLowerCase().replace(/[’`]/g, "'").replace(/\b(?:di|del|dello|della|dei|degli|delle|il|lo|la|i|gli|le|un|uno|una|un'|d')\b\s*/g, " ").replace(/\s+/g, " ").trim() + " ";

  /* Alimento più adatto al nome scritto (il più specifico vince: "pasta integrale" prima di "pasta") */
  function cercaAlimento(nome, extra = []) {
    const n = norm(nome).trim();
    if (!n) return null;
    const propri = extra.find((x) => x.nome.toLowerCase() === nome.toLowerCase().trim()) || extra.find((x) => norm(x.nome).trim() === n);
    if (propri) return propri;
    let best = null;
    for (const a of T) {
      const m = (" " + n + " ").match(a.re);
      if (m && (!best || m[0].length > best.l || (m[0].length === best.l && a.lung > best.a.lung))) best = { a, l: m[0].length };
    }
    if (best) return best.a;
    // un mio prodotto con un nome più lungo: "gocciole" → "Gocciole (Pavesi)"
    return extra.find((x) => (" " + norm(x.nome.replace(/[()]/g, " ")) + " ").includes(" " + n + " ")) || null;
  }
  function suggerimenti(q, extra = [], max = 8) {
    const n = q.toLowerCase().trim();
    if (!n) return [];
    const tutti = [...extra, ...T.filter((a) => !extra.some((e) => e.nome.toLowerCase() === a.nome.toLowerCase()))];
    return tutti.filter((a) => a.nome.toLowerCase().includes(n) || (a.re && (" " + n + " ").match(a.re))).slice(0, max);
  }

  const NUMERI = { un: 1, uno: 1, una: 1, "un'": 1, mezzo: 0.5, mezza: 0.5, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10 };
  const UNITA = [[/^(?:kg|chili|chilo)$/, 1000], [/^(?:etti|etto|hg)$/, 100], [/^(?:g|gr|grammi|grammo)$/, 1], [/^(?:ml|millilitri)$/, 1], [/^(?:cl)$/, 10], [/^(?:l|litri|litro)$/, 1000],
    [/^cucchia[iy]o$|^cucchiai$/, 10], [/^cucchiain[oi]$/, 5]];
  const PEZZI = /^(?:fett[ae]|tazz[ae]|tazzin[ae]|bicchier[ei]|lattin[ae]|vasett[oi]|scatolett[ae]|porzion[ei]|pacchett[oi]|misurin[oi]|pezz[oi]|bottiglie|bottiglia)$/;

  /* "80 g di pasta, 2 uova e una mela" → [{ nome, grammi, alimento }] */
  function leggiPasto(testo, extra = []) {
    const parti = String(testo || "").replace(/\s+(?:e|con|più|piu)\s+/gi, ",").replace(/\s*\+\s*/g, ",").split(/[,;]/).map((s) => pulisci(s)).filter(Boolean);
    const out = [];
    for (let p of parti) {
      let q = null, mult = null, pezzi = null, nome = p, m;
      const NUM = "(\\d+(?:[.,]\\d+)?|un'|un|uno|una|mezzo|mezza|due|tre|quattro|cinque|sei|sette|otto|nove|dieci)";
      const val = (s) => (NUMERI[s.toLowerCase()] ?? +s.replace(",", "."));
      if ((m = p.match(new RegExp(`^${NUM}\\s*([a-zà']+)?\\s*(?:di\\s+|d')?(.*)$`, "iu")))) {
        const n = val(m[1]), u = (m[2] || "").toLowerCase(), resto = m[3];
        const unita = UNITA.find(([re]) => re.test(u));
        if (unita) { q = n * unita[1]; nome = resto; }
        else if (PEZZI.test(u)) { pezzi = n; mult = u; nome = resto; }
        else { pezzi = n; nome = ((m[2] || "") + " " + resto).trim(); }
      } else if ((m = p.match(/^(.*?)\s+(\d+(?:[.,]\d+)?)\s*(g|gr|grammi|ml|kg|cl|l)\b\.?$/i))) {
        nome = m[1]; q = +m[2].replace(",", ".") * (UNITA.find(([re]) => re.test(m[3].toLowerCase()))?.[1] || 1);
      }
      nome = pulisci(nome.replace(/^(?:di|del|della|dello|dei|delle|degli|d')\s+/i, ""));
      if (!nome) continue;
      const a = cercaAlimento(nome, extra);
      if (q == null) {
        const unitaPezzo = mult && /^cucchia/.test(mult) ? 10 : null;
        const base = unitaPezzo || (a ? ((mult && /^porzion/.test(mult)) || pezzi == null ? a.porz : a.pezzo || a.porz) : null);
        q = base != null ? Math.round(base * (pezzi ?? 1)) : null;
      }
      out.push({ nome: a ? a.nome : nome[0].toUpperCase() + nome.slice(1), scritto: nome, grammi: q != null ? Math.round(q * 10) / 10 : null, alimento: a });
    }
    return out;
  }
  const valori = (a, grammi) => ({ kcal: Math.round((a.kcal * grammi) / 100), p: Math.round((a.p * grammi) / 10) / 10, c: Math.round((a.c * grammi) / 10) / 10, g: Math.round((a.g * grammi) / 10) / 10 });

  /* ------------------------------------------------------------ attività */
  const SPORT = {
    Corsa: { ico: "🏃", re: /\b(?:corso|corsa|correre|running|jogging|corsetta)\b/i },
    Camminata: { ico: "🚶", re: /\b(?:camminato|camminata|camminare|passeggiata|passeggiato|passi|camminando)\b/i },
    Bici: { ico: "🚴", re: /\b(?:bici|bicicletta|pedalato|pedalata|ciclismo|mtb|spinning|cyclette)\b/i },
    Nuoto: { ico: "🏊", re: /\b(?:nuotato|nuoto|piscina|nuotata|vasche)\b/i },
    Escursione: { ico: "🥾", re: /\b(?:escursione|trekking|montagna|hiking)\b/i },
    Calcio: { ico: "⚽", re: /\b(?:calcio|calcetto|partita|futsal)\b/i },
    "Tennis / Padel": { ico: "🎾", re: /\b(?:tennis|padel)\b/i },
    Yoga: { ico: "🧘", re: /\b(?:yoga|pilates|stretching)\b/i },
    Palestra: { ico: "🏋️", re: /\b(?:palestra|pesi|allenamento|crossfit|funzionale)\b/i },
    "Movimento (Salute)": { ico: "❤️", re: /^$/ },
    Altro: { ico: "🔥", re: /^$/ },
  };
  function met(sport, minuti, km) {
    const v = minuti && km ? km / (minuti / 60) : null;   // km/h
    switch (sport) {
      case "Corsa": return v ? Math.max(6, Math.min(16, v * 1.0)) : 9.8;
      case "Camminata": return v ? (v < 4 ? 3 : v < 5.5 ? 3.5 : v < 6.5 ? 4.3 : 5) : 3.5;
      case "Bici": return v ? (v < 16 ? 4 : v < 19 ? 6.8 : v < 22 ? 8 : v < 25 ? 10 : 12) : 6.8;
      case "Nuoto": return 7; case "Escursione": return 6; case "Calcio": return 7; case "Tennis / Padel": return 7;
      case "Yoga": return 2.5; case "Palestra": return 5; default: return 5;
    }
  }
  /* calorie bruciate in più rispetto al riposo: (MET − 1) × peso × ore */
  function kcalAttivita({ sport, minuti, km, passi }, peso = 70) {
    if (!minuti && sport === "Camminata" && passi) return Math.round(passi * 0.04 * (peso / 70));
    if (!minuti && km) minuti = sport === "Corsa" ? km * 6 : sport === "Camminata" ? km * 12 : sport === "Bici" ? km * 3 : km * 10;
    if (!minuti) return 0;
    return Math.round((met(sport, minuti, km) - 1) * peso * (minuti / 60));
  }
  const STRAVA_SPORT = { Run: "Corsa", TrailRun: "Corsa", VirtualRun: "Corsa", Walk: "Camminata", Hike: "Escursione", Ride: "Bici", VirtualRide: "Bici", MountainBikeRide: "Bici",
    GravelRide: "Bici", EBikeRide: "Bici", Swim: "Nuoto", WeightTraining: "Palestra", Workout: "Palestra", Crossfit: "Palestra", Yoga: "Yoga", Pilates: "Yoga",
    Soccer: "Calcio", Tennis: "Tennis / Padel", Padel: "Tennis / Padel", Pickleball: "Tennis / Padel" };
  function daStrava(a, peso = 70) {
    const sport = STRAVA_SPORT[a.sport_type] || STRAVA_SPORT[a.type] || "Altro";
    const minuti = Math.round((a.moving_time || a.elapsed_time || 0) / 60), km = a.distance ? Math.round(a.distance / 10) / 100 : null;
    const kcal = a.calories ? Math.round(a.calories) : a.kilojoules ? Math.round(a.kilojoules) : kcalAttivita({ sport, minuti, km }, peso);
    return { tipo: "attivita", titolo: a.name || sport, data: (a.start_date_local || a.start_date || "").slice(0, 10),
      extra: { sport, minuti, km, passi: null, kcal, fonte: "strava", ext_id: "strava-" + a.id } };
  }

  /* fabbisogno a riposo (Mifflin-St Jeor) */
  function bmr({ sesso, eta, peso, altezza }) {
    if (!sesso || !eta || !peso || !altezza) return null;
    return Math.round(10 * peso + 6.25 * altezza - 5 * eta + (sesso === "F" ? -161 : 5));
  }

  /* Dati Salute incollati dal Comando Rapido: "LifeApp-Salute;2026-11-25;520;8400" (una riga per giorno) */
  function leggiSalute(testo) {
    const out = [];
    for (const r of String(testo || "").split(/\r?\n/)) {
      const m = r.match(/(\d{4}-\d{2}-\d{2})\s*[;|,]\s*([\d.,]+)\s*[;|,]\s*([\d.,]+)/);
      if (!m) continue;
      const n = (s) => Math.round(+s.replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
      out.push({ data: m[1], kcal: n(m[2]), passi: n(m[3]) });
    }
    return out;
  }

  /* ------------------------------------------------------------ Open Food Facts */
  const OFF = "https://world.openfoodfacts.org";
  function daOff(p, codice) {
    const n = p.nutriments || {};
    let kcal = n["energy-kcal_100g"];
    if (kcal == null && n["energy_100g"] != null) kcal = n["energy_100g"] / 4.184;
    if (kcal == null) return null;
    const nome = (p.product_name_it || p.product_name || "").trim() || "Prodotto " + codice;
    const marca = (p.brands || "").split(",")[0].trim();
    const r1 = (v) => Math.round((+v || 0) * 10) / 10;
    return { nome: marca && !nome.toLowerCase().includes(marca.toLowerCase()) ? `${nome} (${marca})` : nome, codice: codice || p.code || null,
      kcal: Math.round(kcal), p: r1(n.proteins_100g), c: r1(n.carbohydrates_100g), g: r1(n.fat_100g),
      pezzo: +p.serving_quantity > 0 ? Math.round(+p.serving_quantity) : null, porz: +p.serving_quantity > 0 ? Math.round(+p.serving_quantity) : 100 };
  }
  const CAMPI = "product_name,product_name_it,brands,nutriments,serving_quantity,code";
  async function prodotto(codice) {
    const r = await fetch(`${OFF}/api/v2/product/${encodeURIComponent(codice)}.json?fields=${CAMPI}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error("Open Food Facts non risponde");
    const d = await r.json();
    return d.status === 1 || d.product ? daOff(d.product || {}, codice) : null;
  }
  async function cercaOnline(q) {
    const r = await fetch(`${OFF}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=12&fields=${CAMPI}`);
    if (!r.ok) throw new Error("Ricerca non disponibile ora, riprova tra poco");
    const d = await r.json();
    return (d.products || []).map((p) => daOff(p, p.code)).filter(Boolean);
  }

  /* ------------------------------------------------------------ Strava */
  const STRAVA = "https://www.strava.com";
  const strava = {
    urlAutorizza: (clientId, redirect) => `${STRAVA}/oauth/authorize?client_id=${encodeURIComponent(clientId)}&response_type=code&redirect_uri=${encodeURIComponent(redirect)}&approval_prompt=auto&scope=activity:read_all&state=lifeapp-strava`,
    async token(cfg, corpo) {
      const r = await fetch(`${STRAVA}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: cfg.client_id, client_secret: cfg.client_secret, ...corpo }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(r.status === 400 || r.status === 401 ? "Strava ha rifiutato: controlla Client ID e Client Secret" : "Strava non risponde");
      return { ...cfg, access_token: d.access_token, refresh_token: d.refresh_token || cfg.refresh_token, expires_at: d.expires_at,
        atleta: d.athlete ? [d.athlete.firstname, d.athlete.lastname].filter(Boolean).join(" ") : cfg.atleta };
    },
    scambia: (cfg, code) => strava.token(cfg, { code, grant_type: "authorization_code" }),
    async valido(cfg) {
      if (cfg.access_token && cfg.expires_at > Date.now() / 1000 + 120) return cfg;
      return strava.token(cfg, { refresh_token: cfg.refresh_token, grant_type: "refresh_token" });
    },
    async attivita(cfg, dopo) {
      const out = [];
      for (let pag = 1; pag <= 5; pag++) {
        const r = await fetch(`${STRAVA}/api/v3/athlete/activities?after=${Math.floor(dopo)}&per_page=100&page=${pag}`, { headers: { Authorization: "Bearer " + cfg.access_token } });
        if (r.status === 401) throw new Error("Strava: collegamento scaduto, ricollegalo");
        if (!r.ok) throw new Error("Strava non risponde");
        const l = await r.json();
        out.push(...l);
        if (l.length < 100) break;
      }
      return out;
    },
  };

  const api = { ALIMENTI: T, cercaAlimento, suggerimenti, leggiPasto, valori, SPORT, kcalAttivita, daStrava, bmr, leggiSalute, prodotto, cercaOnline, daOff, strava };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else glob.Salute = api;
})(typeof window !== "undefined" ? window : globalThis);
