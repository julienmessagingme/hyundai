// Catalogue vehicules : chargement et mise en forme pour le prompt.
//
// 17 modeles seulement. Le catalogue condense tient dans le prompt systeme, donc le
// modele voit TOUT a chaque tour : plus fiable qu'une recherche vectorielle sur 17
// items, et cela supprime une infrastructure entiere (base, embeddings, index).
import fs from "node:fs";
import path from "node:path";
import { RACINE } from "./env.mjs";

const { vehicules } = JSON.parse(
  fs.readFileSync(path.join(RACINE, "data/vehicules.json"), "utf8")
);

export const tousLesVehicules = vehicules;
/** Ceux que le bot a le droit de recommander (hors serie speciale et page teaser). */
export const vehiculesConseillables = vehicules.filter((v) => v.conseillable);

export function vehiculeParSlug(slug) {
  if (!slug) return null;
  const cle = String(slug).trim().toLowerCase();
  return (
    vehicules.find((v) => v.slug === cle) ||
    // tolerance : le modele peut renvoyer le nom commercial plutot que le slug
    vehicules.find((v) => v.nom.toLowerCase() === cle) ||
    vehicules.find((v) => v.slug.replace(/-/g, " ") === cle.replace(/-/g, " ")) ||
    null
  );
}

const euros = (n) => (n ? `${n.toLocaleString("fr-FR")} EUR` : "prix non communique");

/**
 * Catalogue condense injecte dans le prompt systeme (~2000 tokens).
 * Contient de quoi CHOISIR et ARGUMENTER : caracteristiques chiffrees, profil vise
 * et contre-indication. Le "a eviter si" est essentiel : sans lui le modele vend
 * n'importe quel vehicule a n'importe qui.
 */
export function catalogueCondense() {
  return vehiculesConseillables
    .map((v) => {
      const specs = [
        v.categorie,
        v.motorisation,
        `${v.places} places`,
        euros(v.prix_a_partir_de),
        v.autonomie_km && `${v.autonomie_km} km d'autonomie`,
        v.batterie_kwh && `batterie ${v.batterie_kwh} kWh`,
        v.puissance_ch && `${v.puissance_ch} ch`,
        v.coffre_l && `coffre ${v.coffre_l} L`,
        v.recharge_10_80_min && `charge rapide ${v.recharge_10_80_min} min`,
      ]
        .filter(Boolean)
        .join(" | ");
      return [
        `### ${v.nom}  [slug: ${v.slug}]`,
        specs,
        v.points_forts?.length ? `Points forts : ${v.points_forts.join(" ; ")}` : null,
        v.profil_ideal ? `Ideal pour : ${v.profil_ideal}` : null,
        v.a_eviter_si ? `A eviter si : ${v.a_eviter_si}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

/**
 * Questions reponses officielles Hyundai d'un vehicule, pour repondre precisement
 * sans inventer. Injectees a la demande via l'outil, pas dans le prompt systeme :
 * 56 Q/R pesent plus lourd que le catalogue entier.
 */
export function faqVehicule(slug) {
  const v = vehiculeParSlug(slug);
  if (!v) return null;
  return {
    nom: v.nom,
    url: v.url,
    faq: v.faq,
    caracteristiques: {
      categorie: v.categorie,
      motorisation: v.motorisation,
      places: v.places,
      prix_a_partir_de: v.prix_a_partir_de,
      autonomie_km: v.autonomie_km,
      batterie_kwh: v.batterie_kwh,
      puissance_ch: v.puissance_ch,
      coffre_l: v.coffre_l,
      recharge_10_80_min: v.recharge_10_80_min,
      longueur_mm: v.longueur_mm,
    },
    points_forts: v.points_forts,
    a_eviter_si: v.a_eviter_si,
  };
}
