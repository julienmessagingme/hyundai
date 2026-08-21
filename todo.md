# Backlog

## À faire ensuite

- Déploiement VPS : PM2, bind `172.18.0.1:8150`, proxy NPM `hyundai.messagingme.app`.
- Export des leads qualifiés (horizon du projet, véhicules vus, concession affectée).

## Améliorations identifiées

- **Vidéo sur un node.** Les MP4 sont récupérables en direct sur certaines pages
  (l'INSTER en a un). Reste à choisir le moment du parcours où l'envoyer, et à vérifier
  le poids accepté par WhatsApp.
- **Enrichir les concessions.** Téléphone et horaires ne sont pas dans le HTML : ils
  viennent du widget Uberall chargé en JavaScript. Piste si le client les demande.
- **Photos intérieures.** Dix modèles sur dix sept ont une galerie intérieure
  exploitable. Pour les autres, seule la photo officielle est disponible par nom.
- **Rafraîchissement du catalogue.** Les prix et les modèles bougent. Prévoir une
  relance périodique du scraping plutôt qu'un figeage définitif.

## Connu, non bloquant

- `ultime-edition` est une série spéciale et `kona-nouvelle-generation` une page
  teaser : à écarter des véhicules recommandables.
- Deux concessions sur 188 sont géocodées au niveau de la commune et non de l'adresse.
