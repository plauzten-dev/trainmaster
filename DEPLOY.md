# TrainMaster online stellen (PythonAnywhere, kostenlos)

GitHub speichert nur den Code – ausführen kann es die App nicht (GitHub Pages kann nur statische Seiten).
PythonAnywhere holt den Code von GitHub und betreibt die App unter `https://DEIN_NAME.eu.pythonanywhere.com`
(oder `.pythonanywhere.com`). HTTPS ist inklusive, damit funktioniert auch die Installation als App am iPhone.

**Gratis-Tarif:** 1 Web-App, 512 MB Speicher, 100 CPU-Sekunden pro Tag. Die Web-App läuft jeweils 1 Monat und
muss dann im Reiter *Web* mit einem Klick verlängert werden (PythonAnywhere schickt vorher eine E-Mail).
Für dich und ein paar Freunde reicht das gut.

## 1. Konto anlegen
1. Auf <https://eu.pythonanywhere.com> registrieren (EU-Server – besser für den Datenschutz).
   Der Benutzername wird Teil der Adresse.

## 2. Code holen
Im Reiter **Consoles** → **Bash** öffnen und eingeben:

```bash
git clone https://github.com/plauzten-dev/trainmaster.git
cd trainmaster
mkvirtualenv --python=python3.12 trainmaster
pip install -r requirements.txt
```

(Ist Python 3.12 nicht verfügbar, die höchste angebotene Version ab 3.10 nehmen.)

## 3. Web-App einrichten
1. Reiter **Web** → **Add a new web app** → **Manual configuration** → dieselbe Python-Version wählen.
2. **Virtualenv**: `/home/DEIN_NAME/.virtualenvs/trainmaster`
3. **WSGI configuration file** anklicken, gesamten Inhalt ersetzen durch den Inhalt von
   `deploy/pythonanywhere_wsgi.py` und dort `DEIN_BENUTZERNAME` sowie die Betreiberdaten eintragen.
4. **Static files** (optional, macht es schneller): URL `/static/` → Ordner `/home/DEIN_NAME/trainmaster/static`
5. **Force HTTPS** einschalten.
6. Oben auf **Reload** klicken – fertig. Beim ersten Aufruf entstehen Datenbank, Secret-Key und Übungen automatisch.

## 4. Updates einspielen
Nach Änderungen am Code (auf GitHub gepusht) in der Bash-Konsole:

```bash
cd ~/trainmaster && git pull && workon trainmaster && pip install -r requirements.txt
```

Danach im Reiter **Web** auf **Reload** klicken. Datenbank und Bilder bleiben erhalten (sie sind nicht im Repo).

## 5. Datensicherung
Die Datenbank liegt in `~/trainmaster/trainmaster.db`, Bilder in `~/trainmaster/uploads/`.
Im Reiter **Files** kannst du beides herunterladen – am besten ab und zu machen.

## Wichtig vor dem Teilen
- Betreiberdaten in der WSGI-Datei eintragen (sonst zeigen Impressum/Datenschutz gelbe Platzhalter).
- **Kein** `scripts/seed_demo.py` auf dem Server ausführen (legt Demo-Konten mit bekanntem Passwort an).
- Freunde registrieren sich ganz normal; Spieler brauchen einen Einladecode von dir als Trainer.

## Alternative mit eigener Domain / ohne Monatsklick
`Dockerfile` und `fly.toml` liegen bei (Fly.io, mit persistentem Volume). Das braucht eine Kreditkarte und kostet
je nach Nutzung einige Euro im Monat, läuft dafür ohne Verlängerung und mit eigener Domain.
