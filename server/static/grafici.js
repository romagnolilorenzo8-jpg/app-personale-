/* Scrigno — grafici in SVG, senza librerie.
   Regole (skill dataviz): colori verificati per daltonismo (viola · arancio · verde acqua, in quest'ordine),
   un solo asse, barre sottili con angoli arrotondati solo in cima, linee da 2px, punti con anello,
   legenda quando le serie sono 2 o più, dettagli al passaggio del dito/mouse, tabella dei dati sempre disponibile.
   I testi usano i colori del testo, mai quelli delle serie. */
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const crea = (tag, attr = {}, padre) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attr)) n.setAttribute(k, v);
    if (padre) padre.appendChild(n);
    return n;
  };
  const div = (cls, padre, testo) => { const d = document.createElement("div"); d.className = cls; if (testo != null) d.textContent = testo; if (padre) padre.appendChild(d); return d; };

  /* Tacche "pulite" per l'asse verticale */
  function tacche(max, n = 4) {
    if (max <= 0) return [0, 1];
    const passoGrezzo = max / n, mag = Math.pow(10, Math.floor(Math.log10(passoGrezzo)));
    const passo = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((p) => p >= passoGrezzo);
    const out = [];
    for (let v = 0; v <= max + passo * 0.001; v += passo) out.push(+v.toFixed(6));
    if (out[out.length - 1] < max) out.push(+(out[out.length - 1] + passo).toFixed(6));
    return out;
  }
  /* Colonna con angoli arrotondati in cima e base squadrata */
  function colonna(x, y, w, h) {
    const r = Math.min(4, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  function cornice(el, serie, titoloTabella) {
    el.innerHTML = "";
    el.classList.add("grafico");
    if (serie.length >= 2) {
      const leg = div("g-legenda", el);
      serie.forEach((s) => {
        const v = div("g-voce", leg);
        const key = div(`g-chiave s${s.slot} ${s.tipo === "linea" ? "linea" : s.tipo === "punti" ? "punto" : ""}`, v);
        key.setAttribute("aria-hidden", "true");
        v.appendChild(document.createTextNode(s.nome));
      });
    }
    const area = div("g-area", el);
    const tip = div("g-tip", area); tip.hidden = true; tip.setAttribute("role", "status");
    return { area, tip };
  }
  function tabella(el, intestazioni, righe, titolo) {
    const d = document.createElement("details"); d.className = "g-tabella";
    const s = document.createElement("summary"); s.textContent = "📋 " + (titolo || "Vedi i numeri"); d.appendChild(s);
    const t = document.createElement("table"), tr = document.createElement("tr");
    intestazioni.forEach((h) => { const th = document.createElement("th"); th.textContent = h; tr.appendChild(th); });
    t.appendChild(tr);
    righe.forEach((r) => { const row = document.createElement("tr"); r.forEach((c) => { const td = document.createElement("td"); td.textContent = c; row.appendChild(td); }); t.appendChild(row); });
    d.appendChild(t); el.appendChild(d);
  }
  function mostraTip(tip, area, x, righe, titolo) {
    tip.innerHTML = "";
    if (titolo) div("g-tip-tit", tip, titolo);
    righe.forEach((r) => {
      const riga = div("g-tip-riga", tip);
      const k = div(`g-chiave s${r.slot} ${r.tipo === "linea" ? "linea" : r.tipo === "punti" ? "punto" : ""}`, riga);
      k.setAttribute("aria-hidden", "true");
      const b = document.createElement("b"); b.textContent = r.valore; riga.appendChild(b);
      const sp = document.createElement("span"); sp.textContent = r.nome; riga.appendChild(sp);
    });
    tip.hidden = false;
    const w = tip.offsetWidth, W = area.clientWidth;
    tip.style.left = Math.max(0, Math.min(W - w, x - w / 2)) + "px";
  }

  /* -------------------------------------------------------------- colonne (una o più serie per categoria) */
  function colonne(el, { categorie, serie, formato = (v) => String(v), altezza = 190, titoloTabella, etichettaCategoria = (c) => c }) {
    const { area, tip } = cornice(el, serie, titoloTabella);
    const W = Math.max(260, area.clientWidth || el.clientWidth || 320), H = altezza;
    const m = { s: 40, d: 6, a: 10, b: 24 }, pw = W - m.s - m.d, ph = H - m.a - m.b;
    const max = Math.max(1, ...serie.flatMap((s) => s.valori));
    const ys = tacche(max), top = ys[ys.length - 1];
    const svg = crea("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", tabindex: "0",
      "aria-label": serie.map((s) => s.nome).join(", ") + ": usa le frecce per scorrere i valori" }, area);
    const y = (v) => m.a + ph - (v / top) * ph;
    ys.forEach((v) => {
      crea("line", { x1: m.s, x2: W - m.d, y1: y(v), y2: y(v), class: v === 0 ? "g-base" : "g-griglia" }, svg);
      crea("text", { x: m.s - 6, y: y(v) + 4, class: "g-tacca", "text-anchor": "end" }, svg).textContent = formato(v, true);
    });
    const n = categorie.length, banda = pw / n, k = serie.length;
    const lb = Math.min(24, Math.max(4, (banda * 0.72 - (k - 1) * 2) / k)), gw = lb * k + (k - 1) * 2;
    const evid = crea("rect", { class: "g-evidenzia", y: m.a, height: ph, width: banda, x: -999, rx: 8 }, svg);
    const passoEtich = W / n < 34 ? 2 : 1;
    categorie.forEach((c, i) => {
      const x0 = m.s + i * banda + (banda - gw) / 2;
      serie.forEach((s, j) => {
        const v = s.valori[i] || 0; if (v <= 0) return;
        crea("path", { d: colonna(x0 + j * (lb + 2), y(v), lb, y(0) - y(v)), class: `g-col s${s.slot}` }, svg);
      });
      if (i % passoEtich === 0 || i === n - 1)
        crea("text", { x: m.s + i * banda + banda / 2, y: H - 6, class: "g-tacca", "text-anchor": "middle" }, svg).textContent = etichettaCategoria(c);
    });
    let att = -1;
    const vai = (i) => {
      att = Math.max(0, Math.min(n - 1, i));
      evid.setAttribute("x", m.s + att * banda);
      mostraTip(tip, area, m.s + att * banda + banda / 2, serie.map((s) => ({ slot: s.slot, nome: s.nome, valore: formato(s.valori[att] || 0) })), categorie[att]);
    };
    const nascondi = () => { tip.hidden = true; evid.setAttribute("x", -999); };
    const daPuntatore = (e) => { const r = svg.getBoundingClientRect(); vai(Math.floor(((e.clientX - r.left) * (W / r.width) - m.s) / banda)); };
    svg.addEventListener("pointermove", daPuntatore);
    svg.addEventListener("pointerdown", daPuntatore);   // un tocco sul telefono
    svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") nascondi(); });
    svg.addEventListener("blur", nascondi);
    svg.addEventListener("keydown", (e) => { if (e.key === "ArrowRight") vai(att + 1); if (e.key === "ArrowLeft") vai(att < 0 ? n - 1 : att - 1); });
    tabella(el, ["", ...serie.map((s) => s.nome)], categorie.map((c, i) => [c, ...serie.map((s) => formato(s.valori[i] || 0))]), titoloTabella);
  }

  /* -------------------------------------------------------------- linea + punti (es. voti e media) */
  function linea(el, { categorie, serie, yMin, yMax, tickY, formato = (v) => String(v), altezza = 200, titoloTabella, etichette }) {
    const { area, tip } = cornice(el, serie, titoloTabella);
    const W = Math.max(260, area.clientWidth || el.clientWidth || 320), H = altezza;
    const m = { s: 30, d: 44, a: 12, b: 24 }, pw = W - m.s - m.d, ph = H - m.a - m.b;
    const n = categorie.length;
    const svg = crea("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", tabindex: "0",
      "aria-label": serie.map((s) => s.nome).join(", ") + ": usa le frecce per scorrere i valori" }, area);
    const x = (i) => m.s + (n === 1 ? pw / 2 : (i / (n - 1)) * pw);
    const y = (v) => m.a + ph - ((v - yMin) / (yMax - yMin)) * ph;
    (tickY || [yMin, yMax]).forEach((v, i) => {
      crea("line", { x1: m.s, x2: W - m.d, y1: y(v), y2: y(v), class: i === 0 ? "g-base" : "g-griglia" }, svg);
      crea("text", { x: m.s - 6, y: y(v) + 4, class: "g-tacca", "text-anchor": "end" }, svg).textContent = formato(v, true);
    });
    const croce = crea("line", { class: "g-croce", y1: m.a, y2: m.a + ph, x1: -999, x2: -999 }, svg);
    serie.forEach((s) => {
      const pts = s.valori.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
      if (s.tipo === "linea" && pts.length > 1) {
        crea("path", { d: "M" + pts.map((p) => p.join(",")).join("L"), class: `g-linea s${s.slot}` }, svg);
        const [lx, ly] = pts[pts.length - 1], ult = s.valori[s.valori.length - 1];
        crea("circle", { cx: lx, cy: ly, r: 4, class: `g-punto s${s.slot}` }, svg);
        crea("text", { x: lx + 8, y: ly + 4, class: "g-etichetta" }, svg).textContent = formato(ult);   // etichetta solo in fondo
      }
      if (s.tipo === "linea" && s.punti) pts.slice(0, -1).forEach(([px, py]) => crea("circle", { cx: px, cy: py, r: 4, class: `g-punto s${s.slot}` }, svg));
      if (s.tipo === "punti") pts.forEach(([px, py]) => crea("circle", { cx: px, cy: py, r: 4.5, class: `g-punto s${s.slot}` }, svg));
    });
    const passoEtich = Math.ceil(n / Math.max(1, Math.floor(pw / 46)));
    categorie.forEach((c, i) => {
      const vicinoUltima = i !== n - 1 && x(n - 1) - x(i) < 58;   // non sovrapporre la penultima etichetta all'ultima
      if ((i % passoEtich === 0 || i === n - 1) && !vicinoUltima)
        crea("text", { x: x(i), y: H - 6, class: "g-tacca", "text-anchor": i === 0 && n > 1 ? "start" : i === n - 1 && n > 1 ? "end" : "middle" }, svg).textContent = c;
    });
    let att = -1;
    const vai = (i) => {
      att = Math.max(0, Math.min(n - 1, i));
      croce.setAttribute("x1", x(att)); croce.setAttribute("x2", x(att));
      mostraTip(tip, area, x(att), serie.filter((s) => s.valori[att] != null).map((s) => ({ slot: s.slot, tipo: s.tipo, nome: s.nome, valore: formato(s.valori[att]) })),
        etichette ? etichette[att] : categorie[att]);
    };
    const nascondi = () => { tip.hidden = true; croce.setAttribute("x1", -999); croce.setAttribute("x2", -999); };
    const daPuntatore = (e) => { const r = svg.getBoundingClientRect(); const px = (e.clientX - r.left) * (W / r.width); vai(n === 1 ? 0 : Math.round(((px - m.s) / pw) * (n - 1))); };
    svg.addEventListener("pointermove", daPuntatore);
    svg.addEventListener("pointerdown", daPuntatore);   // un tocco sul telefono
    svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") nascondi(); });
    svg.addEventListener("blur", nascondi);
    svg.addEventListener("keydown", (e) => { if (e.key === "ArrowRight") vai(att + 1); if (e.key === "ArrowLeft") vai(att < 0 ? n - 1 : att - 1); });
    tabella(el, ["", ...serie.map((s) => s.nome)], categorie.map((c, i) => [etichette ? etichette[i] : c, ...serie.map((s) => (s.valori[i] == null ? "—" : formato(s.valori[i])))]), titoloTabella);
  }

  /* -------------------------------------------------------------- numeri che "contano" fino al valore */
  function conta(el) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.querySelectorAll("[data-conta]").forEach((n) => {
      const fine = parseFloat(n.dataset.conta), dec = +(n.dataset.dec || 0), pre = n.dataset.pre || "", suf = n.dataset.suf || "";
      if (!isFinite(fine) || fine === 0) return;
      const t0 = performance.now(), dur = 900, fmt = (v) => pre + v.toLocaleString("it-IT", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + suf;
      const finale = n.textContent;
      const passo = (t) => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3); n.textContent = fmt(fine * e); if (p < 1) requestAnimationFrame(passo); else n.textContent = finale; };
      requestAnimationFrame(passo);
    });
  }

  window.Grafici = { colonne, linea, conta };
})();
