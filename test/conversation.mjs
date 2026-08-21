// Joue une conversation complete contre l'agent, SANS rien envoyer sur WhatsApp :
// on appelle traiterMessage directement, les envois ne sont que decrits.
// But : verifier que le parcours va jusqu'au lead qualifie sans se bloquer.
import { traiterMessage } from "../src/agent.mjs";

const USER = "test-" + Math.random().toString(36).slice(2, 8);

const SCENARIO = [
  "un véhicule neuf",
  "oui allez-y",
  "on est 5 à la maison, 3 enfants, et on fait beaucoup de route le week-end",
  "l'impact carbone ça compte pour moi, mais j'habite en appartement je peux pas recharger chez moi",
  "il fait quelle taille de coffre le premier ?",
  "ok ça m'intéresse, je peux le voir quelque part ?",
  "on veut changer de voiture d'ici 2 mois",
  "j'habite au 75011",
  "être rappelé",
];

const ETAPES_ATTENDUES = ["proposition", "localisation", "termine"];

let vus = new Set();
let vehiculesPousses = 0;
let concessionPoussee = false;
let menuPousse = false;

for (const [i, message] of SCENARIO.entries()) {
  const t0 = Date.now();
  const r = await traiterMessage(USER, message);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n[${i + 1}] CLIENT : ${message}`);
  console.log(`    BOT    : ${r.reponse.replace(/\n/g, "\n             ")}`);
  console.log(`    etape=${r.etape}  ${dt}s`);

  for (const s of r.sortants) {
    if (s.type === "vehicule") {
      vehiculesPousses++;
      console.log(`    -> CARTE : ${s.nom}`);
      console.log(`         argu  : ${s.argumentaire}`);
      console.log(`         photo : ${s.photo ? "ok" : "MANQUANTE"}   lien : ${s.url ? "ok" : "MANQUANT"}`);
    } else if (s.type === "concession") {
      concessionPoussee = true;
      console.log(`    -> GPS   : ${s.concession.latitude}, ${s.concession.longitude}`);
      console.log(`         desc  : ${s.description.replace(/\n/g, " / ")}`);
    } else if (s.type === "menu") {
      menuPousse = true;
      console.log(`    -> MENU PRINCIPAL`);
    }
  }
  vus.add(r.etape);
}

console.log("\n" + "=".repeat(64));
const manquantes = ETAPES_ATTENDUES.filter((e) => !vus.has(e));
const controles = [
  ["deux vehicules pousses", vehiculesPousses >= 2],
  ["concession poussee avec GPS", concessionPoussee],
  ["retour menu principal", menuPousse],
  ["etapes du parcours atteintes", manquantes.length === 0],
];
for (const [libelle, ok] of controles) {
  console.log(`  ${ok ? "OK  " : "ECHEC"}  ${libelle}`);
}
if (manquantes.length) console.log(`         etapes manquantes : ${manquantes.join(", ")}`);

const tout = controles.every(([, ok]) => ok);
console.log("=".repeat(64));
console.log(tout ? "Parcours complet." : "Parcours INCOMPLET.");
process.exit(tout ? 0 : 1);
