# Weinkeller

Eine Weinkeller-App fürs Handy. Etikett fotografieren, eine kostenlose KI liest
Winzer, Rebsorte und Jahrgang, du bestätigst, fertig. Dazu Trinkfenster-Ampel,
Sommelier, Erfolge, Rebsorten-Album und Konfetti.

## Online

Die App läuft unter **https://renecganahl-max.github.io/weinkeller/**.
Am Handy öffnen und als App installieren:

- iPhone: in Safari auf „Teilen“, dann „Zum Home-Bildschirm“.
- Android: im Chrome-Menü „App installieren“.

Änderungen gehen von selbst online, sobald sie auf GitHub im Branch `main` liegen
(GitHub Pages, dauert ein bis zwei Minuten). Die Weine bleiben auf jedem Handy für sich;
zum Umziehen gibt es unter „Mehr“ die Sicherung.

## Starten am Mac

```bash
python3 "$HOME/Desktop/weinkeller app/serve.py"
```

Dann im Browser `http://localhost:8765` öffnen. Das Startprogramm zeigt auch die
Adresse fürs Handy im selben WLAN an (`http://<IP-Adresse des Macs>:8765`).
Fragt macOS, ob Python Verbindungen annehmen darf: erlauben, sonst klappt es am Handy nicht.
Zum Ausprobieren ohne KI: `http://localhost:8765/?mock` (Demo-Modus, liest immer dasselbe Beispiel-Etikett).

## Kostenlose KI einrichten

1. Bei [openrouter.ai](https://openrouter.ai) ein Gratis-Konto anlegen.
2. Unter [Keys](https://openrouter.ai/settings/keys) einen Schlüssel erstellen.
3. In der App unter „Mehr“ einfügen und testen.

Gratis sind 50 Anfragen pro Tag, nach einmal 10 $ Guthaben 1.000 pro Tag.
Standard-Modell ist Google Gemma 4 31B; fällt es aus, probiert die App automatisch
andere Gratis-Bildmodelle. Der Schlüssel bleibt nur auf dem Gerät.

## Was die App kann

- Eigene Kamera mit Rahmen und Scan-Linie (wie bei Vivino). Sie braucht HTTPS oder `localhost`;
  im WLAN über `http://192.168…` öffnet sich stattdessen die normale Handy-Kamera.
- Etikett scannen: Foto, KI füllt Winzer, Rebsorte, Jahrgang, Region, Land, Art und Trinkfenster aus,
  Feld für Feld zum Zuschauen.
- Gezeichnete Flaschen (Bordeaux, Schlegel, Burgunder, Sekt, halbe Flasche), wenn es kein Foto gibt.
- Fenster lassen sich nach unten wegwischen, Zahlen zählen hoch, Punkte fliegen aus dem Level-Abzeichen.
- Keller: Suche, Filter, Sortierung, Anzahl, Lagerort, Preis, Notizen. Als Liste oder als Regal
  mit großen Flaschen (Umschalter neben der Suche). Farbbalken zeigt den Mix aus Rot, Weiß und Co.
- Lagerort-Schnellwahl: die häufigsten Lagerorte als Knöpfe unter dem Feld.
- Geschmacksprofil in der Detail-Ansicht (leicht–kräftig, sanft–tanninreich, trocken–süß,
  mild–säurebetont): von der KI geschätzt oder typisch für die Rebsorte.
- Rebsorte und Region in der Detail-Ansicht antippen: der Keller zeigt alle passenden Weine.
- Sommelier-Leiste auf der Startseite: Essen eintippen, Vorschlag kommt sofort.
- Doppelte Weine erkennt sie und zählt einfach die Flaschen hoch.
- Trinkfenster als Ampel: Lagern, Jetzt trinken, Bald trinken, Drüber. „Heute dran“ zeigt, was weg muss.
- Flasche öffnen: Sterne und Verkostungsnotiz, mit Rückgängig.
- Sommelier: Essen eingeben, die KI wählt aus dem eigenen Keller (ohne KI nach Regeln).
- Links zu Vivino (Bewertungen) und Wine-Searcher (Preise).
- Spiel: XP, 10 Level, 15 Erfolge, Rebsorten-Album, Länder. Punkte gibt es fürs Sammeln,
  Notieren und gutes Timing, nicht fürs Vieltrinken.
- Sicherung als Datei speichern und laden. Beispielweine zum Ausprobieren.

## Aufbau

| Datei | Inhalt |
|---|---|
| `index.html` | Grundgerüst |
| `css/app.css` | Design (hell und dunkel) |
| `js/app.js` | Bildschirme und Abläufe |
| `js/ai.js` | KI über OpenRouter (Etikett lesen, Sommelier) |
| `js/db.js` | Speicher im Gerät (IndexedDB) |
| `js/wine.js` | Trinkfenster, Rebsorten, Länder, Essen, Links |
| `js/game.js` | XP, Level, Erfolge, Konfetti |
| `js/image.js` | Fotos verkleinern |
| `sw.js`, `manifest.json`, `icons/` | Installierbar als App, läuft offline |

Kein Build-Schritt, keine Pakete. Jede Datei lässt sich direkt bearbeiten.

## Nächste Schritte

- Online stellen (HTTPS), damit sie als App auf beide Handys kommt.
- Gemeinsamer Keller mit Login (zum Beispiel Supabase); dafür wird nur `js/db.js` ausgetauscht.
- KI-Schlüssel auf einen kleinen Server legen (Cloudflare-Funktion), damit niemand einen eigenen braucht.
