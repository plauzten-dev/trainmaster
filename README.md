# TrainMaster

Trainingsplanung als Web-App/PWA für **Trainer**, **Spieler** und **Privatpersonen**: Übungsdatenbank, Trainings mit Blöcken und Live-Modus, Kalender mit Terminen, Teams mit Anwesenheit, PDF-Export.

Stack: Python 3.12+ · Flask 3 · SQLite · Vanilla HTML/CSS/JS (keine Build-Tools, keine Bibliotheken, keine externen Ressourcen).

## Lokal starten

```bash
python -m pip install -r requirements.txt
python app.py            # http://localhost:5000
```

Beim ersten Start entstehen automatisch `training.db`, `secret_key.txt` und die 46 Systemübungen. Unter Windows genügt ein Doppelklick auf `start.bat`.

Demo-Daten für Tests (nur lokal!): `python scripts/seed_demo.py` – legt `demo_trainer`, `demo_spieler`, `demo_privat` samt Teams, Spielern, Trainings und Terminen an (Passwort steht im Skript).

App-Icons neu erzeugen (nach Logo-Änderung): `python scripts/make_icons.py`.

## Umgebungsvariablen

| Variable | Zweck |
|---|---|
| `SECRET_KEY` | Signatur der Session-Cookies. **In Produktion setzen** (sonst wird `secret_key.txt` erzeugt). |
| `DB_PATH` | SQLite-Datei (Default `training.db`; Container: `/data/trainmaster.db` auf persistentem Volume) |
| `UPLOAD_DIR` | Ordner für lokale Bilder (Default `uploads/`) |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Optional: Bilder bei Cloudinary statt lokal |
| `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Optional: E-Mail-Verifikation. Ohne SMTP wird sofort eingeloggt, der Link nur geloggt. |
| `OPERATOR_NAME`, `OPERATOR_ADDRESS`, `OPERATOR_EMAIL`, `OPERATOR_PHONE` | Betreiberangaben für Impressum und Datenschutzerklärung |
| `OPERATOR_HOSTING`, `OPERATOR_MAIL_PROVIDER`, `OPERATOR_LOG_DAYS` | Hoster, E-Mail-Dienst und Log-Aufbewahrung für die Datenschutzerklärung |
| `FEEDBACK_URL` | Ziel des Feedback-Links (sonst `mailto:OPERATOR_EMAIL`) |
| `PORT` | Port (Container: 8080) |
| `INSECURE_COOKIES=1` | Nur für lokale Tests ohne HTTPS unter gunicorn. `python app.py` setzt das automatisch. |

## Deployment

**Online stellen ohne eigenen Server:** Schritt-für-Schritt-Anleitung für PythonAnywhere (kostenlos) in [DEPLOY.md](DEPLOY.md).

`Dockerfile` (python:3.12-slim, gunicorn, 2 Worker) und ein `fly.toml`-Beispiel liegen bei. Wichtig:

- SQLite **und** lokale Uploads müssen auf einem persistenten Volume liegen (`/data`), oder Bilder über Cloudinary.
- Secrets nur per `fly secrets set …` bzw. Umgebungsvariablen, nie in Dateien.
- Bei jedem Release `APP_VERSION` in `config.py` **und** `CACHE_VERSION` in `static/sw.js` erhöhen (die App warnt beim Start, wenn beide nicht übereinstimmen).

## Rollen

| Rolle | Rechte |
|---|---|
| Trainer | Übungen, Trainings, Kalender inkl. Termine, Teams/Spieler, Anwesenheit, Einladecodes, „Mein Team“ |
| Spieler | Registrierung nur per Einladecode. Eigene Trainings; Trainings und Termine (nur der eigenen Teams) des Trainers read-only; eigene Anwesenheit melden |
| Privat | Eigene Trainings und Übungen, keine Team-/Termin-/Anwesenheitsfunktionen |

Alle Rechte werden serverseitig geprüft (Rolle frisch aus der DB, `@role_required`); fremde Objekte liefern 404.

## Datenschutz & Rechtliches – Checkliste vor dem Veröffentlichen

Technisch ist die App auf Datensparsamkeit ausgelegt:

- **Keine Cookie-Einwilligung nötig:** nur ein technisch notwendiges Session-Cookie (`tm_session`, HttpOnly, Secure, SameSite=Lax). `localStorage`/`sessionStorage` nur für Komfort-Einstellungen, die das Gerät nicht verlassen. Alles ist in `/privacy` tabellarisch aufgeführt.
- **Keine Drittanbieter im Browser:** keine Google Fonts, kein CDN, kein Tracking. Eine strenge Content-Security-Policy erzwingt das (`script-src 'self'`).
- **Betroffenenrechte im Produkt:** Datenexport als JSON (Auskunft/Portabilität), Selbst-Löschung inkl. aller Bilder, Profil änderbar.
- **Sicherheit:** PBKDF2-HMAC-SHA256 (200 000 Iterationen, Salt), CSRF-Header + Origin-Prüfung, Login-Rate-Limit, Sicherheits-Header, HSTS bei HTTPS, keine Stacktraces an Clients.
- Profil- und Spielerbilder sind nur für eingeloggte Nutzer abrufbar; Gäste sehen nur Bilder aktiv geteilter Übungen. Der Service Worker cached weder `/api/*` noch `/uploads/*`.

Was **du als Betreiber** noch tun musst:

1. `OPERATOR_*`-Variablen setzen – sonst zeigen Impressum und Datenschutzerklärung gelb markierte Platzhalter.
2. Mit dem Hoster (und ggf. Cloudinary, E-Mail-Dienst) einen **Auftragsverarbeitungsvertrag (AVV)** abschließen; Hosting möglichst in der EU.
3. Im Impressum die Zusatzangaben ergänzen, falls zutreffend (Firmenbuch, UID, Kammer).
4. Die Texte in `templates/privacy.html` und `templates/imprint.html` rechtlich prüfen lassen – sie sind eine sorgfältige Vorlage, aber keine Rechtsberatung.
5. Hinweis Gesundheitsdaten: Der Spielerstatus „krank/verletzt“ ist eine Gesundheitsangabe (Art. 9 DSGVO). Die App weist Trainer im Formular darauf hin, dass sie dafür eine Einwilligung brauchen.

## Entscheidungen

- **Übungs-Sichtbarkeit:** Systemübungen + eigene. Fremde Übungen nur über Share-Link-Import (Kopie, Bild wird mitkopiert, damit Löschen beim Original die Kopie nicht beschädigt).
- **Seed:** pro Sportart nur, wenn es noch keine *Systemübung* dieser Sportart gibt (idempotent, unabhängig von Nutzerübungen).
- **Termine für Privat:** `GET /api/events` liefert 403 (laut Matrix kein Zugriff); der Kalender lädt für Privat keine Termine.
- **Team-Kennzahl „Trainings“:** Anzahl der Trainings mit Anwesenheitstracking für dieses Team – dieselbe Basis wie Prozentwert und Übersicht.
- **Suche:** Unicode-fähiges `lower()` (eigene SQLite-Funktion), damit Umlaute case-insensitiv gefunden werden.
- **Zusatz-Endpunkte:** `GET /api/next-up` (Anzeige „Als Nächstes“ in der Navigation), `GET /api/auth/export` (Datenexport), Seite `/imprint`.
- **Rate-Limit** ist in-memory pro gunicorn-Worker (bei 2 Workern effektiv höchstens doppelt so viele Versuche).
- **Design:** eigenes „Liquid Glass“-System (hell/dunkel, Tokens in `static/css/app.css :root`). Die mobile Navigation ist an die Tab-Leiste von Apple Music angelehnt: schwebende Glas-Kapsel mit gleitender Linse (Tippen oder Finger darüber ziehen), separater runder Plus-Button für Schnell-Erstellen, „Als Nächstes“-Leiste wie der Mini-Player; beim Herunterscrollen minimiert sich die Leiste auf den aktiven Tab und die „Als Nächstes“-Leiste rückt in die Zeile. Die Leiste ist ein In-Flow-Flex-Kind der fixen App-Shell (iOS-PWA-sicher, keine Lücke unter der Navigation).

## Struktur

```
app.py              App, Sicherheit, Seiten
api_auth.py         Registrierung, Login, Konto, Export
api_content.py      Übungen, Trainings, Termine
api_team.py         Teams, Spieler, Anwesenheit
api_dashboard.py    Dashboard, Statistik, Als Nächstes
database.py         Schema, Migrationen, Seed, Hashing
helpers.py          Decorators, Zugriffsregeln, Uploads, Mail, Rate-Limit
config.py           APP_NAME, APP_VERSION, Konstanten
data/               schema.sql, konstanten.json, seed_exercises.json
templates/ static/  Oberfläche (je Seite ein Template + JS)
scripts/            seed_demo.py, make_icons.py
```
