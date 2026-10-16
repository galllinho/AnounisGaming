// Ajuste le projet Android généré : permissions, signature stable, numéro de version, nom
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const man = path.join(root, "android/app/src/main/AndroidManifest.xml");
let m = fs.readFileSync(man, "utf8");
for (const p of ["android.permission.INTERNET", "android.permission.WAKE_LOCK"]) {
  if (!m.includes(`"${p}"`)) m = m.replace("</manifest>", `    <uses-permission android:name="${p}" />\n</manifest>`);
}
// la synthèse vocale Android doit être visible depuis Android 11
if (!m.includes("android.intent.action.TTS_SERVICE")) {
  m = m.replace("</manifest>", `    <queries>\n        <intent>\n            <action android:name="android.intent.action.TTS_SERVICE" />\n        </intent>\n    </queries>\n</manifest>`);
}
// vidéos YouTube en plein écran possibles en paysage
m = m.replace(/android:screenOrientation="[^"]*"\s*/g, "");
fs.writeFileSync(man, m);

const gradle = path.join(root, "android/app/build.gradle");
let g = fs.readFileSync(gradle, "utf8");
const code = parseInt(process.env.VERSION_CODE || "1", 10);
g = g.replace(/versionCode \d+/, `versionCode ${code}`).replace(/versionName "[^"]*"/, `versionName "1.0.${code}"`);
if (!g.includes("signingConfigs")) {
  g = g.replace(/android\s*\{/, `android {
    signingConfigs {
        anounis {
            storeFile file("../../keystore/anounisgaming.jks")
            storePassword "anounisgaming"
            keyAlias "anounisgaming"
            keyPassword "anounisgaming"
        }
    }`);
  g = g.replace(/buildTypes\s*\{\s*release\s*\{/, `buildTypes {
        debug {
            signingConfig signingConfigs.anounis
        }
        release {
            signingConfig signingConfigs.anounis`);
}
fs.writeFileSync(gradle, g);

const strings = path.join(root, "android/app/src/main/res/values/strings.xml");
if (fs.existsSync(strings)) fs.writeFileSync(strings, fs.readFileSync(strings, "utf8")
  .replace(/<string name="app_name">[^<]*</, '<string name="app_name">AnounisGaming<')
  .replace(/<string name="title_activity_main">[^<]*</, '<string name="title_activity_main">AnounisGaming<'));
console.log("Projet Android ajusté (versionCode " + code + ")");
