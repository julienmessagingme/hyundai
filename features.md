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

Le parcours ne redémarre que sur un vrai clic de bouton. Une question qui contient le
mot « LOA » au milieu d'une phrase ne remet pas la conversation à zéro.

## Ce que le bot sait faire pendant l'échange

**Montrer l'intérieur d'un véhicule.** Quand le client demande à voir l'habitacle, le
coffre, le tableau de bord ou simplement plus de photos, le bot en envoie trois, une
par une. Il retient ce qu'il a déjà montré : s'il en redemande, il en reçoit des
nouvelles, pas les mêmes.

**Parler des finitions.** Pour les modèles dont Hyundai publie les versions, le bot
les nomme et dit ce que chacune apporte par rapport à la précédente, en équipements
concrets (« la Calligraphy ajoute la sellerie cuir Nappa, les sièges multi-confort et
la boîte à gants avec désinfection UV-C »). Il répond aussi à une question ciblée du
type « la Intuitive a la caméra de recul ? ».

**Répondre sans inventer.** Sur trois sujets où le client peut vérifier en une minute,
le bot se tait plutôt que de deviner : les finitions d'un modèle dont il n'a pas la
liste, les mensualités de location que Hyundai ne publie pas, et la confusion entre
hybride simple et hybride rechargeable. Dans ces cas il renvoie vers la concession.

**Ne jamais demander de données inutiles.** On est sur WhatsApp, le numéro est déjà
connu. Le code postal est la seule information demandée, et uniquement pour trouver
la concession.

## Statut

| Brique | Statut |
|---|---|
| Catalogue véhicules (17 modèles, specs, 56 Q/R officielles) | live |
| Photos (129 extérieures, 102 d'habitacle) | live |
| Finitions et leurs équipements | live, couverture partielle |
| Référentiel concessions (188 points, GPS, code postal) | live |
| Parcours conversationnel complet jusqu'au lead | live |
| Cartes véhicule, épingle GPS, retour menu | live |
| Envoi de photos à la demande | live |
| Enregistrement des leads qualifiés | live |

## Limites connues

- **Véhicules d'occasion.** Le catalogue hyundai.fr est du neuf. Le parcours occasion
  n'est pas déclenché en démonstration.
- **Prise de rendez-vous réelle.** Le bouton test drive est présent pour la
  démonstration, il ne réserve rien.
- **Finitions.** Tous les modèles n'en publient pas sur leur page. Pour les autres, le
  bot renvoie vers la concession au lieu de deviner.
- **Couverture géographique.** Le réseau ne couvre que la métropole. Au delà de 150 km,
  le bot dit honnêtement qu'il n'a pas de concession à proposer.
