// Serveur webhook : recoit les messages relayes par le flow messagingme.app.
//
// Modele de reponse retenu : SYNCHRONE pour le texte, ASYNCHRONE pour le reste.
//   - le texte de l'agent part dans la reponse HTTP ({"reponse": "..."}), le flow
//     n'a qu'a l'afficher : rien a cabler, et cela ne consomme aucun appel API ;
//   - les cartes vehicule, l'epingle GPS et le retour menu ne peuvent pas passer par
//     la reponse : ils sont pousses juste apres, via l'API workspace.
//
// D'ou le delai avant de pousser : sans lui, la carte arrive AVANT le texte que le
// flow est encore en train d'afficher, et la conversation parait desordonnee.
import http from "node:http";
import { env, exigerVariables } from "./env.mjs";
import { traiterMessage, genererRecapitulatif, messageConfirmation } from "./agent.mjs";
import { envoyerSortants, pousserRecap, envoyerTexte, mmActif, budgetMm } from "./mm.mjs";
import { purger, nombreSessions } from "./parcours.mjs";

exigerVariables(["WEBHOOK_SECRET", "AI_GATEWAY_API_KEY"]);

const PORT = Number(env.PORT || 8150);
const HOST = env.HOST || "0.0.0.0";
const SECRET = env.WEBHOOK_SECRET;
const DELAI_AVANT_NODES = Number(env.MM_POST_REPLY_DELAY_MS || 1500);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Le flow peut encadrer les valeurs d'accolades ({{last_input}} non resolu, espaces).
const nettoyer = (s) =>
  String(s ?? "")
    .trim()
    .replace(/^\{+|\}+$/g, "")
    .trim();

function repondre(res, code, objet) {
  const corps = JSON.stringify(objet);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(corps),
  });
  res.end(corps);
}

