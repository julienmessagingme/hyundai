// Etat du parcours par contact.
//
// Le parcours est tenu par le CODE, pas par le modele : c'est ce qui garantit que la
// qualification n'est ni sautee ni rejouee, meme si le client part dans tous les sens.
// Le modele mene la conversation, l'etat dit ou on en est et ce qui reste a obtenir.
import fs from "node:fs";
import path from "node:path";
import { RACINE } from "./env.mjs";

export const ETAPES = {
  ACCORD: "accord", // on vient d'entrer, on explique la demarche et on demande l'accord
  DECOUVERTE: "decouverte", // questions sur le foyer, l'usage, la sensibilite carbone
  PROPOSITION: "proposition", // deux vehicules pousses, on argumente
  ESSAI: "essai", // on propose de decouvrir le vehicule / faire un test drive
  QUALIFICATION: "qualification", // horizon du projet : c'est ce qui fait la valeur du lead
  LOCALISATION: "localisation", // code postal puis concession la plus proche
  TERMINE: "termine", // rappel demande, le lead est complet
};

const TTL_MS = 6 * 60 * 60 * 1000; // une conversation abandonnee est oubliee au bout de 6 h
const FICHIER_LEADS = path.join(RACINE, "data/leads.jsonl");

const sessions = new Map();

function neuve(typeEntree) {
  return {
    etape: ETAPES.ACCORD,
    type_entree: typeEntree || null, // "neuf" | "LOA" | "occasion"
    foyer: null,
    usage: null,
    sensibilite_carbone: null,
    vehicules_proposes: [],
    // urls deja poussees, pour ne pas renvoyer deux fois la meme image
    photos_envoyees: new Set(),
    interesse_essai: null,
    horizon_projet: null,
    vehicule_essai: null, // celui retenu pour l'essai, choisi a l'ouverture du formulaire
    // Renseignes APRES coup, par le retour du formulaire de rendez-vous.
    nom_client: null,
    rdv_date: null,
    rdv_creneau: null,
    code_postal: null,
    concession: null,
    messages: [], // historique envoye au modele
    tours: 0,
    creee_le: Date.now(),
    vue_le: Date.now(),
  };
}

export function session(userNs, typeEntree) {
  const s = sessions.get(userNs);
  if (s && Date.now() - s.vue_le < TTL_MS) {
    s.vue_le = Date.now();
    return s;
  }
  const n = neuve(typeEntree);
  sessions.set(userNs, n);
  return n;
}

/**
 * Session existante uniquement, sans en creer une neuve.
 * Sert aux traitements declenches APRES la conversation (retour de formulaire) :
 * creer une session vide y produirait un recapitulatif sans aucun contenu.
 */
export function sessionExistante(userNs) {
  const s = sessions.get(userNs);
  if (!s || Date.now() - s.vue_le >= TTL_MS) return null;
  return s;
}

/** Redemarre un parcours (le client repasse par un bouton d'entree du flow). */
export function redemarrer(userNs, typeEntree) {
  const n = neuve(typeEntree);
  sessions.set(userNs, n);
  return n;
}

export function purger() {
  const limite = Date.now() - TTL_MS;
  let n = 0;
  for (const [cle, s] of sessions) {
    if (s.vue_le < limite) {
      sessions.delete(cle);
      n++;
    }
  }
  return n;
}

export const nombreSessions = () => sessions.size;

/**
 * Enregistre le lead qualifie. Append-only : un fichier qui ne se corrompt pas si le
 * process tombe en cours d'ecriture, et qui se relit ligne a ligne.
 */
export function enregistrerLead(userNs, s) {
  const lead = {
    horodatage: new Date().toISOString(),
    user_ns: userNs,
    type_entree: s.type_entree,
    foyer: s.foyer,
    usage: s.usage,
    sensibilite_carbone: s.sensibilite_carbone,
    vehicules_proposes: s.vehicules_proposes,
    horizon_projet: s.horizon_projet,
    code_postal: s.code_postal,
    concession: s.concession
      ? { id: s.concession.id, nom: s.concession.nom, ville: s.concession.ville }
      : null,
    tours: s.tours,
  };
  try {
    fs.appendFileSync(FICHIER_LEADS, JSON.stringify(lead) + "\n", "utf8");
  } catch (e) {
    // Un lead non ecrit ne doit pas casser la conversation en cours.
    console.error(`[lead] ecriture impossible : ${e.message}`);
  }
  return lead;
}

