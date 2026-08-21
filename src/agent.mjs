// Agent conversationnel : mene l'entretien, choisit les vehicules, qualifie le lead.
//
// Le modele conduit la conversation ; le parcours (parcours.mjs) tient l'etat et
// verrouille l'ordre des etapes. Les outils sont le seul moyen d'agir sur WhatsApp :
// tout ce qui n'est pas texte (carte vehicule, epingle GPS, retour menu) passe par eux.
import OpenAI from "openai";
import { env } from "./env.mjs";
import { catalogueCondense, faqVehicule, vehiculeParSlug } from "./catalogue.mjs";
import { concessionsProches } from "./concessions.mjs";
import {
  ETAPES,
  session,
  redemarrer,
  consigneEtape,
  enregistrerLead,
} from "./parcours.mjs";

const client = new OpenAI({
  apiKey: env.AI_GATEWAY_API_KEY,
  baseURL: env.LLM_BASE_URL || "https://ai-gateway.vercel.sh/v1",
});
const MODEL = env.LLM_MODEL || "google/gemini-3-flash";
const MAX_TOURS_LLM = 4; // garde-fou : au dela, on rend ce qu'on a plutot que de boucler

const CATALOGUE = catalogueCondense();

// Messages d'entree envoyes par le flow quand le client clique un bouton du menu.
// Ils ne sont pas des questions : ils DEMARRENT le parcours.
//
// Le motif est teste sur une forme SANS ACCENTS : c'est le declenchement de tout le
// parcours, il ne doit dependre ni de la casse, ni des accents, ni d'un encodage
// approximatif en amont. Un "e" accentue mal encode devient un caractere de
// remplacement, d'ou le "." tolerant plutot qu'une classe [ee].
// Les libelles des boutons sont FIXES et connus ("un vehicule neuf", "occasion",
// "vehicule LOA"). Les motifs sont donc ANCRES sur le message entier, avec juste ce
// qu'il faut de tolerance sur l'article et le mot "vehicule"/"voiture". Chercher le
// mot-cle n'importe ou dans la phrase ne marche pas : "la LOA m'interesse" ou "ca
// coute combien en LOA" sont des phrases de conversation, pas des clics.
const PREFIXE = "^(un |une |le |la )?(vehicule|voiture)?\\s*";
const ENTREES = [
  { motif: new RegExp(PREFIXE + "(neuf|neuve)$"), type: "neuf" },
  { motif: new RegExp(PREFIXE + "(en\\s+)?loa$"), type: "LOA" },
  { motif: new RegExp(PREFIXE + "(d'?\\s*)?occasion$"), type: "occasion" },
];

// Garde-fou de forme : un libelle de bouton tient en quelques mots. Au dela, c'est
// une phrase du client, meme si elle contient le mot-cle.
const MOTS_MAX_BOUTON = 5;

