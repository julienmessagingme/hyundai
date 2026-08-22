# Backlog

## Améliorations identifiées

- **Enrichir les concessions.** Téléphone et horaires ne sont pas dans le HTML : ils
  viennent du widget Uberall chargé en JavaScript. Piste si le client les demande.
- **Rafraîchissement du catalogue.** Les prix, les modèles et les offres bougent.
  Prévoir une relance périodique du scraping plutôt qu'un figeage définitif. Les deux
  scripts sont idempotents et le second refuse de publier un résultat partiel.
- **Photos d'habitacle manquantes.** Trois modèles n'en ont pas (les deux KONA hors
  électrique et les non conseillables). Leur page ne porte que le visuel officiel.
- **Offres de location.** Hyundai n'en publie que pour deux modèles. Si le client veut
  couvrir toute la gamme, il faudra une source interne, pas le site public.
- **Parcours occasion.** Hors périmètre de la démonstration. Le catalogue public étant
  du neuf uniquement, il faudrait une autre source de données.

## Connu, non bloquant

- `ultime-edition` (série spéciale) et `kona-nouvelle-generation` (page teaser) sont
  marqués non conseillables : le bot peut en parler mais ne les propose jamais.
- Deux concessions sur 188 sont géocodées au niveau de la commune et non de l'adresse.
- Les identifiants de nodes ne sont pas vérifiables par l'API : aucun endpoint ne liste
  les nodes d'un flow, et `send-node` répond `ok` même pour un node inexistant. Toute
  erreur d'identifiant se constate uniquement sur le téléphone du destinataire.
