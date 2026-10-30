"""API-Abnahmetest (Abschnitt 13 der Spezifikation): Rollen, Rechte (403/404), Einladecodes,
Uebungen/Teilen, Trainings, Termine, Anwesenheit, Dashboard, Rate-Limit, Konto loeschen.

Laeuft gegen eine temporaere Datenbank – die echte training.db bleibt unberuehrt.
Aufruf aus dem Projektordner:  python tests/api_test.py
"""
import io, os, sys, tempfile, json
tmp = tempfile.mkdtemp()
os.environ['DB_PATH'] = os.path.join(tmp, 't.db')
os.environ['UPLOAD_DIR'] = os.path.join(tmp, 'up')
os.environ['INSECURE_COOKIES'] = '1'
ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import logging; logging.disable(logging.WARNING)
from app import app
H = {'X-Requested-With': 'fetch'}
fails = []
def check(cond, msg):
    print(('OK   ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)

def client(): return app.test_client()

def reg(c, name, role, code=None, privacy=True):
    return c.post('/api/auth/register', json={'username': name, 'email': name + '@x.de', 'password': 'secret1', 'role': role, 'invite_code': code, 'accept_privacy': privacy}, headers=H)

# Seiten ohne Login
c0 = client()
check(c0.get('/dashboard').status_code == 302, 'Seite ohne Login -> Redirect')
check(c0.get('/api/exercises').status_code == 401, 'API ohne Login -> 401')
for p in ('/privacy', '/imprint', '/offline', '/login', '/sw.js', '/manifest.json'):
    r = c0.get(p); check(r.status_code == 200, 'oeffentlich ' + p)
check(c0.get('/sw.js').headers.get('Service-Worker-Allowed') == '/', 'SW header')
check('Content-Security-Policy' in c0.get('/login').headers, 'CSP gesetzt')
check(c0.post('/api/auth/login', json={'username': 'x', 'password': 'y'}).status_code == 403, 'CSRF ohne Header -> 403')

# Trainer
t = client()
check(reg(t, 'trainer1', 'trainer', privacy=False).status_code == 400, 'Registrierung ohne Datenschutz -> 400')
r = reg(t, 'trainer1', 'trainer'); check(r.status_code == 201, 'Trainer registriert')
check(reg(client(), 'TRAINER1', 'trainer').get_json()['error'] == 'Benutzername bereits vergeben', 'Username eindeutig (case-insens.)')
ex = t.get('/api/exercises').get_json(); check(len(ex) == 46, 'Trainer sieht 46 Systemuebungen (%d)' % len(ex))
d = t.get('/api/dashboard').get_json(); check(d['stats']['total_trainings'] == 0 and len(d['suggested']) == 3, 'Dashboard leer + 3 Vorschlaege')
# Uebung mit Bild (HEIC)
data = {'title': 'Meine Übung', 'description': 'Text\nZeile 2', 'core_competency': 'Passspiel', 'difficulty': 'Profi', 'field_size': 'Klein (10x10m)', 'sport': 'Fußball', 'field_players': '6', 'goalkeepers': '1',
        'image': (io.BytesIO(b'fakeheicdata'), 'bild.HEIC')}
r = t.post('/api/exercises', data=data, headers=H, content_type='multipart/form-data'); check(r.status_code == 201, 'Uebung mit HEIC angelegt')
my = r.get_json(); check(my['is_owner'] and my['image_path'].endswith('.heic'), 'is_owner + Bildpfad')
bad = dict(data); bad['image'] = (io.BytesIO(b'x'), 'virus.exe')
check(t.post('/api/exercises', data=bad, headers=H, content_type='multipart/form-data').status_code == 400, 'Ungueltiges Bildformat -> 400')
check(t.put('/api/exercises/1', data={k: v for k, v in data.items() if k != 'image'}, headers=H, content_type='multipart/form-data').status_code == 403, 'Systemuebung nicht aenderbar')
check(t.post('/api/exercises/%d/favorite' % my['id'], headers=H).get_json()['is_favorite'] is True, 'Favorit an')
check(len(t.get('/api/exercises?favorites=1').get_json()) == 1, 'Filter favorites')
check(len(t.get('/api/exercises?search=MEINE%20%C3%9CB').get_json()) == 1, 'Suche case-insensitive')
sh = t.post('/api/exercises/%d/share' % my['id'], headers=H).get_json()
sh2 = t.post('/api/exercises/%d/share' % my['id'], headers=H).get_json()
check(sh['token'] == sh2['token'], 'Share-Token wiederverwendet')
check(c0.get('/exercise/share/' + sh['token']).status_code == 200, 'Share-Seite oeffentlich')
check(c0.get('/uploads/' + my['image_path']).status_code == 200, 'Bild geteilter Uebung fuer Gast')

# Zweiter Nutzer importiert, sieht fremde Uebung nicht
v = client(); reg(v, 'privat1', 'private')
check(len(v.get('/api/exercises').get_json()) == 46, 'Privat sieht keine fremden Uebungen')
check(v.get('/api/exercises/%d' % my['id']).status_code == 404, 'Fremde Uebung -> 404')
imp = v.post('/api/exercises/import/' + sh['token'], headers=H); check(imp.status_code == 201, 'Import 201')
check(len(v.get('/api/exercises').get_json()) == 47, 'Import in eigene Sammlung')
check(t.delete('/api/exercises/%d/share' % my['id'], headers=H).status_code == 200, 'Link widerrufen')
check(c0.get('/exercise/share/' + sh['token']).status_code == 404, 'Widerrufener Link 404')
check(c0.get('/uploads/' + my['image_path']).status_code == 404, 'Bild nach Widerruf nicht mehr fuer Gast')

# Teams & Spieler
team = t.post('/api/teams', json={'name': 'U17', 'sport': 'Fußball'}, headers=H).get_json()
team2 = t.post('/api/teams', json={'name': 'U19', 'sport': 'Fußball'}, headers=H).get_json()
p = t.post('/api/players', json={'name': 'Max', 'position': 'Stürmer', 'number': 9, 'birthday': '2008-05-01', 'status': 'fit', 'team_ids': [team['id'], team2['id']]}, headers=H).get_json()
check(len(p['invite_code']) == 8 and sorted(p['team_ids']) == sorted([team['id'], team2['id']]), 'Spieler in 2 Teams + Code')
p2 = t.post('/api/players', json={'name': 'Ben', 'team_ids': [team['id']]}, headers=H).get_json()
teams = t.get('/api/teams').get_json(); check(teams[0]['player_count'] == 2 and teams[1]['player_count'] == 1, 'player_count ueber Memberships')
check(t.put('/api/players/%d/status' % p['id'], json={'status': 'verletzt'}, headers=H).get_json()['status'] == 'verletzt', 'Status aendern')
check(t.post('/api/players', json={'name': 'X', 'number': 120}, headers=H).status_code == 400, 'Trikotnummer > 99 -> 400')

# Spieler-Registrierung
s = client()
check(reg(s, 'spieler1', 'player', 'FFFFFFFF').get_json()['error'] == 'Einladecode ungültig oder nicht gefunden', 'Ungueltiger Code')
check(reg(s, 'spieler1', 'player', p['invite_code'].lower()).status_code == 201, 'Spieler mit Code registriert')
check(reg(client(), 'spieler2', 'player', p['invite_code']).get_json()['error'] == 'Dieser Einladecode wurde bereits verwendet', 'Code zweimal -> Fehler')

# Trainings
tr = t.post('/api/trainings', json={'title': 'Training A', 'date': '2026-10-28', 'time': '18:00'}, headers=H).get_json()
tid = tr['id']
for eid, block, dur in ((1, 'Aufwärmen', 10), (2, 'Hauptteil', 20), (3, 'Abschluss', None), (my['id'], 'Quatsch', 5)):
    check(t.post('/api/trainings/%d/exercises' % tid, json={'exercise_id': eid, 'block': block, 'duration': dur}, headers=H).status_code == 201, 'Uebung %d hinzu' % eid)
check(t.post('/api/trainings/%d/exercises' % tid, json={'exercise_id': 1}, headers=H).get_json()['error'] == 'Übung bereits im Training', 'Doppelte Uebung -> 400')
check(t.post('/api/trainings/%d/exercises' % tid, json={'exercise_id': imp.get_json()['id']}, headers=H).status_code == 404, 'Fremde Uebung nicht hinzufuegbar')
det = t.get('/api/trainings/%d' % tid).get_json()
check([e['block'] for e in det['exercises']][-1] == 'Hauptteil', 'Ungueltiger Block -> Hauptteil')
check(t.put('/api/trainings/%d/exercises/reorder' % tid, json={'order': [3, 2, 1, my['id']]}, headers=H).status_code == 200, 'Reorder')
check(t.put('/api/trainings/%d/exercises/1/meta' % tid, json={'block': 'Abschluss', 'duration': 241}, headers=H).status_code == 400, 'Dauer > 240 -> 400')
check(t.put('/api/trainings/%d/exercises/1/meta' % tid, json={'block': 'Abschluss'}, headers=H).get_json()['block'] == 'Abschluss', 'Blockwechsel')
check(t.put('/api/trainings/%d' % tid, json={'notes': 'Notiz'}, headers=H).status_code == 200, 'Notizen speichern')
check(t.get('/api/trainings/%d' % tid).get_json()['time'] == '18:00', 'time bleibt ohne time im Body')
dup = t.post('/api/trainings/%d/duplicate' % tid, json={'date': '2026-11-04', 'title': 'Kopie'}, headers=H).get_json()
dd = t.get('/api/trainings/%d' % dup['id']).get_json()
check(len(dd['exercises']) == 4 and dd['notes'] == '' and dd['time'] == '18:00' and dd['title'] == 'Kopie', 'Duplizieren korrekt')
check(t.get('/training/%d/pdf' % tid).status_code == 200 and 'Abschluss' in t.get('/training/%d/pdf' % tid).get_data(as_text=True), 'PDF mit Block')
pf = t.get('/training/%d/pdf/file' % tid); check(pf.status_code == 200 and pf.mimetype == 'application/pdf' and pf.data.startswith(b'%PDF') and pf.data.rstrip().endswith(b'%%EOF'), 'PDF-Datei')
check(t.get('/api/trainings/%d' % tid).get_json()['team_id'] is None, 'Neues Training ohne Team')
check(t.put('/api/trainings/%d' % tid, json={'team_id': team['id']}, headers=H).status_code == 200 and t.get('/api/trainings/%d' % tid).get_json()['team_name'] == 'U17', 'Team zuordnen')
check(t.put('/api/trainings/%d' % tid, json={'team_id': 99999}, headers=H).status_code == 404, 'Fremdes Team -> 404')
check(t.put('/api/trainings/%d' % tid, json={'notes': 'Notiz'}, headers=H).status_code == 200 and t.get('/api/trainings/%d' % tid).get_json()['team_id'] == team['id'], 'Team bleibt ohne team_id im Body')

# Spieler-Sicht
st = s.get('/api/trainings').get_json(); check(any(x['id'] == tid and not x['owned_by_me'] for x in st), 'Spieler sieht Trainer-Training')
check(s.get('/api/trainings/%d' % tid).status_code == 200, 'Spieler liest Trainer-Training')
check(s.put('/api/trainings/%d' % tid, json={'title': 'x'}, headers=H).status_code == 403, 'Spieler darf nicht aendern')
check(s.get('/training/%d/pdf' % tid).status_code == 200, 'Spieler PDF ok')
for url, body in (('/api/events', {'title': 'x', 'date': '2026-10-30', 'type': 'spiel'}), ('/api/teams', {'name': 'x', 'sport': 'Gym'}), ('/api/players', {'name': 'x'})):
    check(s.post(url, json=body, headers=H).status_code == 403, 'Spieler POST %s -> 403' % url)
    check(v.post(url, json=body, headers=H).status_code == 403, 'Privat POST %s -> 403' % url)
check(v.get('/players').status_code == 302, 'Privat /players -> Redirect')
check(v.get('/api/trainings/%d' % tid).status_code == 404, 'Privat sieht fremdes Training nicht')
own = s.post('/api/trainings', json={'title': 'Eigen', 'date': '2026-10-29'}, headers=H); check(own.status_code == 201, 'Spieler eigenes Training')
check(s.put('/api/trainings/%d' % own.get_json()['id'], json={'team_id': team['id']}, headers=H).status_code == 403, 'Spieler darf kein Team zuordnen')

# Termine
e1 = t.post('/api/events', json={'title': 'Spiel', 'date': '2026-10-28', 'type': 'spiel', 'team_id': team['id']}, headers=H).get_json()
e2 = t.post('/api/events', json={'title': 'Intern', 'date': '2026-10-28', 'type': 'sonstiges'}, headers=H).get_json()
e3 = t.post('/api/events', json={'title': 'Fremdteam', 'date': '2026-10-28', 'type': 'turnier', 'team_id': 99999}, headers=H).get_json()
evs = s.get('/api/events?month=2026-10').get_json()
check([x['title'] for x in evs] == ['Spiel'], 'Spieler sieht nur Termine seiner Teams: %s' % [x['title'] for x in evs])
check(t.put('/api/events/%d' % e2['id'], json={'title': 'Intern2', 'date': '2026-10-29', 'type': 'turnier'}, headers=H).status_code == 200, 'Termin bearbeiten')
check(t.delete('/api/events/%d' % e3['id'], headers=H).status_code == 200, 'Termin loeschen')
check(v.get('/api/events').status_code == 403, 'Privat GET events -> 403')

# Anwesenheit
check(s.put('/api/trainings/%d/my-attendance' % tid, json={'present': True}, headers=H).get_json()['present'] == 1, 'Spieler meldet Ja')
att = t.get('/api/trainings/%d/attendance?team_id=%d' % (tid, team['id'])).get_json()
check({a['name']: a['present'] for a in att} == {'Ben': None, 'Max': 1}, 'Trainer sieht Spieler-Meldung')
check(s.get('/api/trainings/%d/my-attendance' % own.get_json()['id']).status_code == 404, 'my-attendance bei eigenem Training 404')
check(t.put('/api/trainings/%d/attendance' % tid, json={'player_id': p2['id'], 'present': False}, headers=H).status_code == 200, 'Trainer markiert fehlt')
summ = t.get('/api/teams/%d/attendance-summary' % team['id']).get_json()
check(summ['total_tracked'] == 1 and summ['players'][0]['name'] == 'Max' and summ['players'][1]['absent_count'] == 1, 'Summary korrekt')
check(t.put('/api/trainings/%d/attendance/all' % tid, json={'team_id': team['id'], 'present': True}, headers=H).get_json()['count'] == 2, 'Ganzes Team anwesend')
check(t.put('/api/trainings/%d/attendance' % tid, json={'player_id': p2['id'], 'present': None}, headers=H).status_code == 200, 'null loescht Eintrag')

# Dashboard Spieler
ds = s.get('/api/dashboard').get_json(); check(ds['stats']['total_trainings'] == 3, 'Spieler-Dashboard zaehlt eigene+Trainer (%d)' % ds['stats']['total_trainings'])
check(s.get('/api/statistik').status_code == 200 and len(s.get('/api/statistik').get_json()['monthly']) == 6, 'Statistik 6 Monate')
check(t.put('/api/auth/weekly-goal', json={'weekly_goal': 99}, headers=H).get_json()['weekly_goal'] == 14, 'Wochenziel geklemmt')

# Regenerate + Remove/Delete
rg = t.post('/api/players/%d/regenerate-invite' % p['id'], headers=H).get_json()
check(t.get('/api/players/%d' % p['id']).get_json()['linked_user_id'] is None, 'Regenerate loest Verknuepfung')
check(s.get('/api/trainings/%d' % tid).status_code == 404, 'Entknuepfter Spieler sieht Training nicht mehr')
check(t.delete('/api/players/%d/teams/%d' % (p['id'], team2['id']), headers=H).get_json()['remaining_teams'] == 1, 'Aus einem Team entfernen')

# Login/Rate-Limit
lc = client()
check(lc.post('/api/auth/login', json={'username': 'trainer1@x.de', 'password': 'secret1'}, headers=H).status_code == 200, 'Login per E-Mail')
for i in range(10): lc.post('/api/auth/login', json={'username': 'ratetest', 'password': 'bad'}, headers=H)
check(lc.post('/api/auth/login', json={'username': 'ratetest', 'password': 'bad'}, headers=H).status_code == 429, 'Rate-Limit greift')
check(t.get('/api/auth/export').status_code == 200 and 'password_hash' not in t.get('/api/auth/export').get_data(as_text=True), 'Export ohne Hash')

# Konto loeschen
img = os.path.join(os.environ['UPLOAD_DIR'], my['image_path'])
check(os.path.exists(img), 'Bild existiert vor Loeschung')
check(t.delete('/api/auth/account', json={'password': 'falsch'}, headers=H).status_code == 400, 'Loeschen falsches PW')
check(t.delete('/api/auth/account', json={'password': 'secret1'}, headers=H).status_code == 200, 'Konto geloescht')
check(not os.path.exists(img), 'Bild geloescht')
import sqlite3
con = sqlite3.connect(os.environ['DB_PATH'])
check(con.execute("SELECT COUNT(*) FROM teams").fetchone()[0] == 0 and con.execute("SELECT COUNT(*) FROM players").fetchone()[0] == 0 and con.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 0, 'Teams/Spieler/Termine weg')
check(t.get('/api/auth/me').get_json()['authenticated'] is False, 'Session leer')
print('\nFEHLER:', len(fails)); [print(' -', f) for f in fails]
sys.exit(1 if fails else 0)
