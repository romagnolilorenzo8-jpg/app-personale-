/* LifeApp — meteo da Open-Meteo (gratuito, senza registrazione).
   I dati del meteo non vengono salvati: si chiedono via https e restano in memoria solo mentre l'app è aperta.
   Si ricorda soltanto il luogo scelto (nome e coordinate arrotondate). */
(function (glob) {
  "use strict";
  const CODICI = {
    0: ["☀️", "🌙", "Sereno"], 1: ["🌤️", "🌙", "Poco nuvoloso"], 2: ["⛅", "☁️", "Parzialmente nuvoloso"], 3: ["☁️", "☁️", "Coperto"],
    45: ["🌫️", "🌫️", "Nebbia"], 48: ["🌫️", "🌫️", "Nebbia con brina"],
    51: ["🌦️", "🌧️", "Pioviggine debole"], 53: ["🌦️", "🌧️", "Pioviggine"], 55: ["🌧️", "🌧️", "Pioviggine intensa"],
    56: ["🌧️", "🌧️", "Pioviggine gelata"], 57: ["🌧️", "🌧️", "Pioviggine gelata"],
    61: ["🌦️", "🌧️", "Pioggia debole"], 63: ["🌧️", "🌧️", "Pioggia"], 65: ["🌧️", "🌧️", "Pioggia forte"],
    66: ["🌧️", "🌧️", "Pioggia gelata"], 67: ["🌧️", "🌧️", "Pioggia gelata forte"],
    71: ["🌨️", "🌨️", "Neve debole"], 73: ["🌨️", "🌨️", "Neve"], 75: ["❄️", "❄️", "Neve forte"], 77: ["🌨️", "🌨️", "Nevischio"],
    80: ["🌦️", "🌧️", "Rovesci"], 81: ["🌧️", "🌧️", "Rovesci forti"], 82: ["⛈️", "⛈️", "Rovesci violenti"],
    85: ["🌨️", "🌨️", "Rovesci di neve"], 86: ["❄️", "❄️", "Rovesci di neve forti"],
    95: ["⛈️", "⛈️", "Temporale"], 96: ["⛈️", "⛈️", "Temporale con grandine"], 99: ["⛈️", "⛈️", "Temporale con grandine"],
  };
  const cielo = (c, giorno = true) => { const x = CODICI[c] || ["🌡️", "🌡️", "—"]; return { ico: giorno ? x[0] : x[1], testo: x[2] }; };
  const direzione = (g) => ["N", "NE", "E", "SE", "S", "SO", "O", "NO"][Math.round(((g % 360) + 360) % 360 / 45) % 8];
  const uv = (v) => (v == null ? "" : v < 3 ? "basso" : v < 6 ? "moderato" : v < 8 ? "alto" : v < 11 ? "molto alto" : "estremo");

  const CHIAVE = "scrigno-meteo-luogo";
  const luogo = () => { try { return JSON.parse(localStorage.getItem(CHIAVE) || "null"); } catch { return null; } };
  const salvaLuogo = (l) => { try { l ? localStorage.setItem(CHIAVE, JSON.stringify(l)) : localStorage.removeItem(CHIAVE); } catch { /* */ } cache = null; };
  const tondo = (n) => Math.round(n * 100) / 100;   // ~1 km: basta per il meteo

  async function json(url) {
    const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 10000);
    try { const r = await fetch(url, { signal: ctrl.signal }); if (!r.ok) throw new Error("Servizio meteo non disponibile"); return await r.json(); }
    catch (e) { throw new Error(e.name === "AbortError" ? "Il meteo non risponde" : navigator.onLine === false ? "Sei senza connessione" : e.message); }
    finally { clearTimeout(t); }
  }
  async function cercaCitta(nome) {
    const d = await json(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(nome)}&count=6&language=it&format=json`);
    return (d.results || []).map((r) => ({ nome: r.name, zona: [r.admin1, r.country_code !== "IT" ? r.country : ""].filter(Boolean).join(", "), lat: tondo(r.latitude), lon: tondo(r.longitude) }));
  }
  function posizioneAttuale() {
    return new Promise((ok, ko) => {
      if (!navigator.geolocation) return ko(new Error("Posizione non disponibile su questo dispositivo"));
      navigator.geolocation.getCurrentPosition((p) => ok({ nome: "La mia posizione", lat: tondo(p.coords.latitude), lon: tondo(p.coords.longitude), gps: true }),
        () => ko(new Error("Non ho il permesso di usare la posizione")), { timeout: 12000, maximumAge: 30 * 60000 });
    });
  }

  let cache = null;   // { chiave, t, dati } — solo in memoria
  async function previsioni(l) {
    const k = `${l.lat},${l.lon}`;
    if (cache && cache.chiave === k && Date.now() - cache.t < 10 * 60000) return cache.dati;
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${l.lat}&longitude=${l.lon}&timezone=auto&forecast_days=4` +
      "&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,uv_index,is_day,cloud_cover" +
      "&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,weather_code,is_day" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_direction_10m_dominant,sunrise,sunset,uv_index_max";
    const d = await json(u);
    if (!d.current || !d.hourly || !d.daily) throw new Error("Dati meteo incompleti");
    const c = d.current, h = d.hourly, g = d.daily, el = (o, k, j) => (o[k] ? o[k][j] : null);
    const ora = c.time.slice(0, 13);
    const i0 = Math.max(0, h.time.findIndex((t) => t.slice(0, 13) === ora));
    const ore = h.time.slice(i0, i0 + 24).map((t, j) => ({ ora: t.slice(11, 16), temp: el(h, "temperature_2m", i0 + j), pioggia: el(h, "precipitation_probability", i0 + j),
      ...cielo(el(h, "weather_code", i0 + j), el(h, "is_day", i0 + j) !== 0) }));
    const umiditaMedia = (giorno) => { const v = h.time.map((t, j) => (t.startsWith(giorno) ? el(h, "relative_humidity_2m", j) : null)).filter((x) => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
    const giorni = g.time.map((t, j) => ({ data: t, ...cielo(el(g, "weather_code", j)), max: el(g, "temperature_2m_max", j), min: el(g, "temperature_2m_min", j),
      pioggia: el(g, "precipitation_probability_max", j), mm: el(g, "precipitation_sum", j), vento: el(g, "wind_speed_10m_max", j), dir: direzione(el(g, "wind_direction_10m_dominant", j) || 0),
      alba: (el(g, "sunrise", j) || "").slice(11, 16), tramonto: (el(g, "sunset", j) || "").slice(11, 16), uv: el(g, "uv_index_max", j), umidita: umiditaMedia(t) }));
    const dati = {
      adesso: { ...cielo(c.weather_code, c.is_day === 1), temp: c.temperature_2m, percepita: c.apparent_temperature, umidita: c.relative_humidity_2m, vento: c.wind_speed_10m,
        raffiche: c.wind_gusts_10m, dir: direzione(c.wind_direction_10m), pressione: c.pressure_msl, uv: c.uv_index, uvTesto: uv(c.uv_index), nuvole: c.cloud_cover, pioggiaMm: c.precipitation, ora: c.time.slice(11, 16) },
      oggi: giorni[0], prossimi: giorni.slice(1, 4), ore,
    };
    cache = { chiave: k, t: Date.now(), dati };
    return dati;
  }
  glob.Meteo = { luogo, salvaLuogo, cercaCitta, posizioneAttuale, previsioni, cielo, uv };
})(window);
