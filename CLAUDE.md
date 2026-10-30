# TrainMaster – Projektwissen für Claude

Trainingsplanungs-Web-App/PWA für Trainer, Spieler und Privatpersonen. Ursprüngliche Spezifikation:
`Masterprompt_Neues_Projekt/MASTERPROMPT.md` (nur lokal, absichtlich nicht im Repo). Nutzer spricht Deutsch –
UI-Texte, Antworten und Commit-Messages auf Deutsch, Code-Bezeichner Englisch.

## Arbeitsweise mit dem Nutzer (wichtig)
- **Ablauf:** lokal ändern → im Browser prüfen → lokal committen → **pushen nur, wenn der Nutzer es ausdrücklich sagt**.
  Live geht es erst, wenn der Nutzer auf PythonAnywhere `git pull` + Reload macht (Befehl siehe unten). Nichts ist automatisch live.
- **Hosting kostet nie etwas:** PythonAnywhere Free (EU) – keine bezahlten Dienste/Kreditkarte vorschlagen.
- Bei jeder Änderung an CSS/JS/Templates, die live gehen soll: **Version erhöhen** in `config.py` (`APP_VERSION`) **und**
  `static/sw.js` (`CACHE_VERSION = 'v…'`) – sonst liefern Browser/Service Worker online alte Dateien (App warnt beim Start bei Abweichung).
- Nutzer testet am iPhone (installierte PWA, iOS 26). Nach Design-Änderungen: App vom Home-Bildschirm löschen und neu hinzufügen.

## Live-Betrieb
- Repo: https://github.com/plauzten-dev/trainmaster (öffentlich, Branch `main`)
- Live: https://plauztendev.eu.pythonanywhere.com (Benutzer `PlauztenDev`, Code in `/home/PlauztenDev/trainmaster`,
  Virtualenv `trainmaster`, Python 3.12). Web-App muss monatlich verlängert werden („Run until 1 month from today“).
- Update auf dem Server (Bash-Konsole), danach im Reiter Web „Reload“:
  `cd ~/trainmaster && git pull && workon trainmaster && pip install -r requirements.txt`
- Server-Datenbank/Bilder (`trainmaster.db`, `uploads/`) liegen nur dort und sind nie im Repo. Anleitung: `DEPLOY.md`.
- Betreiberdaten für Impressum/Datenschutz kommen per Env aus der WSGI-Datei auf PythonAnywhere (`OPERATOR_*`); noch nicht ausgefüllt.

## Lokal
- Start: `start.bat` bzw. `python app.py` → http://localhost:5000 (iPhone im WLAN: http://192.168.68.104:5000).
  `python app.py` setzt `DEV_MODE` → kein Caching (Server + Service Worker), Änderungen sofort sichtbar.
- Der Nutzer hat oft selbst einen Server auf Port 5000 laufen; Vorschau-Server weicht dann auf 5001 aus (`.claude/launch.json`).
- Demo-Daten (nur lokal): `python scripts/seed_demo.py` → `demo_trainer`, `demo_spieler`, `demo_privat`, Passwort im Skript.
- Tests: `python tests/api_test.py` (99 API-Prüfungen gegen temporäre DB, Exit-Code ≠ 0 bei Fehlern) – nach Backend-Änderungen laufen lassen.
- App-Icons nach Logo-Änderung neu erzeugen: `python scripts/make_icons.py` (reines Python, Geometrie im Skript, Quelle `static/icons/logo.svg`).

## Git-Besonderheiten
- Commits laufen unter der anonymen Adresse `285976574+plauzten-dev@users.noreply.github.com` (lokale git-config) – die Gmail-Adresse darf nicht ins öffentliche Repo.
- `main` startet mit einem sauberen Einzel-Commit. Die alte, detaillierte Historie liegt **nur lokal** im Branch `historie-lokal` (nie pushen),
  Tag `v1.0.2-klassisch` = alte Startseite (nur lokal). `Masterprompt_Neues_Projekt/` ist gitignored.
- Zeilenenden: `.gitattributes` erzwingt LF für `*.sh` und `Dockerfile`.

