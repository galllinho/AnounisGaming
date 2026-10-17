// Ajuste le projet Android généré : permissions, signature stable, numéro de version, nom
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const man = path.join(root, "android/app/src/main/AndroidManifest.xml");
let m = fs.readFileSync(man, "utf8");
for (const p of ["android.permission.INTERNET", "android.permission.WAKE_LOCK", "android.permission.POST_NOTIFICATIONS", "android.permission.SCHEDULE_EXACT_ALARM", "android.permission.RECEIVE_BOOT_COMPLETED", "android.permission.VIBRATE"]) {
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
// le plugin d'arrière-plan embarque son moteur JavaScript dans une bibliothèque locale
if (!g.includes("background-runner/android/src/main/libs")) {
  g = g.replace(/flatDir\s*\{\s*dirs ([^\n]*)/, (m, d) => `flatDir{\n        dirs ${d}\n        dirs '../../node_modules/@capacitor/background-runner/android/src/main/libs', 'libs'`);
}
fs.writeFileSync(gradle, g);

const strings = path.join(root, "android/app/src/main/res/values/strings.xml");
if (fs.existsSync(strings)) fs.writeFileSync(strings, fs.readFileSync(strings, "utf8")
  .replace(/<string name="app_name">[^<]*</, '<string name="app_name">AnounisGaming<')
  .replace(/<string name="title_activity_main">[^<]*</, '<string name="title_activity_main">AnounisGaming<'));
// widget écran d'accueil (3 dernières infos)
const nat = path.join(root, "native/widget");
const javaDir = path.join(root, "android/app/src/main/java/fr/anounis/gaming");
fs.mkdirSync(javaDir, { recursive: true });
fs.copyFileSync(path.join(nat, "WidgetProvider.java"), path.join(javaDir, "WidgetProvider.java"));
for (const [dir, file] of [["layout", "widget_news.xml"], ["xml", "widget_info.xml"], ["drawable", "widget_bg.xml"]]) {
  const d = path.join(root, "android/app/src/main/res", dir);
  fs.mkdirSync(d, { recursive: true });
  fs.copyFileSync(path.join(nat, "res", dir, file), path.join(d, file));
}
let man2 = fs.readFileSync(man, "utf8");
if (!man2.includes(".WidgetProvider")) {
  man2 = man2.replace("</application>", `    <receiver android:name=".WidgetProvider" android:exported="false" android:label="AnounisGaming">
            <intent-filter><action android:name="android.appwidget.action.APPWIDGET_UPDATE" /></intent-filter>
            <meta-data android:name="android.appwidget.provider" android:resource="@xml/widget_info" />
        </receiver>
    </application>`);
  fs.writeFileSync(man, man2);
}
if (fs.existsSync(strings)) {
  let st = fs.readFileSync(strings, "utf8");
  if (!st.includes("widget_desc")) st = st.replace("</resources>", '    <string name="widget_desc">Les 3 dernières infos jeux vidéo</string>\n</resources>');
  fs.writeFileSync(strings, st);
}
console.log("Projet Android ajusté (versionCode " + code + ")");