/** Ce que le modele doit obtenir a l'etape courante, injecte dans le prompt. */
export function consigneEtape(s) {
  switch (s.etape) {
    case ETAPES.ACCORD:
      return `ETAPE : premier contact.
Explique en deux phrases que tu es la pour comprendre son besoin avant de lui presenter les vehicules qui lui correspondent vraiment, et demande-lui si c'est d'accord pour repondre a quelques questions. Ne pose AUCUNE question technique maintenant, et ne propose AUCUN vehicule.`;
    case ETAPES.DECOUVERTE:
      return `ETAPE : decouverte. Deja connu -> foyer: ${s.foyer || "inconnu"} | usage: ${s.usage || "inconnu"} | motivation: ${s.sensibilite_carbone || "inconnue"}.
Pose UNE seule question a la fois, jamais deux. Dans l'ordre : d'abord la composition du foyer et la maniere dont la voiture servira au quotidien, ensuite seulement sa MOTIVATION.

La question de motivation se pose comme un CHOIX, jamais comme "quelle importance accordez-vous a l'impact carbone" : demande-lui s'il est plutot sensible a l'ecologie et a son empreinte carbone, ou s'il cherche avant tout une voiture economique a l'usage au quotidien. Les deux reponses sont bonnes a prendre, et il peut repondre les deux.

Ce qu'il faut en faire :
- ecologie -> l'electrique s'impose, l'hybride est le repli s'il ne peut pas recharger.
- economie a l'usage -> l'electrique gagne AUSSI : le cout au kilometre est nettement
  plus bas qu'a l'essence et l'entretien est reduit (pas de vidange, pas de courroie,
  freinage regeneratif qui epargne les plaquettes). Dis-le, c'est un vrai argument.
- MAIS reste honnete : cet avantage economique suppose de pouvoir recharger a domicile
  ou au travail. Si le client ne le peut pas, la recharge publique rapide coute cher et
  l'hybride redevient le choix raisonnable. Verifie ce point avant de pousser l'electrique.

Des que tu connais le foyer, l'usage ET sa motivation, appelle proposer_deux_vehicules. Ne pose pas de question supplementaire pour le plaisir.`;
    case ETAPES.PROPOSITION:
      return `ETAPE : argumentation. Vehicules deja proposes : ${s.vehicules_proposes.join(", ") || "aucun"}.
Les deux vehicules viennent d'etre envoyes avec leur photo et leur lien. Reponds aux objections avec des faits (utilise consulter_vehicule pour les caracteristiques exactes et les questions reponses officielles). Tu peux proposer deux AUTRES vehicules si les reponses du client montrent que tu t'es trompe.
Quand l'echange a produit assez d'elements, propose-lui de decouvrir le vehicule en vrai ou de faire un essai.`;
    case ETAPES.ESSAI:
      return `ETAPE : bascule vers l'essai.
Propose clairement de venir decouvrir le vehicule ou d'organiser un essai. S'il accepte, appelle enregistrer_qualification apres lui avoir demande ou en est son projet. S'il refuse, continue a argumenter sans insister lourdement.`;
    case ETAPES.QUALIFICATION:
      return `ETAPE : qualification. C'est l'information la plus importante de tout l'echange.
Demande-lui, avec tact et en une seule phrase, ou en est son projet : est-ce qu'il compte changer de voiture prochainement, ou est-il plutot en train de se renseigner pour plus tard. Ne parle pas de "qualification" ni de delai en mois de facon administrative. Des qu'il repond, appelle enregistrer_qualification.`;
    case ETAPES.LOCALISATION:
      return `ETAPE : orientation vers une concession.
Demande son code postal pour trouver la concession la plus proche. Des qu'il le donne, appelle localiser_concession. S'il refuse de le donner, n'insiste pas plus d'une fois.`;
    case ETAPES.TERMINE:
      if (s.rdv_date || s.nom_client) {
        return `ETAPE : rendez-vous demande. ${s.nom_client ? s.nom_client + " a" : "Le client a"} rempli le formulaire${
          s.rdv_date ? ` pour le ${s.rdv_date}${s.rdv_creneau ? ` (${s.rdv_creneau})` : ""}` : ""
        }, pour essayer ${s.vehicule_essai || "le vehicule retenu"} chez ${s.concession?.nom || "la concession"}.
C'est FAIT : ne redemande ni son nom, ni une date, ni son code postal, et ne repropose pas de prendre rendez-vous. Reponds a ses questions s'il en a, sinon confirme simplement que la concession le recontacte pour confirmer le creneau.`;
      }
      return `ETAPE : parcours termine. La concession ${s.concession?.nom || ""} a ete communiquee.
S'il demande a etre rappele, remercie-le chaleureusement en nommant la concession qui le rappellera, puis appelle retour_menu_principal. Sinon reponds simplement a ses questions.`;
    default:
      return "";
  }
}
