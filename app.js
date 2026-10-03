/* TradeIA — version 100 % statique (GitHub Pages).
 * Aucun serveur : l'appel à l'API Anthropic part directement du navigateur avec la clé de l'utilisateur.
 */
"use strict";

(() => {
  /* =========================================================
   * Configuration
   * ========================================================= */
  const CONFIG = {
    API_URL: "https://api.anthropic.com/v1/messages",
    API_VERSION: "2023-06-01",
    // claude-3-5-sonnet-20241022 est retiré par Anthropic (erreur 404) : modèle actuel par défaut.
    DEFAULT_MODEL: "claude-sonnet-5-5",
    MAX_BYTES: 5 * 1024 * 1024,
    ACCEPT: ["image/png", "image/jpeg", "image/webp"],
    HISTORY_MAX: 30,
    KEYS: { apiKey: "tradeia:apiKey", model: "tradeia:model", history: "tradeia:history" },
  };

  const SYSTEM_PROMPT = `Tu es un analyste technique senior spécialisé en Price Action et Smart Money Concepts (SMC), avec 15 ans d'expérience sur crypto, forex, indices et actions. Tu analyses UNE capture d'écran de graphique en chandeliers japonais et tu produis un plan de trade discipliné.

# FORMAT DE SORTIE (OBLIGATOIRE)
- Réponds UNIQUEMENT avec un objet JSON valide. Aucun texte avant ou après, aucune balise markdown, aucun \`\`\`.
- Tous les prix sont des nombres (pas de chaînes, pas de séparateur de milliers, point comme séparateur décimal).
- Le champ "rationale" est rédigé en français.

Structure exacte :
{
  "asset_detected": "string (ex: BTC/USDT, EUR/USD, NVDA, ou \\"Inconnu\\")",
  "timeframe_detected": "string (ex: 15m, 1h, 4h, Daily, ou \\"Inconnu\\")",
  "trend": "Bullish" | "Bearish" | "Neutral",
  "key_patterns": ["string"],
  "support_levels": [number],
  "resistance_levels": [number],
  "recommendation": "BUY" | "SELL" | "WAIT",
  "confidence_score": number entre 0 et 100,
  "trade_plan": {
    "entry_price": number ou "Market",
    "stop_loss": number,
    "take_profit_1": number,
    "take_profit_2": number,
    "risk_reward_ratio": "string (ex: 1:2.5)"
  },
  "rationale": "string"
}

# CAS D'ÉCHEC
Si l'image n'est PAS un graphique de prix exploitable (photo, texte, graphique illisible, aucune échelle de prix visible), réponds exactement :
{"error": "NOT_A_CHART", "message": "<raison courte en français>"}

# MÉTHODE D'ANALYSE (dans cet ordre)
1. Lecture du contexte : identifie l'actif et l'unité de temps via les titres, légendes et l'axe des abscisses. Lis l'échelle de prix sur l'axe de droite ; tous tes niveaux doivent être cohérents avec cette échelle. Si une information n'est pas lisible, écris "Inconnu" plutôt que de deviner.
2. Structure de marché : repère les sommets et creux significatifs (HH/HL = haussier, LH/LL = baissier). Détecte les BOS (Break of Structure) et CHoCH (Change of Character). Une cassure n'est valide que si une bougie CLÔTURE au-delà du niveau, pas une simple mèche.
3. Cassures et retests : signale toute cassure récente d'un support/résistance et précise si le retest a eu lieu, s'il a tenu (rejet) ou échoué.
4. Liquidité : identifie les zones de liquidité (equal highs/lows, sommets/creux évidents, stops au-dessus/en dessous des ranges) et les chasses de liquidité (sweep puis réintégration rapide).
5. Zones institutionnelles : order blocks, fair value gaps (FVG / imbalances), zones de premium/discount par rapport au dernier swing.
6. Rejets de mèches et figures de bougies : pin bars, englobantes, dojis à des niveaux clés. Une figure n'a de valeur que sur un niveau significatif.
7. Indicateurs visibles uniquement : si des moyennes mobiles, RSI, MACD, volume ou autres sont affichés, intègre-les (croisements, divergences, surachat/survente). N'invente jamais un indicateur absent de l'image.

# RÈGLES DE GESTION DU RISQUE (NON NÉGOCIABLES)
- BUY : stop_loss < entry_price < take_profit_1 < take_profit_2.
- SELL : stop_loss > entry_price > take_profit_1 > take_profit_2.
- Le stop_loss se place derrière une invalidation structurelle claire (au-delà du dernier swing, de la mèche de rejet ou de l'order block), jamais à une distance arbitraire.
- Les take-profits visent des zones logiques : liquidité opposée, résistance/support suivant, comblement de FVG.
- Le ratio risque/rendement vers take_profit_1 doit être d'au moins 1:1,5. Si aucun setup ne l'offre, recommande "WAIT".
- risk_reward_ratio est calculé vers take_profit_2 : |TP2 - entrée| / |entrée - SL|, arrondi à une décimale, au format "1:X".
- Recommande "WAIT" si : marché en range sans biais, signaux contradictoires, prix au milieu de nulle part (loin de toute zone clé), ou setup non confirmé. Dans ce cas, fournis tout de même un plan CONDITIONNEL (niveaux qui déclencheraient le trade) et explique la condition de déclenchement dans "rationale".
- "Market" n'est autorisé pour entry_price que si le prix actuel se trouve déjà dans la zone d'entrée idéale ; sinon donne un prix d'entrée limite précis.

# CALIBRATION DE LA CONFIANCE
- 80-100 : confluence forte (structure + liquidité + zone institutionnelle + confirmation bougie), R:R ≥ 1:2.
- 60-79 : setup propre mais une confluence manque.
- 40-59 : setup spéculatif ou lecture partielle de l'image.
- 0-39 : lecture très incertaine. Recommande alors "WAIT".
Baisse la confiance si l'échelle de prix est difficile à lire, si l'unité de temps est inconnue, ou si peu de bougies sont visibles.

# RÉDACTION DU "rationale"
4 à 8 phrases, factuelles et précises : structure observée, niveaux clés et pourquoi, signal déclencheur, logique du SL et des TP, puis le scénario d'invalidation (ce qui annulerait l'analyse). Pas de promesse de gain, pas de langage émotionnel.`;
  const USER_PROMPT = "Analyse ce graphique et renvoie uniquement le JSON demandé.";

  const TABS = [
    { id: "accueil", label: "Accueil", icon: "house" },
    { id: "analyseur", label: "Analyseur", icon: "scan-line" },
    { id: "methode", label: "Stratégie & méthode", icon: "book-open" },
    { id: "historique", label: "Historique", icon: "history" },
  ];
  const FLOW = ["Contexte", "Structure", "Cassures", "Liquidité", "OB & FVG", "Bougies", "Indicateurs"];
  const TIPS = [
    "L’axe des prix doit être visible et lisible.",
    "Garde entre 50 et 200 bougies à l’écran.",
    "Affiche le nom de l’actif et l’unité de temps.",
    "Évite les captures surchargées d’indicateurs.",
  ];
  const LOADER_STEPS = [
    "Lecture de l’échelle de prix",
    "Structure de marché",
    "Zones de liquidité",
    "Order blocks et FVG",
    "Calcul du plan de trade",
  ];

  /** Exemples fictifs pour l'aperçu de la page d'accueil. */
  const DEMOS = {
    BUY: {
      label: "BTC/USDT",
      analysis: {
        asset_detected: "BTC/USDT",
        timeframe_detected: "4h",
        trend: "Bullish",
        key_patterns: ["Liquidity sweep", "BOS haussier", "Order block 4h", "Bullish engulfing"],
        support_levels: [66400, 65200],
        resistance_levels: [68650, 70200],
        recommendation: "BUY",
        confidence_score: 74,
        trade_plan: {
          entry_price: 67250,
          stop_loss: 66380,
          take_profit_1: 68650,
          take_profit_2: 70200,
          risk_reward_ratio: "1:3.4",
        },
        rationale:
          "La structure reste haussière avec une suite de creux ascendants et un BOS validé en clôture au-dessus de 68 000. Le dernier repli a balayé la liquidité sous les equal lows de 66 450 avant une réintégration rapide, signe d'absorption acheteuse. L'entrée se place dans l'order block 4h qui a initié l'impulsion, au retest de la zone. Le stop est logé sous la mèche du sweep, ce qui invalide le scénario s'il est touché. TP1 vise le sommet précédent, TP2 la liquidité au-dessus de 70 000. Une clôture 4h sous 66 380 annulerait l'analyse.",
      },
    },
    SELL: {
      label: "EUR/USD",
      analysis: {
        asset_detected: "EUR/USD",
        timeframe_detected: "1h",
        trend: "Bearish",
        key_patterns: ["CHoCH baissier", "Retest de cassure", "Fair value gap", "Pin bar"],
        support_levels: [1.083, 1.0795],
        resistance_levels: [1.0898, 1.0925],
        recommendation: "SELL",
        confidence_score: 66,
        trade_plan: {
          entry_price: 1.0872,
          stop_loss: 1.0898,
          take_profit_1: 1.083,
          take_profit_2: 1.0795,
          risk_reward_ratio: "1:3.0",
        },
        rationale:
          "Le prix a cassé en clôture le dernier creux majeur à 1,0860, ce qui confirme un changement de caractère baissier. Le retour actuel comble le fair value gap laissé par l'impulsion et vient retester l'ancien support devenu résistance. Une pin bar rejette la zone. Le stop se place au-dessus du dernier sommet inférieur à 1,0898. TP1 cible le creux récent, TP2 la liquidité sous 1,0800. Une clôture horaire au-dessus de 1,0898 invaliderait le scénario.",
      },
    },
    WAIT: {
      label: "NVDA",
      analysis: {
        asset_detected: "NVDA",
        timeframe_detected: "Daily",
        trend: "Neutral",
        key_patterns: ["Range", "Equal highs", "Compression"],
        support_levels: [114.9, 110.2],
        resistance_levels: [124.2, 131.5],
        recommendation: "WAIT",
        confidence_score: 42,
        trade_plan: {
          entry_price: 118.4,
          stop_loss: 114.9,
          take_profit_1: 124.2,
          take_profit_2: 131.5,
          risk_reward_ratio: "1:3.7",
        },
        rationale:
          "Le titre évolue en range entre 114,9 et 124,2 depuis plusieurs semaines, sans biais directionnel clair. Le prix se trouve au milieu de la fourchette, loin de toute zone d'intérêt, ce qui dégrade le ratio risque/rendement. Le plan proposé est conditionnel : achat uniquement après un balayage de 114,9 suivi d'une réintégration en clôture journalière. Les equal highs à 124,2 forment l'objectif naturel, puis 131,5 en cas de cassure. Une clôture sous 110,2 annulerait ce scénario.",
      },
    },
  };

  /* =========================================================
   * Utilitaires
   * ========================================================= */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /** Échappe tout texte venant de l'IA ou du stockage avant insertion HTML. */
  function esc(v) {
    return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  const icon = (name, cls = "size-4") => `<i data-lucide="${name}" class="${cls}" aria-hidden="true"></i>`;
  const refreshIcons = () => window.lucide && window.lucide.createIcons();

  function formatPrice(n) {
    const abs = Math.abs(n);
    const digits = abs >= 1000 ? 2 : abs >= 10 ? 3 : abs >= 1 ? 5 : 6;
    return n.toLocaleString("fr-FR", { maximumFractionDigits: digits });
  }
  const formatBytes = (n) => (n < 1024 * 1024 ? `${Math.round(n / 1024)} Ko` : `${(n / 1024 / 1024).toFixed(1)} Mo`);
  const formatDateTime = (iso) =>
    new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  /** "claude-sonnet-5-5" → "Claude Sonnet 5.5" */
  function modelLabel(id) {
    const m = String(id || "").match(/^claude-([a-z]+)-(\d+)-(\d+)/);
    return m ? `Claude ${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : "Claude";
  }

  const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  /* =========================================================
   * Stockage (localStorage / sessionStorage, toujours protégé)
   * ========================================================= */
  function makeStore(getter) {
    return {
      get(k) { try { return getter().getItem(k); } catch { return null; } },
      set(k, v) { try { getter().setItem(k, v); return true; } catch { return false; } },
      del(k) { try { getter().removeItem(k); } catch { /* stockage indisponible */ } },
    };
  }
  const local = makeStore(() => window.localStorage);
  const session = makeStore(() => window.sessionStorage);

  const getApiKey = () => local.get(CONFIG.KEYS.apiKey) || session.get(CONFIG.KEYS.apiKey) || "";
  const getModel = () => local.get(CONFIG.KEYS.model) || CONFIG.DEFAULT_MODEL;
  function saveApiKey(key, remember) {
    local.del(CONFIG.KEYS.apiKey);
    session.del(CONFIG.KEYS.apiKey);
    (remember ? local : session).set(CONFIG.KEYS.apiKey, key);
  }
  function deleteApiKey() {
    local.del(CONFIG.KEYS.apiKey);
    session.del(CONFIG.KEYS.apiKey);
  }

  /* =========================================================
   * Validation (équivalent du schéma Zod)
   * ========================================================= */
  function num(v) {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v.replace(/[\s\u202f]/g, ""));
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }
  const numList = (arr) => (Array.isArray(arr) ? arr.map(num).filter((n) => n !== null) : []);

  function validateAnalysis(j) {
    const fail = (field) => {
      throw new Error(`Réponse de l’IA incomplète (champ « ${field} »). Relance l’analyse.`);
    };
    if (!j || typeof j !== "object") fail("racine");
    const tp = j.trade_plan && typeof j.trade_plan === "object" ? j.trade_plan : fail("trade_plan");

    const entry = tp.entry_price === "Market" ? "Market" : num(tp.entry_price);
    const sl = num(tp.stop_loss);
    const tp1 = num(tp.take_profit_1);
    const tp2 = num(tp.take_profit_2);
    const conf = num(j.confidence_score);
    if (entry === null) fail("entry_price");
    if (sl === null) fail("stop_loss");
    if (tp1 === null) fail("take_profit_1");
    if (tp2 === null) fail("take_profit_2");
    if (conf === null) fail("confidence_score");
    if (!["Bullish", "Bearish", "Neutral"].includes(j.trend)) fail("trend");
    if (!["BUY", "SELL", "WAIT"].includes(j.recommendation)) fail("recommendation");
    if (typeof j.rationale !== "string" || !j.rationale.trim()) fail("rationale");

    return {
      asset_detected: typeof j.asset_detected === "string" && j.asset_detected ? j.asset_detected : "Inconnu",
      timeframe_detected: typeof j.timeframe_detected === "string" && j.timeframe_detected ? j.timeframe_detected : "Inconnu",
      trend: j.trend,
      key_patterns: Array.isArray(j.key_patterns) ? j.key_patterns.filter((p) => typeof p === "string") : [],
      support_levels: numList(j.support_levels),
      resistance_levels: numList(j.resistance_levels),
      recommendation: j.recommendation,
      confidence_score: Math.max(0, Math.min(100, Math.round(conf))),
      trade_plan: {
        entry_price: entry,
        stop_loss: sl,
        take_profit_1: tp1,
        take_profit_2: tp2,
        risk_reward_ratio: typeof tp.risk_reward_ratio === "string" ? tp.risk_reward_ratio : "N/A",
      },
      rationale: j.rationale,
    };
  }

  /** Extrait le premier objet JSON, même entouré de ``` ou de texte. */
  function extractJson(text) {
    const cleaned = text.replace(/```(?:json)?/gi, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("La réponse de l’IA n’était pas un JSON valide. Relance l’analyse.");
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      throw new Error("La réponse de l’IA n’était pas un JSON valide. Relance l’analyse.");
    }
  }

  /* =========================================================
   * Contrôles du plan de trade
   * ========================================================= */
  function computeRR(entry, sl, tp) {
    const risk = Math.abs(entry - sl);
    return risk === 0 ? null : Math.abs(tp - entry) / risk;
  }

  function checkTradePlan(a) {
    const w = [];
    const { entry_price, stop_loss: sl, take_profit_1: tp1, take_profit_2: tp2 } = a.trade_plan;
    const entry = entry_price === "Market" ? null : entry_price;

    if (a.recommendation === "BUY") {
      if (entry !== null && sl >= entry) w.push("Stop-loss au-dessus de l’entrée pour un achat.");
      if (entry !== null && tp1 <= entry) w.push("TP1 sous l’entrée pour un achat.");
      if (tp2 < tp1) w.push("TP2 plus proche que TP1.");
    }
    if (a.recommendation === "SELL") {
      if (entry !== null && sl <= entry) w.push("Stop-loss sous l’entrée pour une vente.");
      if (entry !== null && tp1 >= entry) w.push("TP1 au-dessus de l’entrée pour une vente.");
      if (tp2 > tp1) w.push("TP2 plus proche que TP1.");
    }
    if (entry !== null && a.recommendation !== "WAIT") {
      const rr1 = computeRR(entry, sl, tp1);
      if (rr1 !== null && rr1 < 1.5) w.push(`R:R réel vers TP1 de 1:${rr1.toFixed(2)}, sous le minimum de 1:1.5.`);
    }
    if (a.confidence_score < 50 && a.recommendation !== "WAIT") w.push("Confiance inférieure à 50 % : signal fragile.");
    if (a.asset_detected === "Inconnu" || a.timeframe_detected === "Inconnu") {
      w.push("Actif ou unité de temps non lisible : vérifie les niveaux sur ta plateforme.");
    }
    return w;
  }

  /* =========================================================
   * API Anthropic (appel direct depuis le navigateur)
   * ========================================================= */
  class AppError extends Error {
    constructor(message, code) {
      super(message);
      this.code = code;
    }
  }

  function apiErrorMessage(status, data) {
    const detail = data && data.error && data.error.message ? ` (${data.error.message})` : "";
    if (status === 401) return "Clé API invalide ou révoquée.";
    if (status === 403) return `Cette clé n’a pas accès à la ressource demandée${detail}.`;
    if (status === 404) return `Modèle introuvable : vérifie son nom dans les réglages${detail}.`;
    if (status === 413) return "Image trop lourde pour l’API.";
    if (status === 429) return "Limite de requêtes ou de crédit atteinte. Réessaie dans un instant.";
    if (status === 529 || status === 503) return "L’API d’Anthropic est surchargée. Réessaie dans un instant.";
    return `Erreur de l’API Anthropic (HTTP ${status})${detail}.`;
  }

  async function callClaude(body, key = getApiKey()) {
    if (!key) throw new AppError("Ajoute ta clé API Anthropic dans les réglages.", "NO_KEY");
    let res;
    try {
      res = await fetch(CONFIG.API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": CONFIG.API_VERSION,
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error("Impossible de joindre l’API Anthropic. Vérifie ta connexion ou un éventuel bloqueur de requêtes.");
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new AppError(apiErrorMessage(res.status, data), res.status === 401 ? "NO_KEY" : "API");
    return data;
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1]);
      r.onerror = () => reject(new Error("Lecture du fichier impossible."));
      r.readAsDataURL(file);
    });
  }

  async function analyzeImage(file) {
    const data = await callClaude({
      model: getModel(),
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: file.type, data: await fileToBase64(file) } },
            { type: "text", text: USER_PROMPT },
          ],
        },
      ],
    });
    const text = (data && Array.isArray(data.content) ? data.content : [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const json = extractJson(text);
    if (json && json.error === "NOT_A_CHART") {
      throw new AppError(typeof json.message === "string" ? json.message : "Cette image n’est pas un graphique exploitable.", "NOT_A_CHART");
    }
    const analysis = validateAnalysis(json);
    return { analysis, warnings: checkTradePlan(analysis) };
  }

  /** Requête minimale (1 token) : valide la clé ET le nom du modèle. */
  async function testKey(key, model) {
    await callClaude({ model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }, key);
  }

  async function makeThumbnail(file, width = 240) {
    try {
      const bmp = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = Math.round(bmp.height * (width / bmp.width));
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      bmp.close();
      return canvas.toDataURL("image/jpeg", 0.7);
    } catch {
      return null;
    }
  }

  /* =========================================================
   * État de l'application
   * ========================================================= */
  const state = {
    tab: "accueil",
    file: null,
    previewUrl: null,
    status: "idle", // idle | ready | loading | done | error
    result: null,
    error: null,
    loaderStep: 0,
    loaderTimer: null,
    history: [],
    selectedId: null,
    demo: "BUY",
  };

  /* =========================================================
   * Rendu : dashboard de résultats
   * ========================================================= */
  const DECISION = {
    BUY: { label: "Signal d’achat", text: "text-buy", bar: "bg-buy", glow: "bg-buy/25", badge: "border-buy/30 bg-buy/10 text-buy" },
    SELL: { label: "Signal de vente", text: "text-sell", bar: "bg-sell", glow: "bg-sell/25", badge: "border-sell/30 bg-sell/10 text-sell" },
    WAIT: { label: "Pas de setup", text: "text-wait", bar: "bg-wait", glow: "bg-wait/20", badge: "border-wait/30 bg-wait/10 text-wait" },
  };
  const TREND = {
    Bullish: { label: "haussière", icon: "trending-up" },
    Bearish: { label: "baissière", icon: "trending-down" },
    Neutral: { label: "neutre", icon: "move-right" },
  };
  const badge = (content, cls = "border-line bg-white/[0.04] text-fg") =>
    `<span class="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${cls}">${content}</span>`;

  function priceLadder(plan) {
    const levels = [
      { label: "TP2", value: plan.take_profit_2, line: "bg-buy", text: "text-buy" },
      { label: "TP1", value: plan.take_profit_1, line: "bg-buy/60", text: "text-buy" },
      { label: "SL", value: plan.stop_loss, line: "bg-sell", text: "text-sell" },
    ];
    if (plan.entry_price !== "Market") levels.push({ label: "Entrée", value: plan.entry_price, line: "bg-accent", text: "text-accent" });

    const values = levels.map((l) => l.value);
    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min || 1;
    const top = (v) => 8 + ((max - v) / range) * 84;

    let zones = "";
    if (plan.entry_price !== "Market") {
      const e = top(plan.entry_price);
      const s = top(plan.stop_loss);
      const t = top(plan.take_profit_2);
      zones = `
        <div class="absolute left-16 right-24 bg-sell/[0.07]" style="top:${Math.min(e, s)}%;height:${Math.abs(s - e)}%"></div>
        <div class="absolute left-16 right-24 bg-buy/[0.07]" style="top:${Math.min(e, t)}%;height:${Math.abs(t - e)}%"></div>`;
    }

    return `
      <div class="relative h-64 w-full" aria-label="Échelle des niveaux du plan">
        ${zones}
        <div class="absolute inset-y-0 left-16 w-px bg-line"></div>
        ${levels
          .map(
            (l) => `
          <div class="absolute inset-x-0 flex -translate-y-1/2 items-center gap-2" style="top:${top(l.value)}%">
            <span class="w-14 text-right text-xs font-medium ${l.text}">${l.label}</span>
            <span class="h-px flex-1 ${l.line}"></span>
            <span class="w-22 text-right font-mono text-sm">${formatPrice(l.value)}</span>
          </div>`,
          )
          .join("")}
        ${plan.entry_price === "Market" ? `<p class="absolute bottom-0 left-16 pl-2 text-xs text-muted">Entrée au prix du marché</p>` : ""}
      </div>`;
  }

  function levelList(title, values, cls) {
    const sorted = [...values].sort((x, y) => y - x);
    return `
      <div>
        <h3 class="mb-2.5 text-sm font-medium text-muted">${title}</h3>
        <div class="flex flex-wrap gap-1.5">
          ${sorted.length ? sorted.map((v) => badge(formatPrice(v), `${cls} font-mono`)).join("") : `<span class="text-sm text-zinc-500">Aucun</span>`}
        </div>
      </div>`;
  }

  function renderDashboard(a, warnings) {
    const d = DECISION[a.recommendation];
    const t = TREND[a.trend];
    const plan = a.trade_plan;
    const entry = plan.entry_price === "Market" ? null : plan.entry_price;
    const realRR = entry !== null ? computeRR(entry, plan.stop_loss, plan.take_profit_2) : null;

    const rows = [
      ["Entrée", entry === null ? "Market" : formatPrice(entry), ""],
      ["Stop-loss", formatPrice(plan.stop_loss), "text-sell"],
      ["Take-profit 1", formatPrice(plan.take_profit_1), "text-buy"],
      ["Take-profit 2", formatPrice(plan.take_profit_2), "text-buy"],
      ["Risque / rendement", esc(plan.risk_reward_ratio) + (realRR ? ` (recalculé 1:${realRR.toFixed(1)})` : ""), ""],
    ];

    return `
      <div class="space-y-4">
        <div class="glass relative overflow-hidden">
          <div aria-hidden="true" class="absolute -left-20 -top-24 size-72 rounded-full blur-3xl ${d.glow}"></div>
          <div class="h-px ${d.bar}"></div>
          <div class="relative flex flex-wrap items-end justify-between gap-6 p-6">
            <div>
              <div class="flex flex-wrap items-center gap-2">
                ${badge(`<span class="pulse-dot ${d.bar}"></span> ${d.label}`, d.badge)}
                ${badge(esc(a.asset_detected))}
                ${badge(esc(a.timeframe_detected))}
              </div>
              <p class="mt-4 text-6xl font-semibold tracking-tighter sm:text-7xl ${d.text}">${a.recommendation}</p>
              <p class="mt-2 flex items-center gap-1.5 text-sm text-muted">${icon(t.icon)} Tendance ${t.label}</p>
            </div>
            <div class="w-full max-w-60">
              <div class="flex justify-between text-sm"><span class="text-muted">Confiance</span><span class="font-mono font-medium">${a.confidence_score} %</span></div>
              <div class="mt-2 h-1.5 rounded-full bg-white/[0.06]"><div class="h-full rounded-full ${d.bar}" style="width:${a.confidence_score}%"></div></div>
            </div>
          </div>
        </div>

        ${
          warnings.length
            ? `<div class="space-y-1.5 rounded-xl border border-wait/30 bg-wait/[0.06] p-4 text-sm">
                ${warnings.map((w) => `<p class="flex gap-2 text-wait">${icon("triangle-alert", "mt-0.5 size-4 shrink-0")} ${esc(w)}</p>`).join("")}
              </div>`
            : ""
        }

        <div class="grid gap-4 md:grid-cols-2">
          <div class="glass">
            <h3 class="px-5 pt-5 text-sm font-medium text-muted">Plan d’exécution</h3>
            <div class="p-5">
              <table class="w-full text-sm"><tbody>
                ${rows
                  .map(
                    ([k, v, c]) => `<tr class="border-b border-line/70 last:border-0">
                      <th scope="row" class="py-3 text-left font-normal text-muted">${k}</th>
                      <td class="py-3 text-right font-mono font-medium ${c}">${v}</td></tr>`,
                  )
                  .join("")}
              </tbody></table>
            </div>
          </div>
          <div class="glass">
            <h3 class="px-5 pt-5 text-sm font-medium text-muted">Niveaux à l’échelle</h3>
            <div class="p-5">${priceLadder(plan)}</div>
          </div>
        </div>

        <div class="glass grid gap-6 p-5 sm:grid-cols-3">
          ${levelList("Résistances", a.resistance_levels, "border-sell/30 bg-sell/10 text-sell")}
          ${levelList("Supports", a.support_levels, "border-buy/30 bg-buy/10 text-buy")}
          <div>
            <h3 class="mb-2.5 text-sm font-medium text-muted">Figures détectées</h3>
            <div class="flex flex-wrap gap-1.5">
              ${a.key_patterns.length ? a.key_patterns.map((p) => badge(esc(p))).join("") : `<span class="text-sm text-zinc-500">Aucune</span>`}
            </div>
          </div>
        </div>

        <div class="glass">
          <h3 class="px-5 pt-5 text-sm font-medium text-muted">Pourquoi ce plan</h3>
          <p class="max-w-prose whitespace-pre-line p-5 leading-relaxed text-zinc-300">${esc(a.rationale)}</p>
        </div>
      </div>`;
  }

  /* =========================================================
   * Rendu : navigation, statut de la clé, footer
   * ========================================================= */
  function renderTabs() {
    const html = TABS.map((t) => {
      const active = t.id === state.tab;
      const count =
        t.id === "historique" && state.history.length
          ? `<span class="rounded-md bg-accent/15 px-1.5 font-mono text-[11px] text-accent">${state.history.length}</span>`
          : "";
      return `<li><button data-nav="${t.id}" ${active ? 'aria-current="page"' : ""}
        class="flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-all duration-200 ${
          active ? "bg-white/[0.08] text-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]" : "text-muted hover:bg-white/[0.04] hover:text-fg"
        }">${icon(t.icon, `size-4 ${active ? "text-accent" : ""}`)}${t.label}${count}</button></li>`;
    }).join("");
    $$(".tab-list").forEach((ul) => (ul.innerHTML = html));
    refreshIcons();
  }

  function renderKeyStatus() {
    const has = Boolean(getApiKey());
    const btn = $("#key-status");
    btn.innerHTML = `${has ? '<span class="pulse-dot bg-buy"></span>' : '<span class="inline-flex size-2 rounded-full bg-wait"></span>'}
      <span class="hidden sm:inline">${has ? "Clé API configurée" : "Ajouter une clé API"}</span>${icon("settings", "size-3.5")}`;
    btn.title = has ? `Modèle : ${getModel()}` : "Configurer ta clé API Anthropic";
    $("#hero-model").textContent = modelLabel(getModel());
    refreshIcons();
  }

  function renderStatic() {
    $("#flow-chips").innerHTML = FLOW.map(
      (s, i) => `<li class="flex items-center gap-1.5">
        <span class="rounded-md border border-line bg-white/[0.03] px-2.5 py-1 text-xs text-zinc-300">${s}</span>
        ${i < FLOW.length - 1 ? icon("chevron-right", "size-3.5 text-zinc-600") : ""}</li>`,
    ).join("");
    $("#footer-links").innerHTML = TABS.map(
      (t) => `<li><button data-nav="${t.id}" class="text-muted transition-colors hover:text-fg">${t.label}</button></li>`,
    ).join("");
    $("#year").textContent = String(new Date().getFullYear());
  }

  function renderDemo() {
    const d = DEMOS[state.demo].analysis;
    $("#demo-dashboard").innerHTML = `<div class="tab-enter">${renderDashboard(d, checkTradePlan(d))}</div>`;
    $$("[data-demo]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.demo === state.demo)));
    refreshIcons();
  }

  /* =========================================================
   * Rendu : analyseur
   * ========================================================= */
  function renderSide() {
    if (!state.file) {
      const keyNotice = getApiKey()
        ? ""
        : `<div class="mt-5 rounded-lg border border-wait/30 bg-wait/[0.06] p-3 text-sm">
            <p class="text-wait">Aucune clé API configurée.</p>
            <button data-action="open-settings" class="btn-outline mt-3 h-8 w-full px-3 text-xs">${icon("key-round", "size-3.5")} Ajouter ma clé</button>
          </div>`;
      return `
        <h2 class="text-sm font-medium">Pour une lecture fiable</h2>
        <ul class="points text-muted">${TIPS.map((t) => `<li>${t}</li>`).join("")}</ul>
        ${keyNotice}`;
    }

    const action =
      state.status === "loading"
        ? `<ol class="space-y-3" role="status" aria-live="polite">
            ${LOADER_STEPS.map((s, i) => {
              const ico =
                i < state.loaderStep
                  ? icon("check", "size-4 text-buy")
                  : i === state.loaderStep
                    ? icon("loader-circle", "size-4 text-accent spin")
                    : icon("circle", "size-4 text-zinc-700");
              return `<li class="flex items-center gap-3 text-sm">${ico}<span class="${i <= state.loaderStep ? "text-fg" : "text-zinc-500"}">${s}</span></li>`;
            }).join("")}
          </ol>`
        : `<button data-action="analyze" class="btn-primary h-12 w-full px-6 text-base">${icon("scan-line", "size-5")}
            ${state.status === "error" ? "Relancer l’analyse" : state.status === "done" ? "Analyser à nouveau" : "Analyser le graphique"}
          </button>`;

    return `
      <div class="space-y-5">
        <div class="flex items-center gap-3">
          <div class="grid size-10 shrink-0 place-items-center rounded-lg border border-line bg-ink">${icon("file-image", "size-4 text-accent")}</div>
          <div class="min-w-0">
            <p class="truncate text-sm font-medium">${esc(state.file.name || "Capture collée")}</p>
            <p class="text-xs text-muted">${formatBytes(state.file.size)}</p>
          </div>
        </div>
        ${action}
        <button data-action="reset" ${state.status === "loading" ? "disabled" : ""} class="btn-ghost h-8 w-full px-3 text-xs">${icon("rotate-ccw", "size-3.5")} Changer d’image</button>
      </div>`;
  }

  function renderScanner() {
    const hasFile = Boolean(state.file);
    $("#dropzone").hidden = hasFile;
    $("#preview").hidden = !hasFile;
    if (hasFile && $("#preview-img").getAttribute("src") !== state.previewUrl) $("#preview-img").src = state.previewUrl;
    $("#preview-img").style.opacity = state.status === "loading" ? "0.5" : "1";
    $("#scan-overlay").hidden = state.status !== "loading";

    const err = $("#scanner-error");
    err.hidden = !state.error;
    err.innerHTML = state.error ? `${icon("circle-x", "size-4 shrink-0")}<span>${esc(state.error)}</span>` : "";

    $("#scanner-side").innerHTML = renderSide();
    $("#scanner-result").innerHTML =
      state.status === "done" && state.result
        ? `<div class="tab-enter">${renderDashboard(state.result.analysis, state.result.warnings)}</div>`
        : "";
    refreshIcons();
  }

  function selectFile(file) {
    if (!file) return;
    if (!CONFIG.ACCEPT.includes(file.type)) return showScannerError("Format non supporté. Utilise PNG, JPG ou WEBP.");
    if (file.size > CONFIG.MAX_BYTES) return showScannerError("Image trop lourde (5 Mo max).");
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    Object.assign(state, { file, previewUrl: URL.createObjectURL(file), status: "ready", result: null, error: null });
    renderScanner();
  }

  function showScannerError(msg) {
    state.error = msg;
    renderScanner();
  }

  function resetScanner() {
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    Object.assign(state, { file: null, previewUrl: null, status: "idle", result: null, error: null });
    $("#preview-img").removeAttribute("src");
    renderScanner();
  }

  function startLoader() {
    state.loaderStep = 0;
    state.loaderTimer = setInterval(() => {
      state.loaderStep = Math.min(state.loaderStep + 1, LOADER_STEPS.length - 1);
      $("#scanner-side").innerHTML = renderSide();
      refreshIcons();
    }, 3000);
  }
  function stopLoader() {
    clearInterval(state.loaderTimer);
    state.loaderTimer = null;
  }

  async function analyze() {
    if (!state.file || state.status === "loading") return;
    if (!getApiKey()) return openSettings();

    state.status = "loading";
    state.error = null;
    renderScanner();
    startLoader();
    try {
      const { analysis, warnings } = await analyzeImage(state.file);
      state.result = { analysis, warnings };
      state.status = "done";
      addHistory({
        id: newId(),
        createdAt: new Date().toISOString(),
        fileName: state.file.name || "capture.png",
        thumbnail: await makeThumbnail(state.file),
        analysis,
        warnings,
      });
    } catch (e) {
      state.error = e instanceof Error ? e.message : "Analyse impossible.";
      state.status = "error";
      if (e instanceof AppError && e.code === "NO_KEY") openSettings();
    } finally {
      stopLoader();
      renderScanner();
    }
  }

  /* =========================================================
   * Historique (localStorage)
   * ========================================================= */
  function loadHistory() {
    try {
      const arr = JSON.parse(local.get(CONFIG.KEYS.history) || "[]");
      if (!Array.isArray(arr)) return [];
      return arr.flatMap((e) => {
        try {
          return [{ ...e, analysis: validateAnalysis(e.analysis), warnings: Array.isArray(e.warnings) ? e.warnings : [] }];
        } catch {
          return [];
        }
      });
    } catch {
      return [];
    }
  }

  function persistHistory() {
    let list = state.history.slice(0, CONFIG.HISTORY_MAX);
    // Si le quota est dépassé, on retire les entrées les plus anciennes
    while (list.length && !local.set(CONFIG.KEYS.history, JSON.stringify(list))) list = list.slice(0, -1);
    if (!list.length) local.del(CONFIG.KEYS.history);
  }

  function addHistory(entry) {
    state.history = [entry, ...state.history].slice(0, CONFIG.HISTORY_MAX);
    persistHistory();
    renderTabs();
  }

  function clearHistory() {
    state.history = [];
    state.selectedId = null;
    local.del(CONFIG.KEYS.history);
    renderTabs();
    renderHistory();
  }

  function renderHistory() {
    const root = $("#history-root");
    const header = (extra = "") => `
      <div class="flex flex-wrap items-end justify-between gap-4">
        <header>
          <h1 class="text-3xl font-semibold tracking-tight">Historique des scans</h1>
          <p class="mt-2 text-muted">Tes analyses, enregistrées dans ce navigateur. Clique sur une ligne pour revoir le détail.</p>
        </header>${extra}
      </div>`;

    if (!state.history.length) {
      root.innerHTML = `${header()}
        <div class="glass mt-8 flex flex-col items-center px-6 py-20 text-center">
          <div class="grid size-12 place-items-center rounded-xl border border-line bg-ink">${icon("history", "size-5 text-muted")}</div>
          <p class="mt-5 font-medium">Aucun scan pour l’instant</p>
          <p class="mt-1 max-w-sm text-sm text-muted">Tes analyses apparaîtront ici, avec leur miniature et leur plan de trade.</p>
          <button data-nav="analyseur" class="btn-primary mt-6 h-10 px-4">${icon("scan-line")} Lancer une analyse</button>
        </div>`;
      refreshIcons();
      return;
    }

    const h = state.history;
    const count = (r) => h.filter((e) => e.analysis.recommendation === r).length;
    const avg = Math.round(h.reduce((s, e) => s + e.analysis.confidence_score, 0) / h.length);
    const stats = [
      ["Scans", h.length, "text-fg"],
      ["Achats", count("BUY"), "text-buy"],
      ["Ventes", count("SELL"), "text-sell"],
      ["Attentes", count("WAIT"), "text-wait"],
      ["Confiance moyenne", `${avg} %`, "text-accent"],
    ];
    const selected = h.find((e) => e.id === state.selectedId);

    root.innerHTML = `
      <div class="space-y-6">
        ${header(`<button data-action="clear-history" class="btn-outline h-8 px-3 text-xs">${icon("trash-2", "size-3.5")} Vider l’historique</button>`)}
        <dl class="grid grid-cols-2 gap-3 sm:grid-cols-5">
          ${stats.map(([l, v, c]) => `<div class="glass p-4"><dt class="text-xs text-muted">${l}</dt><dd class="mt-1 font-mono text-2xl font-medium ${c}">${v}</dd></div>`).join("")}
        </dl>
        <div class="glass overflow-x-auto">
          <table class="w-full min-w-[760px] text-sm">
            <thead><tr class="border-b border-line text-left text-xs text-muted">
              <th class="px-4 py-3 font-normal">Capture</th><th class="px-4 py-3 font-normal">Actif</th>
              <th class="px-4 py-3 font-normal">Date</th><th class="px-4 py-3 font-normal">Signal</th>
              <th class="px-4 py-3 text-right font-normal">Confiance</th><th class="px-4 py-3 text-right font-normal">R:R</th>
              <th class="px-4 py-3 font-normal">Statut</th>
            </tr></thead>
            <tbody>
              ${h
                .map((e) => {
                  const a = e.analysis;
                  const sel = e.id === state.selectedId;
                  const thumb =
                    typeof e.thumbnail === "string" && e.thumbnail.startsWith("data:image/")
                      ? `<img src="${esc(e.thumbnail)}" alt="" class="h-10 w-16 rounded-md border border-line object-cover" />`
                      : `<div class="h-10 w-16 rounded-md border border-line bg-ink"></div>`;
                  return `<tr data-action="select" data-id="${esc(e.id)}" tabindex="0" aria-selected="${sel}"
                    class="cursor-pointer border-b border-line/60 transition-colors last:border-0 ${sel ? "bg-accent/[0.06]" : "hover:bg-white/[0.03]"}">
                    <td class="px-4 py-3">${thumb}</td>
                    <td class="px-4 py-3"><p class="font-medium">${esc(a.asset_detected)}</p><p class="text-xs text-muted">${esc(a.timeframe_detected)}</p></td>
                    <td class="px-4 py-3 text-muted">${esc(formatDateTime(e.createdAt))}</td>
                    <td class="px-4 py-3">${badge(a.recommendation, DECISION[a.recommendation].badge)}</td>
                    <td class="px-4 py-3 text-right font-mono">${a.confidence_score} %</td>
                    <td class="px-4 py-3 text-right font-mono">${esc(a.trade_plan.risk_reward_ratio)}</td>
                    <td class="px-4 py-3">${
                      e.warnings.length
                        ? `<span class="text-xs text-wait">${e.warnings.length} alerte${e.warnings.length > 1 ? "s" : ""}</span>`
                        : `<span class="text-xs text-buy">Plan cohérent</span>`
                    }</td></tr>`;
                })
                .join("")}
            </tbody>
          </table>
        </div>
        ${
          selected
            ? `<div class="tab-enter space-y-3">
                <div class="flex items-center justify-between">
                  <h2 class="text-lg font-medium">Détail du scan</h2>
                  <button data-action="close-detail" class="btn-ghost h-8 px-3 text-xs">${icon("x", "size-3.5")} Fermer</button>
                </div>
                ${renderDashboard(selected.analysis, selected.warnings)}
              </div>`
            : ""
        }
      </div>`;
    refreshIcons();
  }

  /* =========================================================
   * Navigation par onglets (synchronisée avec #hash)
   * ========================================================= */
  const isTab = (id) => TABS.some((t) => t.id === id);

  function showTab(id, push = true) {
    if (!isTab(id)) id = "accueil";
    state.tab = id;
    $$("section[data-tab]").forEach((s) => {
      const on = s.dataset.tab === id;
      s.hidden = !on;
      if (on) {
        s.classList.remove("tab-enter");
        void s.offsetWidth; // relance l'animation
        s.classList.add("tab-enter");
      }
    });
    if (push && location.hash.slice(1) !== id) history.pushState(null, "", `#${id}`);
    if (id === "historique") renderHistory();
    renderTabs();
    window.scrollTo({ top: 0 });
  }

  /* =========================================================
   * Réglages (modale clé API)
   * ========================================================= */
  function setTestResult(kind, msg) {
    const el = $("#key-test-result");
    if (!kind) {
      el.className = "hidden text-sm";
      el.textContent = "";
      return;
    }
    el.className = `flex items-start gap-2 text-sm ${kind === "ok" ? "text-buy" : kind === "err" ? "text-sell" : "text-muted"}`;
    el.textContent = msg;
  }

  function openSettings() {
    $("#key-input").value = getApiKey();
    $("#key-input").type = "password";
    $("#model-input").value = getModel();
    $("#remember-input").checked = Boolean(local.get(CONFIG.KEYS.apiKey)) || !getApiKey();
    setTestResult(null);
    $("#settings").showModal();
  }

  function bindSettings() {
    const dialog = $("#settings");
    const keyInput = $("#key-input");
    const modelOf = () => $("#model-input").value.trim() || CONFIG.DEFAULT_MODEL;

    $("#key-status").addEventListener("click", openSettings);
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog || e.target.closest("[data-close]")) dialog.close();
    });

    $("#key-toggle").addEventListener("click", () => {
      const show = keyInput.type === "password";
      keyInput.type = show ? "text" : "password";
      $("#key-toggle").innerHTML = icon(show ? "eye-off" : "eye");
      $("#key-toggle").setAttribute("aria-label", show ? "Masquer la clé" : "Afficher la clé");
      refreshIcons();
    });

    $("#key-test").addEventListener("click", async () => {
      const key = keyInput.value.trim();
      if (!key) return setTestResult("err", "Saisis d’abord une clé.");
      const btn = $("#key-test");
      btn.disabled = true;
      setTestResult("info", "Test en cours…");
      try {
        await testKey(key, modelOf());
        setTestResult("ok", `Clé valide, modèle ${modelOf()} accessible.`);
      } catch (e) {
        setTestResult("err", e instanceof Error ? e.message : "Test impossible.");
      } finally {
        btn.disabled = false;
      }
    });

    $("#key-delete").addEventListener("click", () => {
      deleteApiKey();
      keyInput.value = "";
      renderKeyStatus();
      renderScanner();
      setTestResult("ok", "Clé supprimée de ce navigateur.");
    });

    $("#settings-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const key = keyInput.value.trim();
      if (key && !key.startsWith("sk-ant-")) return setTestResult("err", "Une clé Anthropic commence par « sk-ant- ».");
      if (key) saveApiKey(key, $("#remember-input").checked);
      local.set(CONFIG.KEYS.model, modelOf());
      dialog.close();
      renderKeyStatus();
      renderScanner();
    });
  }

  /* =========================================================
   * Événements
   * ========================================================= */
  function bindEvents() {
    // Navigation et actions (délégation)
    document.addEventListener("click", (e) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;

      const nav = target.closest("[data-nav]");
      if (nav) {
        e.preventDefault();
        showTab(nav.dataset.nav);
        return;
      }
      const demo = target.closest("[data-demo]");
      if (demo) {
        state.demo = demo.dataset.demo;
        renderDemo();
        return;
      }
      const el = target.closest("[data-action]");
      if (!el || el.disabled) return;
      switch (el.dataset.action) {
        case "analyze": analyze(); break;
        case "reset": resetScanner(); break;
        case "open-settings": openSettings(); break;
        case "clear-history": clearHistory(); break;
        case "close-detail": state.selectedId = null; renderHistory(); break;
        case "select":
          state.selectedId = state.selectedId === el.dataset.id ? null : el.dataset.id;
          renderHistory();
          break;
      }
    });

    // Entrée / Espace sur les éléments cliquables non-boutons
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const el = e.target instanceof Element ? e.target : null;
      if (el && (el.matches("tr[data-action]") || el.id === "dropzone")) {
        e.preventDefault();
        el.click();
      }
    });

    window.addEventListener("popstate", () => showTab(location.hash.slice(1), false));

    // Glisser-déposer
    const dz = $("#dropzone");
    const input = $("#file-input");
    dz.addEventListener("click", () => input.click());
    input.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("change", () => {
      selectFile(input.files && input.files[0]);
      input.value = "";
    });
    dz.addEventListener("dragover", (e) => {
      e.preventDefault();
      dz.dataset.drag = "true";
    });
    dz.addEventListener("dragleave", () => delete dz.dataset.drag);
    dz.addEventListener("drop", (e) => {
      e.preventDefault();
      delete dz.dataset.drag;
      selectFile(e.dataTransfer && e.dataTransfer.files[0]);
    });

    // Ctrl+V / Cmd+V depuis n'importe quel onglet
    window.addEventListener("paste", (e) => {
      if (e.target instanceof Element && e.target.closest("input, textarea, dialog")) return;
      const item = Array.from((e.clipboardData && e.clipboardData.items) || []).find((i) => i.type.startsWith("image/"));
      const file = item && item.getAsFile();
      if (!file) return;
      e.preventDefault();
      if (state.status === "loading") return;
      if (state.tab !== "analyseur") showTab("analyseur");
      selectFile(file);
    });
  }

  /* =========================================================
   * Démarrage
   * ========================================================= */
  function init() {
    state.history = loadHistory();
    renderStatic();
    renderDemo();
    renderKeyStatus();
    renderScanner();
    bindEvents();
    bindSettings();
    showTab(location.hash.slice(1), false);
  }

  init();
})();
