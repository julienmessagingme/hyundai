// Client de l'API workspace messagingme.app.
//
// Deux operations suffisent a tout ce que fait ce bot :
//   PUT  /subscriber/set-user-fields   {user_ns, data:[{var_ns, value}]}
//   POST /subscriber/send-node         {user_ns, node_ns}
//
// On utilise la variante PAR var_ns (et non par nom) : les identifiants viennent
// de l'editeur, ils sont stables, et un seul appel remplit tous les champs d'un
// node. Pousser un vehicule coute donc 2 requetes, pas 5.
//
// Limite mesuree : 1000 requetes/heure/token, exposee dans les en-tetes de chaque
// reponse. On lit ce budget plutot que de tenir un compteur local, qui derive et
// ne survit pas a un redemarrage.
import { env } from "./env.mjs";

const BASE = env.MM_API_BASE || "https://ai.messagingme.app/api";
const TOKEN = env.MM_API_TOKEN;

export const mmActif = Boolean(TOKEN);

// set-user-fields et send-node sont traites en ASYNCHRONE cote messagingme.app.
// Sans ce delai, le node se declenche avant que les champs soient propages et part
// avec les valeurs du tour precedent (photo du vehicule d'avant, ancien nom...).
const PROPAGATION_MS = Number(env.MM_FIELD_PROPAGATION_MS || 1500);
// Entre deux nodes successifs : l'API livre dans l'ordre d'envoi mais WhatsApp peut
// reordonner deux messages trop rapproches.
const GAP_MS = Number(env.MM_MSG_GAP_MS || 700);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let budgetRestant = 1000;
let budgetTotal = 1000;

export const budgetMm = () => ({ restant: budgetRestant, total: budgetTotal });

async function requete(methode, chemin, corps, essai = 0) {
  const res = await fetch(BASE + chemin, {
    method: methode,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + TOKEN,
    },
    body: JSON.stringify(corps),
    signal: AbortSignal.timeout(15000),
  });

  // Source de verite du quota : les en-tetes de la reponse.
  const lim = Number(res.headers.get("x-ratelimit-limit"));
  const rem = Number(res.headers.get("x-ratelimit-remaining"));
  if (Number.isFinite(lim) && lim > 0) budgetTotal = lim;
  if (Number.isFinite(rem)) budgetRestant = rem;

  // La fenetre est fixe (reset d'un bloc, pas glissante) : on attend la vraie duree
  // annoncee si elle est courte, sinon retenter ne sert a rien.
  if (res.status === 429 && essai < 2) {
    const retry = Number(res.headers.get("retry-after"));
    const attente = Number.isFinite(retry) && retry >= 0 ? retry * 1000 : 2000 * (essai + 1);
    if (attente <= 10000) {
      console.warn(`[mm] 429 sur ${chemin}, nouvelle tentative dans ${Math.ceil(attente / 1000)}s`);
      await sleep(attente);
      return requete(methode, chemin, corps, essai + 1);
    }
  }

  return res.json().catch(() => ({}));
}

// L'API repond toujours 200 : le succes se lit dans le corps, pas dans le statut.
function verifier(r, contexte) {
  if (r && r.status === "ok") return { ok: true };
  const erreur = r?.message || r?.error || JSON.stringify(r?.errors ?? r ?? {});
  console.error(`[mm] echec ${contexte} : ${erreur}`);
  return { ok: false, erreur };
}

/** Remplit plusieurs user fields en UNE requete. `champs` = {var_ns: valeur}. */
export async function remplirChamps(userNs, champs) {
  if (!mmActif) return { ok: false, erreur: "MM_API_TOKEN absent" };
  const data = Object.entries(champs)
    .filter(([varNs, valeur]) => varNs && valeur != null)
    .map(([var_ns, valeur]) => ({ var_ns, value: String(valeur) }));
  if (!data.length) return { ok: true };
  try {
    return verifier(
      await requete("PUT", "/subscriber/set-user-fields", { user_ns: userNs, data }),
      "set-user-fields"
    );
  } catch (e) {
    return { ok: false, erreur: String(e.message) };
  }
}

/** Declenche un node de l'editeur. Le node doit etre PUBLIE, sinon l'API dit ok sans rien livrer. */
export async function envoyerNode(userNs, nodeNs) {
  if (!mmActif) return { ok: false, erreur: "MM_API_TOKEN absent" };
  if (!nodeNs) return { ok: false, erreur: "node_ns absent" };
  try {
    return verifier(
      await requete("POST", "/subscriber/send-node", { user_ns: userNs, node_ns: nodeNs }),
      `send-node ${nodeNs}`
    );
  } catch (e) {
    return { ok: false, erreur: String(e.message) };
  }
}

