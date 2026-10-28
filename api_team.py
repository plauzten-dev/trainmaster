"""Teams, Spieler, Anwesenheit (Trainer) und eigene Anwesenheit (Spieler)."""
from flask import Blueprint, g, jsonify, request

from config import LIMITS, PLAYER_POSITIONS, PLAYER_STATUS, SPORTS
from database import get_db, new_invite_code
from helpers import (ApiError, clean_str, delete_image, err, get_training, int_or_none, json_body, role_required,
                     save_image, uid, valid_date)

bp = Blueprint('team', __name__)


# ================================================================ Teams

def _own_team(team_id):
    row = get_db().execute('SELECT * FROM teams WHERE id = ? AND user_id = ?', (team_id, uid())).fetchone()
    if row is None:
        raise ApiError('Team nicht gefunden', 404)
    return row


def _parse_team():
    data = json_body()
    name = clean_str(data.get('name'), 80)
    sport = data.get('sport') or 'Fußball'
    if not name:
        raise ApiError('Teamname ist erforderlich')
    if sport not in SPORTS:
        raise ApiError('Ungültige Sportart')
    return name, sport


@bp.get('/api/teams')
@role_required('trainer')
def list_teams():
    rows = get_db().execute(
        '''SELECT t.*, (SELECT COUNT(*) FROM player_team_memberships m WHERE m.team_id = t.id) AS player_count
           FROM teams t WHERE t.user_id = ? ORDER BY t.created_at, t.id''', (uid(),)).fetchall()
    return jsonify([dict(r) for r in rows])


@bp.post('/api/teams')
@role_required('trainer')
def create_team():
    name, sport = _parse_team()
    db = get_db()
    cur = db.execute('INSERT INTO teams (user_id, name, sport) VALUES (?,?,?)', (uid(), name, sport))
    db.commit()
    return jsonify({'id': cur.lastrowid, 'name': name, 'sport': sport, 'player_count': 0}), 201


@bp.put('/api/teams/<int:team_id>')
@role_required('trainer')
def update_team(team_id):
    _own_team(team_id)
    name, sport = _parse_team()
    db = get_db()
    db.execute('UPDATE teams SET name = ?, sport = ? WHERE id = ?', (name, sport, team_id))
    db.commit()
    return jsonify({'message': 'Team gespeichert'})


@bp.delete('/api/teams/<int:team_id>')
@role_required('trainer')
def delete_team(team_id):
    _own_team(team_id)
    db = get_db()
    db.execute('DELETE FROM teams WHERE id = ?', (team_id,))
    db.commit()
    return jsonify({'message': 'Team gelöscht'})


@bp.get('/api/teams/<int:team_id>/attendance-summary')
@role_required('trainer')
def attendance_summary(team_id):
    team = _own_team(team_id)
    db = get_db()
    me = uid()
    players = db.execute(
        '''SELECT p.id, p.name, p.position, p.status,
                  COUNT(a.id) AS marked_count,
                  COALESCE(SUM(CASE WHEN a.present = 1 THEN 1 ELSE 0 END), 0) AS present_count,
                  COALESCE(SUM(CASE WHEN a.present = 0 THEN 1 ELSE 0 END), 0) AS absent_count
           FROM players p
           JOIN player_team_memberships m ON m.player_id = p.id AND m.team_id = ?
           LEFT JOIN training_attendance a ON a.player_id = p.id
                AND a.training_id IN (SELECT id FROM trainings WHERE user_id = ?)
           WHERE p.user_id = ?
           GROUP BY p.id ORDER BY present_count DESC, p.name COLLATE NOCASE''', (team_id, me, me)).fetchall()
    total = db.execute(
        '''SELECT COUNT(DISTINCT a.training_id) FROM training_attendance a
           JOIN trainings t ON t.id = a.training_id AND t.user_id = ?
           JOIN player_team_memberships m ON m.player_id = a.player_id AND m.team_id = ?''',
        (me, team_id)).fetchone()[0]
    return jsonify({'team_name': team['name'], 'total_tracked': total, 'players': [dict(r) for r in players]})


# ================================================================ Spieler

def _own_player(player_id):
    row = get_db().execute('SELECT * FROM players WHERE id = ? AND user_id = ?', (player_id, uid())).fetchone()
    if row is None:
        raise ApiError('Spieler nicht gefunden', 404)
    return row


def _team_ids_of(player_ids):
    if not player_ids:
        return {}
    rows = get_db().execute(
        f'SELECT player_id, team_id FROM player_team_memberships WHERE player_id IN ({",".join("?" * len(player_ids))})',
        list(player_ids)).fetchall()
    out = {pid: [] for pid in player_ids}
    for r in rows:
        out[r['player_id']].append(r['team_id'])
    return out


def _player_out(rows):
    teams = _team_ids_of([r['id'] for r in rows])
    out = []
    for r in rows:
        d = dict(r)
        d['team_ids'] = teams.get(r['id'], [])
        d['is_linked'] = r['linked_user_id'] is not None
        out.append(d)
    return out


