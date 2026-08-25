// Complete les caracteristiques MANQUANTES du catalogue, sans toucher au reste.
//
// L'extraction complete (extract.mjs) rend un catalogue entier mais son resultat
// varie d'une passe a l'autre : une valeur presente hier peut revenir nulle demain.
// Ce script ne redemande QUE ce qui manque, vehicule par vehicule, avec un prompt
// court cible sur les lignes utiles du texte source. Il ne peut donc rien degrader :
// il ne fait qu'ajouter, et n'ecrase jamais une valeur existante.
import fs from "node:fs/promises";
import OpenAI from "openai";

const CATALOGUE = "data/vehicules.json";
const RAW = "data/raw";
const CHAMPS = ["coffre_l", "puissance_ch", "recharge_10_80_min", "longueur_mm"];

const env = Object.fromEntries(
  (await fs.readFile(".env", "utf8"))
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const client = new OpenAI({
  apiKey: env.AI_GATEWAY_API_KEY,
  baseURL: env.LLM_BASE_URL || "https://ai-gateway.vercel.sh/v1",
  maxRetries: 4,
  timeout: 90000,
});
// On force un modele qui raisonne : la lecture d'un tableau de specs multi-versions
// est justement ce qu'un modele "lite" rate.
const MODEL = env.LLM_MODEL_EXTRACTION || "google/gemini-3-flash";

/** Lignes du texte qui parlent de la caracteristique cherchee, avec un peu de contexte. */
function zone(texte, motif, marge = 6) {
  const lignes = String(texte || "").split("\n");
  const gardees = new Set();
  lignes.forEach((l, i) => {
    if (!motif.test(l)) return;
    for (let j = Math.max(0, i - marge); j < Math.min(lignes.length, i + marge); j++) gardees.add(j);
  });
  return [...gardees].sort((a, b) => a - b).map((i) => lignes[i]).join("\n");
}

const MOTIFS = {
  coffre_l: /coffre|chargement|litres|\bL\b|volume/i,
  puissance_ch: /\bch\b|puissance|kW\b/i,
  recharge_10_80_min: /recharge|charge|10 ?(a|à) ?80|minutes/i,
  longueur_mm: /longueur|dimensions|mm\b/i,
};

async function completer(v, fiche) {
  const manquants = CHAMPS.filter((c) => v[c] == null);
  if (!manquants.length) return 0;

  const motif = new RegExp(manquants.map((m) => MOTIFS[m].source).join("|"), "i");
  const source = [zone(fiche.texte, motif), zone(fiche.texte_equipements, motif)]
    .filter(Boolean)
    .join("\n")
    .slice(0, 7000);
  if (!source) return 0;

  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `Tu lis un extrait de la page officielle Hyundai d'un vehicule et tu en tires UNIQUEMENT les valeurs demandees.

Rends un objet JSON avec exactement ces cles : ${manquants.join(", ")}.
- "coffre_l" : volume de coffre en litres, sieges arriere EN PLACE (le plus petit des volumes annonces, pas celui sieges rabattus)
- "puissance_ch" : puissance MAXIMALE en chevaux
- "recharge_10_80_min" : duree de charge rapide de 10 a 80 % en minutes
- "longueur_mm" : longueur du vehicule en millimetres

Rends un NOMBRE ENTIER, ou null si la valeur ne figure pas dans l'extrait.
N'invente RIEN : une valeur absente vaut null. Si plusieurs versions coexistent,
prends celle du vehicule nomme, jamais celle d'un autre modele cite en comparaison.`,
      },
      { role: "user", content: `Vehicule : ${fiche.nom}\n\n--- EXTRAIT ---\n${source}\n--- FIN ---` },
    ],
  });

  let json = {};
  try {
    json = JSON.parse((completion.choices[0].message.content || "{}").replace(/^```json\s*|\s*```$/g, ""));
  } catch {
    return 0;
  }

  let ajoutes = 0;
  for (const c of manquants) {
    const val = Number(json[c]);
    // Garde-fou de plausibilite : une valeur hors bornes est une hallucination.
    const bornes = { coffre_l: [80, 3000], puissance_ch: [40, 900], recharge_10_80_min: [5, 120], longueur_mm: [3000, 5800] };
    const [min, max] = bornes[c];
    if (Number.isFinite(val) && val >= min && val <= max) {
      v[c] = Math.round(val);
      ajoutes++;
    }
  }
  return ajoutes;
}

const cat = JSON.parse(await fs.readFile(CATALOGUE, "utf8"));
let total = 0;
for (const v of cat.vehicules) {
  const manquants = CHAMPS.filter((c) => v[c] == null);
  if (!manquants.length) continue;
  try {
    const fiche = JSON.parse(await fs.readFile(`${RAW}/${v.slug}.json`, "utf8"));
    const n = await completer(v, fiche);
    total += n;
    console.log(
      `  ${v.slug.padEnd(24)} manquait ${manquants.length} -> ${n} complete(s)` +
        (v.coffre_l ? `  coffre=${v.coffre_l}L` : "")
    );
  } catch (e) {
    console.error(`  ${v.slug.padEnd(24)} echec : ${e.message.slice(0, 60)}`);
  }
}

if (total) {
  cat.complete_le = new Date().toISOString();
  await fs.writeFile(CATALOGUE, JSON.stringify(cat, null, 2), "utf8");
}
console.log(`\n${total} valeur(s) ajoutee(s) au catalogue.`);