/**
 * Envoie un message texte au contact.
 *
 * Le texte partait initialement dans la reponse HTTP, a charge pour le flow de
 * l'afficher. Mesure du premier test reel : la requete arrivait, le bot repondait,
 * et le client ne recevait RIEN, car ce mapping n'existait pas cote editeur. On
 * n'appuie pas le fonctionnement du bot sur un cablage manuel invisible depuis le
 * code : le bot envoie desormais son texte lui-meme.
 */
export async function envoyerTexte(userNs, contenu) {
  if (!mmActif) return { ok: false, erreur: "MM_API_TOKEN absent" };
  const content = String(contenu || "").trim();
  if (!content) return { ok: true };
  try {
    return verifier(
      await requete("POST", "/subscriber/send-text", { user_ns: userNs, content }),
      "send-text"
    );
  } catch (e) {
    return { ok: false, erreur: String(e.message) };
  }
}

/** Remplit les champs, laisse le temps a la propagation, puis declenche le node. */
async function remplirPuisEnvoyer(userNs, champs, nodeNs) {
  const rempli = await remplirChamps(userNs, champs);
  if (!rempli.ok) return rempli;
  await sleep(PROPAGATION_MS);
  return envoyerNode(userNs, nodeNs);
}

/**
 * Pousse une carte vehicule (photo + nom + argumentaire + bouton URL).
 * @param {0|1} emplacement 0 = premier vehicule, 1 = second.
 *   Chaque emplacement a SON node et SES champs : les deux cartes ne s'ecrasent pas.
 */
export async function pousserVehicule(userNs, emplacement, vehicule) {
  const premier = emplacement === 0;
  return remplirPuisEnvoyer(
    userNs,
    {
      [premier ? env.MM_VF_PHOTO_1 : env.MM_VF_PHOTO_2]: vehicule.photo,
      [premier ? env.MM_VF_LIEN_1 : env.MM_VF_LIEN_2]: vehicule.url,
      [premier ? env.MM_VF_NOM_1 : env.MM_VF_NOM_2]: vehicule.nom,
      [premier ? env.MM_VF_ARGU_1 : env.MM_VF_ARGU_2]: vehicule.argumentaire,
    },
    premier ? env.MM_NODE_VEHICULE_1 : env.MM_NODE_VEHICULE_2
  );
}

/**
 * Pousse l'epingle GPS de la concession puis, dans la foulee (le node suivant est
 * enchaine cote editeur), sa description et les deux reponses rapides.
 */
export async function pousserConcession(userNs, concession, description) {
  return remplirPuisEnvoyer(
    userNs,
    {
      [env.MM_VF_LATITUDE]: concession.latitude,
      [env.MM_VF_LONGITUDE]: concession.longitude,
      [env.MM_VF_CONCESSION]: description,
    },
    env.MM_NODE_LOCALISATION
  );
}

/**
 * Envoie une photo seule (node dedie qui n'affiche qu'une image).
 * Un node = une photo : pour en envoyer plusieurs, on repete la sequence, ce qui
 * coute 2 requetes par image.
 */
export async function pousserPhoto(userNs, url) {
  if (!url) return { ok: false, erreur: "url absente" };
  return remplirPuisEnvoyer(userNs, { [env.MM_VF_PHOTO_EXTRA]: url }, env.MM_NODE_PHOTO);
}

/** Ramene le contact au menu principal. */
export async function retourMenu(userNs) {
  return envoyerNode(userNs, env.MM_NODE_MAIN_MENU);
}

/**
 * Envoie une suite de messages sortants dans l'ordre, en espacant les envois pour
 * que WhatsApp respecte la sequence.
 * @param {number} delaiApresTexte pause supplementaire entre le message texte et la
 *   premiere carte : la photo met plus de temps a s'afficher, sans cette marge elle
 *   arrive avant le texte qui l'annonce.
 */
export async function envoyerSortants(userNs, sortants, delaiApresTexte = 0) {
  const resultats = [];
  let emplacement = 0;
  for (const m of sortants) {
    if (m.type === "texte") {
      resultats.push(await envoyerTexte(userNs, m.texte));
      if (delaiApresTexte) await sleep(delaiApresTexte);
      continue; // le delai ci-dessus remplace l'espacement standard
    } else if (m.type === "vehicule") {
      resultats.push(await pousserVehicule(userNs, emplacement, m));
      emplacement = Math.min(1, emplacement + 1);
    } else if (m.type === "photo") {
      resultats.push(await pousserPhoto(userNs, m.url));
    } else if (m.type === "concession") {
      resultats.push(await pousserConcession(userNs, m.concession, m.description));
    } else if (m.type === "menu") {
      resultats.push(await retourMenu(userNs));
    }
    await sleep(GAP_MS);
  }
  return resultats;
}
