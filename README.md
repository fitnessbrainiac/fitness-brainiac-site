# Fitness Brainiac — fitnessbrainiac.com

Static site for PJ Hradilek's private personal training business in Agoura Hills, CA.

## Structure
- `index.html` — Home (hero, about teaser, pricing CTA, Mind Forward teaser, contact form + phone widget)
- `about.html` — Bio / credentials
- `training.html` — Full rates with 60/30-minute toggle
- `mind-forward.html` — Seasonal wellness program
- `personal-training-agoura-hills.html` — Local SEO landing page
- `assets/` — Images (parallax layers, portraits)
- `sitemap.xml`, `robots.txt` — Search engine crawl files

## Deploy
Static files — no build step. Host on Netlify (connected to this repo).
Netlify auto-detects the two forms (`contact`, `text-request`) and the site deploys on every commit.

## Notes
- Radio widget streams a live YouTube feed (video ID in index.html). If it goes offline, swap the ID.
- Fog/mountain transparency is baked into the PNGs; do not re-flatten them.