function lireCorps(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1e6) reject(new Error("corps trop volumineux"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// Les envois se font APRES la reponse HTTP, qui est deja close : aucune erreur ici
// ne doit remonter. Le TEXTE part en premier, puis les cartes, avec un delai entre
// les deux pour que WhatsApp respecte l'ordre (une carte qui precede le message qui
// l'annonce donne une conversation incomprehensible).
async function pousserEnsuite(userNs, texte, sortants) {
  if (!mmActif) return;
  const tout = [...(texte ? [{ type: "texte", texte }] : []), ...sortants];
  if (!tout.length) return;
  try {
    const resultats = await envoyerSortants(userNs, tout, DELAI_AVANT_NODES);
    const ok = resultats.filter((r) => r.ok).length;
    const echecs = resultats.filter((r) => !r.ok);
    console.log(
      `[envoi] ${userNs} : ${ok}/${resultats.length} message(s)` +
        (echecs.length ? ` | echec : ${echecs[0].erreur}` : "") +
        ` | quota ${budgetMm().restant}/${budgetMm().total}`
    );
  } catch (e) {
    console.error(`[envoi] ${userNs} : ${e.message}`);
  }
}

const serveur = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return repondre(res, 200, {
      ok: true,
      sessions: nombreSessions(),
      quota_mm: budgetMm(),
    });
  }

  // Retour du formulaire de rendez-vous : le flow nous transmet le nom saisi par le
  // client. On compose alors le recapitulatif destine a la concession et on le pousse.
  // Meme secret que /webhook.
  if (req.method === "POST" && req.url.startsWith("/rdv")) {
    if (req.headers["x-webhook-secret"] !== SECRET) {
      return repondre(res, 401, { error: "unauthorized" });
    }
    let corpsRdv;
    try {
      corpsRdv = JSON.parse((await lireCorps(req)) || "{}");
    } catch {
      return repondre(res, 400, { error: "JSON invalide" });
    }
    const userNs = nettoyer(corpsRdv.user_ns || corpsRdv.external_id || corpsRdv.subscriber_id);
    const nom = nettoyer(corpsRdv.nom || corpsRdv.name || corpsRdv.nom_client);
    const date = nettoyer(corpsRdv.date || corpsRdv.date_rdv || corpsRdv.jour);
    const creneau = nettoyer(corpsRdv.creneau || corpsRdv.heure || corpsRdv.horaire);
    if (!userNs) return repondre(res, 400, { error: "user_ns requis" });

    // ACK immediat : composer le recapitulatif demande un appel au modele.
    repondre(res, 200, { ok: true });
    (async () => {
      try {
        const r = await genererRecapitulatif(userNs, nom, { date, creneau });
        if (!r) {
          console.warn(`[rdv] ${userNs} : aucune conversation en cours, recapitulatif ignore`);
          return;
        }
        // 1. Le client a soumis le formulaire et n'a plus rien recu depuis : on lui
        //    confirme AVANT tout, c'est ce qu'il attend. Message compose par le code,
        //    donc immediat.
        const confirmation = await envoyerTexte(userNs, messageConfirmation(r.session));
        // 2. Puis le recapitulatif destine a la concession.
        const envoi = await pousserRecap(userNs, r.contenu);
        console.log(
          `[rdv] ${userNs} nom="${nom || "-"}" date="${date || "-"}" creneau="${creneau || "-"}" ` +
            `-> confirmation ${confirmation.ok ? "ok" : "ECHEC"}, ` +
            `recapitulatif ${r.contenu.length} car ${envoi.ok ? "envoye" : "ECHEC : " + envoi.erreur}`
        );
      } catch (e) {
        console.error(`[rdv] ${userNs} : ${e.stack || e.message}`);
      }
    })();
    return;
  }

  if (req.method !== "POST" || !req.url.startsWith("/webhook")) {
    return repondre(res, 404, { error: "not found" });
  }

  if (req.headers["x-webhook-secret"] !== SECRET) {
    return repondre(res, 401, { error: "unauthorized" });
  }

  let corps;
  try {
    corps = JSON.parse((await lireCorps(req)) || "{}");
  } catch {
    return repondre(res, 400, { error: "JSON invalide" });
  }

  const userNs = nettoyer(corps.user_ns || corps.external_id || corps.subscriber_id);
  const message = nettoyer(corps.message || corps.text || corps.last_input);
  if (!userNs || !message) {
    return repondre(res, 400, { error: "user_ns et message requis" });
  }

  const t0 = Date.now();
  try {
    const { reponse, sortants, etape, tours } = await traiterMessage(userNs, message);
    // On acquitte immediatement : le flow n'a rien a afficher ni a mapper, tout est
    // envoye au contact par l'API juste apres. `reponse` n'est la que pour le debug.
    repondre(res, 200, { ok: true, reponse });
    console.log(
      `[${new Date().toISOString()}] ${userNs} t${tours} "${message.slice(0, 60)}" ` +
        `-> ${etape} (${((Date.now() - t0) / 1000).toFixed(1)}s)` +
        (sortants.length ? ` +${sortants.length} node(s)` : "")
    );
    pousserEnsuite(userNs, reponse, sortants);
  } catch (e) {
    console.error(`[erreur] ${userNs} "${message.slice(0, 60)}" : ${e.stack || e.message}`);
    // Le client attend une reponse : sans cet envoi, la conversation reste muette.
    pousserEnsuite(userNs, "Desole, j'ai eu un souci technique. Pouvez-vous reformuler ?", []);
    if (!res.headersSent) {
      // 4xx et non 5xx : Cloudflare remplace le corps de toute reponse 5xx par sa
      // propre page d'erreur, le flow ne verrait jamais ce message.
      repondre(res, 422, { error: "erreur interne" });
    }
  }
});

// Au boot du VPS, le bridge Docker peut ne pas etre pret quand PM2 lance le service.
// Sans ce retry, le process crashe et PM2 enchaine les redemarrages.
function ecouter(essai = 0) {
  const surErreur = (err) => {
    if (err.code === "EADDRNOTAVAIL" && essai < 20) {
      console.log(`[boot] ${HOST}:${PORT} indisponible (${err.code}), nouvel essai ${essai + 1}/20`);
      setTimeout(() => ecouter(essai + 1), 2000);
    } else {
      console.error("[boot] echec definitif :", err);
      process.exit(1);
    }
  };
  serveur.once("error", surErreur);
  serveur.listen(PORT, HOST, () => {
    serveur.off("error", surErreur);
    console.log(
      `Bot Hyundai a l'ecoute sur ${HOST}:${PORT}` +
        `${mmActif ? "" : " (envois messagingme.app DESACTIVES : MM_API_TOKEN absent)"}`
    );
  });
}

setInterval(() => {
  const n = purger();
  if (n) console.log(`[purge] ${n} session(s) expiree(s)`);
}, 30 * 60 * 1000).unref();

ecouter();