## Stack & Regeln (aus der Spezifikation, verbindlich)
- Flask 3 + SQLite, Vanilla HTML/CSS/JS, **keine** Bibliotheken/Build-Tools, nur Inline-SVG-Icons (Sprite `templates/_icons.html`),
  keine Emojis, keine externen Ressourcen (CSP `script-src 'self'` → **keine Inline-Skripte/onclick**, nur Dateien in `static/js`).
- Jede Ausgabe von Nutzertext über `escHtml()`. Rollenprüfung serverseitig (`@login_required`, `@role_required`), fremde Objekte → 404.
- Schreibende Requests brauchen Header `X-Requested-With: fetch` (CSRF) – im Frontend immer `api()` aus `core.js` nutzen.
- Nur Komfort-Daten im `localStorage` (`exercises_sport`, `calView`, `theme`, `accent`) – neue Keys auch in `templates/privacy.html` (Cookie-Tabelle) eintragen.

## Architektur
- Backend: `app.py` (Sicherheit, Seiten, Header/Caching), `api_auth.py`, `api_content.py` (Übungen/Trainings/Termine),
  `api_team.py` (Teams/Spieler/Anwesenheit), `api_dashboard.py` (inkl. `/api/next-up`), `helpers.py`, `database.py`, `config.py`.
- `/` zeigt Gästen `templates/landing.html` (Apple-Stil, Installations-Anleitung mit Geräteerkennung, `static/js/landing.js`, `static/css/landing.css`), Eingeloggten → `/dashboard`.
- Design-Tokens in `static/css/app.css :root` (hell/dunkel). Farbprofile: Standard Rot-Violett, `html[data-accent="ocean"]` Grün-Blau
  (gesetzt in `static/js/theme.js`, gewählt in Einstellungen → Darstellung). Farben immer über Tokens (`--accent`, `--accent-grad`, `--accent-glow`, `--grad-a/b`).
- **Dock (mobile Tab-Leiste, Apple-Music-Stil)** in `core.js` `initDock`: Glas-Linse, Ziehen über Tabs, minimiert beim Scrollen, „Als Nächstes“-Accessory.
- **Schneller Tab-Wechsel** in `core.js` (`softNavigate`): Tabs (Übersicht/Kalender/Übungen/Trainings/Team) tauschen nur `.page` aus,
  Nachbar-Tabs werden vorgeladen, Wischen links/rechts (`initSwipeNav`). Regeln für Seitenskripte:
  - IIFE beginnt mit `if (!claimPage('<root-id>')) return;` (bindet sich einmal an die frische Seite),
  - **keine** Listener an `document`/`window` in Seitenskripten (an das Seiten-Root hängen),
  - keine globalen `const/let`; laufende `api()`-Aufrufe werden beim Seitenwechsel abgebrochen (`PAGE_ABORT`),
    für dauerhafte Aufrufe `api(url, { keep: true })`.
- **iOS-26-PWA:** Lücke/schwarzer Balken unter der Tab-Leiste ist mit der CSS-Regel `@media (display-mode: standalone) { html { min-height: min(100lvh, …) } }`
  in `app.css` gelöst (WebKit-Bug 301108). App-Shell **nicht** per JS verlängern, keine `filter: blur()` auf großen Flächen (Performance).
- Dashboard = Variante „Bibliothek“ (Heute-Karte, Diese Woche, Bibliothek-Liste, wischbare Reihen); Statistik im Dialog.
- Training-Detail: Tabs Übungen/Team/Notizen – „Team“ nur für Trainer bei eigenen Trainings (`trainings.team_id`, keine Vorauswahl),
  Spieler sehen stattdessen eine kompakte Zusage-Karte. Drucken: Desktop `window.print()`, iPhone/iPad teilt die echte PDF-Datei
  `/training/<id>/pdf/file` (`pdf_export.py`, reines Python, nur Text) – `window.print()` geht in der iOS-PWA nicht.

## Offene Punkte / Ideen
- Betreiberdaten (`OPERATOR_*`) auf PythonAnywhere eintragen; Datenschutz/Impressum rechtlich prüfen lassen.
- Landingpage + Abmelden-Knopf (v1.5.1) sind gepusht; Nutzer muss sie noch auf PythonAnywhere einspielen und am iPhone testen.
- Roadmap-Ideen aus den Einstellungen: Trainingsvorlagen, Saison-/Wochenplanung, Share-Link-Verwaltung.
