// Applies the Infylearn theme (theme/admin.css, theme/public.css) to listmonk's
// Settings -> Appearance, and sets the site name used in public page titles. Safe to re-run.
// Also writes the exact CSS it applies to theme/dist/, for pasting into Settings -> Appearance by hand.
// `--build-only` writes theme/dist/ without contacting listmonk.
const fs = require("fs");
const path = require("path");
const { api } = require("./listmonk");

const THEME_DIR = path.join(__dirname, "..", "theme");

// listmonk loads the admin custom CSS *before* its own stylesheet, so a theme rule with the same
// specificity as a built-in rule loses. Prefixing every selector with `html body` makes the theme
// win without sprinkling !important through the source file.
function boostSpecificity(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[{}])(\s*)([^{}@]+?)(\s*\{)/g, (match, before, space, selectors, open) => {
      const boosted = selectors.split(",").map((selector) => {
        const s = selector.trim();
        if (s.startsWith(":root")) return s;
        if (/^html\b/.test(s)) return s.replace(/^html/, "html:root");
        if (/^body\b/.test(s)) return `html ${s}`;
        return `html body ${s}`;
      }).join(", ");
      return `${before}${space}${boosted}${open}`;
    });
}

async function main() {
  const adminCss = boostSpecificity(fs.readFileSync(path.join(THEME_DIR, "admin.css"), "utf8"));
  const publicCss = fs.readFileSync(path.join(THEME_DIR, "public.css"), "utf8");
  const publicJs = fs.readFileSync(path.join(THEME_DIR, "public.js"), "utf8");
  fs.mkdirSync(path.join(THEME_DIR, "dist"), { recursive: true });
  fs.writeFileSync(path.join(THEME_DIR, "dist", "admin.css"), adminCss);
  fs.writeFileSync(path.join(THEME_DIR, "dist", "public.css"), publicCss);
  fs.writeFileSync(path.join(THEME_DIR, "dist", "public.js"), publicJs);
  if (process.argv.includes("--build-only")) {
    console.log("Wrote theme/dist/admin.css, public.css and public.js");
    return;
  }

  const settings = await api("GET", "/settings");
  settings["appearance.admin.custom_css"] = adminCss;
  settings["appearance.public.custom_css"] = publicCss;
  settings["appearance.public.custom_js"] = publicJs;
  settings["app.site_name"] = process.env.SITE_NAME || "Infylearn Newsletter";
  await api("PUT", "/settings", settings);
  console.log("Theme applied. Hard-refresh the admin (Ctrl+Shift+R) to see it.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
