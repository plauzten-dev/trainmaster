"""NUR LOKAL: legt Demo-Daten fuer Abnahmetests an (Trainer, Spieler, Privat, Teams, Trainings, Termine).

Aufruf:  python scripts/seed_demo.py
Niemals gegen eine Produktionsdatenbank ausfuehren.
"""
import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import connect, hash_password, init_db, new_invite_code  # noqa: E402

PASSWORD = 'demo-passwort'
USERS = [('demo_trainer', 'trainer@demo.test', 'trainer'),
         ('demo_spieler', 'spieler@demo.test', 'player'),
         ('demo_privat', 'privat@demo.test', 'private')]


def main():
    if os.environ.get('DB_PATH', '').startswith('/data'):
        sys.exit('Abbruch: sieht nach Produktions-DB aus.')
    init_db()
    db = connect()
    if db.execute("SELECT 1 FROM users WHERE username = 'demo_trainer'").fetchone():
        print('Demo-Daten existieren bereits.')
        return
    ids = {}
    for name, mail, role in USERS:
        cur = db.execute('INSERT INTO users (username, email, password_hash, role, email_verified) VALUES (?,?,?,?,1)',
                         (name, mail, hash_password(PASSWORD), role))
        ids[role] = cur.lastrowid
    trainer = ids['trainer']
    t1 = db.execute("INSERT INTO teams (user_id, name, sport) VALUES (?, 'U17 Fußball', 'Fußball')", (trainer,)).lastrowid
    t2 = db.execute("INSERT INTO teams (user_id, name, sport) VALUES (?, 'Damen Basketball', 'Basketball')", (trainer,)).lastrowid
    today = date.today()
    players = [('Lena Berger', 'Torwart', 1, '2008-03-14', 'fit', [t1]),
               ('Jonas Huber', 'Innenverteidiger', 4, '2008-07-02', 'fit', [t1]),
               ('Mia Wagner', 'Mittelfeld', 8, today.replace(year=2008).isoformat(), 'krank', [t1, t2]),
               ('Noah Gruber', 'Stürmer', 9, '2009-01-22', 'verletzt', [t1]),
               ('Sophie Bauer', 'Point Guard', 7, '1999-11-30', 'fit', [t2]),
               ('Emma Steiner', 'Center', 12, None, 'fit', [t2])]
    pids = []
    for name, pos, num, bday, status, teams in players:
        pid = db.execute('''INSERT INTO players (user_id, name, position, number, birthday, status, invite_code)
                            VALUES (?,?,?,?,?,?,?)''', (trainer, name, pos, num, bday, status, new_invite_code(db))).lastrowid
        pids.append(pid)
        for t in teams:
            db.execute('INSERT INTO player_team_memberships (player_id, team_id) VALUES (?, ?)', (pid, t))
    # Spieler-Konto mit "Jonas Huber" verknuepfen
    db.execute('UPDATE players SET linked_user_id = ? WHERE id = ?', (ids['player'], pids[1]))

    ex = {r['sport']: [] for r in db.execute('SELECT DISTINCT sport FROM exercises')}
    for r in db.execute('SELECT id, sport FROM exercises WHERE owner_user_id IS NULL ORDER BY id'):
        ex[r['sport']].append(r['id'])

    def training(owner, title, d, time_, items):
        tid = db.execute('INSERT INTO trainings (user_id, title, date, time, notes) VALUES (?,?,?,?,?)',
                         (owner, title, d.isoformat(), time_, 'Fokus auf saubere Technik.')).lastrowid
        for i, (eid, block, dur) in enumerate(items):
            db.execute('INSERT INTO training_exercises (training_id, exercise_id, order_index, block, duration) '
                       'VALUES (?,?,?,?,?)', (tid, eid, i, block, dur))
        return tid

    monday = today - timedelta(days=today.weekday())
    fb, ag, bb = ex['Fußball'], ex['Allgemein'], ex['Basketball']
    tr_today = training(trainer, 'Passspiel & Abschluss', today, '18:00',
                        [(ag[0], 'Aufwärmen', 10), (fb[0], 'Hauptteil', 20), (fb[2], 'Hauptteil', None), (ag[-1], 'Abschluss', 10)])
    training(trainer, 'Wurftraining', today + timedelta(days=2), '19:30',
             [(bb[0], 'Aufwärmen', 15), (bb[1], 'Hauptteil', 25)])
    past = training(trainer, 'Pressing-Einheit', monday - timedelta(days=5), '17:30',
                    [(fb[1], 'Hauptteil', 25), (fb[3], 'Hauptteil', 20)])
    for m in range(1, 6):
        training(trainer, f'Grundlagen {m}', today - timedelta(days=30 * m), '18:00', [(fb[m % len(fb)], 'Hauptteil', 30)])
    for pid, present in zip(pids[:4], (1, 1, 0, 1)):
        db.execute('INSERT INTO training_attendance (training_id, player_id, present) VALUES (?,?,?)', (past, pid, present))
    db.execute('INSERT INTO training_attendance (training_id, player_id, present) VALUES (?,?,1)', (tr_today, pids[0]))

    training(ids['player'], 'Eigenes Lauftraining', today + timedelta(days=1), '07:00', [(ag[1], 'Hauptteil', 30)])
    training(ids['private'], 'Morgenroutine', today, '07:30', [(ag[0], 'Aufwärmen', 10), (ex['Gym'][0], 'Hauptteil', 20)])

    for title, typ, d, team in (('Heimspiel gegen SV Nord', 'spiel', today + timedelta(days=3), t1),
                                ('Hallenturnier', 'turnier', today + timedelta(days=9), t2),
                                ('Trainerbesprechung', 'sonstiges', today + timedelta(days=1), None)):
        db.execute('INSERT INTO events (user_id, team_id, title, date, time, location, type) VALUES (?,?,?,?,?,?,?)',
                   (trainer, team, title, d.isoformat(), '10:00', 'Sportplatz Mitte', typ))
    db.commit()
    db.close()
    print('Demo-Daten angelegt. Konten: demo_trainer, demo_spieler, demo_privat – Passwort siehe PASSWORD in diesem Skript.')


if __name__ == '__main__':
    main()
