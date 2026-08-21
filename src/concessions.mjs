// Referentiel des concessions + recherche de la plus proche d'un code postal.
// Le fichier data/concessions.json est charge une fois au demarrage (188 entrees,
// quelques dizaines de Ko) : aucune base de donnees n'est necessaire a cette echelle.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GEOCODE = "https://api-adresse.data.gouv.fr/search/";

const { concessions } = JSON.parse(
  fs.readFileSync(path.join(RACINE, "data/concessions.json"), "utf8")
);

export const toutesLesConcessions = concessions;

// Distance orthodromique (haversine) en km. Suffisant : on classe des points en
// France, pas besoin d'un calcul geodesique exact ni de PostGIS.
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Cache memoire : un meme code postal revient souvent d'une conversation a l'autre.
const cacheCp = new Map();

/** Localise un code postal francais (5 chiffres) -> {latitude, longitude, commune}. */
export async function localiserCodePostal(codePostal) {
  const cp = String(codePostal).trim().match(/\b\d{5}\b/)?.[0];
  if (!cp) return null;
  if (cacheCp.has(cp)) return cacheCp.get(cp);

  const url = new URL(GEOCODE);
  url.searchParams.set("q", cp);
  url.searchParams.set("type", "municipality");
  url.searchParams.set("limit", "1");
  let resultat = null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const f = (await res.json()).features?.[0];
      if (f) {
        const [lon, lat] = f.geometry.coordinates;
        resultat = {
          code_postal: f.properties.postcode || cp,
          commune: f.properties.city || f.properties.name,
          latitude: lat,
          longitude: lon,
        };
      }
    }
  } catch {
    /* reseau indisponible : on rend null, l'appelant redemande le code postal */
  }
  cacheCp.set(cp, resultat);
  return resultat;
}

// Au-dela de cette distance, on considere qu'il n'y a PAS de concession desservant
// le client. Le reseau ne couvre que la metropole : sans ce garde-fou, un client de
// La Reunion (97400) se voit proposer Ajaccio a 8476 km, ce qui discredite le bot.
const DISTANCE_MAX_KM = 150;

/**
 * Concessions les plus proches d'un code postal, triees par distance croissante.
 * `trop_loin` a vrai = aucune concession a portee, il ne faut rien proposer.
 * @returns {Promise<{origine, trop_loin, resultats: Array<concession & {distance_km}>}|null>}
 */
export async function concessionsProches(codePostal, nb = 3) {
  const origine = await localiserCodePostal(codePostal);
  if (!origine) return null;
  const resultats = concessions
    .map((c) => ({
      ...c,
      distance_km:
        Math.round(
          distanceKm(origine.latitude, origine.longitude, c.latitude, c.longitude) * 10
        ) / 10,
    }))
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, nb);
  const trop_loin = !resultats.length || resultats[0].distance_km > DISTANCE_MAX_KM;
  return { origine, trop_loin, resultats: trop_loin ? [] : resultats };
}
