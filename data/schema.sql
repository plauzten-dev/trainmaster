-- ============================================================================
-- Ziel-Schema für das neue Projekt (SQLite 3, PRAGMA foreign_keys = ON)
-- Konsolidierter Endstand des Vorbilds, bereinigt:
--   * kein OAuth (oauth_provider / oauth_id entfallen)
--   * kein Legacy-Feld players.team_id – Teamzugehörigkeit NUR über
--     player_team_memberships (Mehrfach-Teams pro Spieler)
--   * CHECK-Constraints für Enums, UNIQUE(training_id, exercise_id)
-- Migrationen für spätere Änderungen: immer try/except-gewrappte ALTER TABLE.
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    username             TEXT NOT NULL UNIQUE,
    email                TEXT NOT NULL UNIQUE,
    password_hash        TEXT NOT NULL,              -- "salt$hexhash" (PBKDF2-HMAC-SHA256, >=100k Iterationen)
    role                 TEXT NOT NULL DEFAULT 'trainer'
                         CHECK (role IN ('trainer','player','private')),
    avatar_path          TEXT,                       -- lokaler Dateiname ODER volle https-URL (Cloud-Speicher)
    weekly_goal          INTEGER NOT NULL DEFAULT 4, -- Wochenziel Trainings (1..14)
    email_verified       INTEGER NOT NULL DEFAULT 0,
    verification_token   TEXT,
    verification_expires TEXT,                       -- ISO-Zeitstempel (UTC), TTL 24 h
    created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exercises (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT NOT NULL,
    description     TEXT NOT NULL,
    image_path      TEXT,                            -- lokaler Dateiname ODER volle https-URL
    field_players   INTEGER NOT NULL DEFAULT 0,
    goalkeepers     INTEGER NOT NULL DEFAULT 0,
    core_competency TEXT NOT NULL,
    difficulty      TEXT NOT NULL CHECK (difficulty IN ('Anfänger','Fortgeschritten','Profi')),
    field_size      TEXT NOT NULL,
    sport           TEXT NOT NULL DEFAULT 'Fußball',
    owner_user_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,  -- NULL = Systemübung (read-only)
    share_token     TEXT UNIQUE,                     -- öffentlicher Share-Link (uuid4 hex), nullable
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_exercises_sport ON exercises(sport);
CREATE INDEX IF NOT EXISTS idx_exercises_owner ON exercises(owner_user_id);

CREATE TABLE IF NOT EXISTS exercise_favorites (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
    exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, exercise_id)
);

CREATE TABLE IF NOT EXISTS trainings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    date       TEXT NOT NULL,                        -- YYYY-MM-DD
    time       TEXT,                                 -- HH:MM, optional
    notes      TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_trainings_user_date ON trainings(user_id, date);

CREATE TABLE IF NOT EXISTS training_exercises (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    training_id INTEGER NOT NULL REFERENCES trainings(id) ON DELETE CASCADE,
    exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    order_index INTEGER DEFAULT 0,                   -- globale Reihenfolge über alle Blöcke
    block       TEXT NOT NULL DEFAULT 'Hauptteil'
                CHECK (block IN ('Aufwärmen','Hauptteil','Abschluss')),
    duration    INTEGER,                             -- Minuten, optional (0..240)
    UNIQUE (training_id, exercise_id)
);

CREATE TABLE IF NOT EXISTS teams (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    sport      TEXT NOT NULL DEFAULT 'Fußball',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS players (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- der Trainer, dem der Spieler gehört
    name           TEXT NOT NULL,
    position       TEXT NOT NULL DEFAULT 'Universal',
    number         INTEGER,                          -- Trikotnummer 1..99, nullable
    notes          TEXT DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'fit' CHECK (status IN ('fit','krank','verletzt')),
    birthday       TEXT,                             -- YYYY-MM-DD, optional
    avatar_path    TEXT,
    invite_code    TEXT UNIQUE,                      -- 8 Zeichen, A-F0-9 (uppercase), siehe Masterprompt
    linked_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- Spieler-Konto, das den Code eingelöst hat
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_players_user   ON players(user_id);
CREATE INDEX IF NOT EXISTS idx_players_linked ON players(linked_user_id);

CREATE TABLE IF NOT EXISTS player_team_memberships (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    team_id   INTEGER NOT NULL REFERENCES teams(id)   ON DELETE CASCADE,
    UNIQUE (player_id, team_id)
);

CREATE TABLE IF NOT EXISTS training_attendance (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    training_id INTEGER NOT NULL REFERENCES trainings(id) ON DELETE CASCADE,
    player_id   INTEGER NOT NULL REFERENCES players(id)   ON DELETE CASCADE,
    present     INTEGER NOT NULL DEFAULT 1,          -- 1 = anwesend, 0 = fehlt; KEIN Eintrag = nicht markiert
    UNIQUE (training_id, player_id)
);

CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    team_id    INTEGER REFERENCES teams(id) ON DELETE SET NULL,   -- NULL = nur für den Trainer sichtbar
    title      TEXT NOT NULL,
    date       TEXT NOT NULL,
    time       TEXT,
    location   TEXT,
    type       TEXT NOT NULL DEFAULT 'spiel' CHECK (type IN ('spiel','turnier','sonstiges')),
    notes      TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_events_user_date ON events(user_id, date);
