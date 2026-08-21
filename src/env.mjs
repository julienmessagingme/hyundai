// Lecture du .env sans dependance. Les variables du process ont la priorite, ce qui
// permet de surcharger ponctuellement (PM2, tests) sans toucher au fichier.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function lireFichier() {
  const chemin = path.join(RACINE, ".env");
  if (!fs.existsSync(chemin)) return {};
  const valeurs = {};
  for (const ligne of fs.readFileSync(chemin, "utf8").split("\n")) {
    const t = ligne.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    valeurs[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return valeurs;
}

export const env = { ...lireFichier(), ...process.env };

/** Arrete le demarrage si une variable indispensable manque, plutot que d'echouer en vol. */
export function exigerVariables(noms) {
  const absentes = noms.filter((n) => !env[n]);
  if (absentes.length) {
    console.error(`Variables manquantes dans .env : ${absentes.join(", ")}`);
    process.exit(1);
  }
}
