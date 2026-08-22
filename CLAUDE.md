# CLAUDE.md - Bot IA Hyundai

Bot conversationnel WhatsApp pour Hyundai France : il conseille un véhicule à partir
du besoin réel du client, puis qualifie le lead et l'oriente vers la concession la
plus proche pour un test drive.

Workspace messagingme.app **148907** (bot sandbox), flow `f265919`.

## Commandes

```bash
npm run scrape:pages        # récupère les 17 pages modèles de hyundai.fr -> data/raw/
npm run scrape:concessions  # 188 concessions + géocodage -> data/concessions.json
npm run scrape:extract      # structure les caractéristiques via le LLM -> data/vehicules.json
npm start                   # serveur webhook (port 8150)
```

## Documentation

- [documentation.md](documentation.md) : architecture, API, données, déploiement
- [features.md](features.md) : ce que fait le bot, vu côté utilisateur
- [wip.md](wip.md) : ce qui est en cours
- [todo.md](todo.md) : backlog

## Règles propres au projet

- **Les nodes et user fields sont pilotés par `.env`**, jamais en dur dans le code.
  Les identifiants viennent du workspace 148907 et changeront pour un autre client.
- **Toujours laisser le délai de propagation** entre `set-user-fields` et `send-node` :
  messagingme.app traite les deux en asynchrone, sans le délai le node part avec les
  champs de la conversation précédente.
- **`send-node` répond `ok` même pour un node qui n'existe pas.** Vérifié avec un identifiant
  bidon : réponse identique. Aucun log d'envoi ne prouve donc une livraison, et un node non publié
  échoue en silence. La seule preuve est le téléphone du destinataire. Pour diagnostiquer, relire les
  user fields du contact via `GET /subscriber/get-info` : s'ils sont remplis, le problème est dans
  l'éditeur, pas ici.
- **Le bot n'énonce jamais une donnée vérifiable qu'il n'a pas** (finitions, mensualité de location).
  Il renvoie vers la concession. Un chiffre inventé se vérifie en une minute côté client.
- **Ne jamais proposer une concession au delà de 150 km.** Le réseau ne couvre que la
  métropole, sans ce garde-fou un client des DOM se voit proposer la Corse.
