"""SQLite-Zugriff, Schema, idempotente Migrationen, Seed und Passwort-Hashing."""
import hashlib
import hmac
import json
import logging
import os
import secrets
import sqlite3

from flask import g, has_app_context

from config import DATA_DIR, DB_PATH

log = logging.getLogger(__name__)

PBKDF2_ITERATIONS = 200_000

# Spaetere Schemaaenderungen hier anhaengen. Jede Anweisung laeuft einzeln in try/except.
MIGRATIONS = [
    "ALTER TABLE users ADD COLUMN avatar_path TEXT",
    "ALTER TABLE users ADD COLUMN weekly_goal INTEGER NOT NULL DEFAULT 4",
    "ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN verification_token TEXT",
    "ALTER TABLE users ADD COLUMN verification_expires TEXT",
    "ALTER TABLE exercises ADD COLUMN owner_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE",
    "ALTER TABLE exercises ADD COLUMN share_token TEXT",
    "ALTER TABLE trainings ADD COLUMN time TEXT",
    "ALTER TABLE training_exercises ADD COLUMN block TEXT NOT NULL DEFAULT 'Hauptteil'",
    "ALTER TABLE training_exercises ADD COLUMN duration INTEGER",
    "ALTER TABLE players ADD COLUMN birthday TEXT",
    "ALTER TABLE players ADD COLUMN avatar_path TEXT",
    "ALTER TABLE players ADD COLUMN invite_code TEXT",
    "ALTER TABLE players ADD COLUMN linked_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL",
    "ALTER TABLE events ADD COLUMN team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_exercises_share ON exercises(share_token)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_players_invite ON players(invite_code)",
    "CREATE INDEX IF NOT EXISTS idx_memberships_team ON player_team_memberships(team_id)",
    "CREATE INDEX IF NOT EXISTS idx_attendance_training ON training_attendance(training_id)",
]


def connect():
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    conn.execute('PRAGMA busy_timeout = 15000')
    # Unicode-faehiges lower() (SQLite kennt nur ASCII) fuer die Suche mit Umlauten
    conn.create_function('ulower', 1, lambda v: v.lower() if isinstance(v, str) else v, deterministic=True)
    return conn


def get_db():
    """Eine Verbindung pro Request (in flask.g), ausserhalb des App-Kontexts eine neue."""
    if not has_app_context():
        return connect()
    if 'db' not in g:
        g.db = connect()
    return g.db


def close_db(_exc=None):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def hash_password(password):
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), PBKDF2_ITERATIONS)
    return f'{salt}${digest.hex()}'


def verify_password(password, stored):
    try:
        salt, hexhash = stored.split('$', 1)
    except (ValueError, AttributeError):
        return False
    digest = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), PBKDF2_ITERATIONS)
    return hmac.compare_digest(digest.hex(), hexhash)


def new_invite_code(conn):
    while True:
        code = secrets.token_hex(4).upper()
        if not conn.execute('SELECT 1 FROM players WHERE invite_code = ?', (code,)).fetchone():
            return code


def _seed_exercises(conn):
    with open(os.path.join(DATA_DIR, 'seed_exercises.json'), encoding='utf-8') as fh:
        seed = json.load(fh)
    by_sport = {}
    for ex in seed:
        by_sport.setdefault(ex['sport'], []).append(ex)
    for sport, items in by_sport.items():
        exists = conn.execute(
            'SELECT 1 FROM exercises WHERE sport = ? AND owner_user_id IS NULL LIMIT 1', (sport,)).fetchone()
        if exists:
            continue
        for ex in items:
            conn.execute(
                '''INSERT INTO exercises (title, description, field_players, goalkeepers, core_competency,
                   difficulty, field_size, sport, owner_user_id) VALUES (?,?,?,?,?,?,?,?,NULL)''',
                (ex['title'], ex['description'], ex['field_players'], ex['goalkeepers'],
                 ex['core_competency'], ex['difficulty'], ex['field_size'], ex['sport']))
        log.info('Seed: %d Uebungen fuer %s angelegt', len(items), sport)


def init_db():
    os.makedirs(os.path.dirname(os.path.abspath(DB_PATH)), exist_ok=True)
    conn = connect()
    try:
        conn.execute('PRAGMA journal_mode = WAL')
        with open(os.path.join(DATA_DIR, 'schema.sql'), encoding='utf-8') as fh:
            conn.executescript(fh.read())
        for stmt in MIGRATIONS:
            try:
                conn.execute(stmt)
            except sqlite3.OperationalError:
                pass  # Spalte/Index existiert bereits
        for row in conn.execute('SELECT id FROM players WHERE invite_code IS NULL').fetchall():
            conn.execute('UPDATE players SET invite_code = ? WHERE id = ?', (new_invite_code(conn), row['id']))
        _seed_exercises(conn)
        conn.commit()
    finally:
        conn.close()
