# En cours

## Ce qui bloque

**L'entrée DNS `hyundai.messagingme.app` n'existe pas encore sur Cloudflare.**
Tout le reste est en place et teste : le bot tourne sur le VPS, le proxy host NPM
(id 23) route deja correctement vers lui, verifie en forcant l'en-tete Host. Il
manque l'enregistrement DNS, puis le certificat Let's Encrypt (a demander cote NPM
une fois le DNS resolu, sinon Cloudflare renvoie une erreur 525).

## A eprouver au premier test reel sur WhatsApp

- **Les quatre `node_ns` ne sont pas verifiables par l'API** : aucun endpoint ne
  liste les nodes d'un flow. Ils seront confirmes au premier envoi reel. Si un node
  n'est pas PUBLIE dans l'editeur, l'API repond `ok` sans rien livrer.
- **Le delai de propagation des champs** (1500 ms) est repris d'odalys. Si une carte
  part avec la photo du vehicule precedent, l'augmenter via `MM_FIELD_PROPAGATION_MS`.
- **L'ordre texte puis cartes** repose sur `MM_POST_REPLY_DELAY_MS` (1500 ms) : le
  temps que le flow affiche le texte avant que les nodes n'arrivent. A ajuster en
  conditions reelles, c'est le reglage le plus visible pour le client.
- **Latence du tour de proposition** : 11 a 15 s, contre 3 a 5 s pour un tour normal
  (le modele choisit deux vehicules et redige deux argumentaires). A verifier contre
  le delai d'attente du node HTTP Request de l'editeur.

## Pistes ouvertes

- **Vidéo sur un node.** Les MP4 sont recuperables en direct (l'INSTER en a un,
  le TUCSON aussi). Reste a choisir le moment du parcours et a verifier le poids
  accepte par WhatsApp.
- **Photos interieures.** Recuperees pour dix modeles sur dix-sept, pas encore
  utilisees dans le parcours.
