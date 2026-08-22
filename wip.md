# En cours

## Couverture des finitions

Le correctif est en place (fenêtre autour de chaque mention du mot « finition », au
lieu d'une plage continue qui couvrait 30 000 caractères sur l'INSTER et le TUCSON et
se faisait tronquer avant le contenu utile). Il reste à faire aboutir une passe
complète :

```bash
npm run scrape:extract
```

Attendu : 6 modèles de plus (i20, inster-electric, ioniq5, santa-fe-hybrid,
tucson-hybrid, tucson-plug-in), soit 12 sur 17. Les 5 derniers (IONIQ 3, IONIQ 5 N,
NEXO et les deux non conseillables) ne présentent aucune finition sur leur page : il
n'y a rien à en tirer.

Le script refuse d'écrire s'il n'obtient pas les 17 modèles, donc une passe
interrompue ne dégrade jamais le catalogue en place.

## À éprouver en conditions réelles

- **Ordonnancement des envois.** `MM_POST_REPLY_DELAY_MS` (1500 ms) sépare le texte
  des cartes, `MM_FIELD_PROPAGATION_MS` (1500 ms) sépare le remplissage des champs du
  déclenchement du node. Ce sont les deux réglages qui se voient le plus côté client :
  si une carte part avec la photo du véhicule précédent, augmenter le second.
- **Latence du tour de proposition** : 9 à 15 s, contre 2 à 5 s pour un tour normal
  (le modèle choisit deux véhicules et rédige deux argumentaires). Cloudflare tient,
  vérifié en HTTPS public ; c'est le délai d'attente du node HTTP Request de l'éditeur
  qui doit accepter au moins 20 s.
- **Volume de photos.** Trois par demande (`PHOTOS_PAR_DEMANDE`), soit 6 requêtes API
  sur les 1000/heure. À ajuster selon le ressenti en démonstration.

## Piste ouverte

**Vidéo sur un node.** Les MP4 sont récupérables en direct sur le CDN Hyundai
(l'INSTER et le TUCSON en ont). Reste à choisir le moment du parcours où l'envoyer et
à vérifier le poids accepté par WhatsApp.