def _parse_player(data, existing=None):
    def pick(key, default=None):
        return data[key] if key in data else (existing[key] if existing is not None else default)

    name = clean_str(pick('name'), 80)
    if not name:
        raise ApiError('Name ist erforderlich')
    all_positions = {p for lst in PLAYER_POSITIONS.values() for p in lst}
    position = pick('position') or 'Universal'
    if position not in all_positions:
        position = 'Universal'
    number = int_or_none(pick('number'), LIMITS['jersey_number_min'], LIMITS['jersey_number_max'], 'Trikotnummer')
    birthday = pick('birthday') or None
    if birthday and not valid_date(birthday):
        raise ApiError('Ungültiges Geburtsdatum')
    status = pick('status') or 'fit'
    if status not in PLAYER_STATUS:
        raise ApiError('Ungültiger Status')
    notes = str(pick('notes') or '')[:2000]
    return name, position, number, birthday, status, notes


def _set_memberships(player_id, team_ids):
    db = get_db()
    valid = []
    for tid in team_ids or []:
        try:
            tid = int(tid)
        except (TypeError, ValueError):
            continue
        if db.execute('SELECT 1 FROM teams WHERE id = ? AND user_id = ?', (tid, uid())).fetchone():
            valid.append(tid)
    db.execute('DELETE FROM player_team_memberships WHERE player_id = ?', (player_id,))
    for tid in set(valid):
        db.execute('INSERT INTO player_team_memberships (player_id, team_id) VALUES (?, ?)', (player_id, tid))


@bp.get('/api/players')
@role_required('trainer')
def list_players():
    team_id = request.args.get('team_id')
    db = get_db()
    if team_id:
        _own_team(team_id)
        rows = db.execute('''SELECT p.* FROM players p JOIN player_team_memberships m ON m.player_id = p.id
                             WHERE m.team_id = ? AND p.user_id = ? ORDER BY p.name COLLATE NOCASE''',
                          (team_id, uid())).fetchall()
    else:
        rows = db.execute('SELECT * FROM players WHERE user_id = ? ORDER BY name COLLATE NOCASE', (uid(),)).fetchall()
    return jsonify(_player_out(rows))


@bp.post('/api/players')
@role_required('trainer')
def create_player():
    data = json_body()
    vals = _parse_player(data)
    db = get_db()
    cur = db.execute('''INSERT INTO players (user_id, name, position, number, birthday, status, notes, invite_code)
                        VALUES (?,?,?,?,?,?,?,?)''', (uid(),) + vals + (new_invite_code(db),))
    _set_memberships(cur.lastrowid, data.get('team_ids'))
    db.commit()
    return jsonify(_player_out([_own_player(cur.lastrowid)])[0]), 201


@bp.get('/api/players/<int:player_id>')
@role_required('trainer')
def get_player(player_id):
    return jsonify(_player_out([_own_player(player_id)])[0])


@bp.put('/api/players/<int:player_id>')
@role_required('trainer')
def update_player(player_id):
    existing = _own_player(player_id)
    data = json_body()
    vals = _parse_player(data, existing)
    db = get_db()
    db.execute('UPDATE players SET name=?, position=?, number=?, birthday=?, status=?, notes=? WHERE id=?',
               vals + (player_id,))
    if 'team_ids' in data:
        _set_memberships(player_id, data.get('team_ids'))
    db.commit()
    return jsonify(_player_out([_own_player(player_id)])[0])


@bp.delete('/api/players/<int:player_id>')
@role_required('trainer')
def delete_player(player_id):
    row = _own_player(player_id)
    db = get_db()
    db.execute('DELETE FROM players WHERE id = ?', (player_id,))
    db.commit()
    delete_image(row['avatar_path'])
    return jsonify({'message': 'Spieler gelöscht'})


@bp.put('/api/players/<int:player_id>/status')
@role_required('trainer')
def set_player_status(player_id):
    _own_player(player_id)
    status = json_body().get('status')
    if status not in PLAYER_STATUS:
        return err('Ungültiger Status')
    db = get_db()
    db.execute('UPDATE players SET status = ? WHERE id = ?', (status, player_id))
    db.commit()
    return jsonify({'status': status})


@bp.post('/api/players/<int:player_id>/regenerate-invite')
@role_required('trainer')
def regenerate_invite(player_id):
    _own_player(player_id)
    db = get_db()
    code = new_invite_code(db)
    db.execute('UPDATE players SET invite_code = ?, linked_user_id = NULL WHERE id = ?', (code, player_id))
    db.commit()
    return jsonify({'invite_code': code})


@bp.delete('/api/players/<int:player_id>/teams/<int:team_id>')
@role_required('trainer')
def remove_from_team(player_id, team_id):
    _own_player(player_id)
    _own_team(team_id)
    db = get_db()
    db.execute('DELETE FROM player_team_memberships WHERE player_id = ? AND team_id = ?', (player_id, team_id))
    db.commit()
    remaining = db.execute('SELECT COUNT(*) FROM player_team_memberships WHERE player_id = ?',
                           (player_id,)).fetchone()[0]
    return jsonify({'message': 'Aus Team entfernt', 'remaining_teams': remaining})


