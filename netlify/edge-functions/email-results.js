// Netlify Edge Function — /api/email-results
// Reads visitor geolocation (free, built into Netlify Edge — no third-party API),
// gates by country + proximity to the studio, then sends:
//   1) the results email to the visitor  (reply-to = your Gmail)
//   2) a lead-notification email to you   (email + ZIP + geo, for marketing)
//
// Requires these environment variables (Netlify → Site config → Environment):
//   RESEND_API_KEY   (required)  — from https://resend.com  (free tier: 100/day)
//   FROM_EMAIL       (optional)  — e.g. "Fitness Brainiac <results@fitnessbrainiac.com>"
//                                   defaults to Resend's shared sender until you verify your domain
//   LEAD_EMAIL       (optional)  — where leads land. Default: fitnessbrainiac@gmail.com
//   REPLY_TO         (optional)  — Default: fitnessbrainiac@gmail.com
//   MAX_MILES        (optional)  — service-area radius for flagging. Default: 150

const STUDIO = { lat: 34.1361, lon: -118.7734, label: "Agoura Hills, CA 91301" };

export default async (request, context) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const env = (k, d) => (globalThis.Netlify?.env?.get?.(k) ?? d);
  const RESEND_API_KEY = env("RESEND_API_KEY");
  const FROM_EMAIL = env("FROM_EMAIL", "Fitness Brainiac <onboarding@resend.dev>");
  const LEAD_EMAIL = env("LEAD_EMAIL", "fitnessbrainiac@gmail.com");
  const REPLY_TO = env("REPLY_TO", "fitnessbrainiac@gmail.com");
  const MAX_MILES = parseFloat(env("MAX_MILES", "150"));

  if (!RESEND_API_KEY) {
    return json({ error: "Email service is not configured yet." }, 500);
  }

  // ---- parse + validate body ----
  let d;
  try { d = await request.json(); } catch { return json({ error: "Bad request." }, 400); }

  const email = String(d.email || "").trim();
  const zip = String(d.zip || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ error: "Enter a valid email." }, 400);
  if (!/^\d{5}$/.test(zip)) return json({ error: "Enter a valid 5-digit ZIP." }, 400);
  if (d.consent !== true) return json({ error: "Consent is required." }, 400);

  const bf = clampNum(d.bf, 0, 75);
  const fat = clampNum(d.fat, 0, 1e5);
  const lean = clampNum(d.lean, 0, 1e5);
  const weight = clampNum(d.weight, 0, 1e5);
  const sum = clampNum(d.sum, 0, 1e5);
  const unit = d.unit === "kg" ? "kg" : "lb";
  const methodLabel = esc(String(d.methodLabel || "Body Fat").slice(0, 60));
  const band = esc(String(d.band || "").slice(0, 40));
  const sexLabel = d.sex === "female" ? "Women" : "Men";
  const age = d.age ? Math.round(clampNum(d.age, 0, 120)) : null;

  // ---- geolocation gate ----
  const geo = context.geo || {};
  const country = geo.country?.code || null;         // e.g. "US"
  const city = geo.city || null;
  const region = geo.subdivision?.code || null;      // e.g. "CA"
  const lat = typeof geo.latitude === "number" ? geo.latitude : null;
  const lon = typeof geo.longitude === "number" ? geo.longitude : null;
  const ip = context.ip || "unknown";

  // Hard filter: block obvious out-of-country traffic (the "bot in Indonesia" case).
  // If geo is entirely unavailable we allow but flag it, rather than lose a real lead.
  if (country && country !== "US") {
    return json({ error: "We can only email results to visitors located in the U.S. service area." }, 403);
  }

  // Soft filter: compute distance to studio; flag (don't block) distant U.S. leads.
  let miles = null, outsideArea = false;
  if (lat !== null && lon !== null) {
    miles = Math.round(haversine(STUDIO.lat, STUDIO.lon, lat, lon));
    outsideArea = miles > MAX_MILES;
  }

  const dateStr = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "long", timeStyle: "short" });
  const stat = (v) => `${v}`;
  const massLine = `${fat.toFixed(1)} ${unit} fat · ${lean.toFixed(1)} ${unit} lean`;

  // ---- email 1: results → visitor ----
  const userHtml = resultsEmail({ methodLabel, sexLabel, age, bf, band, fat, lean, weight, sum, unit, dateStr });
  // ---- email 2: lead → PJ ----
  const geoLine = [city, region, country].filter(Boolean).join(", ") || "unknown";
  const leadHtml = leadEmail({
    email: esc(email), zip: esc(zip), geoLine: esc(geoLine), ip: esc(ip),
    miles, outsideArea, methodLabel, sexLabel, age, bf, band, massLine, weight, unit, sum, dateStr
  });

  try {
    const results = await Promise.allSettled([
      sendEmail(RESEND_API_KEY, {
        from: FROM_EMAIL, to: [email], reply_to: REPLY_TO,
        subject: `Your ${methodLabel} results — ${bf.toFixed(1)}% body fat`,
        html: userHtml
      }),
      sendEmail(RESEND_API_KEY, {
        from: FROM_EMAIL, to: [LEAD_EMAIL], reply_to: email,
        subject: `${outsideArea ? "⚠ OUT-OF-AREA " : ""}New body-fat lead — ${zip} (${geoLine})`,
        html: leadHtml
      })
    ]);
    // The visitor-facing send is the one that must succeed.
    if (results[0].status !== "fulfilled" || results[0].value !== true) {
      return json({ error: "We couldn't send the email just now. Please try again." }, 502);
    }
    return json({ ok: true, flagged: outsideArea, miles }, 200);
  } catch {
    return json({ error: "Email service error." }, 502);
  }
};

