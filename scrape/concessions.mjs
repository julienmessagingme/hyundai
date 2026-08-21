// Construit le referentiel des concessions Hyundai France.
//
// Source : la page "liste des concessionnaires" de hyundai.fr, qui est du HTML
// statique et porte un lien par point de vente, sous la forme
//   /fr/fr/distributeurs.html/l/<ville>/<adresse-slug>/<id>
//
// Les FICHES detaillees, elles, sont vides en HTML (widget Uberall charge en JS) :
// ni GPS, ni telephone. On ne depend donc pas d'Uberall. On reconstruit l'adresse
// depuis le slug et on la geocode via api-adresse.data.gouv.fr (service public,
// gratuit, sans cle), qui rend lat/long ET le code postal -- exactement ce qu'il
// faut pour trouver la concession la plus proche d'un client.
//
// Sortie : data/concessions.json (versionne).
import fs from "node:fs/promises";

const LISTE = "https://www.hyundai.com/fr/fr/liste-concessionnaire.html";
const GEOCODE = "https://api-adresse.data.gouv.fr/search/";
const OUT = "data/concessions.json";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const DELAY_MS = 120; // l'API adresse tient 50 req/s ; on reste tres en dessous
const SCORE_MIN = 0.4; // en dessous, le geocodage est trop incertain pour etre utilise

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// "11-rue-robert-piddat" -> "11 rue robert piddat" ; "aix-en-provence" -> "aix en provence"
const deslug = (s) => decodeURIComponent(s).replace(/-/g, " ").trim();
// "aix en provence" -> "Aix En Provence"
const capital = (s) => s.replace(/\b[a-zà-ÿ]/g, (c) => c.toUpperCase());

async function geocoder(requete, codePostalIndice) {
  const url = new URL(GEOCODE);
  url.searchParams.set("q", requete);
  url.searchParams.set("limit", "1");
  if (codePostalIndice) url.searchParams.set("postcode", codePostalIndice);
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`geocodage HTTP ${res.status}`);
  const j = await res.json();
  const f = j.features?.[0];
  if (!f) return null;
  const [lon, lat] = f.geometry.coordinates;
  return {
    latitude: lat,
    longitude: lon,
    code_postal: f.properties.postcode || null,
    commune: f.properties.city || null,
    adresse_normalisee: f.properties.label || null,
    score: f.properties.score,
  };
}

async function main() {
  console.log("Recuperation de la liste des concessions...");
  const res = await fetch(LISTE, {
    headers: { "User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9" },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} sur la liste`);
  const html = await res.text();

  const brut = [
    ...new Set(
      [
        ...html.matchAll(
          /https:\/\/www\.hyundai\.com\/fr\/fr\/distributeurs\.html\/l\/([^/"]+)\/([^/"]+)\/([a-z0-9]+)/g
        ),
      ].map((m) => JSON.stringify({ ville: m[1], adresse: m[2], id: m[3], url: m[0] }))
    ),
  ].map((s) => JSON.parse(s));

  console.log(`${brut.length} concessions reperees. Geocodage...\n`);

  const concessions = [];
  let echecs = 0;
  for (const [i, c] of brut.entries()) {
    const ville = deslug(c.ville);
    const adresse = deslug(c.adresse);
    let geo = null;
    try {
      geo = await geocoder(`${adresse} ${ville}`);
      // Adresse introuvable telle quelle : on retombe sur la ville seule, ce qui
      // reste utilisable pour "la concession la plus proche" (precision ~ commune).
      if (!geo || geo.score < SCORE_MIN) {
        const parVille = await geocoder(ville);
        if (parVille && (!geo || parVille.score > geo.score)) {
          geo = { ...parVille, approximatif: true };
        }
      }
    } catch (e) {
      console.error(`  ! geocodage KO pour ${ville} : ${e.message}`);
    }

    if (!geo) {
      echecs++;
      console.error(`  KO  ${ville} (${adresse}) : non geocode`);
    } else {
      concessions.push({
        id: c.id,
        nom: `Hyundai ${capital(ville)}`,
        ville: capital(ville),
        adresse: capital(adresse),
        code_postal: geo.code_postal,
        commune: geo.commune,
        latitude: Number(geo.latitude.toFixed(6)),
        longitude: Number(geo.longitude.toFixed(6)),
        url: c.url,
        geocodage: { score: Number(geo.score.toFixed(3)), approximatif: !!geo.approximatif },
      });
    }
    if ((i + 1) % 25 === 0) console.log(`  ... ${i + 1}/${brut.length}`);
    await sleep(DELAY_MS);
  }

  concessions.sort((a, b) => a.ville.localeCompare(b.ville, "fr"));
  await fs.mkdir("data", { recursive: true });
  await fs.writeFile(
    OUT,
    JSON.stringify(
      { genere_le: new Date().toISOString(), source: LISTE, total: concessions.length, concessions },
      null,
      2
    ),
    "utf8"
  );

  const approx = concessions.filter((c) => c.geocodage.approximatif).length;
  const sansCP = concessions.filter((c) => !c.code_postal).length;
  console.log(`\n${concessions.length} concessions ecrites dans ${OUT}`);
  console.log(`  geocodage precis   : ${concessions.length - approx}`);
  console.log(`  approximatif (ville): ${approx}`);
  console.log(`  sans code postal   : ${sansCP}`);
  if (echecs) console.log(`  echecs             : ${echecs}`);
}

main().catch((e) => {
  console.error("Echec :", e);
  process.exit(1);
});