@bp.post('/api/players/<int:player_id>/avatar')
@role_required('trainer')
def set_player_avatar(player_id):
    row = _own_player(player_id)
    path = save_image(request.files.get('image'), 'players')
    if not path:
        return err('Bitte wähle ein Bild aus')
    db = get_db()
    db.execute('UPDATE players SET avatar_path = ? WHERE id = ?', (path, player_id))
    db.commit()
    delete_image(row['avatar_path'])
    return jsonify({'avatar_path': path})


@bp.delete('/api/players/<int:player_id>/avatar')
@role_required('trainer')
def remove_player_avatar(player_id):
    row = _own_player(player_id)
    db = get_db()
    db.execute('UPDATE players SET avatar_path = NULL WHERE id = ?', (player_id,))
    db.commit()
    delete_image(row['avatar_path'])
    return jsonify({'message': 'Bild entfernt'})


# ================================================================ Anwesenheit

def _present_value(value):
    if value is None:
        return None
    if value in (True, 1, '1', 'true'):
        return 1
    if value in (False, 0, '0', 'false'):
        return 0
    raise ApiError('Ungültiger Anwesenheitswert')


def _write_attendance(training_id, player_id, present):
    db = get_db()
    if present is None:
        db.execute('DELETE FROM training_attendance WHERE training_id = ? AND player_id = ?', (training_id, player_id))
    else:
        db.execute('''INSERT INTO training_attendance (training_id, player_id, present) VALUES (?,?,?)
                      ON CONFLICT(training_id, player_id) DO UPDATE SET present = excluded.present''',
                   (training_id, player_id, present))


@bp.get('/api/trainings/<int:training_id>/attendance')
@role_required('trainer')
def get_attendance(training_id):
    get_training(training_id, write=True)
    team_id = request.args.get('team_id')
    if not team_id:
        return err('Bitte wähle ein Team')
    _own_team(team_id)
    rows = get_db().execute(
        '''SELECT p.id, p.name, p.position, p.number, p.status, p.avatar_path, p.linked_user_id, a.present
           FROM players p JOIN player_team_memberships m ON m.player_id = p.id AND m.team_id = ?
           LEFT JOIN training_attendance a ON a.player_id = p.id AND a.training_id = ?
           WHERE p.user_id = ? ORDER BY p.name COLLATE NOCASE''', (team_id, training_id, uid())).fetchall()
    return jsonify([dict(r) for r in rows])


@bp.put('/api/trainings/<int:training_id>/attendance')
@role_required('trainer')
def set_attendance(training_id):
    get_training(training_id, write=True)
    data = json_body()
    try:
        player_id = int(data.get('player_id'))
    except (TypeError, ValueError):
        return err('Ungültiger Spieler')
    _own_player(player_id)
    present = _present_value(data.get('present'))
    _write_attendance(training_id, player_id, present)
    get_db().commit()
    return jsonify({'player_id': player_id, 'present': present})


@bp.put('/api/trainings/<int:training_id>/attendance/all')
@role_required('trainer')
def set_attendance_all(training_id):
    get_training(training_id, write=True)
    data = json_body()
    _own_team(data.get('team_id'))
    present = _present_value(data.get('present', True))
    rows = get_db().execute('''SELECT p.id FROM players p JOIN player_team_memberships m ON m.player_id = p.id
                               WHERE m.team_id = ? AND p.user_id = ?''', (data.get('team_id'), uid())).fetchall()
    for r in rows:
        _write_attendance(training_id, r['id'], present)
    get_db().commit()
    return jsonify({'message': f'{len(rows)} Spieler aktualisiert', 'count': len(rows)})


def _my_player_for(training_id):
    t = get_training(training_id)
    row = get_db().execute('SELECT * FROM players WHERE linked_user_id = ? AND user_id = ?',
                           (uid(), t['user_id'])).fetchone()
    if row is None or t['user_id'] == uid():
        raise ApiError('Kein Spielerprofil für dieses Training', 404)
    return row


@bp.get('/api/trainings/<int:training_id>/my-attendance')
@role_required('player')
def get_my_attendance(training_id):
    player = _my_player_for(training_id)
    row = get_db().execute('SELECT present FROM training_attendance WHERE training_id = ? AND player_id = ?',
                           (training_id, player['id'])).fetchone()
    return jsonify({'player_name': player['name'], 'present': row['present'] if row else None})


@bp.put('/api/trainings/<int:training_id>/my-attendance')
@role_required('player')
def set_my_attendance(training_id):
    player = _my_player_for(training_id)
    present = _present_value(json_body().get('present'))
    _write_attendance(training_id, player['id'], present)
    get_db().commit()
    return jsonify({'player_name': player['name'], 'present': present})
