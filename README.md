# Fitness Brainiac — fitnessbrainiac.com

Static site for PJ Hradilek's private personal training business in Agoura Hills, CA.

## Structure
- index.html — Home (hero, about teaser, pricing CTA, Mind Forward teaser, contact form + phone widget)
- about.html — Bio / credentials
- training.html — Full rates with 60/30-minute toggle
- mind-forward.html — Seasonal wellness program
- personal-training-agoura-hills.html — Local SEO landing page
- assets/ — Images (parallax layers, portraits)
- sitemap.xml, robots.txt — Search engine crawl files

## Deploy
Static files — no build step. Host on Netlify (connected to this repo). Deploys on every commit.
Upload the CONTENTS of this folder to the repo ROOT (index.html at top level, assets/ beside it).

## Forms
Both forms (contact + desktop "TEXT REQUESTED") post to Web3Forms and email fitnessbrainiac@gmail.com.
Access key is embedded in index.html. Free tier: 250 submissions/month.

## Notes
- Radio widget streams a live YouTube feed (VIDEO_ID in index.html). If offline, swap the ID.
- Radio on/off persists across pages via a 7-day cookie; audio restarts briefly on each navigation.
- Fog/mountain/ground transparency is baked into the PNGs; do not re-flatten them.