/** Minuscules, accents retires, caracteres de remplacement compris. */
function normaliser(texte) {
  return String(texte)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Type d'entree SI le message est un clic sur un bouton du menu, sinon null.
 *
 * Le mot-cle seul ne suffit pas : "et si je la prends en LOA, est-ce que ca marche
 * la Tucson ?" contient "LOA" mais c'est une QUESTION au milieu d'un parcours en
 * cours, la reconnaitre comme un bouton remettait la conversation a zero. On exige
 * donc que le message entier soit court : un bouton l'est toujours, une question non.
 */
export function detecterEntree(message) {
  const t = normaliser(message).trim();
  const mots = t.split(/\s+/).filter(Boolean).length;
  if (mots > MOTS_MAX_BOUTON) return null;
  // Une phrase courte peut rester une question ("c'est quoi la LOA ?").
  if (/[?]|^(c'?est|quoi|comment|pourquoi|combien|quel)/.test(t)) return null;
  return ENTREES.find((e) => e.motif.test(t))?.type || null;
}

function promptSysteme(s) {
  return `Tu es le conseiller virtuel de Hyundai France, sur WhatsApp. Tu aides un particulier a trouver le vehicule Hyundai qui lui convient VRAIMENT, puis tu l'orientes vers la concession la plus proche pour un essai.

TON ET FORME
- Tu ecris comme sur WhatsApp : phrases courtes, chaleureuses, jamais de pave.
- TROIS phrases maximum par message. C'est une limite stricte, pas une indication.
- Une seule question a la fois. Jamais deux questions dans le meme message.
- Ne repose jamais une question dont tu viens toi-meme de donner la reponse.
- Pas de listes a puces, pas de markdown, pas de titres, pas de saut de ligne
  decoratif. Du texte simple, au fil de l'eau.
- Tutoiement interdit : tu vouvoies.
- IMPORTANT : ces consignes sont ecrites sans accents pour des raisons techniques,
  mais TOI tu ecris un francais parfaitement accentue et ponctue. Exemple attendu :
  "J'ai sélectionné deux modèles très spacieux, idéaux pour votre famille."
  Cela vaut AUSSI pour le contenu que tu passes aux outils, qui s'affiche a l'ecran.

CE QUE TU NE DEMANDES JAMAIS
- Tu es sur WhatsApp : le numero de telephone du client, tu l'as DEJA. Ne le demande
  jamais, sous aucun pretexte, pas meme pour le faire rappeler par la concession.
- Ne demande ni son nom, ni son adresse e-mail, ni son adresse postale. Le code
  postal est la SEULE donnee que tu lui demandes, et uniquement pour trouver la
  concession la plus proche.

HONNETETE
- Tu recommandes le MEILLEUR vehicule pour le besoin exprime, pas le plus cher.
- Tu ne promets rien que le catalogue ne dise pas. Si tu ne sais pas, tu le dis.
- Tu tiens compte du champ "A eviter si" : si un vehicule ne convient pas au client, tu ne le proposes pas, meme s'il est seduisant.
- Un hybride simple ne se recharge pas sur une prise et n'a pas d'autonomie electrique annoncee. Un hybride rechargeable, si. Ne confonds jamais les deux.
- LOCATION (LOA ou LLD) : tu ne cites une mensualite QUE si l'outil consulter_vehicule
  te la donne dans "offre_loa". Hyundai ne publie pas d'offre pour tous les modeles.
  Si tu ne l'as pas, tu le dis simplement et tu renvoies vers la concession, qui
  etablit un devis personnalise. Tu n'estimes JAMAIS une mensualite toi-meme, et tu ne
  la deduis jamais du prix d'achat : un chiffre invente se verifie en une minute.

CE QUE TU SAIS DU CLIENT
- Type de demande : ${s.type_entree || "non precise"}
- Foyer : ${s.foyer || "inconnu"}
- Usage : ${s.usage || "inconnu"}
- Sensibilite a l'impact carbone : ${s.sensibilite_carbone || "inconnue"}
- Interesse par un essai : ${s.interesse_essai === null ? "pas encore demande" : s.interesse_essai ? "oui" : "non"}
- Horizon du projet : ${s.horizon_projet || "inconnu"}

${consigneEtape(s)}

CATALOGUE HYUNDAI (le seul que tu as le droit de proposer)

${CATALOGUE}`;
}

const OUTILS = [
  {
    type: "function",
    function: {
      name: "proposer_deux_vehicules",
      description:
        "Envoie au client DEUX vehicules, chacun avec sa photo, son nom, un argumentaire court et un bouton vers sa page. A appeler des que tu connais le foyer, l'usage et la sensibilite carbone. Choisis les DEUX meilleurs vehicules pour ce client precis, pas les plus vendeurs. Tu peux le rappeler plus tard si l'echange montre que tu t'etais trompe.",
      parameters: {
        type: "object",
        properties: {
          vehicule_1: { type: "string", description: "slug exact du 1er vehicule, tel qu'indique entre crochets dans le catalogue" },
          argumentaire_1: {
            type: "string",
            description:
              "UNE a DEUX phrases, adressees au client, disant pourquoi CE vehicule lui convient a LUI. Concret et chiffre. Pas de nom de modele au debut, il est deja affiche au dessus.",
          },
          vehicule_2: { type: "string", description: "slug exact du 2e vehicule" },
          argumentaire_2: { type: "string", description: "meme consigne que argumentaire_1" },
          message: {
            type: "string",
            description:
              "Courte phrase d'annonce affichee AVANT les deux vehicules. NE DECRIS PAS les vehicules ici : leur photo, leur nom et leur argumentaire s'affichent juste apres, les repeter fait doublon. UNE phrase qui dit que tu as retenu deux modeles au vu de ce qu'il t'a explique, rien de plus.",
          },
        },
        required: ["vehicule_1", "argumentaire_1", "vehicule_2", "argumentaire_2", "message"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "consulter_vehicule",
      description:
        "Donne les caracteristiques exactes et les questions reponses officielles Hyundai d'un vehicule. A appeler des que le client pose une question precise (autonomie, coffre, recharge, places, prix, equipements) plutot que de repondre de memoire.",
      parameters: {
        type: "object",
        properties: { slug: { type: "string", description: "slug du vehicule" } },
        required: ["slug"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "memoriser_besoin",
      description:
        "Enregistre ce que le client vient de dire sur sa situation. A appeler des qu'il donne une information sur son foyer, l'usage qu'il fera de la voiture, ou son rapport a l'impact carbone.",
      parameters: {
        type: "object",
        properties: {
          foyer: { type: "string", description: "composition du foyer, ex: couple avec 3 enfants" },
          usage: { type: "string", description: "usage reel, ex: trajets quotidiens courts + longs trajets en vacances" },
          sensibilite_carbone: { type: "string", description: "ce qu'il a dit de son rapport a l'impact carbone" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "enregistrer_qualification",
      description:
        "Enregistre l'interet du client pour un essai et l'horizon de son projet. A appeler des qu'il a repondu sur le moment ou il compte changer de voiture.",
      parameters: {
        type: "object",
        properties: {
          interesse_essai: { type: "boolean", description: "vrai s'il veut essayer ou voir le vehicule" },
          horizon_projet: {
            type: "string",
            enum: ["prochainement", "plus_de_6_mois", "non_precise"],
            description: "prochainement = projet a court terme ; plus_de_6_mois = simple decouverte",
          },
        },
        required: ["interesse_essai", "horizon_projet"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "localiser_concession",
      description:
        "Trouve la concession Hyundai la plus proche du client et lui envoie sa position GPS puis ses coordonnees. A appeler des que le client a donne son code postal.",
      parameters: {
        type: "object",
        properties: {
          code_postal: { type: "string", description: "code postal francais a 5 chiffres" },
        },
        required: ["code_postal"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "retour_menu_principal",
      description:
        "Ramene le client au menu principal. A appeler UNIQUEMENT apres l'avoir remercie lorsqu'il a demande a etre rappele par la concession.",
      parameters: { type: "object", properties: {} },
    },
  },
];

/** Argumentaire trop long = carte WhatsApp illisible. On coupe proprement a la phrase. */
function raccourcir(texte, max = 220) {
  const t = String(texte || "").trim();
  if (t.length <= max) return t;
  const coupe = t.slice(0, max);
  const fin = Math.max(coupe.lastIndexOf(". "), coupe.lastIndexOf(" ! "), coupe.lastIndexOf(" ? "));
  return (fin > 60 ? coupe.slice(0, fin + 1) : coupe).trim();
}

/**
 * Traite un message entrant.
 * @returns {{reponse: string, sortants: Array, etape: string}}
 *   `reponse` part en synchrone dans la reponse HTTP (le flow l'affiche),
 *   `sortants` sont pousses ensuite via l'API (cartes, GPS, menu).
 */
export async function traiterMessage(userNs, message) {
  // Un clic sur un bouton d'entree du menu redemarre toujours un parcours propre.
  const entree = detecterEntree(message);
  let s = entree ? redemarrer(userNs, entree) : session(userNs);
  s.tours++;

  const sortants = [];
  let concessionTrouvee = null;

  s.messages.push({ role: "user", content: message });
  // On ne garde que la fin de l'historique : le prompt systeme porte deja l'etat.
  if (s.messages.length > 24) s.messages = s.messages.slice(-24);

  let texte = "";
  // Quand des cartes vehicule partent, le texte qui les annonce est fige : sinon le
  // tour de boucle suivant produit un nouveau message qui l'ecrase, redecrit les
  // vehicules et pose parfois une question d'une etape ulterieure.
  let texteFige = false;

  for (let etape = 0; etape < MAX_TOURS_LLM; etape++) {
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.6,
      messages: [{ role: "system", content: promptSysteme(s) }, ...s.messages],
      tools: OUTILS,
    });

    const msg = completion.choices[0].message;
    s.messages.push(msg);
    if (msg.content && !texteFige) texte = msg.content;

    if (!msg.tool_calls?.length) break;

    for (const appel of msg.tool_calls) {
      let resultat;
      let args = {};
      try {
        args = JSON.parse(appel.function.arguments || "{}");
      } catch {
        args = {};
      }

      switch (appel.function.name) {
        case "memoriser_besoin": {
          if (args.foyer) s.foyer = args.foyer;
          if (args.usage) s.usage = args.usage;
          if (args.sensibilite_carbone) s.sensibilite_carbone = args.sensibilite_carbone;
          if (s.etape === ETAPES.ACCORD) s.etape = ETAPES.DECOUVERTE;
          resultat = { enregistre: true, manquant: [
            !s.foyer && "foyer",
            !s.usage && "usage",
            !s.sensibilite_carbone && "sensibilite_carbone",
          ].filter(Boolean) };
          break;
        }

        case "proposer_deux_vehicules": {
          const v1 = vehiculeParSlug(args.vehicule_1);
          const v2 = vehiculeParSlug(args.vehicule_2);
          if (!v1 || !v2) {
            // On ne pousse jamais une carte vide : on renvoie l'erreur au modele.
            resultat = {
              erreur: `slug inconnu : ${!v1 ? args.vehicule_1 : args.vehicule_2}. Utilise un slug du catalogue.`,
            };
            break;
          }
          if (v1.slug === v2.slug) {
            resultat = { erreur: "les deux vehicules doivent etre differents." };
            break;
          }
          sortants.push(
            {
              type: "vehicule",
              nom: v1.nom,
              url: v1.url,
              photo: v1.photo,
              argumentaire: raccourcir(args.argumentaire_1),
            },
            {
              type: "vehicule",
              nom: v2.nom,
              url: v2.url,
              photo: v2.photo,
              argumentaire: raccourcir(args.argumentaire_2),
            }
          );
          s.vehicules_proposes = [...new Set([...s.vehicules_proposes, v1.slug, v2.slug])];
          s.etape = ETAPES.PROPOSITION;
          // Le modele redecrit les vehicules dans son message d'annonce malgre la
          // consigne, alors que photo, nom et argumentaire s'affichent juste apres.
          // On coupe donc a la premiere phrase : la consigne seule ne tient pas, le
          // code si.
          if (args.message) {
            texte = raccourcir(args.message, 180);
            texteFige = true;
          }
          resultat = { envoye: true, vehicules: [v1.nom, v2.nom] };
          break;
        }

        case "consulter_vehicule": {
          resultat = faqVehicule(args.slug) || { erreur: `vehicule inconnu : ${args.slug}` };
          break;
        }

        case "enregistrer_qualification": {
          s.interesse_essai = args.interesse_essai;
          s.horizon_projet = args.horizon_projet;
          s.etape = args.interesse_essai ? ETAPES.LOCALISATION : ETAPES.PROPOSITION;
          resultat = {
            enregistre: true,
            suite: args.interesse_essai
              ? "Demande maintenant son code postal pour trouver la concession la plus proche."
              : "Il ne souhaite pas d'essai pour l'instant : continue a repondre a ses questions.",
          };
          break;
        }

        case "localiser_concession": {
          const proches = await concessionsProches(args.code_postal, 1);
          if (!proches) {
            resultat = { erreur: "code postal non reconnu, redemande-le." };
            break;
          }
          if (proches.trop_loin) {
            // Garde-fou : le reseau ne couvre que la metropole.
            resultat = {
              aucune_concession: true,
              consigne:
                "Aucune concession Hyundai proche. Dis-le honnetement et propose de le faire rappeler sans indiquer de concession.",
            };
            break;
          }
          const c = proches.resultats[0];
          s.code_postal = proches.origine.code_postal;
          s.concession = c;
          s.etape = ETAPES.TERMINE;
          concessionTrouvee = c;
          const description = `${c.nom}\n${c.adresse}, ${c.code_postal} ${c.commune}\nA ${c.distance_km} km de chez vous`;
          sortants.push({ type: "concession", concession: c, description });
          enregistrerLead(userNs, s);
          resultat = { envoye: true, concession: c.nom, distance_km: c.distance_km };
          break;
        }

        case "retour_menu_principal": {
          sortants.push({ type: "menu" });
          resultat = { envoye: true };
          break;
        }

        default:
          resultat = { erreur: "outil inconnu" };
      }

      s.messages.push({
        role: "tool",
        tool_call_id: appel.id,
        content: JSON.stringify(resultat),
      });
    }
  }

  // Passage d'etape naturel quand le modele a fini d'argumenter sans outil.
  if (s.etape === ETAPES.ACCORD && s.tours >= 2) s.etape = ETAPES.DECOUVERTE;
  if (s.etape === ETAPES.PROPOSITION && s.tours >= 6 && s.interesse_essai === null)
    s.etape = ETAPES.ESSAI;

  return {
    // Plafond de securite : un pave passe mal sur WhatsApp et la consigne de longueur
    // n'est pas toujours respectee. On coupe a la phrase, jamais au milieu d'un mot.
    reponse: raccourcir(texte, 600) || "Je n'ai pas bien compris, pouvez-vous reformuler ?",
    sortants,
    etape: s.etape,
    concession: concessionTrouvee,
    tours: s.tours,
  };
}
