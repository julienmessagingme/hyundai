// Structure les caracteristiques de chaque modele a partir du texte scrape.
//
// Pourquoi le LLM et pas des expressions regulieres : les specs sont presentees en
// tableau MULTI VERSIONS ("42 kWh" et "49 kWh" en colonnes, "327 km" / "370 km") et
// la structure change d'une page a l'autre. Un parseur par page serait fragile et
// silencieusement faux. Ici l'extraction se fait UNE FOIS, le resultat est fige dans
// data/vehicules.json et versionne : aucun cout ni aucune latence a chaud.
//
// Sortie : data/vehicules.json (versionne).
import fs from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";

const RAW = "data/raw";
const OUT = "data/vehicules.json";
const CONCURRENCE = 2; // 17 pages, on reste poli avec le gateway

// Presents dans le catalogue mais a ne PAS recommander a un client :
// une serie speciale et une page teaser d'un modele a venir, sans prix ni fiche
// technique exploitable. Ils restent dans le fichier (le bot doit savoir repondre
// si on lui en parle) mais sont exclus des propositions.
const NON_CONSEILLABLES = new Set(["ultime-edition", "kona-nouvelle-generation"]);

const env = Object.fromEntries(
  (await fs.readFile(".env", "utf8"))
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

// Depuis l'ajout de la page equipements, le prompt a double et les requetes longues
// tombent en "Connection error". On laisse donc au SDK le soin de reessayer, avec un
// timeout large : c'est un traitement hors ligne, la duree importe peu, l'exhaustivite si.
const client = new OpenAI({
  apiKey: env.AI_GATEWAY_API_KEY,
  baseURL: env.LLM_BASE_URL || "https://ai-gateway.vercel.sh/v1",
  maxRetries: 5,
  timeout: 180000,
});
const MODEL = env.LLM_MODEL || "google/gemini-3-flash";

const CONSIGNE = `Tu extrais les caracteristiques d'un vehicule depuis le texte de sa page officielle Hyundai France.

Rends UNIQUEMENT un objet JSON, sans commentaire ni bloc de code, avec ces cles :

- "categorie": une seule valeur parmi "citadine", "SUV urbain", "SUV compact", "SUV familial", "monospace", "berline", "utilitaire"
- "places": nombre de places (entier)
- "prix_a_partir_de": prix d'entree de gamme en euros (entier), ou null si absent
- "autonomie_km": autonomie WLTP MAXIMALE annoncee (entier), ou null si non electrifie
- "batterie_kwh": capacite de la plus GRANDE batterie (nombre), ou null
- "puissance_ch": puissance MAXIMALE en chevaux (entier), ou null
- "coffre_l": volume de coffre minimal en litres, sieges en place (entier), ou null
- "recharge_10_80_min": duree de charge rapide 10 a 80% en minutes (entier), ou null
- "longueur_mm": longueur du vehicule en mm (entier), ou null
- "offre_loa": l'offre de location telle qu'ELLE EST ECRITE sur la page, par exemple
  "a partir de 139 EUR/mois en LLD sur 37 mois et 45 000 km", ou null si la page
  n'annonce aucune mensualite. N'assemble jamais une offre a partir du prix d'achat.
- "points_forts": 3 a 5 arguments courts et CONCRETS, chiffres quand c'est possible
- "profil_ideal": une phrase disant a QUI ce vehicule convient le mieux et pourquoi
- "a_eviter_si": une phrase disant dans quel cas ce vehicule N'EST PAS le bon choix

Regles imperatives :
- N'invente RIEN. Toute valeur absente du texte vaut null.
- Le texte peut citer d'AUTRES modeles Hyundai (comparatifs, encarts pedagogiques,
  navigation). N'utilise QUE ce qui concerne le vehicule nomme ci-dessus. Dans le
  doute, mets null.
- Une autonomie electrique ne concerne QUE les vehicules electriques ou hybrides
  rechargeables. Pour un hybride simple ou un thermique, "autonomie_km" vaut null.
- Quand plusieurs versions coexistent, prends la valeur MAXIMALE et ignore les autres.
- "points_forts", "profil_ideal" et "a_eviter_si" doivent servir un conseiller qui
  doit recommander honnetement : sois factuel, pas promotionnel.`;

// Le texte d'une page porte le menu, le pied de page et des encarts pedagogiques
// communs a TOUT le site ("9 idees recues sur l'hybride", la liste des autres
// modeles...). Le LLM prenait ce bruit pour des specs : le SANTA FE Hybrid heritait
// des 65 km et 13,8 kWh du PLUG-IN. On retire donc les lignes presentes dans la
// plupart des pages : ce qui est partout n'appartient a aucun vehicule en propre.
function retirerBoilerplate(fiches, seuil = 0.6) {
  const min = Math.ceil(fiches.length * seuil);
  const freq = new Map();
  for (const f of fiches) {
    for (const l of new Set([...f.texte.split("\n"), ...(f.texte_equipements || "").split("\n")]))
      freq.set(l, (freq.get(l) || 0) + 1);
  }
  let avant = 0;
  let apres = 0;
  // Les deux pages portent le meme menu et le meme pied de page : on nettoie aussi
  // la page equipements, sinon le bruit revient par elle.
  for (const f of fiches) {
    for (const champ of ["texte", "texte_equipements"]) {
      if (!f[champ]) continue;
      const lignes = f[champ].split("\n");
      avant += lignes.length;
      const gardees = lignes.filter((l) => (freq.get(l) || 0) < min);
      apres += gardees.length;
      f[champ] = gardees.join("\n");
    }
  }
  console.log(`Boilerplate retire : ${avant - apres} lignes sur ${avant}`);
  return fiches;
}

// La motorisation est certaine des lors qu'on lit le nom commercial : on ne la
// DEMANDE donc pas au LLM, on la DEDUIT. Regle d'or : ne jamais confier a un modele
// ce qu'un test deterministe tranche sans risque.
function motorisationDepuisNom(nom, slug) {
  const t = `${nom} ${slug}`.toLowerCase();
  if (/plug-?in|phev/.test(t)) return "hybride rechargeable";
  if (/hybrid/.test(t)) return "hybride";
  if (/nexo|hydrog/.test(t)) return "hydrogene";
  if (/electric|ioniq|inster/.test(t)) return "100% electrique";
  return "essence";
}

// Meme contamination que pour les champs chiffres, mais dans le TEXTE LIBRE : les
// points forts du TUCSON Hybrid annoncaient "288 ch en version rechargeable" et
// "autonomie electrique 92 km", qui sont ceux du PLUG-IN. Sur un vehicule qui ne se
// branche pas, tout argument de recharge ou d'autonomie electrique est faux : on le
// retire plutot que d'esperer que le modele n'en parlera pas.
const ARGUMENT_RECHARGEABLE =
  /rechargeable|plug-?in|autonomie [ée]lectrique|se recharge|recharge (rapide|ultra|en|de|sur)|borne|kwh|\d+\s*km (d'|en )?[ée]lectrique|batterie de \d/i;

function nettoyerArguments(vehicule) {
  if (/electrique|rechargeable/.test(vehicule.motorisation)) return vehicule;
  const avant = vehicule.points_forts?.length || 0;
  if (Array.isArray(vehicule.points_forts)) {
    vehicule.points_forts = vehicule.points_forts.filter((p) => !ARGUMENT_RECHARGEABLE.test(p));
  }
  for (const cle of ["profil_ideal", "a_eviter_si"]) {
    if (vehicule[cle] && ARGUMENT_RECHARGEABLE.test(vehicule[cle])) vehicule[cle] = null;
  }
  const retires = avant - (vehicule.points_forts?.length || 0);
  if (retires) console.log(`      (${vehicule.slug} : ${retires} argument(s) de recharge retire(s))`);
  return vehicule;
}

// Une mensualite doit RESTER une mensualite : le modele rend parfois "199 EUR" seul,
// alors que la page dit "a partir de 199 EUR /mois". Presente tel quel, ce montant se
// lit comme un prix d'achat. Sans mention de periodicite, on prefere ne rien annoncer.
function offreLoaValide(offre) {
  const t = String(offre || "").trim();
  if (!t) return null;
  if (!/\/\s*mois|par mois|mensualit|lld|loa|location/i.test(t)) return null;
  if (!/\d/.test(t)) return null;
  return t;
}

const CONSIGNE_FINITIONS = `Tu lis la page "equipements" d'un modele Hyundai France et tu en tires ses FINITIONS, c'est a dire les versions commercialisees du vehicule.

Rends UNIQUEMENT un objet JSON de la forme :
{"finitions": [{"nom": "Intuitive", "apports": "...", "prix": 25350}]}

- "nom" : le nom de la finition (Intuitive, Creative, Executive, Initia, N Line...)
- "apports" : en UNE phrase, ce que cette finition ajoute par rapport a la precedente
- "prix" : son tarif en euros si la page l'indique, sinon null
- classe-les dans l'ordre croissant de gamme
- liste vide si la page n'en presente aucune

N'inclus NI les options, NI les accessoires, NI les coloris : uniquement les versions
du vehicule. N'invente aucun nom : s'il n'est pas ecrit sur la page, il n'existe pas.`;

/**
 * Les finitions font l'objet d'un appel SEPARE, sur la seule page equipements.
 * Fusionner les deux taches dans un unique appel doublait la taille du prompt et
 * faisait tomber une requete sur trois en "Connection error". Un appel = une tache :
 * les prompts restent courts, et l'echec d'une extraction n'emporte pas l'autre.
 */
/**
 * Isole la zone des finitions dans un texte de page.
 * Les finitions sont annoncees par des blocs "Equipements supplementaires par rapport
 * a la finition X" : on prend donc de la premiere a la derniere mention de
 * "finition", avec une marge. Cela evite d'envoyer la page entiere au modele, ce qui
 * faisait tomber une requete sur trois.
 */
function zoneFinitions(texte, marge = 14) {
  const lignes = String(texte || "").split("\n");
  const reperes = lignes
    .map((l, i) => (/finition/i.test(l) ? i : -1))
    .filter((i) => i >= 0);
  if (!reperes.length) return "";
  // Une plage continue de la premiere a la derniere mention peut couvrir la page
  // entiere (30 000 caracteres sur l'INSTER et le TUCSON), donc etre tronquee et
  // perdre justement les finitions. On prend une FENETRE autour de chaque mention,
  // et on ne garde chaque ligne qu'une fois.
  const gardees = new Set();
  for (const i of reperes) {
    for (let j = Math.max(0, i - marge); j < Math.min(lignes.length, i + marge); j++) {
      gardees.add(j);
    }
  }
  return [...gardees]
    .sort((a, b) => a - b)
    .map((i) => lignes[i])
    .join("\n");
}

async function extraireFinitions(fiche) {
  // Les finitions figurent sur la page PRINCIPALE du modele ("Configurer / Creative /
  // Equipements supplementaires par rapport a la finition Intuitive"), pas sur la page
  // equipements, qui ne porte que la liste d'equipements par categorie.
  const source = [zoneFinitions(fiche.texte), zoneFinitions(fiche.texte_equipements)]
    .filter(Boolean)
    .join("\n\n");
  if (!source) return [];
  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: CONSIGNE_FINITIONS },
      {
        role: "user",
        content:
          `Vehicule : ${fiche.nom}\n\n` +
          `--- EXTRAIT DE LA PAGE, ZONE DES FINITIONS ---\n${source.slice(0, 9000)}\n--- FIN ---`,
      },
    ],
  });
  try {
    const j = JSON.parse((completion.choices[0].message.content || "{}").replace(/^```json\s*|\s*```$/g, ""));
    return Array.isArray(j.finitions) ? j.finitions.filter((f) => f && f.nom) : [];
  } catch {
    return [];
  }
}

