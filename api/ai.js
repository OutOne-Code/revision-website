/**
 * Fonction serverless Vercel — assistant IA de l'application de révision.
 *
 * EMPLACEMENT : place ce fichier dans ton dépôt Vercel à la racine, sous  api/ai.js
 *   mon-projet/
 *     api/ai.js        <-- ce fichier
 *     index.html
 *     script.js
 *     style.css
 *
 * VARIABLE D'ENVIRONNEMENT à créer dans Vercel (Settings > Environment Variables) :
 *   GEMINI_API_KEY  = ta clé Google AI Studio (https://aistudio.google.com/apikey)
 *
 * L'appel côté navigateur se fait sur /api/ai (même domaine : aucun souci de CORS).
 */

const MODEL = "gemini-2.5-flash";
const ENDPOINT = (model, key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

const QUIZ_SYSTEM = `Tu es un professeur français qui crée des quiz de révision.
À partir du cours fourni, génère un quiz au format JSON STRICT :
{"questions":[{"question":"...","options":["a","b","c","d"],"answer":0,"explanation":"..."}]}
Règles : uniquement des notions présentes dans le cours, 4 options plausibles par question,
"answer" est l'index (0-3) de la bonne réponse, explication courte et pédagogique, en français.`;

const ADVICE_SYSTEM = `Tu es un coach scolaire français bienveillant et concret.
À partir des notes, matières, chapitres et devoirs de l'élève, réponds en JSON STRICT :
{"summary":"bilan en 2-3 phrases",
 "priorities":[{"subject":"nom","level":"urgent|à consolider|solide","why":"...","topics":["point de leçon 1","point 2"],"actions":["conseil concret 1","conseil 2"]}],
 "tips":["conseil de méthode 1","conseil 2","conseil 3"]}
Classe les matières de la plus urgente à la plus solide. Sois précis, en français, sans blabla.`;

const CHAT_SYSTEM = `Tu es l'assistant de révision de l'élève, en français.
Tu connais ses matières, ses chapitres, ses notes et ses devoirs (fournis en contexte).
Donne des conseils concrets, courts et encourageants. Utilise du markdown léger si utile.`;

async function askAI({ system, turns, jsonMode }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return { status: 500, body: { error: "Clé IA manquante côté serveur (GEMINI_API_KEY)." } };
  }

  const res = await fetch(ENDPOINT(MODEL, key), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: turns.map((t) => ({
        role: t.role === "assistant" ? "model" : "user",
        parts: [{ text: t.content }],
      })),
      generationConfig: jsonMode ? { responseMimeType: "application/json" } : {},
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error("Gemini error", res.status, detail);
    const message =
      res.status === 429
        ? "Trop de demandes à l'IA, réessaie dans quelques instants."
        : res.status === 401 || res.status === 403
          ? "Clé IA invalide ou refusée."
          : `Erreur IA (${res.status}).`;
    return { status: res.status, body: { error: message } };
  }

  const data = await res.json();
  const content =
    (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("") || "";

  if (!jsonMode) return { status: 200, body: { content } };

  try {
    const cleaned = content
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/, "");
    return { status: 200, body: { data: JSON.parse(cleaned) } };
  } catch {
    return { status: 502, body: { error: "Réponse IA illisible.", raw: content } };
  }
}

export default async function handler(req, res) {
  // CORS (utile seulement si l'app est servie depuis un autre domaine)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée." });

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body || {};
  if (!body) return res.status(400).json({ error: "Requête invalide." });

  let result;

  if (body.mode === "quiz") {
    const lesson = String(body.lesson || "").slice(0, 20000).trim();
    if (lesson.length < 40) {
      return res.status(400).json({ error: "Le cours est trop court pour générer un quiz." });
    }
    const count = Math.min(Math.max(Number(body.count) || 8, 3), 15);
    result = await askAI({
      system: QUIZ_SYSTEM,
      jsonMode: true,
      turns: [
        {
          role: "user",
          content: `Chapitre : ${body.title || "Sans titre"}\nNombre de questions : ${count}\n\nCours :\n${lesson}`,
        },
      ],
    });
  } else if (body.mode === "advice") {
    result = await askAI({
      system: ADVICE_SYSTEM,
      jsonMode: true,
      turns: [{ role: "user", content: String(body.context || "").slice(0, 20000) }],
    });
  } else if (body.mode === "chat") {
    const history = (body.messages || []).slice(-20).map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || "").slice(0, 4000),
    }));
    result = await askAI({
      system: `${CHAT_SYSTEM}\n\nContexte élève :\n${String(body.context || "").slice(0, 12000)}`,
      jsonMode: false,
      turns: history.length ? history : [{ role: "user", content: "Bonjour" }],
    });
  } else {
    return res.status(400).json({ error: "Mode inconnu." });
  }

  return res.status(result.status).json(result.body);
}

function safeParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}