export const config = { path: "/api/email-results" };

// ---------- helpers ----------
function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
function clampNum(v, lo, hi) { const n = Number(v); return isFinite(n) ? Math.max(lo, Math.min(n, hi)) : 0; }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function haversine(la1, lo1, la2, lo2) {
  const R = 3958.8, dLa = (la2 - la1) * Math.PI / 180, dLo = (lo2 - lo1) * Math.PI / 180;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
async function sendEmail(key, payload) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return r.ok;
}

// ---------- email templates ----------
function resultsEmail(d) {
  const meta = [d.sexLabel, d.age ? `age ${d.age}` : null].filter(Boolean).join(" · ");
  return `<!doctype html><html><body style="margin:0;background:#0b0e1c;font-family:Arial,Helvetica,sans-serif;color:#1c2033;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;">
    <div style="background:#0b0e1c;padding:26px 30px;">
      <div style="font-size:11px;letter-spacing:3px;color:#4ad9ff;text-transform:uppercase;">Fitness Brainiac</div>
      <div style="font-size:22px;font-weight:800;color:#ffffff;margin-top:8px;text-transform:uppercase;">Body Fat Analysis</div>
    </div>
    <div style="padding:30px;">
      <div style="font-size:12px;letter-spacing:1px;color:#8a90a6;text-transform:uppercase;">${d.methodLabel}${meta ? " · " + meta : ""}</div>
      <div style="margin:14px 0 6px;font-size:56px;font-weight:800;color:#0b0e1c;line-height:1;">${d.bf.toFixed(1)}<span style="font-size:24px;color:#8a90a6;">%</span></div>
      <div style="font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#3e74ff;">${d.band}</div>
      <table style="width:100%;border-collapse:collapse;margin-top:24px;font-size:14px;">
        <tr><td style="padding:12px 0;border-bottom:1px solid #eceef4;color:#8a90a6;">Fat mass</td><td style="padding:12px 0;border-bottom:1px solid #eceef4;text-align:right;font-weight:700;">${d.fat.toFixed(1)} ${d.unit}</td></tr>
        <tr><td style="padding:12px 0;border-bottom:1px solid #eceef4;color:#8a90a6;">Lean mass</td><td style="padding:12px 0;border-bottom:1px solid #eceef4;text-align:right;font-weight:700;">${d.lean.toFixed(1)} ${d.unit}</td></tr>
        <tr><td style="padding:12px 0;border-bottom:1px solid #eceef4;color:#8a90a6;">Body weight</td><td style="padding:12px 0;border-bottom:1px solid #eceef4;text-align:right;font-weight:700;">${d.weight.toFixed(1)} ${d.unit}</td></tr>
        <tr><td style="padding:12px 0;color:#8a90a6;">Skinfold sum</td><td style="padding:12px 0;text-align:right;font-weight:700;">${d.sum % 1 ? d.sum.toFixed(1) : d.sum} mm</td></tr>
      </table>
      <div style="margin-top:26px;padding:18px 20px;background:#f5f7ff;border-radius:6px;font-size:14px;line-height:1.5;color:#1c2033;">
        <strong>Would you be interested in speaking with PJ about your body fat management strategies?</strong>
        <div style="margin-top:8px;color:#5a6180;">Just reply to this email and we'll set up a conversation.</div>
      </div>
      <div style="margin-top:22px;font-size:11px;color:#9aa0b4;line-height:1.5;">
        Field estimate for tracking trends — not a clinical or diagnostic measurement.<br>
        Generated on <a href="https://fitnessbrainiac.com" style="color:#3e74ff;text-decoration:none;">FitnessBrainiac.com</a> · ${d.dateStr}
      </div>
    </div>
  </div></body></html>`;
}

