# Documentation technique

## Architecture

```
WhatsApp  <->  messagingme.app (flow f265919)  <->  ce serveur (VPS)  <->  Vercel AI Gateway
                                                          |
                                                    data/*.json
```

Le flow appelle notre webhook à chaque message du client. Le serveur acquitte en 200
immédiatement puis traite en tâche de fond : appel LLM avec tool calling, puis
remplissage des user fields et déclenchement des nodes via l'API workspace.

## Stack

- Node 22, ESM, zéro framework (serveur `node:http` natif)
- SDK `openai` pointé sur Vercel AI Gateway (compatible OpenAI)
- Modèle : `google/gemini-3-flash` (reasoning + tool use, 1M de contexte)
- Aucune base de données : le catalogue tient en JSON chargé en mémoire

### Pourquoi pas de base de données

17 véhicules et 188 concessions. Le catalogue condensé tient dans le prompt système
(~2500 tokens, mis en cache implicite), donc le modèle voit tout le catalogue à chaque
tour. C'est plus fiable qu'une recherche vectorielle sur 17 items et cela supprime une
infrastructure entière. Les leads partent en JSONL append-only.

## API messagingme.app

Base `https://ai.messagingme.app/api`, auth `Authorization: Bearer <token>`.
Limite mesurée : **1000 requêtes/heure par token**, exposée dans les en-têtes
`x-ratelimit-remaining` / `x-ratelimit-limit` de chaque réponse.

| Besoin | Méthode et chemin | Corps |
|---|---|---|
| Remplir des user fields | `PUT /subscriber/set-user-fields` | `{user_ns, data:[{var_ns, value}]}` |
| Déclencher un node | `POST /subscriber/send-node` | `{user_ns, node_ns}` |

Pousser un véhicule coûte **2 requêtes** (un set batché puis un send-node), soit une
dizaine de requêtes pour une conversation complète.

### Nodes du flow f265919

| Node | Rôle |
|---|---|
| `f265919n451985427` | carte véhicule 1 (photo + texte + bouton URL) |
| `f265919n451985515` | carte véhicule 2 |
| `f265919n451985589` | épingle GPS, puis description concession et quick replies |
| `f265919n451985241` | menu principal |

### User fields (var_ns)

| var_ns | Nom dans l'éditeur | Contenu |
|---|---|---|
| `f265919v16668429` / `...431` | `hyundai1` / `hyundai2` | URL photo véhicule 1 / 2 |
| `f265919v16668437` / `...439` | `lienHyundai1` / `lienHyundai2` | URL page véhicule 1 / 2 |
| `f265919v16669059` / `...061` | `nom vehicule 1` / `nom véhicule 2` | nom commercial |
| `f265919v16669063` / `...065` | `argu vehicule 1` / `argu vehicule 2` | argumentaire court |
| `f265919v16668433` / `...435` | `latitudeHyundai` / `longitudeHyundai` | GPS concession |
| `f265919v16669231` | `concessionnaire` | description de la concession |

### Ordonnancement des envois

`set-user-fields` et `send-node` sont traités en **asynchrone** côté messagingme.app.
Sans délai entre les deux, le node se déclenche avant que les champs soient propagés
et part avec les valeurs précédentes. Réglages dans `.env` :

- `MM_FIELD_PROPAGATION_MS` (1500) : entre le remplissage des champs et le send-node
- `MM_MSG_GAP_MS` (700) : entre deux nodes successifs, pour que WhatsApp respecte l'ordre

## Données

### `data/concessions.json` (versionné, 188 entrées)

Construit par `scrape/concessions.mjs`. La page liste de hyundai.fr est du HTML
statique et porte un lien par point de vente ; les fiches détaillées, elles, sont
vides en HTML (widget Uberall chargé en JS). On reconstruit donc l'adresse depuis
l'URL et on la géocode via `api-adresse.data.gouv.fr` (service public, gratuit, sans
clé), qui rend lat/long et code postal.

Qualité obtenue : 186 géocodages au niveau adresse, 2 au niveau commune, 0 sans code
postal.

`src/concessions.mjs` expose `concessionsProches(codePostal, nb)` : distance
haversine sur les 188 points, tri croissant. Au delà de `DISTANCE_MAX_KM` (150), la
réponse porte `trop_loin: true` et aucune concession n'est proposée.

### `data/raw/*.json` (non versionné, 17 fiches)

Construit par `scrape/fetch-pages.mjs`. Pour chaque modèle : JSON-LD `Product` (nom,
description officielle, prix, image principale), `FAQPage` (jusqu'à 8 questions
réponses officielles Hyundai), photos CDN, vidéos, et le texte visible de la page.

Deux pièges rencontrés et traités :

- **Nom de fichier CDN.** Le CDN mélange les séparateurs (`IONIQ_5`, `IONIQ-5`,
  `INSTER`) et les noms produits contiennent la motorisation (`TUCSON Hybrid`) que les
  fichiers n'ont pas. D'où une clé normalisée en alphanumérique, puis dégressive : on
  retire un mot à la fois jusqu'à obtenir assez de photos. Cela garde `IONIQ 5`
  spécifique tout en faisant matcher `TUCSON Hybrid` sur `Hyundai_TUCSON_2024`.
- **Frames de configurateur.** Les pages Tucson et Santa Fe portent 300+ images
  nommées par code châssis interne (`HHME_NX4_PHEV_360_EXT_...`) : ce sont les vues de
  la rotation 360, inutiles sur WhatsApp. Le filtre par nom commercial les écarte, ce
  qui est le comportement voulu.

15 modèles sur 17 ont une image principale servie par le CDN. Les 2 sans
(`kona-nouvelle-generation`, page teaser, et `ultime-edition`, série spéciale) ont une
galerie exploitable en repli.

## Déploiement

VPS OVH, même moule qu'odalys : PM2, bind sur `172.18.0.1:8150` (gateway Docker
`mcp-robot_default`), NPM `hyundai.messagingme.app` avec path routing sur `/webhook`
et `/health`.

```bash
cd /home/ubuntu/hyundai && git pull && npm install && pm2 restart hyundai --update-env
```

## Variables d'environnement

Voir `.env.example`. Les secrets (clé gateway, token workspace, secret webhook) vivent
uniquement dans le `.env` du VPS, jamais dans le dépôt.
