// Recupere les pages modeles de hyundai.fr et en extrait la matiere brute :
// JSON-LD (Product / FAQPage / VideoObject), texte visible, photos CDN, videos.
// Sortie : data/raw/<slug>.json (non versionne). La structuration des
// caracteristiques techniques est faite ensuite par scrape/extract.mjs.
import fs from "node:fs/promises";
import path from "node:path";

const BASE = "https://www.hyundai.com";
const INDEX = `${BASE}/fr/fr/modeles.html`;
const OUT = "data/raw";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const DELAY_MS = 1200; // scraping poli : on n'inonde pas hyundai.com

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9" },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
  return res.text();
}

// Blocs <script type="application/ld+json"> parses (ceux qui ne parsent pas sont ignores).
function jsonLd(html) {
  const out = [];
  for (const m of html.matchAll(
    /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g
  )) {
    try {
      const parsed = JSON.parse(m[1]);
      out.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch {
      /* bloc malforme : sans interet ici, on passe */
    }
  }
  return out;
}

// Texte visible : script/style retires, balises converties en sauts de ligne.
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]*>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&[a-z]+;/g, " ")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 1)
    .join("\n");
}

// Reduit a l'alphanumerique majuscule : "Hyundai_IONIQ-5_2024" -> "HYUNDAIIONIQ52024".
// Indispensable car le CDN melange les separateurs ("IONIQ_5", "IONIQ-5", "INSTER").
const cleNorm = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, "");

// Photos du CDN Hyundai. On ne garde que celles dont le nom de fichier evoque le
// modele (le reste = logos, badges garantie, bandeaux promo communs a tout le site).
// La cle vient du NOM PRODUIT ("IONIQ 5 N" -> "IONIQ5N") et non du slug : le slug
// "inster-electric" ne correspond a aucun nom de fichier du CDN, le nom produit si.
function photos(html, slug, nomProduit) {
  const urls = [
    ...new Set(
      [...html.matchAll(/https:\/\/dmassets\.hyundai\.com\/is\/image\/[A-Za-z0-9_/-]+/g)].map(
        (m) => m[0]
      )
    ),
  ];
  // Cle degressive : on part du nom complet et on retire un mot a la fois jusqu'a
  // obtenir assez de photos. "TUCSON Hybrid" ne matche aucun fichier (le CDN dit
  // "Hyundai_TUCSON_2024") alors que "TUCSON" oui ; a l'inverse "IONIQ 5" doit
  // rester specifique, sinon on ramasse les IONIQ 3 et 9 presents sur la meme page.
  const mots = String(nomProduit || slug.replace(/-/g, " ")).trim().split(/s+/);
  const matchant = (cle) => urls.filter((u) => cleNorm(u.split("/").pop()).includes(cle));
  let duModele = [];
  for (let n = mots.length; n >= 1; n--) {
    const cle = cleNorm(mots.slice(0, n).join(""));
    if (!cle) continue;
    duModele = matchant(cle);
    if (duModele.length >= 3) break;
  }
  const classe = (u) =>
    /interior|interieur|cockpit|dashboard|seat|cabin/i.test(u) ? "interieur" : "exterieur";
  // repli sur toutes les images si le filtre par nom ne rend rien
  return (duModele.length ? duModele : urls).map((url) => ({ url, vue: classe(url) }));
}

// Deux formes coexistent : MP4 direct (exploitable tel quel) et player HTML sur le
// CDN (VideoObject.contentUrl). On remonte les deux, taggees, pour trancher ensuite.
function videos(html, ld) {
  const mp4 = [...new Set([...html.matchAll(/https:\/\/[^"'\s]+\.mp4/g)].map((m) => m[0]))].map(
    (url) => ({ url, type: "mp4" })
  );
  const players = ld
    .filter((b) => b["@type"] === "VideoObject" && b.contentUrl)
    .map((b) => ({
      url: b.contentUrl,
      type: "player",
      nom: b.name || "",
      vignette: b.thumbnailUrl || null,
    }));
  return [...mp4, ...players];
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });

  console.log("Recuperation de l'index des modeles...");
  const index = await get(INDEX);
  const slugs = [
    ...new Set(
      [...index.matchAll(/\/fr\/fr\/modeles\/([a-z0-9-]+)\.html/g)].map((m) => m[1])
    ),
  ].sort();
  console.log(`${slugs.length} modeles reperes\n`);

  const resume = [];
  for (const slug of slugs) {
    const url = `${BASE}/fr/fr/modeles/${slug}.html`;
    try {
      const html = await get(url);
      const ld = jsonLd(html);
      const produit = ld.find((b) => b["@type"] === "Product") || null;
      const faq = ld.find((b) => b["@type"] === "FAQPage") || null;
      const prix = produit?.offers?.price ? Number(produit.offers.price) : null;

      const fiche = {
        slug,
        url,
        nom: produit?.name || slug,
        description: produit?.description || "",
        // 0 = prix absent cote Hyundai (serie speciale, modele a venir) -> null
        prix_a_partir_de: prix && prix > 0 ? prix : null,
        devise: produit?.offers?.priceCurrency || null,
        image_principale: produit?.image || null,
        faq: (faq?.mainEntity || []).map((q) => ({
          question: q.name,
          reponse: String(q.acceptedAnswer?.text || "").replace(/<[^>]*>/g, "").trim(),
        })),
        photos: photos(html, slug, produit?.name),
        videos: videos(html, ld),
        texte: visibleText(html),
        scrape_le: new Date().toISOString(),
      };

      await fs.writeFile(
        path.join(OUT, `${slug}.json`),
        JSON.stringify(fiche, null, 2),
        "utf8"
      );
      const ext = fiche.photos.filter((p) => p.vue === "exterieur").length;
      const int = fiche.photos.filter((p) => p.vue === "interieur").length;
      console.log(
        `  ok  ${slug.padEnd(26)} prix=${String(fiche.prix_a_partir_de ?? "-").padStart(6)} ` +
          `faq=${String(fiche.faq.length).padStart(2)} photos=${String(ext).padStart(2)}ext/${int}int ` +
          `videos=${fiche.videos.length}`
      );
      resume.push({ slug, ok: true });
    } catch (e) {
      console.error(`  KO  ${slug.padEnd(26)} ${e.message}`);
      resume.push({ slug, ok: false, erreur: e.message });
    }
    await sleep(DELAY_MS);
  }

  const ok = resume.filter((r) => r.ok).length;
  console.log(`\n${ok}/${resume.length} pages recuperees dans ${OUT}/`);
  if (ok < resume.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error("Echec du scraping :", e);
  process.exit(1);
});
