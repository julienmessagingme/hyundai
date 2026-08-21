# En cours

## Agent conversationnel

Le socle de données est prêt, l'agent reste à écrire :

- prompt système avec le catalogue condensé et l'état du parcours
- outils : proposer deux véhicules, répondre sur un véhicule, localiser une
  concession, enregistrer le lead
- état de parcours persistant par contact, pour que la qualification ne puisse pas
  être sautée ni rejouée

## Extraction des caractéristiques

`scrape/extract.mjs` reste à écrire : il passe le texte visible de chaque page au LLM
et en tire un JSON structuré (autonomie, puissance, places, coffre, recharge,
motorisation, prix). Fait une seule fois au scraping, figé dans `data/vehicules.json`.

Le parsing par expressions régulières a été écarté : les specs sont présentées en
tableau multi versions (42 kWh et 49 kWh en colonnes) et la structure varie d'une page
à l'autre. Extraire au LLM une fois coûte quelques centimes et évite dix sept parsers
fragiles.

## Points à vérifier au premier test réel

- Les quatre `node_ns` fournis ne sont pas vérifiables par l'API (aucun endpoint de
  listing des nodes). Ils seront confirmés au premier envoi réel.
- Le délai de propagation des champs (1500 ms) est repris d'odalys. À ajuster si les
  cartes partent avec des champs vides.