async function extraire(fiche) {
  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: CONSIGNE },
      {
        role: "user",
        content:
          `Vehicule : ${fiche.nom}\n` +
          `Motorisation (certaine) : ${motorisationDepuisNom(fiche.nom, fiche.slug)}\n` +
          `Description officielle : ${fiche.description}\n` +
          `Prix annonce dans les donnees structurees : ${fiche.prix_a_partir_de ?? "absent"}\n\n` +
          `--- TEXTE DE LA PAGE ---\n${fiche.texte.slice(0, 18000)}\n--- FIN ---`,
      },
    ],
  });
  const brut = completion.choices[0].message.content || "{}";
  const json = JSON.parse(brut.replace(/^```json\s*|\s*```$/g, ""));
  return { json, usage: completion.usage };
}

async function main() {
  const fichiers = (await fs.readdir(RAW)).filter((f) => f.endsWith(".json"));
  const fiches = await Promise.all(
    fichiers.map(async (f) => JSON.parse(await fs.readFile(path.join(RAW, f), "utf8")))
  );
  retirerBoilerplate(fiches);
  console.log(`${fiches.length} fiches a structurer (modele ${MODEL})\n`);

  const vehicules = [];
  let tokensIn = 0;
  let tokensOut = 0;

  // Traitement par vagues : simple et suffisant pour 17 elements.
  for (let i = 0; i < fiches.length; i += CONCURRENCE) {
    const vague = fiches.slice(i, i + CONCURRENCE);
    const resultats = await Promise.all(
      vague.map(async (fiche) => {
        try {
          const { json, usage } = await extraire(fiche);
          const finitions = await extraireFinitions(fiche);
          tokensIn += usage?.prompt_tokens || 0;
          tokensOut += usage?.completion_tokens || 0;
          const motorisation = motorisationDepuisNom(fiche.nom, fiche.slug);
          // Photo a pousser sur WhatsApp : l'image officielle du Product, sinon la
          // premiere vue exterieure (2 modeles n'ont pas d'image dans le Product).
          const photo =
            fiche.image_principale ||
            fiche.photos.find((p) => p.vue === "exterieur")?.url ||
            fiche.photos[0]?.url ||
            null;
          // Une autonomie "batterie" n'a aucun sens sur un hybride simple ou un
          // thermique : on la neutralise plutot que de laisser passer une valeur
          // ramassee sur un encart voisin. L'hydrogene, lui, a bien une autonomie
          // annoncee (le NEXO depasse les 700 km) mais pas de batterie de traction.
          const aUneAutonomie = /electrique|rechargeable|hydrogene/.test(motorisation);
          const aUneBatterie = /electrique|rechargeable/.test(motorisation);
          return {
            slug: fiche.slug,
            nom: fiche.nom,
            url: fiche.url,
            description: fiche.description,
            photo,
            photos_exterieur: fiche.photos.filter((p) => p.vue === "exterieur").slice(0, 8).map((p) => p.url),
            photos_interieur: fiche.photos
              .filter((p) => p.vue === "interieur")
              .slice(0, 8)
              .map((p) => p.url),
            videos: fiche.videos.filter((v) => v.type === "mp4").map((v) => v.url),
            faq: fiche.faq,
            ...json,
            // valeurs sures : elles ecrasent toute sortie du LLM
            motorisation,
            finitions,
            offre_loa: offreLoaValide(json.offre_loa),
            conseillable: !NON_CONSEILLABLES.has(fiche.slug),
            prix_a_partir_de: fiche.prix_a_partir_de ?? json.prix_a_partir_de ?? null,
            autonomie_km: aUneAutonomie ? json.autonomie_km ?? null : null,
            batterie_kwh: aUneBatterie ? json.batterie_kwh ?? null : null,
            // Toute la gamme est a 5 places sauf les grands SUV et le monospace, que
            // l'extraction identifie deja (SANTA FE et IONIQ 9 a 7, STARIA a 9).
            // Un defaut a 5 est donc exact ici, la ou null bloquerait le conseil famille.
            places: json.places ?? 5,
          };
        } catch (e) {
          console.error(`  KO  ${fiche.slug} : ${e.message}`);
          return null;
        }
      })
    );
    for (const r of resultats) {
      if (!r) continue;
      vehicules.push(nettoyerArguments(r));
      console.log(
        `  ok  ${r.slug.padEnd(26)} ${String(r.categorie || "?").padEnd(14)} ` +
          `${r.motorisation.padEnd(20)} ${String(r.places ?? "?").padStart(2)}pl  ` +
          `${r.prix_a_partir_de ? String(r.prix_a_partir_de).padStart(5) + " EUR" : "  prix ?"}` +
          `${r.autonomie_km ? "  " + r.autonomie_km + " km" : ""}`
      );
    }
  }

  // Une extraction qui echoue sur quelques modeles ne doit PAS publier un catalogue
  // ampute : le bot proposerait alors un choix reduit sans que rien ne le signale.
  // On repasse une fois sur les manquants, puis on refuse d'ecrire si le compte n'y est pas.
  const manquants = fiches.filter((f) => !vehicules.some((v) => v.slug === f.slug));
  if (manquants.length) {
    console.log(`\n${manquants.length} echec(s), seconde tentative : ${manquants.map((f) => f.slug).join(", ")}`);
    for (const fiche of manquants) {
      try {
        const { json } = await extraire(fiche);
        const motorisation = motorisationDepuisNom(fiche.nom, fiche.slug);
        const electrifie = /electrique|rechargeable|hydrogene/.test(motorisation);
        vehicules.push(
          nettoyerArguments({
            slug: fiche.slug,
            nom: fiche.nom,
            url: fiche.url,
            description: fiche.description,
            photo:
              fiche.image_principale ||
              fiche.photos.find((p) => p.vue === "exterieur")?.url ||
              fiche.photos[0]?.url ||
              null,
            photos_exterieur: fiche.photos.filter((p) => p.vue === "exterieur").slice(0, 8).map((p) => p.url),
            photos_interieur: fiche.photos.filter((p) => p.vue === "interieur").slice(0, 8).map((p) => p.url),
            videos: fiche.videos.filter((v) => v.type === "mp4").map((v) => v.url),
            faq: fiche.faq,
            ...json,
            motorisation,
            offre_loa: offreLoaValide(json.offre_loa),
            conseillable: !NON_CONSEILLABLES.has(fiche.slug),
            prix_a_partir_de: fiche.prix_a_partir_de ?? json.prix_a_partir_de ?? null,
            autonomie_km: electrifie ? json.autonomie_km ?? null : null,
            batterie_kwh: /electrique|rechargeable/.test(motorisation) ? json.batterie_kwh ?? null : null,
            places: json.places ?? 5,
          })
        );
        console.log(`  rattrape  ${fiche.slug}`);
      } catch (e) {
        console.error(`  KO definitif  ${fiche.slug} : ${e.message}`);
      }
    }
  }

  if (vehicules.length !== fiches.length) {
    console.error(
      `\nECHEC : ${vehicules.length}/${fiches.length} vehicules seulement. ` +
        `${OUT} n'est PAS reecrit (un catalogue ampute se verrait a l'usage, pas au deploiement).`
    );
    process.exit(1);
  }

  vehicules.sort((a, b) => (a.prix_a_partir_de ?? 1e9) - (b.prix_a_partir_de ?? 1e9));
  await fs.writeFile(
    OUT,
    JSON.stringify(
      {
        genere_le: new Date().toISOString(),
        modele_extraction: MODEL,
        total: vehicules.length,
        vehicules,
      },
      null,
      2
    ),
    "utf8"
  );

  const cout = (tokensIn * 0.5 + tokensOut * 3) / 1e6;
  console.log(`\n${vehicules.length}/${fiches.length} vehicules ecrits dans ${OUT}`);
  console.log(`tokens : ${tokensIn} entree / ${tokensOut} sortie  ->  ~$${cout.toFixed(4)}`);
}

main().catch((e) => {
  console.error("Echec :", e);
  process.exit(1);
});
