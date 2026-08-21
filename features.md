# Fonctionnalités

> Vue côté utilisateur. Aucun détail technique ici.

## Le parcours du client

Le client entre par un bouton du flow WhatsApp qui indique ce qu'il cherche
(véhicule neuf ou LOA). À partir de là, le bot mène l'entretien.

1. **Cadrage.** Le bot annonce qu'il est là pour comprendre le besoin avant de
   proposer, et demande l'accord du client.
2. **Découverte.** Quelques questions, pas un questionnaire : la composition du foyer
   et l'usage réel de la voiture, puis la sensibilité à l'impact carbone, qui permet
   de trancher entre hybride et 100 % électrique.
3. **Proposition.** Deux véhicules, choisis pour de vrai selon les réponses. Chacun
   arrive avec sa photo, son nom, un argumentaire court et un bouton vers sa page
   Hyundai.
4. **Argumentation.** Le client peut challenger, comparer, demander des précisions.
   Le bot répond avec les caractéristiques réelles et les questions réponses
   officielles Hyundai.
5. **Bascule.** Le bot propose de découvrir le véhicule en vrai ou de faire un test
   drive.
6. **Qualification.** Si le client accroche, le bot situe son projet dans le temps
   (imminent ou découverte à plus de six mois). C'est l'information qui vaut le lead.
7. **Orientation.** Le bot demande le code postal, trouve la concession la plus
   proche, envoie l'épingle GPS puis la description de la concession avec deux choix :
   programmer un test drive, ou être rappelé.
8. **Sortie.** Si le client demande à être rappelé, le bot le remercie en nommant la
   concession qui rappellera, puis le ramène au menu principal.

## Statut

| Brique | Statut |
|---|---|
| Catalogue véhicules (17 modèles, specs, photos, FAQ officielle) | scrapé |
| Référentiel concessions (188 points, GPS, code postal) | opérationnel |
| Recherche de la concession la plus proche | opérationnel |
| Agent conversationnel et parcours | en cours |
| Envoi des cartes véhicule et de l'épingle GPS | à faire |
| Enregistrement des leads qualifiés | à faire |

## Hors périmètre

- **Véhicules d'occasion.** Le catalogue hyundai.fr est du neuf. Le parcours occasion
  n'est pas déclenché en démonstration.
- **Prise de rendez-vous réelle.** Le bouton test drive est présent pour la
  démonstration, il ne réserve rien.