function leadEmail(d) {
  const flag = d.outsideArea
    ? `<div style="background:#ffe9ef;color:#b0134d;padding:10px 14px;border-radius:5px;font-size:13px;margin-bottom:16px;">Outside ${STUDIO.label} service radius${d.miles !== null ? " — ~" + d.miles + " mi away" : ""}. Judgment call.</div>`
    : (d.miles !== null ? `<div style="color:#1a8a5a;font-size:13px;margin-bottom:16px;">~${d.miles} mi from the studio.</div>` : "");
  const meta = [d.sexLabel, d.age ? `age ${d.age}` : null].filter(Boolean).join(" · ");
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#1c2033;">
    <div style="max-width:560px;margin:0 auto;padding:24px;">
      <div style="font-size:12px;letter-spacing:2px;color:#8a90a6;text-transform:uppercase;">New Lead — Body Fat Calculator</div>
      <h2 style="margin:8px 0 18px;">${d.email}</h2>
      ${flag}
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:9px 0;color:#8a90a6;">ZIP entered</td><td style="padding:9px 0;text-align:right;font-weight:700;">${d.zip}</td></tr>
        <tr><td style="padding:9px 0;color:#8a90a6;">IP location</td><td style="padding:9px 0;text-align:right;">${d.geoLine}</td></tr>
        <tr><td style="padding:9px 0;color:#8a90a6;">IP address</td><td style="padding:9px 0;text-align:right;">${d.ip}</td></tr>
        <tr><td style="padding:9px 0;color:#8a90a6;">Method</td><td style="padding:9px 0;text-align:right;">${d.methodLabel}${meta ? " · " + meta : ""}</td></tr>
        <tr><td style="padding:9px 0;color:#8a90a6;">Result</td><td style="padding:9px 0;text-align:right;font-weight:700;">${d.bf.toFixed(1)}% · ${d.band}</td></tr>
        <tr><td style="padding:9px 0;color:#8a90a6;">Composition</td><td style="padding:9px 0;text-align:right;">${d.massLine}</td></tr>
        <tr><td style="padding:9px 0;color:#8a90a6;">Weight / Σ folds</td><td style="padding:9px 0;text-align:right;">${d.weight.toFixed(1)} ${d.unit} · ${d.sum % 1 ? d.sum.toFixed(1) : d.sum} mm</td></tr>
        <tr><td style="padding:9px 0;color:#8a90a6;">Timestamp</td><td style="padding:9px 0;text-align:right;">${d.dateStr}</td></tr>
      </table>
      <p style="font-size:12px;color:#9aa0b4;margin-top:18px;">Consent given at submission. Reply to this email to reach the prospect directly.</p>
    </div></body></html>`;
}
