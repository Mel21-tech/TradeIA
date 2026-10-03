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
    KEYS: { apiKey: "tradeia:apiKey", model: "tradeia:model", history: "tradeia:history", risk: "tradeia:risk", style: "tradeia:style", mode: "tradeia:mode", macroManual: "tradeia:macro:manual", macroCache: "tradeia:macro:cache" },
  };

  /* ---------- Styles de trading : calibrent l'horizon du plan ---------- */
  const STYLES = {
    scalp: {
      label: "Scalping",
      tf: "1m – 5m",
      hint: "Exécution ultra-réactive, stop très serré, cibles de liquidité immédiate.",
      gapMax: 1.5,
      prompt: `# STYLE DEMANDÉ : SCALPING (1m – 5m)
- Horizon : quelques minutes à une heure au maximum. Le trade doit pouvoir être ouvert et clôturé dans la session en cours.
- Si l'image montre une unité de temps supérieure, elle ne sert qu'au biais : le plan vise la toute prochaine réaction du prix.
- Construis le plan sur les 15 à 30 dernières bougies uniquement.
- Entrée : "Market" ou un prix limite collé au prix actuel (retest immédiat de la micro-zone).
- Stop : très serré, juste derrière la mèche de la dernière bougie de rejet ou du micro-swing, soit environ 1 à 2 bougies moyennes.
- TP1 : la liquidité immédiate (dernier micro-sommet ou micro-creux). TP2 : la poche de liquidité suivante, au plus 2 fois la distance entrée-TP1.`,
    },
    day: {
      label: "Day trading",
      tf: "15m – 1h",
      hint: "Équilibré : sessions, retests de structures locales, issue dans la journée.",
      gapMax: 1.5,
      prompt: `# STYLE DEMANDÉ : DAY TRADING / INTRADAY (15m – 1h)
- Horizon : exécution et issue dans la journée, jamais un swing de plusieurs jours.
- Tiens compte des sessions (Asie, Londres, New York) : hauts et bas de session et ouvertures de Londres ou de New York sont des zones de liquidité.
- Sur 4h ou Daily, l'unité de temps ne sert qu'au contexte : le plan cherche la réaction sur les niveaux les plus proches du prix actuel.
- Construis le plan sur les 20 à 40 dernières bougies.
- Entrée : "Market" si le prix est déjà dans la zone, sinon le retest immédiat de la structure locale la plus proche.
- Stop : juste derrière la dernière invalidation locale (mèche du dernier swing, du sweep ou bord de l'order block), soit environ 1 à 3 bougies moyennes.
- TP1 : première poche de liquidité locale (prochain sommet ou creux, haut ou bas de session). TP2 : extension logique suivante, au plus 2 à 3 fois la distance entrée-TP1.`,
    },
    swing: {
      label: "Swing",
      tf: "4h – Daily",
      hint: "Suivi de la tendance de fond, objectifs sur plusieurs jours.",
      gapMax: 3,
      prompt: `# STYLE DEMANDÉ : SWING TRADING (4h – Daily)
- Horizon : plusieurs jours à quelques semaines, dans le sens de la tendance de fond.
- Priorité au biais macro : structure 4h et Daily, zones de premium et de discount du dernier grand swing, order blocks et FVG HTF.
- Entrée : sur la zone HTF la plus proche du prix actuel, dans le sens de la tendance. La distance prix actuel-entrée ne doit pas dépasser 2 fois la distance entrée-stop.
- Stop : derrière le swing structurel HTF qui invalide le scénario, pas derrière une simple mèche intraday.
- TP1 : prochaine liquidité HTF (sommet ou creux de swing). TP2 : objectif de tendance suivant (liquidité majeure ou extension), cohérent avec la structure.`,
    },
  };

  const MTF_PROMPT = `# MODE MULTI-TIMEFRAME (2 IMAGES)
- Image 1 = HTF (vue d'ensemble) : détermine le biais et les zones majeures.
- Image 2 = LTF (déclencheur) : sert à construire l'entrée, le stop et les objectifs.
- current_price, entry_price, stop_loss, take_profit_1 et take_profit_2 sont lus sur l'image LTF.
- Vérifie la confluence : le setup LTF doit aller dans le sens du biais HTF, ou réagir sur une zone HTF clé. En cas de conflit HTF/LTF, recommande "WAIT" et explique le conflit.
- timeframe_detected indique les deux unités de temps au format "HTF / LTF" (ex : "4h / 15m").
- Le "rationale" commence par une phrase sur l'alignement HTF/LTF.
- Si les deux images ne montrent pas le même actif, réponds avec l'erreur NOT_A_CHART en expliquant pourquoi.`;

  /** Construit le prompt système selon le style choisi et le mode (1 ou 2 images). */
  function buildSystemPrompt(styleId, multi) {
    const style = STYLES[styleId] || STYLES.day;
    return `Tu es un trader senior spécialisé en Price Action et Smart Money Concepts (SMC), sur crypto, forex, indices et actions. Tu analyses ${multi ? "DEUX captures d'écran du même actif sur deux unités de temps" : "UNE capture d'écran de graphique en chandeliers japonais"} et tu produis un plan d'exécution calibré sur le style de trading demandé.

# FORMAT DE SORTIE (OBLIGATOIRE)
- Tu réponds UNIQUEMENT en appelant un outil : "submit_trade_plan" avec le plan complet, ou "reject_image" si l'image n'est pas exploitable. Jamais de texte libre.
- Tous les prix sont des nombres (pas de chaînes, pas de séparateur de milliers, point comme séparateur décimal).
- Le champ "rationale" est rédigé en français.

Structure exacte :
{
  "asset_detected": "string (ex: BTC/USDT, EUR/USD, NVDA, ou \\"Inconnu\\")",
  "timeframe_detected": "string (ex: 5m, 15m, 1h, 4h, Daily, ou \\"Inconnu\\")",
  "current_price": number (dernier prix visible : clôture de la dernière bougie ou étiquette de prix sur l'axe),
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
Si l'image n'est PAS un graphique de prix exploitable (photo, texte, graphique illisible), appelle "reject_image" avec une raison courte en français.

# ÉCHELLE EN POURCENTAGE
Si l'axe de droite est en pourcentage (et non en prix), convertis chaque niveau en prix à partir du dernier prix affiché (étiquette ou en-tête du graphique). Si aucun prix absolu n'est lisible, appelle "reject_image" en demandant de repasser l'échelle en prix.

${style.prompt}
${multi ? `\n${MTF_PROMPT}\n` : ""}
# MÉTHODE D'ANALYSE (dans cet ordre)
1. Prix actuel : repère le dernier prix (dernière bougie, étiquette sur l'axe de droite). C'est la référence de tout le plan ; renseigne-le dans "current_price".
2. Contexte : actif, unité de temps et échelle de prix lus sur l'image. Si une information n'est pas lisible, écris "Inconnu" plutôt que de deviner.
3. Structure : sommets et creux (HH/HL haussier, LH/LL baissier), BOS et CHoCH. Une cassure n'est valide que si une bougie CLÔTURE au-delà du niveau, pas une simple mèche.
4. Cassures et retests : cassure d'un niveau, retest en cours, tenu ou échoué.
5. Liquidité : equal highs/lows, sommets et creux évidents, sweep suivi d'une réintégration.
6. Zones institutionnelles : order blocks et fair value gaps à portée, adaptés à l'horizon du style.
7. Rejets de mèches et figures de bougies sur ces niveaux.
8. Indicateurs visibles uniquement : n'invente jamais un indicateur absent de l'image.

# RÈGLES DU PLAN (NON NÉGOCIABLES)
- Respecte strictement l'horizon, l'entrée, le stop et les objectifs définis par le style demandé ci-dessus.
- Sauf indication contraire du style, la distance entre current_price et entry_price ne dépasse jamais la distance entre entry_price et stop_loss. Si le seul setup valable exige un repli plus profond, recommande "WAIT".
- BUY : stop_loss < entry_price < take_profit_1 < take_profit_2.
- SELL : stop_loss > entry_price > take_profit_1 > take_profit_2.
- Avec "Market", ces règles s'appliquent par rapport à current_price.
- Le ratio risque/rendement vers take_profit_1 doit être d'au moins 1:1,5. Sinon, recommande "WAIT".
- risk_reward_ratio est calculé vers take_profit_2 : |TP2 - entrée| / |entrée - SL|, arrondi à une décimale, au format "1:X".
- Recommande "WAIT" si : range sans biais, signaux contradictoires, prix loin de toute zone clé, ou setup non confirmé. Fournis alors un plan CONDITIONNEL, au plus près du prix actuel, et précise la condition de déclenchement dans "rationale".

# CALIBRATION DE LA CONFIANCE
- 80-100 : confluence forte (structure + liquidité + zone institutionnelle + confirmation bougie), R:R ≥ 1:2.
- 60-79 : setup propre mais une confluence manque.
- 40-59 : setup spéculatif ou lecture partielle de l'image.
- 0-39 : lecture très incertaine. Recommande alors "WAIT".
Baisse la confiance si l'échelle de prix est difficile à lire, si l'unité de temps est inconnue, ou si peu de bougies sont visibles.

# RÉDACTION DU "rationale"
4 à 8 phrases, factuelles et précises : prix actuel et structure, déclencheur, logique du stop, cibles TP1 et TP2, puis le scénario d'invalidation. Pas de promesse de gain, pas de langage émotionnel.`;
  }

  const USER_PROMPT = "Analyse ce graphique et renvoie uniquement le JSON demandé.";
  const USER_PROMPT_MTF =
    "Image 1 = HTF (vue d'ensemble), image 2 = LTF (déclencheur). Analyse la confluence entre les deux et renvoie uniquement le JSON demandé.";

  /* ---------- Journal de trading ---------- */
  const STATUSES = {
    pending: { label: "En attente", cls: "text-zinc-300" },
    open: { label: "En cours", cls: "text-accent" },
    tp1: { label: "TP1 touché", cls: "text-[#34d399]" },
    tp2: { label: "TP2 touché", cls: "text-[#34d399]" },
    sl: { label: "Stoppé (SL)", cls: "text-[#fb7185]" },
    cancelled: { label: "Annulé", cls: "text-zinc-500" },
  };

  const CHECKLIST = [
    "Structure de marché alignée (BOS/CHoCH validé en clôture)",
    "Sweep de liquidité visible (rejet de mèche net)",
    "Retest propre d’un order block ou d’un FVG",
    "Ratio R:R supérieur ou égal à 1:2",
    "Aucune annonce macroéconomique majeure imminente",
  ];

  const TABS = [
    { id: "accueil", label: "Accueil", icon: "house" },
    { id: "analyseur", label: "Analyseur", icon: "scan-line" },
    { id: "methode", label: "Stratégie & méthode", icon: "book-open" },
    { id: "historique", label: "Journal", icon: "notebook-pen" },
  ];
  const FLOW = ["Contexte", "Structure", "Cassures", "Liquidité", "OB & FVG", "Bougies", "Indicateurs"];
  const TIPS = [
    "L’axe des prix doit être visible et lisible.",
    "Garde entre 50 et 200 bougies à l’écran.",
    "Affiche le nom de l’actif et l’unité de temps.",
    "Évite les captures surchargées d’indicateurs.",
  ];
  const LOADER_STEPS = [
    "Lecture de l’échelle de prix…",
    "Détection des structures…",
    "Cartographie de la liquidité…",
    "Calcul du Risk/Reward…",
    "Validation institutionnelle…",
  ];

  /** Exemples fictifs pour l'aperçu de la page d'accueil. */
  const DEMOS = {
    BUY: {
      label: "BTC/USDT",
      analysis: {
        asset_detected: "BTC/USDT",
        timeframe_detected: "15m",
        current_price: 67310,
        trend: "Bullish",
        key_patterns: ["Liquidity sweep", "BOS haussier", "Order block 15m", "Bullish engulfing"],
        support_levels: [67080, 66900],
        resistance_levels: [67560, 67900],
        recommendation: "BUY",
        confidence_score: 74,
        trade_plan: { entry_price: 67250, stop_loss: 67080, take_profit_1: 67560, take_profit_2: 67900, risk_reward_ratio: "1:3.8" },
        rationale:
          "Le prix évolue à 67 310 après un BOS haussier validé en clôture au-dessus de 67 200. Le dernier repli a balayé les equal lows de 67 100 puis a réintégré la zone, signe d'absorption acheteuse. L'entrée se place sur le retest immédiat de l'order block 15m à 67 250, à quelques dollars du prix actuel. Le stop est serré sous la mèche du sweep à 67 080. TP1 vise le sommet local de 67 560, TP2 la liquidité suivante à 67 900. Une clôture 15m sous 67 080 invaliderait le scénario.",
      },
    },
    SELL: {
      label: "EUR/USD",
      analysis: {
        asset_detected: "EUR/USD",
        timeframe_detected: "5m",
        current_price: 1.087,
        trend: "Bearish",
        key_patterns: ["CHoCH baissier", "Retest de cassure", "Fair value gap", "Pin bar"],
        support_levels: [1.0858, 1.0846],
        resistance_levels: [1.088, 1.0888],
        recommendation: "SELL",
        confidence_score: 66,
        trade_plan: { entry_price: 1.0872, stop_loss: 1.088, take_profit_1: 1.0858, take_profit_2: 1.0846, risk_reward_ratio: "1:3.3" },
        rationale:
          "Le prix cote 1,0870 après avoir cassé en clôture le dernier creux local à 1,0866, ce qui marque un changement de caractère baissier. Le rebond en cours comble le fair value gap et retest l'ancien support à 1,0872, où une pin bar rejette la zone. Le stop est placé juste au-dessus du dernier sommet inférieur à 1,0880. TP1 cible le creux local de 1,0858, TP2 la liquidité suivante à 1,0846. Une clôture 5m au-dessus de 1,0880 annulerait le setup.",
      },
    },
    WAIT: {
      label: "NVDA",
      analysis: {
        asset_detected: "NVDA",
        timeframe_detected: "1h",
        current_price: 118.9,
        trend: "Neutral",
        key_patterns: ["Range", "Equal highs", "Compression"],
        support_levels: [117.6, 117.1],
        resistance_levels: [119.8, 121],
        recommendation: "WAIT",
        confidence_score: 42,
        trade_plan: { entry_price: 118.4, stop_loss: 117.6, take_profit_1: 119.8, take_profit_2: 121, risk_reward_ratio: "1:3.3" },
        rationale:
          "Le titre cote 118,9 au milieu d'un petit range entre 117,6 et 119,8, sans biais clair sur les dernières bougies. Entrer maintenant offrirait un ratio risque/rendement médiocre. Le plan est conditionnel : achat uniquement si le prix revient tester 118,4 et y laisse une mèche de rejet. Le stop serait sous le bas du range à 117,6. TP1 vise les equal highs à 119,8, TP2 l'extension à 121. Une clôture horaire sous 117,6 annulerait ce scénario.",
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
  const refreshIcons = () => {
    if (window.lucide) window.lucide.createIcons();
    updateCalculators();
  };

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
      current_price: num(j.current_price),
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

  /** Entrée effective : prix limite, ou prix actuel si l'entrée est "Market". */
  function effectiveEntry(a) {
    const e = a.trade_plan.entry_price;
    return e === "Market" ? (a.current_price ?? null) : e;
  }

  function checkTradePlan(a, styleId = "day") {
    const gapMax = (STYLES[styleId] || STYLES.day).gapMax;
    const w = [];
    const { entry_price, stop_loss: sl, take_profit_1: tp1, take_profit_2: tp2 } = a.trade_plan;
    const entry = effectiveEntry(a);

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
    const cur = a.current_price;
    if (cur != null && entry_price !== "Market") {
      const risk = Math.abs(entry_price - sl);
      const gap = Math.abs(entry_price - cur);
      if (risk > 0 && gap > risk * gapMax) {
        w.push(`Entrée éloignée du prix actuel (${((gap / cur) * 100).toFixed(2)} %) : setup peu réactif, l’ordre risque de ne pas être exécuté.`);
      }
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

  /* ---------- Sortie structurée garantie via « tool use » ---------- */
  const PRICE = { type: "number", description: "Prix (nombre, point décimal, sans séparateur de milliers)" };
  const ANALYSIS_TOOLS = [
    {
      name: "submit_trade_plan",
      description: "Enregistre l'analyse technique et le plan de trade du graphique.",
      input_schema: {
        type: "object",
        properties: {
          asset_detected: { type: "string" },
          timeframe_detected: { type: "string" },
          current_price: PRICE,
          trend: { type: "string", enum: ["Bullish", "Bearish", "Neutral"] },
          key_patterns: { type: "array", items: { type: "string" } },
          support_levels: { type: "array", items: PRICE },
          resistance_levels: { type: "array", items: PRICE },
          recommendation: { type: "string", enum: ["BUY", "SELL", "WAIT"] },
          confidence_score: { type: "number", description: "0 à 100" },
          trade_plan: {
            type: "object",
            properties: {
              entry_price: { type: ["number", "string"], description: 'Prix limite (nombre) ou "Market"' },
              stop_loss: PRICE,
              take_profit_1: PRICE,
              take_profit_2: PRICE,
              risk_reward_ratio: { type: "string", description: 'Format "1:X"' },
            },
            required: ["entry_price", "stop_loss", "take_profit_1", "take_profit_2", "risk_reward_ratio"],
          },
          rationale: { type: "string", description: "4 à 8 phrases en français" },
        },
        required: [
          "asset_detected", "timeframe_detected", "current_price", "trend", "key_patterns",
          "support_levels", "resistance_levels", "recommendation", "confidence_score", "trade_plan", "rationale",
        ],
      },
    },
    {
      name: "reject_image",
      description: "À utiliser si l'image n'est pas un graphique de prix exploitable.",
      input_schema: {
        type: "object",
        properties: { message: { type: "string", description: "Raison courte en français" } },
        required: ["message"],
      },
    },
  ];

  /** Envoie 1 image, ou 2 images (HTF puis LTF) avec leurs libellés, au modèle vision. */
  async function analyzeImages(images, styleId, multi) {
    const content = [];
    for (const img of images) {
      if (img.label) content.push({ type: "text", text: img.label });
      content.push({ type: "image", source: { type: "base64", media_type: img.file.type, data: await fileToBase64(img.file) } });
    }
    content.push({ type: "text", text: multi ? USER_PROMPT_MTF : USER_PROMPT });

    const data = await callClaude({
      model: getModel(),
      max_tokens: 3000,
      system: buildSystemPrompt(styleId, multi),
      tools: ANALYSIS_TOOLS,
      tool_choice: { type: "any" }, // oblige le modèle à répondre via un outil : JSON toujours valide
      messages: [{ role: "user", content }],
    });
    const blocks = data && Array.isArray(data.content) ? data.content : [];
    const call = blocks.find((b) => b.type === "tool_use");

    let json;
    if (call) {
      if (call.name === "reject_image") {
        const msg = call.input && typeof call.input.message === "string" ? call.input.message : "";
        throw new AppError(msg || "Cette image n’est pas un graphique exploitable.", "NOT_A_CHART");
      }
      json = call.input;
    } else {
      // Repli : ancien format texte
      const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      try {
        json = extractJson(text);
      } catch {
        const extract = text.trim().slice(0, 220);
        throw new AppError(extract ? `L’IA n’a pas renvoyé de plan : « ${extract}${text.length > 220 ? "…" : ""} »` : "Réponse vide de l’IA. Relance l’analyse.", "PARSE");
      }
      if (json && json.error === "NOT_A_CHART") {
        throw new AppError(typeof json.message === "string" ? json.message : "Cette image n’est pas un graphique exploitable.", "NOT_A_CHART");
      }
    }
    if (data && data.stop_reason === "max_tokens") {
      throw new AppError("La réponse de l’IA a été coupée (trop longue). Relance l’analyse.", "PARSE");
    }
    const analysis = validateAnalysis(json);
    return { analysis, warnings: checkTradePlan(analysis, styleId) };
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
    style: "day", // scalp | day | swing
    mode: "single", // single | mtf
    slots: { main: null, htf: null, ltf: null },
    pickSlot: null,
    status: "idle", // idle | ready | loading | done | error
    result: null,
    error: null,
    loaderStep: 0,
    loaderTimer: null,
    loaderStart: 0,
    history: [],
    demo: "BUY",
    macro: { auto: [], manual: [], source: "loading" },
  };

  /* =========================================================
   * Rendu : dashboard de résultats
   * ========================================================= */
  const DECISION = {
    BUY: {
      label: "Signal d’achat",
      hex: "#10b981",
      text: "text-buy",
      badge: "border-buy/30 bg-buy/10 text-buy",
      pill: "border-buy/40 bg-buy/[0.12] text-[#34d399] shadow-[0_0_48px_-10px_rgb(16_185_129/0.8)]",
      glow: "rgb(16 185 129 / 0.20)",
    },
    SELL: {
      label: "Signal de vente",
      hex: "#e11d48",
      text: "text-sell",
      badge: "border-sell/30 bg-sell/10 text-sell",
      pill: "border-sell/40 bg-sell/[0.12] text-[#fb7185] shadow-[0_0_48px_-10px_rgb(225_29_72/0.8)]",
      glow: "rgb(225 29 72 / 0.18)",
    },
    WAIT: {
      label: "Pas de setup",
      hex: "#f59e0b",
      text: "text-wait",
      badge: "border-wait/30 bg-wait/10 text-wait",
      pill: "border-wait/40 bg-wait/[0.12] text-[#fbbf24] shadow-[0_0_48px_-10px_rgb(245_158_11/0.7)]",
      glow: "rgb(245 158 11 / 0.14)",
    },
  };
  const TREND = {
    Bullish: { label: "Tendance haussière", icon: "trending-up" },
    Bearish: { label: "Tendance baissière", icon: "trending-down" },
    Neutral: { label: "Tendance neutre", icon: "move-right" },
  };
  const badge = (content, cls = "border-white/[0.08] bg-white/[0.04] text-zinc-300") =>
    `<span class="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${cls}">${content}</span>`;

  const pctOf = (diff, base) =>
    base ? `${((Math.abs(diff) / Math.abs(base)) * 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %` : "";
  const signed = (d) => `${d >= 0 ? "+" : "−"}${formatPrice(Math.abs(d))}`;

  /** Jauge radiale 270° pour le score de confiance. */
  function gauge(score, hex) {
    const r = 34;
    const c = 2 * Math.PI * r;
    const track = c * 0.75;
    const val = (track * score) / 100;
    return `
      <div class="relative size-32 shrink-0" role="img" aria-label="Confiance ${score} sur 100">
        <svg viewBox="0 0 80 80" class="size-full" style="transform:rotate(135deg)">
          <circle cx="40" cy="40" r="${r}" fill="none" stroke="rgb(255 255 255 / 0.06)" stroke-width="5" stroke-linecap="round" style="stroke-dasharray:${track} ${c}" />
          <circle cx="40" cy="40" r="${r}" fill="none" stroke="${hex}" stroke-width="5" stroke-linecap="round"
            class="gauge-arc" style="stroke-dasharray:${val} ${c};filter:drop-shadow(0 0 6px ${hex}99)" />
        </svg>
        <div class="absolute inset-0 grid place-items-center text-center">
          <div>
            <p class="font-mono text-3xl font-medium tracking-tight">${score}</p>
            <p class="text-[11px] text-zinc-500">confiance</p>
          </div>
        </div>
      </div>`;
  }

  function metric(label, iconName, value, sub, color = "text-fg") {
    return `
      <div class="glass metric p-4">
        <div class="flex items-center justify-between text-xs text-zinc-500">
          <span>${label}</span>${icon(iconName, "size-3.5")}
        </div>
        <p class="mt-3 font-mono text-[22px] font-medium leading-none tracking-tight ${color}">${value}</p>
        <p class="mt-2 truncate font-mono text-[11px] text-zinc-500">${sub}</p>
      </div>`;
  }

  /** Échelle verticale à l'échelle réelle avec zones de risque et de gain. */
  function priceLadder(plan, entry = null, current = null) {
    const levels = [
      { label: "TP2", value: plan.take_profit_2, hex: "#10b981", text: "text-buy" },
      { label: "TP1", value: plan.take_profit_1, hex: "#34d399", text: "text-buy" },
      { label: "SL", value: plan.stop_loss, hex: "#e11d48", text: "text-sell" },
    ];
    if (entry !== null) levels.push({ label: "Entrée", value: entry, hex: "#22d3ee", text: "text-accent" });
    if (current != null) {
      const span = Math.max(...levels.map((l) => l.value)) - Math.min(...levels.map((l) => l.value)) || 1;
      if (entry === null || Math.abs(current - entry) / span > 0.06) {
        levels.push({ label: "Prix", value: current, hex: "#a1a1aa", text: "text-zinc-400" });
      }
    }

    const values = levels.map((l) => l.value);
    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min || 1;
    const top = (v) => 7 + ((max - v) / range) * 86;
    const zoneLeft = "calc(3.75rem + 5px)";

    let zones = "";
    if (entry !== null) {
      const e = top(entry);
      const s = top(plan.stop_loss);
      const t = top(plan.take_profit_2);
      zones = `
        <div class="absolute right-0 rounded-r-md bg-sell/[0.08]" style="left:${zoneLeft};top:${Math.min(e, s)}%;height:${Math.abs(s - e)}%"></div>
        <div class="absolute right-0 rounded-r-md bg-buy/[0.07]" style="left:${zoneLeft};top:${Math.min(e, t)}%;height:${Math.abs(t - e)}%"></div>`;
    }

    return `
      <div class="relative h-72 w-full" aria-label="Échelle des niveaux du plan">
        ${zones}
        <div class="absolute inset-y-0 w-px bg-white/[0.08]" style="left:${zoneLeft}"></div>
        ${levels
          .map((l) => {
            const dist = entry !== null && l.label !== "Entrée" && l.label !== "Prix" ? `${l.value >= entry ? "+" : "−"}${pctOf(l.value - entry, entry)}` : "";
            return `
              <div class="absolute inset-x-0 flex -translate-y-1/2 items-center gap-3" style="top:${top(l.value)}%">
                <span class="w-12 text-right text-[11px] font-medium tracking-wide ${l.text}">${l.label}</span>
                <span class="size-2.5 shrink-0 rounded-full border-2 bg-ink" style="border-color:${l.hex};box-shadow:0 0 10px ${l.hex}"></span>
                <span class="h-px flex-1" style="background:linear-gradient(90deg, ${l.hex}, transparent)"></span>
                <span class="text-right">
                  <span class="font-mono text-sm">${formatPrice(l.value)}</span>
                  ${dist ? `<span class="ml-2 font-mono text-[11px] text-zinc-500">${dist}</span>` : ""}
                </span>
              </div>`;
          })
          .join("")}
        ${entry === null ? `<p class="absolute bottom-0 pl-3 text-xs text-zinc-500" style="left:${zoneLeft}">Entrée au prix du marché</p>` : ""}
      </div>`;
  }

  function levelList(title, values, cls) {
    const sorted = [...values].sort((x, y) => y - x);
    return `
      <div>
        <h3 class="mb-3 text-xs text-zinc-500">${title}</h3>
        <div class="flex flex-wrap gap-1.5">
          ${sorted.length ? sorted.map((v) => badge(formatPrice(v), `${cls} font-mono`)).join("") : `<span class="text-sm text-zinc-600">Aucun</span>`}
        </div>
      </div>`;
  }

  function renderDashboard(a, warnings, meta = {}) {
    const d = DECISION[a.recommendation];
    const t = TREND[a.trend];
    const plan = a.trade_plan;
    const isMarket = plan.entry_price === "Market";
    const entry = effectiveEntry(a);
    const cur = a.current_price;
    const rr = (tp) => (entry !== null ? computeRR(entry, plan.stop_loss, tp) : null);
    const rrFmt = (v) => (v === null ? "" : `${v.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} R`);
    const realRR = rr(plan.take_profit_2);

    const metrics = [
      metric(
        "Prix d’entrée",
        "crosshair",
        isMarket ? "Market" : formatPrice(entry),
        isMarket
          ? entry !== null ? `≈ ${formatPrice(entry)} actuellement` : "Au prix du marché"
          : cur != null ? `Prix actuel ${formatPrice(cur)}` : "Ordre limite",
        "text-accent",
      ),
      metric(
        "Stop loss",
        "octagon-x",
        formatPrice(plan.stop_loss),
        entry === null ? "Invalidation" : `Risque ${signed(plan.stop_loss - entry)} · ${pctOf(plan.stop_loss - entry, entry)}`,
        "text-[#fb7185]",
      ),
      metric(
        "Take profit 1",
        "target",
        formatPrice(plan.take_profit_1),
        entry === null ? "Objectif 1" : `${signed(plan.take_profit_1 - entry)} · ${rrFmt(rr(plan.take_profit_1))}`,
        "text-[#34d399]",
      ),
      metric(
        "Take profit 2",
        "target",
        formatPrice(plan.take_profit_2),
        entry === null ? "Objectif 2" : `${signed(plan.take_profit_2 - entry)} · ${rrFmt(realRR)}`,
        "text-[#34d399]",
      ),
      metric(
        "Ratio R:R",
        "scale",
        esc(plan.risk_reward_ratio),
        realRR !== null ? `Recalculé 1:${realRR.toFixed(1)}` : "Non recalculable",
      ),
    ].join("");

    return `
      <div class="space-y-3">
        <!-- Verdict -->
        <div class="glass relative overflow-hidden">
          <div aria-hidden="true" class="pointer-events-none absolute inset-0" style="background:radial-gradient(600px circle at 0% 0%, ${d.glow}, transparent 60%)"></div>
          <div aria-hidden="true" class="absolute inset-x-0 top-0 h-px" style="background:linear-gradient(90deg, transparent, ${d.hex}, transparent)"></div>
          <div class="relative flex flex-wrap items-center justify-between gap-8 p-6 sm:p-8">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                ${badge(esc(a.asset_detected), "border-white/[0.1] bg-white/[0.05] text-fg")}
                ${badge(esc(a.timeframe_detected))}
                ${badge(`${icon(t.icon, "size-3")} ${t.label}`)}
                ${meta.style && STYLES[meta.style] ? badge(`${icon("gauge", "size-3")} ${STYLES[meta.style].label}`, "border-accent/25 bg-accent/[0.08] text-accent") : ""}
                ${meta.mode === "mtf" ? badge(`${icon("layers", "size-3")} Multi-TF`, "border-accent/25 bg-accent/[0.08] text-accent") : ""}
              </div>
              <div class="mt-6 flex flex-wrap items-center gap-5">
                <span class="verdict-pill rounded-2xl border px-6 py-2.5 font-mono text-5xl font-semibold tracking-tight sm:text-6xl ${d.pill}">${a.recommendation}</span>
                <div>
                  <p class="flex items-center gap-2 font-medium"><span class="pulse-dot" style="background:${d.hex}"></span>${d.label}</p>
                  <p class="mt-1 text-sm text-zinc-500">Plan généré${meta.model ? ` par ${esc(modelLabel(meta.model))}` : ""}</p>
                </div>
              </div>
            </div>
            <div class="flex flex-col items-center gap-3">
              ${gauge(a.confidence_score, d.hex)}
              <button data-action="copy-setup" data-setup="${esc(setupText(a, entry))}" class="btn-outline h-8 px-3 text-xs" title="Copier le setup dans le presse-papier">
                ${icon("clipboard-copy", "size-3.5")}<span>Copier le setup</span>
              </button>
            </div>
          </div>
        </div>

        ${
          warnings.length
            ? `<div class="space-y-1.5 rounded-xl border border-wait/25 bg-wait/[0.05] p-4 text-sm">
                ${warnings.map((w) => `<p class="flex gap-2 text-[#fbbf24]">${icon("triangle-alert", "mt-0.5 size-4 shrink-0")} ${esc(w)}</p>`).join("")}
              </div>`
            : ""
        }

        <!-- Métriques -->
        <div class="grid grid-cols-2 gap-3 lg:grid-cols-5">${metrics}</div>

        <!-- Calculateur -->
        ${calculator(a, entry)}

        <!-- Ladder + niveaux -->
        <div class="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
          <div class="glass p-5">
            <div class="mb-4 flex items-center justify-between">
              <h3 class="text-sm font-medium">Structure du trade</h3>
              <span class="font-mono text-[11px] text-zinc-500">à l’échelle</span>
            </div>
            ${priceLadder(plan, entry, cur)}
          </div>
          <div class="glass space-y-6 p-5">
            ${levelList("Résistances", a.resistance_levels, "border-sell/25 bg-sell/[0.08] text-[#fb7185]")}
            ${levelList("Supports", a.support_levels, "border-buy/25 bg-buy/[0.08] text-[#34d399]")}
            <div>
              <h3 class="mb-3 text-xs text-zinc-500">Figures détectées</h3>
              <div class="flex flex-wrap gap-1.5">
                ${a.key_patterns.length ? a.key_patterns.map((p) => badge(esc(p))).join("") : `<span class="text-sm text-zinc-600">Aucune</span>`}
              </div>
            </div>
          </div>
        </div>

        <!-- Rationale façon terminal -->
        <div class="glass overflow-hidden">
          <div class="flex items-center gap-2 border-b border-white/[0.06] bg-white/[0.02] px-5 py-2.5 font-mono text-[11px] text-zinc-500">
            ${icon("terminal", "size-3.5 text-accent")}
            <span>analyste@tradeia:~/rationale</span>
            <span class="ml-auto hidden sm:inline">${esc(a.asset_detected)} · ${esc(a.timeframe_detected)}</span>
          </div>
          <div class="p-5 sm:p-6">
            <p class="font-mono text-xs text-accent">$ explain --plan ${a.recommendation.toLowerCase()}</p>
            <blockquote class="mt-3 max-w-3xl border-l-2 pl-4 text-[15px] leading-relaxed text-zinc-300" style="border-color:${d.hex}66">${esc(a.rationale)}</blockquote>
            <p class="mt-4 font-mono text-xs text-zinc-600">$ <span class="caret"></span></p>
          </div>
        </div>

        ${meta.entryId ? checklistHtml(meta.entryId) : ""}
      </div>`;
  }

  /* =========================================================
   * Copier le setup
   * ========================================================= */
  const plainPrice = (n) => formatPrice(n).replace(/[\u202f\u00a0]/g, " ");

  function setupText(a, entry) {
    const p = a.trade_plan;
    const pct = (v) => (entry ? ` (${v >= entry ? "+" : "-"}${((Math.abs(v - entry) / entry) * 100).toFixed(1)}%)` : "");
    const rr = entry !== null ? computeRR(entry, p.stop_loss, p.take_profit_2) : null;
    return [
      `[${a.recommendation}] ${a.asset_detected}`,
      `Entrée : ${p.entry_price === "Market" ? `Market${entry !== null ? ` (~${plainPrice(entry)})` : ""}` : plainPrice(entry)}`,
      `Stop : ${plainPrice(p.stop_loss)}${pct(p.stop_loss)}`,
      `TP1 : ${plainPrice(p.take_profit_1)}${pct(p.take_profit_1)}`,
      `TP2 : ${plainPrice(p.take_profit_2)}${pct(p.take_profit_2)}`,
      `R:R : ${rr !== null ? `1:${rr.toFixed(1)}` : p.risk_reward_ratio}`,
    ].join("\n");
  }

  async function copySetup(btn) {
    const text = btn.dataset.setup || "";
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      document.body.appendChild(ta);
      ta.select();
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      ta.remove();
    }
    if (!btn.dataset.orig) btn.dataset.orig = btn.innerHTML;
    btn.innerHTML = ok
      ? `${icon("check", "size-3.5 text-buy")}<span>Copié</span>`
      : `${icon("x", "size-3.5 text-sell")}<span>Copie impossible</span>`;
    refreshIcons();
    clearTimeout(Number(btn.dataset.timer));
    btn.dataset.timer = String(
      setTimeout(() => {
        btn.innerHTML = btn.dataset.orig;
      }, 1600),
    );
  }

  /* =========================================================
   * Calculateur de position
   * ========================================================= */
  const FIAT = ["EUR", "USD", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD"];
  const parseNum = (v) => Number(String(v).replace(/[\s\u202f\u00a0]/g, "").replace(",", "."));

  function getRiskSettings() {
    let s = {};
    try { s = JSON.parse(local.get(CONFIG.KEYS.risk) || "{}") || {}; } catch { s = {}; }
    return {
      capital: typeof s.capital === "number" ? s.capital : 10000,
      riskPct: typeof s.riskPct === "number" ? s.riskPct : 1,
      currency: s.currency === "$" ? "$" : "€",
    };
  }

  function baseUnit(asset) {
    const a = String(asset || "");
    if (!a || a === "Inconnu") return "unités";
    return a.includes("/") ? a.split("/")[0] : a;
  }
  function isForex(asset) {
    const m = String(asset || "").toUpperCase().match(/^([A-Z]{3})\/?([A-Z]{3})$/);
    return Boolean(m && FIAT.includes(m[1]) && FIAT.includes(m[2]));
  }

  function calculator(a, entry) {
    const p = a.trade_plan;
    const s = getRiskSettings();
    const inputVal = (n) => n.toLocaleString("fr-FR", { maximumFractionDigits: 4 });
    const field = (label, name, value, suffix) => `
      <label class="block">
        <span class="text-xs text-zinc-500">${label}</span>
        <span class="calc-field mt-1.5 flex h-10 items-center rounded-[10px] border border-white/[0.1] bg-ink pr-1">
          <input data-calc-input="${name}" inputmode="decimal" autocomplete="off" spellcheck="false" value="${value}"
                 class="h-full w-full min-w-0 bg-transparent px-3 font-mono text-sm text-fg outline-none" />
          ${suffix}
        </span>
      </label>`;
    const currency = `<select data-calc-input="currency" aria-label="Devise" class="h-8 cursor-pointer rounded-md border-0 bg-white/[0.05] px-2 text-xs text-zinc-300 outline-none">
        ${["€", "$"].map((c) => `<option value="${c}" ${c === s.currency ? "selected" : ""}>${c}</option>`).join("")}
      </select>`;
    const out = (label, key, cls) => `
      <div class="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
        <p class="text-[11px] text-zinc-500">${label}</p>
        <p data-out="${key}" class="mt-1.5 truncate font-mono text-lg font-medium tracking-tight ${cls}">—</p>
        <p data-out="${key}-sub" class="mt-0.5 truncate font-mono text-[11px] text-zinc-500"></p>
      </div>`;

    return `
      <div class="glass p-5" data-calc data-entry="${entry ?? ""}" data-sl="${p.stop_loss}" data-tp1="${p.take_profit_1}" data-tp2="${p.take_profit_2}" data-asset="${esc(a.asset_detected)}">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="flex items-center gap-2 text-sm font-medium">${icon("calculator", "size-4 text-accent")} Calculateur de position</h3>
          ${a.recommendation === "WAIT" ? `<span class="text-xs text-[#fbbf24]">Plan conditionnel</span>` : ""}
        </div>
        <div class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,15rem)_1fr]">
          <div class="grid grid-cols-2 gap-3 lg:grid-cols-1">
            ${field("Capital", "capital", inputVal(s.capital), currency)}
            ${field("Risque par trade", "riskPct", inputVal(s.riskPct), `<span class="px-3 font-mono text-xs text-zinc-500">%</span>`)}
          </div>
          <div class="grid grid-cols-2 gap-3">
            ${out("Perte max tolérée", "loss", "text-[#fb7185]")}
            ${out("Taille de position", "size", "text-accent")}
            ${out("Gain estimé TP1", "g1", "text-[#34d399]")}
            ${out("Gain estimé TP2", "g2", "text-[#34d399]")}
          </div>
        </div>
        <p class="mt-3 text-[11px] text-zinc-600">Hors frais, spread et slippage. Les montants sont exprimés dans la devise de cotation de l’actif.</p>
      </div>`;
  }

  /** Recalcule tous les calculateurs affichés (scanner, démo, détail d'historique). */
  function updateCalculators() {
    const s = getRiskSettings();
    const money = (n) => `${n.toLocaleString("fr-FR", { maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 2 })} ${s.currency}`;
    const sizeFmt = (n) =>
      n >= 1000
        ? n.toLocaleString("fr-FR", { maximumFractionDigits: 0 })
        : n >= 1
          ? n.toLocaleString("fr-FR", { maximumFractionDigits: 2 })
          : n.toLocaleString("fr-FR", { maximumSignificantDigits: 4 });

    $$("[data-calc]").forEach((c) => {
      const set = (k, v, sub = "") => {
        c.querySelector(`[data-out="${k}"]`).textContent = v;
        c.querySelector(`[data-out="${k}-sub"]`).textContent = sub;
      };
      const entry = c.dataset.entry === "" ? null : Number(c.dataset.entry);
      const sl = Number(c.dataset.sl);
      const tp1 = Number(c.dataset.tp1);
      const tp2 = Number(c.dataset.tp2);
      const valid = s.capital > 0 && s.riskPct > 0;

      if (!valid) {
        set("loss", "—", "Saisis un capital et un risque");
        ["size", "g1", "g2"].forEach((k) => set(k, "—"));
        return;
      }
      const loss = (s.capital * s.riskPct) / 100;
      set("loss", money(loss), `${s.riskPct.toLocaleString("fr-FR")} % de ${money(s.capital)}`);

      const dist = entry !== null ? Math.abs(entry - sl) : 0;
      if (entry === null || !dist) {
        set("size", "—", entry === null ? "Prix d’entrée inconnu" : "Stop égal à l’entrée");
        set("g1", "—");
        set("g2", "—");
        return;
      }
      const size = loss / dist;
      const exposure = size * entry;
      const lev = exposure / s.capital;
      const lots = isForex(c.dataset.asset) ? ` · ${(size / 100000).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} lot` : "";
      set("size", `${sizeFmt(size)} ${baseUnit(c.dataset.asset)}`, `Exposition ${money(exposure)}${lev > 1 ? ` · levier ×${lev.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}` : ""}${lots}`);
      set("g1", `+${money(size * Math.abs(tp1 - entry))}`, `${rrLabel(Math.abs(tp1 - entry) / dist)}`);
      set("g2", `+${money(size * Math.abs(tp2 - entry))}`, `${rrLabel(Math.abs(tp2 - entry) / dist)}`);
    });
  }

  const rrLabel = (r) => `${r.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} R`;

  function onCalcInput(el) {
    const s = getRiskSettings();
    const name = el.dataset.calcInput;
    if (name === "currency") s.currency = el.value === "$" ? "$" : "€";
    else {
      const v = parseNum(el.value);
      s[name] = Number.isFinite(v) && v > 0 ? v : 0;
    }
    local.set(CONFIG.KEYS.risk, JSON.stringify(s));
    // Synchronise les autres calculateurs affichés
    $$(`[data-calc-input="${name}"]`).forEach((other) => {
      if (other !== el) other.value = el.value;
    });
    updateCalculators();
  }

  /* =========================================================
   * Rendu : navigation, statut de la clé, footer
   * ========================================================= */
  function renderTabs() {
    const items = TABS.map((t) => {
      const active = t.id === state.tab;
      const count =
        t.id === "historique" && state.history.length
          ? `<span class="rounded-md bg-accent/15 px-1.5 font-mono text-[11px] text-accent">${state.history.length}</span>`
          : "";
      return `<li><button data-nav="${t.id}" ${active ? 'aria-current="page"' : ""}
        class="relative z-10 flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors duration-200 ${
          active ? "text-fg" : "text-zinc-500 hover:text-zinc-200"
        }">${icon(t.icon, `size-4 transition-colors ${active ? "text-accent" : ""}`)}${t.label}${count}</button></li>`;
    }).join("");

    $$(".tab-list").forEach((ul) => {
      let ind = ul.querySelector(".tab-indicator");
      if (!ind) {
        ind = document.createElement("span");
        ind.className = "tab-indicator";
        ind.setAttribute("aria-hidden", "true");
      }
      ul.innerHTML = items;
      ul.prepend(ind);
    });
    refreshIcons();
    positionIndicators();
  }

  /** Fait glisser l'indicateur rétroéclairé sous l'onglet actif. */
  function positionIndicators() {
    $$(".tab-list").forEach((ul) => {
      const ind = ul.querySelector(".tab-indicator");
      const btn = ul.querySelector('[aria-current="page"]');
      if (!ind || !btn || !btn.offsetWidth) return;
      const first = !ind.dataset.ready;
      if (first) ind.style.transition = "none";
      ind.style.width = `${btn.offsetWidth}px`;
      ind.style.transform = `translateX(${btn.offsetLeft}px)`;
      if (first) {
        void ind.offsetWidth;
        ind.style.transition = "";
        ind.dataset.ready = "1";
      }
    });
  }

  function renderKeyStatus() {
    const key = getApiKey();
    const btn = $("#key-status");
    btn.innerHTML = `
      ${key ? '<span class="pulse-dot bg-buy"></span>' : '<span class="blink-dot"></span>'}
      <span class="font-medium text-zinc-200">Clé API</span>
      <span class="hidden font-mono text-[11px] sm:inline ${key ? "text-zinc-500" : "text-wait"}">${key ? `sk-ant-…${esc(key.slice(-4))}` : "manquante"}</span>
      ${icon("settings-2", "size-3.5 text-zinc-500")}`;
    btn.title = key ? `Clé configurée · modèle ${getModel()}` : "Aucune clé : clique pour l’ajouter";
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
   * Rendu : analyseur (style, mode 1 ou 2 images, slots)
   * ========================================================= */
  const SLOT_META = {
    main: { label: "Graphique", sub: "Dépose ta capture de graphique ici" },
    htf: { label: "HTF · Vue d’ensemble", sub: "Tendance de fond (ex : 4h, Daily)" },
    ltf: { label: "LTF · Déclencheur", sub: "Entrée et retest (ex : 5m, 15m)" },
  };
  const activeSlots = () => (state.mode === "mtf" ? ["htf", "ltf"] : ["main"]);
  const loadedSlots = () => activeSlots().filter((k) => state.slots[k]);
  const hasAnyFile = () => loadedSlots().length > 0;
  const isComplete = () => loadedSlots().length === activeSlots().length;

  function renderPickers() {
    $("#style-picker").innerHTML = Object.entries(STYLES)
      .map(
        ([id, s]) => `
        <button type="button" role="radio" data-style="${id}" aria-checked="${state.style === id}" ${state.status === "loading" ? "disabled" : ""}
          class="seg-btn flex-1 rounded-lg px-3 py-2 text-left transition-all duration-200">
          <span class="block text-sm font-medium">${s.label}</span>
          <span class="block font-mono text-[11px] text-zinc-500">${s.tf}</span>
        </button>`,
      )
      .join("");
    $("#style-hint").textContent = STYLES[state.style].hint;
    $("#mode-picker").innerHTML = [
      ["single", "1 image", "image"],
      ["mtf", "2 images · Multi-TF", "images"],
    ]
      .map(
        ([id, label, ico]) => `
        <button type="button" role="radio" data-mode="${id}" aria-checked="${state.mode === id}" ${state.status === "loading" ? "disabled" : ""}
          class="seg-btn flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200">
          ${icon(ico, "size-3.5")} ${label}
        </button>`,
      )
      .join("");
  }

  function dropzoneHtml(key, big) {
    const m = SLOT_META[key];
    return `
      <div class="dropzone group relative flex ${big ? "min-h-[400px]" : "min-h-[320px]"} cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl px-5 text-center"
           role="button" tabindex="0" data-slot="${key}" aria-label="Importer : ${m.label}">
        <svg class="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden="true">
          <rect class="dz-rect" x="1" y="1" width="0" height="0" rx="15" ry="15" />
        </svg>
        ${key === "main" ? "" : `<span class="absolute left-4 top-4 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[11px] font-medium text-zinc-300">${m.label}</span>`}
        <div class="dz-icon grid size-14 place-items-center rounded-2xl border border-white/[0.08] bg-panel">${icon("image-up", "size-6 text-accent")}</div>
        <div>
          <p class="${big ? "text-lg" : "text-base"} font-medium tracking-tight">${key === "main" ? m.sub : "Dépose la capture"}</p>
          <p class="mt-1.5 text-sm text-zinc-500">${key === "main" ? "ou clique pour parcourir tes fichiers" : m.sub}</p>
        </div>
        <button type="button" data-action="paste-clipboard" data-slot="${key}"
                class="paste-hint inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] py-1.5 pl-1.5 pr-3 text-xs text-zinc-400 transition-all duration-200 hover:border-[#06b6d4]/40 hover:text-zinc-200"
                title="Coller depuis le presse-papier">
          <span class="flex items-center gap-1"><kbd class="kbd">${MOD_KEY}</kbd><span class="text-zinc-600">+</span><kbd class="kbd">V</kbd></span>
          pour coller
        </button>
        <p class="font-mono text-[11px] text-zinc-600">PNG · JPG · WEBP — 5 Mo max</p>
      </div>`;
  }

  function previewHtml(key) {
    const s = state.slots[key];
    return `
      <div class="slot-preview relative overflow-hidden rounded-2xl border border-white/[0.08] bg-black/40">
        <img src="${s.url}" alt="${esc(SLOT_META[key].label)}" class="slot-img block max-h-[520px] w-full object-contain transition-opacity duration-300" />
        <div class="scan-overlay">
          <div class="pointer-events-none absolute inset-0 bg-[#06b6d4]/[0.04]"></div>
          <div class="scan-grid pointer-events-none absolute inset-0"></div>
          <div class="scan-beam pointer-events-none"></div>
        </div>
        ${key === "main" ? "" : `<span class="absolute left-3 top-3 rounded-md border border-white/[0.1] bg-black/60 px-2 py-0.5 text-[11px] font-medium text-zinc-200 backdrop-blur-md">${SLOT_META[key].label}</span>`}
        <button type="button" data-action="remove-slot" data-slot="${key}" class="slot-remove absolute right-3 top-3 grid size-8 place-items-center rounded-lg border border-white/[0.1] bg-black/60 text-zinc-300 backdrop-blur-md transition hover:text-[#fb7185]" aria-label="Retirer cette image">
          ${icon("x", "size-4")}
        </button>
      </div>`;
  }

  /** Re-rendu des zones d'image (uniquement quand les fichiers ou le mode changent : pas de clignotement). */
  function renderSlots() {
    const keys = activeSlots();
    $("#slots").className = keys.length === 2 ? "grid gap-4 md:grid-cols-2" : "";
    $("#slots").innerHTML = keys.map((k) => (state.slots[k] ? previewHtml(k) : dropzoneHtml(k, keys.length === 1))).join("");
    observeDropzones();
    refreshIcons();
  }

  function loaderStepsHtml() {
    return LOADER_STEPS.map((s, i) => {
      const ico =
        i < state.loaderStep
          ? icon("check", "size-4 text-buy")
          : i === state.loaderStep
            ? icon("loader-circle", "size-4 text-accent spin")
            : icon("circle", "size-4 text-zinc-700");
      return `<li class="flex items-center gap-3 text-sm transition-colors duration-300">${ico}<span class="${
        i < state.loaderStep ? "text-zinc-400" : i === state.loaderStep ? "text-fg" : "text-zinc-600"
      }">${s}</span></li>`;
    }).join("");
  }

  const loaderPct = () => Math.round(((state.loaderStep + 0.6) / LOADER_STEPS.length) * 100);
  const elapsedSec = () => Math.floor((Date.now() - state.loaderStart) / 1000);

  function renderSide() {
    if (!hasAnyFile()) {
      const keyNotice = getApiKey()
        ? ""
        : `<div class="mt-5 rounded-lg border border-wait/25 bg-wait/[0.05] p-3 text-sm">
            <p class="flex items-center gap-2 text-[#fbbf24]"><span class="blink-dot"></span>Aucune clé API configurée</p>
            <button data-action="open-settings" class="btn-outline mt-3 h-8 w-full px-3 text-xs">${icon("key-round", "size-3.5")} Ajouter ma clé</button>
          </div>`;
      return `
        <h2 class="text-sm font-medium">Pour une lecture fiable</h2>
        <ul class="points text-zinc-400">${TIPS.map((t) => `<li>${t}</li>`).join("")}</ul>
        ${keyNotice}`;
    }

    const missing = activeSlots().filter((k) => !state.slots[k]);
    let action;
    if (state.status === "loading") {
      action = `<div id="loader" class="space-y-4" role="status" aria-live="polite">
          <div class="flex items-center justify-between text-xs">
            <span class="flex items-center gap-2 text-accent"><span class="pulse-dot bg-accent"></span>Analyse en cours</span>
            <span id="loader-elapsed" class="font-mono text-zinc-500">${elapsedSec()} s</span>
          </div>
          <div class="h-1 overflow-hidden rounded-full bg-white/[0.05]">
            <div id="loader-bar" class="h-full rounded-full bg-linear-to-r from-buy to-accent transition-[width] duration-700 ease-out" style="width:${loaderPct()}%"></div>
          </div>
          <ol id="loader-steps" class="space-y-3">${loaderStepsHtml()}</ol>
        </div>`;
    } else if (missing.length) {
      action = `<button disabled class="btn-outline h-12 w-full px-6 text-sm">${icon("image-plus", "size-4")} Ajoute l’image ${missing[0].toUpperCase()}</button>`;
    } else {
      action = `<button data-action="analyze" class="btn-primary shimmer h-12 w-full px-6 text-base">${icon("scan-line", "size-5")}
          ${state.status === "error" ? "Relancer l’analyse" : state.status === "done" ? "Analyser à nouveau" : "Analyser le graphique"}
        </button>`;
    }

    const files = loadedSlots()
      .map((k) => {
        const f = state.slots[k].file;
        return `
          <div class="flex items-center gap-3">
            <div class="grid size-10 shrink-0 place-items-center rounded-lg border border-white/[0.08] bg-ink">${icon("file-image", "size-4 text-accent")}</div>
            <div class="min-w-0">
              <p class="truncate text-sm font-medium">${state.mode === "mtf" ? `<span class="text-zinc-500">${k.toUpperCase()} ·</span> ` : ""}${esc(f.name || "Capture collée")}</p>
              <p class="font-mono text-xs text-zinc-500">${formatBytes(f.size)}</p>
            </div>
          </div>`;
      })
      .join("");

    return `
      <div class="space-y-5">
        <div class="flex items-center justify-between text-xs">
          <span class="text-zinc-500">Style</span>
          <span class="font-medium text-zinc-200">${STYLES[state.style].label} <span class="font-mono text-zinc-500">${STYLES[state.style].tf}</span></span>
        </div>
        <div class="space-y-3">${files}</div>
        ${action}
        <button data-action="reset" ${state.status === "loading" ? "disabled" : ""} class="btn-ghost h-8 w-full px-3 text-xs">${icon("rotate-ccw", "size-3.5")} Tout retirer</button>
      </div>`;
  }

  function renderScanner() {
    renderPickers();
    $("#slots").dataset.scanning = String(state.status === "loading");

    const err = $("#scanner-error");
    err.hidden = !state.error;
    err.innerHTML = state.error ? `${icon("circle-x", "size-4 shrink-0")}<span>${esc(state.error)}</span>` : "";

    $("#scanner-side").innerHTML = renderSide();
    $("#scanner-result").innerHTML =
      state.status === "done" && state.result
        ? `<div class="tab-enter">${renderDashboard(state.result.analysis, state.result.warnings, state.result.meta)}</div>`
        : "";
    refreshIcons();
  }

  function setSlot(key, file) {
    const old = state.slots[key];
    if (old) URL.revokeObjectURL(old.url);
    state.slots[key] = file ? { file, url: URL.createObjectURL(file) } : null;
  }

  function validateFile(file) {
    if (!CONFIG.ACCEPT.includes(file.type)) return "Format non supporté. Utilise PNG, JPG ou WEBP.";
    if (file.size > CONFIG.MAX_BYTES) return "Image trop lourde (5 Mo max).";
    return null;
  }

  /** Place une image dans un slot (ou le premier slot libre). */
  function selectFile(file, slot) {
    if (!file || state.status === "loading") return;
    const problem = validateFile(file);
    if (problem) return showScannerError(problem);
    const keys = activeSlots();
    const target = slot && keys.includes(slot) ? slot : keys.find((k) => !state.slots[k]) || keys[keys.length - 1];
    setSlot(target, file);
    Object.assign(state, { status: "ready", result: null, error: null });
    renderSlots();
    renderScanner();
  }

  /** Dépôt de plusieurs fichiers d'un coup : HTF puis LTF en mode multi-timeframe. */
  function selectFiles(files, slot) {
    const list = Array.from(files || []).filter((f) => f.type.startsWith("image/"));
    if (state.mode === "mtf" && list.length >= 2) {
      const problem = validateFile(list[0]) || validateFile(list[1]);
      if (problem) return showScannerError(problem);
      setSlot("htf", list[0]);
      setSlot("ltf", list[1]);
      Object.assign(state, { status: "ready", result: null, error: null });
      renderSlots();
      renderScanner();
      return;
    }
    selectFile(list[0], slot);
  }

  function removeSlot(key) {
    if (state.status === "loading") return;
    setSlot(key, null);
    Object.assign(state, { status: hasAnyFile() ? "ready" : "idle", result: null, error: null });
    renderSlots();
    renderScanner();
  }

  function setMode(mode) {
    if (state.status === "loading" || mode === state.mode) return;
    if (mode === "mtf") {
      // L'image déjà chargée devient le déclencheur (LTF)
      if (state.slots.main) state.slots.ltf = state.slots.main;
    } else {
      const keep = state.slots.ltf || state.slots.htf;
      const drop = keep === state.slots.ltf ? state.slots.htf : state.slots.ltf;
      if (drop) URL.revokeObjectURL(drop.url);
      state.slots.main = keep || null;
    }
    if (mode === "mtf") state.slots.main = null;
    else state.slots.htf = state.slots.ltf = null;
    state.mode = mode;
    local.set(CONFIG.KEYS.mode, mode);
    Object.assign(state, { status: hasAnyFile() ? "ready" : "idle", result: null, error: null });
    renderSlots();
    renderScanner();
  }

  function setStyle(id) {
    if (!STYLES[id] || state.status === "loading") return;
    state.style = id;
    local.set(CONFIG.KEYS.style, id);
    renderScanner();
  }

  function showScannerError(msg) {
    state.error = msg;
    renderScanner();
  }

  function resetScanner() {
    ["main", "htf", "ltf"].forEach((k) => setSlot(k, null));
    Object.assign(state, { status: "idle", result: null, error: null });
    renderSlots();
    renderScanner();
  }

  /** Met à jour le loader sur place (pas de re-rendu complet : aucune saccade). */
  function startLoader() {
    let ticks = 0;
    state.loaderTimer = setInterval(() => {
      ticks += 1;
      const el = $("#loader-elapsed");
      if (el) el.textContent = `${elapsedSec()} s`;
      if (ticks % 3 === 0 && state.loaderStep < LOADER_STEPS.length - 1) {
        state.loaderStep += 1;
        const steps = $("#loader-steps");
        if (steps) steps.innerHTML = loaderStepsHtml();
        const bar = $("#loader-bar");
        if (bar) bar.style.width = `${loaderPct()}%`;
        refreshIcons();
      }
    }, 1000);
  }
  function stopLoader() {
    clearInterval(state.loaderTimer);
    state.loaderTimer = null;
  }

  async function analyze() {
    if (!isComplete() || state.status === "loading") return;
    if (!getApiKey()) return openSettings();

    const multi = state.mode === "mtf";
    const style = state.style;
    const images = multi
      ? [
          { file: state.slots.htf.file, label: "Image 1 — HTF (vue d'ensemble) :" },
          { file: state.slots.ltf.file, label: "Image 2 — LTF (déclencheur) :" },
        ]
      : [{ file: state.slots.main.file }];

    Object.assign(state, { status: "loading", error: null, loaderStep: 0, loaderStart: Date.now() });
    renderScanner();
    startLoader();
    try {
      const model = getModel();
      const { analysis, warnings } = await analyzeImages(images, style, multi);
      const id = newId();
      const entry = analysis.trade_plan.entry_price === "Market" ? (analysis.current_price ?? null) : analysis.trade_plan.entry_price;
      const rr2 = entry !== null ? computeRR(entry, analysis.trade_plan.stop_loss, analysis.trade_plan.take_profit_2) : null;
      addHistory({
        id,
        createdAt: new Date().toISOString(),
        fileName: images[images.length - 1].file.name || "capture.png",
        thumbnail: await makeThumbnail(images[images.length - 1].file),
        thumbnailHtf: multi ? await makeThumbnail(images[0].file) : null,
        analysis,
        warnings,
        model,
        style,
        mode: multi ? "mtf" : "single",
        status: "pending",
        checklist: [false, false, false, rr2 !== null && rr2 >= 2, false],
      });
      state.result = { analysis, warnings, meta: { model, style, mode: multi ? "mtf" : "single", entryId: id } };
      state.status = "done";
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
   * Journal de trading (localStorage)
   * ========================================================= */
  function normalizeEntry(e) {
    const analysis = validateAnalysis(e.analysis);
    const checklist = Array.isArray(e.checklist) ? CHECKLIST.map((_, i) => Boolean(e.checklist[i])) : CHECKLIST.map(() => false);
    return {
      ...e,
      analysis,
      warnings: Array.isArray(e.warnings) ? e.warnings : [],
      status: STATUSES[e.status] ? e.status : "pending",
      style: STYLES[e.style] ? e.style : "day",
      mode: e.mode === "mtf" ? "mtf" : "single",
      checklist,
    };
  }

  function loadHistory() {
    try {
      const arr = JSON.parse(local.get(CONFIG.KEYS.history) || "[]");
      if (!Array.isArray(arr)) return [];
      return arr.flatMap((e) => {
        try {
          return [normalizeEntry(e)];
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
    // Quota dépassé : on retire d'abord les miniatures HTF, puis les entrées les plus anciennes
    if (!local.set(CONFIG.KEYS.history, JSON.stringify(list))) {
      list = list.map((e) => ({ ...e, thumbnailHtf: null }));
      while (list.length && !local.set(CONFIG.KEYS.history, JSON.stringify(list))) list = list.slice(0, -1);
    }
    if (!list.length) local.del(CONFIG.KEYS.history);
  }

  function addHistory(entry) {
    state.history = [entry, ...state.history].slice(0, CONFIG.HISTORY_MAX);
    persistHistory();
    renderTabs();
  }

  const findEntry = (id) => state.history.find((e) => e.id === id);

  function deleteEntry(id) {
    state.history = state.history.filter((e) => e.id !== id);
    persistHistory();
    renderTabs();
    renderHistory();
  }

  async function resetJournal() {
    if (!state.history.length) return;
    const ok = await confirmDialog({
      title: "Réinitialiser le journal ?",
      message: `Les ${state.history.length} trades enregistrés, leurs statuts et leurs checklists seront supprimés de ce navigateur. Cette action est définitive.`,
      confirmLabel: "Tout supprimer",
    });
    if (!ok) return;
    state.history = [];
    local.del(CONFIG.KEYS.history);
    renderTabs();
    renderHistory();
  }

  function setStatus(id, status) {
    const e = findEntry(id);
    if (!e || !STATUSES[status]) return;
    e.status = status;
    persistHistory();
    renderHistory();
  }

  /* ---------- Calculs du journal (en multiples de R) ---------- */
  function entryPrice(a) {
    const e = a.trade_plan.entry_price;
    return e === "Market" ? (a.current_price ?? null) : e;
  }
  function plannedR(a, tpKey) {
    const entry = entryPrice(a);
    return entry === null ? null : computeRR(entry, a.trade_plan.stop_loss, a.trade_plan[tpKey]);
  }
  /** Résultat d'un trade en R (sortie totale à TP1 ou TP2, -1 R au stop). */
  function resultR(e) {
    if (e.status === "sl") return -1;
    if (e.status === "tp1") return plannedR(e.analysis, "take_profit_1");
    if (e.status === "tp2") return plannedR(e.analysis, "take_profit_2");
    return null;
  }

  function journalStats() {
    const h = state.history;
    const closed = h.filter((e) => ["tp1", "tp2", "sl"].includes(e.status));
    const wins = closed.filter((e) => e.status !== "sl").length;
    const results = closed
      .slice()
      .sort((x, y) => x.createdAt.localeCompare(y.createdAt))
      .map(resultR)
      .filter((r) => r !== null);
    const rrs = h.map((e) => plannedR(e.analysis, "take_profit_2")).filter((r) => r !== null);
    return {
      total: h.length,
      open: h.filter((e) => e.status === "open").length,
      closed: closed.length,
      wins,
      winrate: closed.length ? (wins / closed.length) * 100 : null,
      pnl: results.reduce((s, r) => s + r, 0),
      curve: results.reduce((acc, r) => [...acc, (acc.length ? acc[acc.length - 1] : 0) + r], []),
      avgRR: rrs.length ? rrs.reduce((s, r) => s + r, 0) / rrs.length : null,
    };
  }

  const fmtR = (r) => `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} R`;

  /** Mini courbe de performance cumulée (SVG). */
  function sparkline(points) {
    if (points.length < 2) return "";
    const all = [0, ...points];
    const max = Math.max(...all);
    const min = Math.min(...all);
    const range = max - min || 1;
    const w = 120;
    const hgt = 32;
    const xy = all.map((v, i) => `${((i / (all.length - 1)) * w).toFixed(1)},${(hgt - ((v - min) / range) * hgt).toFixed(1)}`);
    const color = points[points.length - 1] >= 0 ? "#10b981" : "#e11d48";
    const zeroY = (hgt - ((0 - min) / range) * hgt).toFixed(1);
    return `
      <svg viewBox="0 0 ${w} ${hgt}" class="h-8 w-28" aria-hidden="true" preserveAspectRatio="none">
        <line x1="0" y1="${zeroY}" x2="${w}" y2="${zeroY}" stroke="rgb(255 255 255 / 0.1)" stroke-dasharray="2 3" />
        <polyline points="${xy.join(" ")}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" style="filter:drop-shadow(0 0 4px ${color}88)" />
      </svg>`;
  }

  /* ---------- Checklist de confluence ---------- */
  function checklistHtml(id) {
    const e = findEntry(id);
    if (!e) return "";
    const n = e.checklist.filter(Boolean).length;
    return `
      <div class="glass p-5" data-checklist="${esc(id)}">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h3 class="flex items-center gap-2 text-sm font-medium">${icon("list-checks", "size-4 text-accent")} Checklist de confluence</h3>
          <span data-check-badge>${checklistBadge(n)}</span>
        </div>
        <div class="mt-4 flex gap-1.5" data-check-bars>${checklistBars(n)}</div>
        <ul class="mt-4 grid gap-2 sm:grid-cols-2">
          ${CHECKLIST.map(
            (label, i) => `
            <li>
              <label class="check-row flex cursor-pointer items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-sm transition-colors hover:border-white/[0.12]">
                <input type="checkbox" class="check mt-0.5" data-check="${i}" data-entry="${esc(id)}" ${e.checklist[i] ? "checked" : ""} />
                <span class="text-zinc-300">${label}${i === 4 ? `<span data-macro-hint class="mt-1 block text-xs text-[#fb7185]">${macroHintText()}</span>` : ""}${
                  i === 3 ? `<span class="mt-1 block text-xs text-zinc-500">Pré-rempli d’après le R:R recalculé</span>` : ""
                }</span>
              </label>
            </li>`,
          ).join("")}
        </ul>
      </div>`;
  }

  function checklistBadge(n) {
    return n >= 4
      ? `<span class="validated inline-flex items-center gap-2 rounded-full border border-buy/40 bg-buy/10 px-3 py-1 text-xs font-medium text-[#34d399]"><span class="pulse-dot bg-buy"></span>Setup validé pour exécution · ${n}/5</span>`
      : `<span class="inline-flex items-center gap-2 rounded-full border border-wait/30 bg-wait/[0.08] px-3 py-1 text-xs font-medium text-[#fbbf24]">${icon("triangle-alert", "size-3.5")} Confluences insuffisantes · ${n}/5</span>`;
  }
  function checklistBars(n) {
    return CHECKLIST.map(
      (_, i) => `<span class="h-1 flex-1 rounded-full transition-colors duration-300 ${i < n ? (n >= 4 ? "bg-buy shadow-[0_0_8px_rgb(16_185_129/0.7)]" : "bg-wait") : "bg-white/[0.06]"}"></span>`,
    ).join("");
  }

  function onCheck(input) {
    const e = findEntry(input.dataset.entry);
    if (!e) return;
    e.checklist[Number(input.dataset.check)] = input.checked;
    persistHistory();
    const n = e.checklist.filter(Boolean).length;
    // Synchronise toutes les copies affichées (analyseur + fenêtre de détail)
    $$(`[data-checklist="${CSS.escape(e.id)}"]`).forEach((box) => {
      box.querySelector("[data-check-badge]").innerHTML = checklistBadge(n);
      box.querySelector("[data-check-bars]").innerHTML = checklistBars(n);
      box.querySelectorAll("[data-check]").forEach((c) => (c.checked = e.checklist[Number(c.dataset.check)]));
    });
    refreshIcons();
  }

  /* ---------- Fenêtre de détail ---------- */
  const safeThumb = (t) => (typeof t === "string" && t.startsWith("data:image/") ? esc(t) : null);

  function openDetail(id) {
    const e = findEntry(id);
    if (!e) return;
    const thumb = safeThumb(e.thumbnail);
    $("#detail-title").innerHTML = `
      <div class="flex min-w-0 items-center gap-3">
        ${thumb ? `<img src="${thumb}" alt="" class="h-8 w-12 shrink-0 rounded border border-white/[0.08] object-cover" />` : ""}
        <div class="min-w-0">
          <p class="truncate font-medium">${esc(e.analysis.asset_detected)} <span class="text-zinc-500">· ${esc(e.analysis.timeframe_detected)}</span></p>
          <p class="font-mono text-[11px] text-zinc-500">${esc(formatDateTime(e.createdAt))} · ${STATUSES[e.status].label}</p>
        </div>
      </div>`;
    $("#detail-body").innerHTML = renderDashboard(e.analysis, e.warnings, { model: e.model, style: e.style, mode: e.mode, entryId: e.id });
    refreshIcons();
    $("#detail").showModal();
    $("#detail").scrollTop = 0;
  }

  /* ---------- Export CSV (Excel FR : séparateur « ; », virgule décimale) ---------- */
  function exportCsv() {
    if (!state.history.length) return;
    const n = (v) => (v === null || v === undefined || v === "" ? "" : typeof v === "number" ? v.toLocaleString("fr-FR", { useGrouping: false, maximumFractionDigits: 8 }) : v);
    const cell = (v) => {
      const s = String(n(v));
      return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [
      "Date", "Actif", "Unité de temps", "Style", "Mode", "Signal", "Confiance (%)", "Prix actuel",
      "Entrée", "Stop", "TP1", "TP2", "R:R prévu (TP2)", "Statut", "Résultat (R)", "Checklist (/5)", "Alertes", "Rationale",
    ];
    const rows = state.history.map((e) => {
      const a = e.analysis;
      const p = a.trade_plan;
      const rr = plannedR(a, "take_profit_2");
      return [
        new Date(e.createdAt).toLocaleString("fr-FR"),
        a.asset_detected,
        a.timeframe_detected,
        STYLES[e.style].label,
        e.mode === "mtf" ? "Multi-TF" : "1 image",
        a.recommendation,
        a.confidence_score,
        a.current_price,
        p.entry_price === "Market" ? "Market" : p.entry_price,
        p.stop_loss,
        p.take_profit_1,
        p.take_profit_2,
        rr === null ? "" : Math.round(rr * 100) / 100,
        STATUSES[e.status].label,
        resultR(e) === null ? "" : Math.round(resultR(e) * 100) / 100,
        e.checklist.filter(Boolean).length,
        e.warnings.join(" | "),
        a.rationale,
      ];
    });
    const csv = "\uFEFF" + [header, ...rows].map((r) => r.map(cell).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `tradeia-journal-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------- Modale de confirmation ---------- */
  function confirmDialog({ title, message, confirmLabel = "Confirmer" }) {
    const dlg = $("#confirm");
    $("#confirm-title").textContent = title;
    $("#confirm-message").textContent = message;
    $("#confirm-ok").textContent = confirmLabel;
    return new Promise((resolve) => {
      const done = (value) => {
        dlg.removeEventListener("close", onClose);
        resolve(value);
      };
      const onClose = () => done(dlg.returnValue === "ok");
      dlg.returnValue = "";
      dlg.addEventListener("close", onClose);
      dlg.showModal();
    });
  }

  /* ---------- Rendu du journal ---------- */
  function renderHistory() {
    const root = $("#history-root");
    const header = (extra = "") => `
      <div class="flex flex-wrap items-end justify-between gap-4">
        <header>
          <h1 class="text-3xl font-semibold tracking-tight">Journal de trading</h1>
          <p class="mt-2 text-zinc-400">Mets à jour le statut de chaque trade : les statistiques se recalculent en direct.</p>
        </header>${extra}
      </div>`;

    if (!state.history.length) {
      root.innerHTML = `${header()}
        <div class="glass mt-8 flex flex-col items-center px-6 py-20 text-center">
          <div class="grid size-12 place-items-center rounded-xl border border-white/[0.08] bg-ink">${icon("notebook-pen", "size-5 text-zinc-500")}</div>
          <p class="mt-5 font-medium">Ton journal est vide</p>
          <p class="mt-1 max-w-sm text-sm text-zinc-500">Chaque analyse est ajoutée ici automatiquement. Tu pourras suivre son statut jusqu’à la clôture.</p>
          <button data-nav="analyseur" class="btn-primary shimmer mt-6 h-10 px-4">${icon("scan-line")} Lancer une analyse</button>
        </div>`;
      refreshIcons();
      return;
    }

    const st = journalStats();
    const stat = (label, value, sub, cls = "text-fg", extra = "") => `
      <div class="glass flex items-end justify-between gap-3 p-4">
        <div class="min-w-0">
          <dt class="text-xs text-zinc-500">${label}</dt>
          <dd class="mt-2 font-mono text-2xl font-medium tracking-tight ${cls}">${value}</dd>
          <p class="mt-1 truncate font-mono text-[11px] text-zinc-500">${sub}</p>
        </div>${extra}
      </div>`;

    const rows = state.history
      .map((e) => {
        const a = e.analysis;
        const d = DECISION[a.recommendation];
        const thumb = safeThumb(e.thumbnail);
        const r = resultR(e);
        const rr = plannedR(a, "take_profit_2");
        const checks = e.checklist.filter(Boolean).length;
        return `
          <tr class="border-b border-white/[0.05] transition-colors last:border-0 hover:bg-white/[0.02]">
            <td class="py-3 pl-4 pr-3">
              <button data-action="open-detail" data-id="${esc(e.id)}" class="group flex items-center gap-3 text-left" aria-label="Voir le plan ${esc(a.asset_detected)}">
                ${
                  thumb
                    ? `<img src="${thumb}" alt="" class="h-10 w-16 shrink-0 rounded-md border border-white/[0.08] object-cover transition group-hover:border-accent/50" />`
                    : `<span class="h-10 w-16 shrink-0 rounded-md border border-white/[0.08] bg-ink"></span>`
                }
                <span class="min-w-0">
                  <span class="block truncate font-medium group-hover:text-accent">${esc(a.asset_detected)}</span>
                  <span class="block font-mono text-[11px] text-zinc-500">${esc(a.timeframe_detected)} · ${STYLES[e.style].label}${e.mode === "mtf" ? " · MTF" : ""}</span>
                </span>
              </button>
            </td>
            <td class="px-3 py-3 font-mono text-xs text-zinc-500">${esc(formatDateTime(e.createdAt))}</td>
            <td class="px-3 py-3">${badge(`<span class="pulse-dot" style="background:${d.hex}"></span>${a.recommendation}`, d.badge)}</td>
            <td class="px-3 py-3 text-right font-mono text-sm">${rr === null ? "—" : `1:${rr.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}`}</td>
            <td class="px-3 py-3 text-center font-mono text-xs ${checks >= 4 ? "text-[#34d399]" : "text-zinc-500"}">${checks}/5</td>
            <td class="px-3 py-3">
              <select data-status-select data-id="${esc(e.id)}" data-status="${e.status}" aria-label="Statut du trade"
                class="status-select h-8 cursor-pointer rounded-lg border border-white/[0.1] bg-ink pl-2.5 pr-7 text-xs font-medium outline-none ${STATUSES[e.status].cls}">
                ${Object.entries(STATUSES).map(([k, s]) => `<option value="${k}" ${k === e.status ? "selected" : ""}>${s.label}</option>`).join("")}
              </select>
            </td>
            <td class="px-3 py-3 text-right font-mono text-sm ${r === null ? "text-zinc-600" : r >= 0 ? "text-[#34d399]" : "text-[#fb7185]"}">${r === null ? "—" : fmtR(r)}</td>
            <td class="py-3 pl-3 pr-4 text-right">
              <button data-action="delete" data-id="${esc(e.id)}" class="btn-ghost size-8 hover:!text-[#fb7185]" aria-label="Supprimer ce trade">${icon("trash-2", "size-3.5")}</button>
            </td>
          </tr>`;
      })
      .join("");

    root.innerHTML = `
      <div class="space-y-6">
        ${header(`
          <div class="flex flex-wrap gap-2">
            <button data-action="export-csv" class="btn-outline h-9 px-3 text-xs">${icon("file-down", "size-3.5")} Exporter en CSV</button>
            <button data-action="reset-journal" class="btn-ghost h-9 px-3 text-xs hover:!text-[#fb7185]">${icon("rotate-ccw", "size-3.5")} Réinitialiser le journal</button>
          </div>`)}
        <dl class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          ${stat("Trades", st.total, `${st.closed} clôturé${st.closed > 1 ? "s" : ""} · ${st.open} en cours`)}
          ${stat(
            "Winrate",
            st.winrate === null ? "—" : `${st.winrate.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`,
            st.closed ? `${st.wins} gagnant${st.wins > 1 ? "s" : ""} / ${st.closed}` : "Aucun trade clôturé",
            st.winrate === null ? "text-zinc-500" : st.winrate >= 50 ? "text-[#34d399]" : "text-[#fbbf24]",
          )}
          ${stat(
            "PnL cumulé",
            st.closed ? fmtR(st.pnl) : "—",
            "Sortie totale au TP, −1 R au stop",
            !st.closed ? "text-zinc-500" : st.pnl >= 0 ? "text-[#34d399]" : "text-[#fb7185]",
            sparkline(st.curve),
          )}
          ${stat("R:R moyen", st.avgRR === null ? "—" : `1:${st.avgRR.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}`, "Prévu, vers TP2", "text-accent")}
        </dl>
        <div class="glass overflow-x-auto">
          <table class="w-full min-w-[880px] text-sm">
            <thead>
              <tr class="border-b border-white/[0.08] text-left text-[11px] text-zinc-500">
                <th class="py-3 pl-4 pr-3 font-normal">Trade</th>
                <th class="px-3 py-3 font-normal">Date</th>
                <th class="px-3 py-3 font-normal">Signal</th>
                <th class="px-3 py-3 text-right font-normal">R:R prévu</th>
                <th class="px-3 py-3 text-center font-normal">Checklist</th>
                <th class="px-3 py-3 font-normal">Statut</th>
                <th class="px-3 py-3 text-right font-normal">Résultat</th>
                <th class="py-3 pl-3 pr-4"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
    refreshIcons();
  }

  /* =========================================================
   * Surveillance macro (calendrier du jour + fenêtres de volatilité)
   * ========================================================= */
  const MACRO = {
    FEED: "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
    CACHE_MS: 60 * 60 * 1000,
    WINDOW_MIN: 15,
  };
  const todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const sameLocalDay = (date) => {
    const d = new Date();
    return date.getFullYear() === d.getFullYear() && date.getMonth() === d.getMonth() && date.getDate() === d.getDate();
  };
  const timeLabel = (date) => date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  function loadManualEvents() {
    try {
      const arr = JSON.parse(local.get(CONFIG.KEYS.macroManual) || "[]");
      const today = todayKey();
      const kept = Array.isArray(arr) ? arr.filter((e) => e && e.day === today && typeof e.time === "string" && typeof e.title === "string") : [];
      if (Array.isArray(arr) && kept.length !== arr.length) local.set(CONFIG.KEYS.macroManual, JSON.stringify(kept));
      return kept;
    } catch {
      return [];
    }
  }

  /** Flux automatique (ForexFactory, best effort) avec cache d'une heure. */
  async function fetchMacroFeed() {
    try {
      const cached = JSON.parse(local.get(CONFIG.KEYS.macroCache) || "null");
      if (cached && Date.now() - cached.at < MACRO.CACHE_MS && Array.isArray(cached.data)) return cached.data;
    } catch { /* cache illisible */ }
    const res = await fetch(MACRO.FEED, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("Format inattendu");
    local.set(CONFIG.KEYS.macroCache, JSON.stringify({ at: Date.now(), data }));
    return data;
  }

  async function initMacro() {
    state.macro.manual = loadManualEvents();
    renderMacroShell();
    renderMacro();
    try {
      const data = await fetchMacroFeed();
      state.macro.auto = data
        .filter((e) => e && String(e.impact).toLowerCase() === "high" && e.date)
        .map((e) => ({ date: new Date(e.date), title: String(e.title || "Annonce"), country: String(e.country || ""), forecast: e.forecast, previous: e.previous }))
        .filter((e) => !Number.isNaN(e.date.getTime()) && sameLocalDay(e.date));
      state.macro.source = "auto";
    } catch {
      state.macro.source = "manual";
    }
    renderMacro();
  }

  /** Toutes les annonces du jour, triées. */
  function macroEvents() {
    const manual = state.macro.manual.map((e) => {
      const [h, m] = e.time.split(":").map(Number);
      const date = new Date();
      date.setHours(h || 0, m || 0, 0, 0);
      return { id: e.id, date, title: e.title, country: e.country || "", manual: true };
    });
    return [...state.macro.auto, ...manual].sort((x, y) => x.date - y.date);
  }

  /** Annonce dont la fenêtre ±15 min est active, et prochaine annonce dans l'heure. */
  function macroWindow() {
    const now = Date.now();
    const w = MACRO.WINDOW_MIN * 60 * 1000;
    const events = macroEvents();
    const active = events.find((e) => Math.abs(e.date - now) <= w) || null;
    const upcoming = events.find((e) => e.date - now > w && e.date - now <= 60 * 60 * 1000) || null;
    return { active, upcoming };
  }

  function macroHintText() {
    const { active } = macroWindow();
    return active ? `Fenêtre de volatilité active : ${active.title}` : "";
  }

  function relTime(date) {
    const diff = Math.round((date - Date.now()) / 60000);
    if (Math.abs(diff) <= MACRO.WINDOW_MIN) return { text: diff >= 0 ? `dans ${diff} min` : `il y a ${-diff} min`, cls: "text-[#fb7185]", live: true };
    if (diff > 0) return { text: diff < 60 ? `dans ${diff} min` : `dans ${Math.floor(diff / 60)} h ${String(diff % 60).padStart(2, "0")}`, cls: diff <= 60 ? "text-[#fbbf24]" : "text-zinc-500", live: false };
    return { text: "passée", cls: "text-zinc-600", live: false };
  }

  /** Squelette de la carte macro (rendu une seule fois : le formulaire n'est jamais effacé). */
  function renderMacroShell() {
    $("#macro-card").innerHTML = `
      <div class="flex items-center justify-between gap-2">
        <h2 class="flex items-center gap-2 text-sm font-medium">${icon("calendar-clock", "size-4 text-accent")} Surveillance macro</h2>
        <span class="font-mono text-[11px] text-zinc-500">${new Date().toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short" })}</span>
      </div>
      <ul id="macro-list" class="mt-3 space-y-0.5"></ul>
      <details class="group mt-3">
        <summary class="flex cursor-pointer list-none items-center gap-1.5 text-xs text-zinc-400 hover:text-fg">
          ${icon("plus", "size-3.5")} Ajouter une annonce
        </summary>
        <form id="macro-form" class="mt-3 grid grid-cols-[5.5rem_1fr] gap-2">
          <input name="time" type="time" required class="field h-9 px-2 font-mono text-xs" aria-label="Heure" />
          <input name="title" required maxlength="60" placeholder="ex : CPI US" class="field h-9 text-xs" aria-label="Annonce" />
          <input name="country" maxlength="3" placeholder="USD" class="field h-9 px-2 font-mono text-xs uppercase" aria-label="Devise" />
          <button type="submit" class="btn-outline h-9 text-xs">Ajouter (impact fort)</button>
        </form>
      </details>
      <div class="mt-4 flex gap-2.5 rounded-lg border border-sell/20 bg-sell/[0.05] p-3 text-xs leading-relaxed text-zinc-300">
        ${icon("shield-alert", "mt-0.5 size-3.5 shrink-0 text-[#fb7185]")}
        <p>Pas de nouvelle position 15 min avant et après une annonce à fort impact (CPI, NFP, FOMC, taux directeurs).</p>
      </div>
      <p class="mt-3 flex items-center justify-between gap-2 text-[11px] text-zinc-600">
        <span id="macro-source"></span>
        <a href="https://www.forexfactory.com/calendar" target="_blank" rel="noopener" class="inline-flex shrink-0 items-center gap-1 text-zinc-400 hover:text-accent">Calendrier complet ${icon("arrow-up-right", "size-3")}</a>
      </p>`;
    refreshIcons();
  }

  function renderMacro() {
    const events = macroEvents();
    const { active, upcoming } = macroWindow();

    // Bandeau d'alerte en haut de l'analyseur
    const alert = $("#macro-alert");
    if (active) {
      const end = new Date(active.date.getTime() + MACRO.WINDOW_MIN * 60000);
      alert.hidden = false;
      alert.className = "macro-alert flex items-start gap-3 rounded-xl border border-sell/40 bg-sell/[0.08] p-4 text-sm";
      alert.innerHTML = `${icon("siren", "mt-0.5 size-4 shrink-0 text-[#fb7185]")}
        <p><span class="font-medium text-[#fb7185]">Zone de volatilité : ${esc(active.title)}${active.country ? ` (${esc(active.country)})` : ""} à ${timeLabel(active.date)}.</span>
        <span class="text-zinc-300"> Évite d’ouvrir une position avant ${timeLabel(end)}.</span></p>`;
    } else if (upcoming) {
      alert.hidden = false;
      alert.className = "flex items-start gap-3 rounded-xl border border-wait/30 bg-wait/[0.06] p-4 text-sm";
      alert.innerHTML = `${icon("alarm-clock", "mt-0.5 size-4 shrink-0 text-[#fbbf24]")}
        <p><span class="font-medium text-[#fbbf24]">${esc(upcoming.title)}${upcoming.country ? ` (${esc(upcoming.country)})` : ""} ${relTime(upcoming.date).text}.</span>
        <span class="text-zinc-300"> Ne prends pas de position entre ${timeLabel(new Date(upcoming.date - MACRO.WINDOW_MIN * 60000))} et ${timeLabel(new Date(upcoming.date.getTime() + MACRO.WINDOW_MIN * 60000))}.</span></p>`;
    } else {
      alert.hidden = true;
    }

    const list = events.length
      ? events
          .map((e) => {
            const r = relTime(e.date);
            const past = r.text === "passée";
            return `
              <li class="flex items-center gap-3 rounded-lg px-2 py-2 ${r.live ? "bg-sell/[0.08]" : ""} ${past ? "opacity-50" : ""}">
                <span class="w-11 shrink-0 font-mono text-xs text-zinc-300">${timeLabel(e.date)}</span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm">${esc(e.title)}</span>
                  <span class="block font-mono text-[11px] ${r.cls}">${r.text}</span>
                </span>
                ${e.country ? `<span class="rounded border border-white/[0.08] px-1.5 font-mono text-[10px] text-zinc-400">${esc(e.country)}</span>` : ""}
                <span class="impact-high inline-flex items-center gap-1 rounded-md border border-sell/30 bg-sell/10 px-1.5 py-0.5 text-[10px] font-medium text-[#fb7185]">${r.live ? '<span class="pulse-dot bg-sell"></span>' : ""}High</span>
                ${e.manual ? `<button data-action="macro-remove" data-id="${esc(e.id)}" class="text-zinc-600 hover:text-[#fb7185]" aria-label="Retirer">${icon("x", "size-3.5")}</button>` : ""}
              </li>`;
          })
          .join("")
      : `<li class="px-2 py-3 text-sm text-zinc-500">${
          state.macro.source === "auto" ? "Aucune annonce à fort impact aujourd’hui." : "Aucune annonce enregistrée pour aujourd’hui."
        }</li>`;

    const source =
      state.macro.source === "loading"
        ? "Chargement du calendrier…"
        : state.macro.source === "auto"
          ? "Source : ForexFactory, impact fort uniquement"
          : "Flux automatique indisponible : ajoute tes annonces à la main";

    $("#macro-list").innerHTML = list;
    $("#macro-source").textContent = source;
    $$("[data-macro-hint]").forEach((el) => (el.textContent = macroHintText()));
    refreshIcons();
  }

  function addManualEvent(form) {
    const data = new FormData(form);
    const time = String(data.get("time") || "");
    const title = String(data.get("title") || "").trim();
    if (!/^\d{2}:\d{2}$/.test(time) || !title) return;
    state.macro.manual.push({ id: newId(), day: todayKey(), time, title, country: String(data.get("country") || "").trim().toUpperCase().slice(0, 3) });
    local.set(CONFIG.KEYS.macroManual, JSON.stringify(state.macro.manual));
    renderMacro();
  }

  function removeManualEvent(id) {
    state.macro.manual = state.macro.manual.filter((e) => e.id !== id);
    local.set(CONFIG.KEYS.macroManual, JSON.stringify(state.macro.manual));
    renderMacro();
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
   * Presse-papier et bordures animées des dropzones
   * ========================================================= */
  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const MOD_KEY = IS_MAC ? "⌘" : "Ctrl";

  function flashPasteHint() {
    $$(".paste-hint").forEach((hint) => {
      hint.classList.remove("kbd-flash");
      void hint.offsetWidth;
      hint.classList.add("kbd-flash");
    });
  }

  /** Clic sur le badge : lit une image du presse-papier (si le navigateur l'autorise). */
  async function pasteFromClipboard(slot) {
    flashPasteHint();
    if (!navigator.clipboard || !navigator.clipboard.read) {
      return showScannerError(`Utilise ${MOD_KEY} + V pour coller ta capture.`);
    }
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (type) {
          const blob = await item.getType(type);
          return selectFile(new File([blob], "capture.png", { type: blob.type }), slot);
        }
      }
      showScannerError("Le presse-papier ne contient pas d’image.");
    } catch {
      showScannerError(`Accès au presse-papier refusé : utilise ${MOD_KEY} + V.`);
    }
  }

  /** Ajuste les rectangles SVG pointillés à la taille réelle de chaque dropzone. */
  const dzObserver =
    "ResizeObserver" in window
      ? new ResizeObserver((entries) => {
          entries.forEach(({ target }) => {
            const rect = target.querySelector(".dz-rect");
            if (!rect) return;
            rect.setAttribute("width", String(Math.max(0, target.clientWidth - 2)));
            rect.setAttribute("height", String(Math.max(0, target.clientHeight - 2)));
          });
        })
      : null;
  function observeDropzones() {
    if (!dzObserver) return;
    dzObserver.disconnect();
    $$(".dropzone").forEach((dz) => dzObserver.observe(dz));
  }

  /* =========================================================
   * Événements (délégation : les zones sont re-rendues dynamiquement)
   * ========================================================= */
  function bindEvents() {
    const input = $("#file-input");

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
      const style = target.closest("[data-style]");
      if (style) return setStyle(style.dataset.style);
      const mode = target.closest("[data-mode]");
      if (mode) return setMode(mode.dataset.mode);

      const el = target.closest("[data-action]");
      if (el) {
        if (el.disabled) return;
        switch (el.dataset.action) {
          case "analyze": analyze(); break;
          case "reset": resetScanner(); break;
          case "remove-slot": removeSlot(el.dataset.slot); break;
          case "open-settings": openSettings(); break;
          case "open-detail": openDetail(el.dataset.id); break;
          case "delete": deleteEntry(el.dataset.id); break;
          case "export-csv": exportCsv(); break;
          case "reset-journal": resetJournal(); break;
          case "paste-clipboard": pasteFromClipboard(el.dataset.slot); break;
          case "copy-setup": copySetup(el); break;
          case "macro-remove": removeManualEvent(el.dataset.id); break;
        }
        return;
      }

      const dz = target.closest(".dropzone");
      if (dz && state.status !== "loading") {
        state.pickSlot = dz.dataset.slot;
        input.click();
      }
    });

    // Entrée / Espace sur les dropzones
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const el = e.target instanceof Element ? e.target : null;
      if (el && el.classList.contains("dropzone")) {
        e.preventDefault();
        el.click();
      }
    });

    input.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("change", () => {
      selectFile(input.files && input.files[0], state.pickSlot);
      input.value = "";
    });

    // Glisser-déposer (n'importe quelle dropzone ; le navigateur n'ouvre jamais le fichier)
    const clearDrag = () => $$(".dropzone[data-drag]").forEach((z) => delete z.dataset.drag);
    window.addEventListener("dragover", (e) => {
      e.preventDefault();
      const dz = e.target instanceof Element ? e.target.closest(".dropzone") : null;
      $$(".dropzone").forEach((z) => (z === dz ? (z.dataset.drag = "true") : delete z.dataset.drag));
    });
    window.addEventListener("dragleave", (e) => {
      if (!e.relatedTarget) clearDrag();
    });
    window.addEventListener("drop", (e) => {
      e.preventDefault();
      const dz = e.target instanceof Element ? e.target.closest(".dropzone") : null;
      clearDrag();
      if (dz && e.dataTransfer) selectFiles(e.dataTransfer.files, dz.dataset.slot);
    });

    window.addEventListener("popstate", () => showTab(location.hash.slice(1), false));
    window.addEventListener("resize", positionIndicators);

    const detail = $("#detail");
    detail.addEventListener("click", (e) => {
      if (e.target === detail || (e.target instanceof Element && e.target.closest("[data-close-detail]"))) detail.close();
    });
    const confirmDlg = $("#confirm");
    confirmDlg.addEventListener("click", (e) => {
      if (e.target === confirmDlg) confirmDlg.close("");
    });

    // Champs dynamiques : calculateur, checklist, statut du journal
    const onField = (e) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t) return;
      if (t.matches("[data-calc-input]")) onCalcInput(t);
      else if (t.matches("[data-check]") && e.type === "change") onCheck(t);
      else if (t.matches("[data-status-select]") && e.type === "change") setStatus(t.dataset.id, t.value);
    };
    document.addEventListener("input", onField);
    document.addEventListener("change", onField);

    // Formulaire d'annonce macro
    document.addEventListener("submit", (e) => {
      if (e.target instanceof HTMLFormElement && e.target.id === "macro-form") {
        e.preventDefault();
        addManualEvent(e.target);
        e.target.reset();
      }
    });

    // Ctrl+V / Cmd+V depuis n'importe quel onglet
    window.addEventListener("paste", (e) => {
      if (e.target instanceof Element && e.target.closest("input, textarea, dialog")) return;
      const item = Array.from((e.clipboardData && e.clipboardData.items) || []).find((i) => i.type.startsWith("image/"));
      const file = item && item.getAsFile();
      if (!file) return;
      e.preventDefault();
      flashPasteHint();
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
    const savedStyle = local.get(CONFIG.KEYS.style);
    if (STYLES[savedStyle]) state.style = savedStyle;
    if (local.get(CONFIG.KEYS.mode) === "mtf") state.mode = "mtf";

    renderStatic();
    renderDemo();
    renderKeyStatus();
    renderSlots();
    renderScanner();
    bindEvents();
    bindSettings();
    initMacro();
    setInterval(renderMacro, 30000);
    showTab(location.hash.slice(1), false);

    // Révèle la page une fois Tailwind appliqué (évite le flash non stylé)
    requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.add("is-ready")));
    if (document.fonts) document.fonts.ready.then(positionIndicators);
  }

  init();
})();
