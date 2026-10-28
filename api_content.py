"""Uebungen, Trainings (inkl. Uebungen im Training) und Termine."""
import os
import shutil
import uuid

from flask import Blueprint, jsonify, request

from config import (APP_NAME, CLOUDINARY_ENABLED, CORE_COMPETENCIES, DIFFICULTIES, EVENT_TYPES, FIELD_SIZES, LIMITS,
                    SPORTS, TRAINING_BLOCKS, UPLOAD_DIR)
from database import get_db
from helpers import (ApiError, clean_str, clean_time, delete_image, err, get_training, int_or_none, json_body,
                     login_required, readable_training_owner_ids, role_required, save_image, training_sports, uid,
                     valid_date, visible_events_sql)

bp = Blueprint('content', __name__)


# ================================================================ Uebungen

VISIBLE = '(e.owner_user_id IS NULL OR e.owner_user_id = ?)'


def _exercise_out(row):
    d = dict(row)
    d['is_owner'] = bool(d.get('is_owner'))
    d['is_favorite'] = bool(d.get('is_favorite'))
    if not d['is_owner']:
        d.pop('share_token', None)
    d.pop('owner_user_id', None)
    d['is_system'] = row['owner_user_id'] is None
    return d


def _select_exercises(where_sql, params):
    me = uid()
    return get_db().execute(
        f'''SELECT e.*, COALESCE(e.owner_user_id = ?, 0) AS is_owner, (f.id IS NOT NULL) AS is_favorite
            FROM exercises e LEFT JOIN exercise_favorites f ON f.exercise_id = e.id AND f.user_id = ?
            WHERE {where_sql} ORDER BY e.created_at DESC, e.id DESC''', [me, me] + params).fetchall()


def _get_visible_exercise(exercise_id, allow_training=False):
    me = uid()
    rows = _select_exercises(f'e.id = ? AND {VISIBLE}', [exercise_id, me])
    if not rows and allow_training:
        owners = readable_training_owner_ids()
        ph = ','.join('?' * len(owners))
        rows = _select_exercises(
            f'''e.id = ? AND EXISTS (SELECT 1 FROM training_exercises te JOIN trainings t ON t.id = te.training_id
                WHERE te.exercise_id = e.id AND t.user_id IN ({ph}))''', [exercise_id] + owners)
    if not rows:
        raise ApiError('Übung nicht gefunden', 404)
    return rows[0]


def _get_own_exercise(exercise_id):
    row = get_db().execute('SELECT * FROM exercises WHERE id = ?', (exercise_id,)).fetchone()
    if row is None or (row['owner_user_id'] is not None and row['owner_user_id'] != uid()):
        raise ApiError('Übung nicht gefunden', 404)
    if row['owner_user_id'] is None:
        raise ApiError('Systemübungen können nicht verändert werden', 403)
    return row


def _parse_exercise_form():
    f = request.form
    sport = f.get('sport') or 'Fußball'
    if sport not in SPORTS:
        raise ApiError('Ungültige Sportart')
    data = {
        'title': clean_str(f.get('title'), 120),
        'description': str(f.get('description') or '').strip()[:5000],
        'core_competency': f.get('core_competency') or '',
        'difficulty': f.get('difficulty') or '',
        'field_size': f.get('field_size') or '',
        'sport': sport,
        'field_players': int_or_none(f.get('field_players'), 0, LIMITS['exercise_field_players_max'], 'Feldspieler') or 0,
        'goalkeepers': int_or_none(f.get('goalkeepers'), 0, LIMITS['exercise_goalkeepers_max'], 'Torhüter') or 0,
    }
    if not data['title']:
        raise ApiError('Titel ist erforderlich')
    if not data['description']:
        raise ApiError('Erklärung ist erforderlich')
    if data['core_competency'] not in CORE_COMPETENCIES[sport]:
        raise ApiError('Bitte wähle eine Kernkompetenz der Sportart')
    if data['difficulty'] not in DIFFICULTIES:
        raise ApiError('Bitte wähle eine Schwierigkeit')
    if data['field_size'] not in FIELD_SIZES:
        raise ApiError('Bitte wähle eine Spielfeldgröße')
    return data


@bp.get('/api/exercises')
@login_required
def list_exercises():
    a = request.args
    where, params = [VISIBLE], [uid()]
    if a.get('sport'):
        where.append('e.sport = ?'); params.append(a['sport'])
    for key in ('field_players', 'goalkeepers'):
        if a.get(key, '') != '':
            try:
                params.append(int(a[key])); where.append(f'e.{key} = ?')
            except ValueError:
                pass
    for key in ('core_competency', 'difficulty', 'field_size'):
        if a.get(key):
            where.append(f'e.{key} = ?'); params.append(a[key])
    if a.get('search'):
        term = '%' + a['search'].strip().lower() + '%'
        where.append('(ulower(e.title) LIKE ? OR ulower(e.description) LIKE ?)'); params += [term, term]
    if a.get('favorites') == '1':
        where.append('f.id IS NOT NULL')
    return jsonify([_exercise_out(r) for r in _select_exercises(' AND '.join(where), params)])


@bp.get('/api/exercises/<int:exercise_id>')
@login_required
def get_exercise(exercise_id):
    return jsonify(_exercise_out(_get_visible_exercise(exercise_id, allow_training=True)))


@bp.post('/api/exercises')
@login_required
def create_exercise():
    data = _parse_exercise_form()
    image = save_image(request.files.get('image'), 'exercises')
    db = get_db()
    cur = db.execute(
        '''INSERT INTO exercises (title, description, image_path, field_players, goalkeepers, core_competency,
           difficulty, field_size, sport, owner_user_id) VALUES (?,?,?,?,?,?,?,?,?,?)''',
        (data['title'], data['description'], image, data['field_players'], data['goalkeepers'],
         data['core_competency'], data['difficulty'], data['field_size'], data['sport'], uid()))
    db.commit()
    return jsonify(_exercise_out(_get_visible_exercise(cur.lastrowid))), 201


@bp.put('/api/exercises/<int:exercise_id>')
@login_required
def update_exercise(exercise_id):
    row = _get_own_exercise(exercise_id)
    data = _parse_exercise_form()
    image = row['image_path']
    new_image = save_image(request.files.get('image'), 'exercises')
    old_to_delete = None
    if new_image:
        old_to_delete, image = image, new_image
    elif request.form.get('remove_image') == '1':
        old_to_delete, image = image, None
    db = get_db()
    db.execute(
        '''UPDATE exercises SET title=?, description=?, image_path=?, field_players=?, goalkeepers=?,
           core_competency=?, difficulty=?, field_size=?, sport=? WHERE id=?''',
        (data['title'], data['description'], image, data['field_players'], data['goalkeepers'],
         data['core_competency'], data['difficulty'], data['field_size'], data['sport'], exercise_id))
    db.commit()
    delete_image(old_to_delete)
    return jsonify(_exercise_out(_get_visible_exercise(exercise_id)))


@bp.delete('/api/exercises/<int:exercise_id>')
@login_required
def delete_exercise(exercise_id):
    row = _get_own_exercise(exercise_id)
    db = get_db()
    db.execute('DELETE FROM exercises WHERE id = ?', (exercise_id,))
    db.commit()
    delete_image(row['image_path'])
    return jsonify({'message': 'Übung gelöscht'})


@bp.post('/api/exercises/<int:exercise_id>/favorite')
@login_required
def toggle_favorite(exercise_id):
    _get_visible_exercise(exercise_id, allow_training=True)
    db = get_db()
    cur = db.execute('DELETE FROM exercise_favorites WHERE user_id = ? AND exercise_id = ?', (uid(), exercise_id))
    if cur.rowcount == 0:
        db.execute('INSERT INTO exercise_favorites (user_id, exercise_id) VALUES (?, ?)', (uid(), exercise_id))
    db.commit()
    return jsonify({'is_favorite': cur.rowcount == 0})


@bp.post('/api/exercises/<int:exercise_id>/share')
@login_required
def share_exercise(exercise_id):
    row = _get_own_exercise(exercise_id)
    token = row['share_token']
    if not token:
        token = uuid.uuid4().hex
        db = get_db()
        db.execute('UPDATE exercises SET share_token = ? WHERE id = ?', (token, exercise_id))
        db.commit()
    return jsonify({'share_url': request.url_root.rstrip('/') + '/exercise/share/' + token, 'token': token})


@bp.delete('/api/exercises/<int:exercise_id>/share')
@login_required
def revoke_share(exercise_id):
    _get_own_exercise(exercise_id)
    db = get_db()
    db.execute('UPDATE exercises SET share_token = NULL WHERE id = ?', (exercise_id,))
    db.commit()
    return jsonify({'message': 'Link widerrufen'})


def _copy_image(path):
    if not path:
        return None
    try:
        if path.startswith('http'):
            if not CLOUDINARY_ENABLED:
                return path
            import cloudinary.uploader
            return cloudinary.uploader.upload(path, folder=APP_NAME.lower() + '/exercises')['secure_url']
        src = os.path.join(UPLOAD_DIR, os.path.basename(path))
        if not os.path.isfile(src):
            return None
        name = uuid.uuid4().hex + os.path.splitext(src)[1]
        shutil.copyfile(src, os.path.join(UPLOAD_DIR, name))
        return name
    except Exception:
        return None


@bp.post('/api/exercises/import/<token>')
@login_required
def import_exercise(token):
    db = get_db()
    src = db.execute('SELECT * FROM exercises WHERE share_token = ?', (token,)).fetchone()
    if src is None:
        return err('Link ungültig oder widerrufen', 404)
    cur = db.execute(
        '''INSERT INTO exercises (title, description, image_path, field_players, goalkeepers, core_competency,
           difficulty, field_size, sport, owner_user_id) VALUES (?,?,?,?,?,?,?,?,?,?)''',
        (src['title'], src['description'], _copy_image(src['image_path']), src['field_players'],
         src['goalkeepers'], src['core_competency'], src['difficulty'], src['field_size'], src['sport'], uid()))
    db.commit()
    return jsonify({'message': 'Übung in deine Sammlung kopiert', 'id': cur.lastrowid}), 201


@bp.get('/api/filter-options')
@login_required
def filter_options():
    where, params = VISIBLE, [uid()]
    sport = request.args.get('sport')
    db = get_db()

    def distinct(col, sport_filter=True):
        sql = f'SELECT DISTINCT e.{col} FROM exercises e WHERE {where}'
        p = list(params)
        if sport and sport_filter:
            sql += ' AND e.sport = ?'; p.append(sport)
        return [r[0] for r in db.execute(sql + f' ORDER BY e.{col}', p).fetchall()]

    return jsonify({'competencies': distinct('core_competency'), 'difficulties': distinct('difficulty'),
                    'field_sizes': distinct('field_size'), 'sports': distinct('sport', False)})


# ================================================================ Trainings

def _clean_block(value):
    return value if value in TRAINING_BLOCKS else 'Hauptteil'


def _clean_duration(value):
    return int_or_none(value, LIMITS['exercise_duration_in_training_min'],
                       LIMITS['exercise_duration_in_training_max'], 'Dauer')


@bp.get('/api/trainings')
@login_required
def list_trainings():
    owners = readable_training_owner_ids()
    ph = ','.join('?' * len(owners))
    sql = f'''SELECT t.*, (SELECT COUNT(*) FROM training_exercises te WHERE te.training_id = t.id) AS exercise_count,
              (SELECT COALESCE(SUM(te.duration), 0) FROM training_exercises te WHERE te.training_id = t.id) AS total_minutes
              FROM trainings t WHERE t.user_id IN ({ph})'''
    params = list(owners)
    month = request.args.get('month')
    if month:
        sql += ' AND substr(t.date, 1, 7) = ?'; params.append(month)
    sql += " ORDER BY t.date DESC, COALESCE(t.time, '99:99') DESC, t.id DESC"
    rows = get_db().execute(sql, params).fetchall()
    sports = training_sports([r['id'] for r in rows])
    out = []
    for r in rows:
        d = dict(r)
        d['owned_by_me'] = r['user_id'] == uid()
        d['sport'] = sports[r['id']]
        out.append(d)
    return jsonify(out)


@bp.post('/api/trainings')
@login_required
def create_training():
    data = json_body()
    title = clean_str(data.get('title'), 120)
    date = data.get('date')
    if not title:
        return err('Titel ist erforderlich')
    if not valid_date(date):
        return err('Bitte gib ein gültiges Datum an')
    time_ = clean_time(data.get('time'))
    db = get_db()
    cur = db.execute('INSERT INTO trainings (user_id, title, date, time, notes) VALUES (?,?,?,?,?)',
                     (uid(), title, date, time_, str(data.get('notes') or '')[:20000]))
    db.commit()
    return jsonify({'id': cur.lastrowid, 'message': 'Training angelegt'}), 201


def _training_exercises(training_id):
    rows = get_db().execute(
        '''SELECT e.id, e.title, e.description, e.image_path, e.field_players, e.goalkeepers, e.core_competency,
           e.difficulty, e.field_size, e.sport, te.order_index, te.block, te.duration
           FROM training_exercises te JOIN exercises e ON e.id = te.exercise_id
           WHERE te.training_id = ? ORDER BY te.order_index, te.id''', (training_id,)).fetchall()
    return [dict(r) for r in rows]


@bp.get('/api/trainings/<int:training_id>')
@login_required
def get_training_detail(training_id):
    t = get_training(training_id)
    d = dict(t)
    d['exercises'] = _training_exercises(training_id)
    d['owned_by_me'] = t['user_id'] == uid()
    d['sport'] = training_sports([training_id])[training_id]
    if not d['owned_by_me']:
        owner = get_db().execute('SELECT username FROM users WHERE id = ?', (t['user_id'],)).fetchone()
        d['owner_name'] = owner['username'] if owner else ''
    return jsonify(d)


@bp.put('/api/trainings/<int:training_id>')
@login_required
def update_training(training_id):
    t = get_training(training_id, write=True)
    data = json_body()
    title = clean_str(data['title'], 120) if 'title' in data else t['title']
    date = data['date'] if 'date' in data else t['date']
    notes = str(data['notes'] or '')[:20000] if 'notes' in data else t['notes']
    time_ = clean_time(data['time']) if 'time' in data else t['time']
    if not title:
        return err('Titel ist erforderlich')
    if not valid_date(date):
        return err('Bitte gib ein gültiges Datum an')
    db = get_db()
    db.execute('UPDATE trainings SET title=?, date=?, notes=?, time=? WHERE id=?',
               (title, date, notes, time_, training_id))
    db.commit()
    return jsonify({'message': 'Gespeichert'})


@bp.delete('/api/trainings/<int:training_id>')
@login_required
def delete_training(training_id):
    get_training(training_id, write=True)
    db = get_db()
    db.execute('DELETE FROM trainings WHERE id = ?', (training_id,))
    db.commit()
    return jsonify({'message': 'Training gelöscht'})


@bp.post('/api/trainings/<int:training_id>/duplicate')
@login_required
def duplicate_training(training_id):
    t = get_training(training_id, write=True)
    data = json_body()
    date = data.get('date') or t['date']
    if not valid_date(date):
        return err('Bitte gib ein gültiges Datum an')
    title = clean_str(data.get('title'), 120) or t['title']
    db = get_db()
    cur = db.execute('INSERT INTO trainings (user_id, title, date, time, notes) VALUES (?,?,?,?,?)',
                     (uid(), title, date, t['time'], ''))
    new_id = cur.lastrowid
    db.execute('''INSERT INTO training_exercises (training_id, exercise_id, order_index, block, duration)
                  SELECT ?, exercise_id, order_index, block, duration FROM training_exercises WHERE training_id = ?''',
               (new_id, training_id))
    db.commit()
    return jsonify({'id': new_id, 'message': 'Training dupliziert'}), 201


@bp.post('/api/trainings/<int:training_id>/exercises')
@login_required
def add_training_exercise(training_id):
    get_training(training_id, write=True)
    data = json_body()
    try:
        exercise_id = int(data.get('exercise_id'))
    except (TypeError, ValueError):
        return err('Ungültige Übung')
    _get_visible_exercise(exercise_id)
    db = get_db()
    if db.execute('SELECT 1 FROM training_exercises WHERE training_id = ? AND exercise_id = ?',
                  (training_id, exercise_id)).fetchone():
        return err('Übung bereits im Training')
    nxt = db.execute('SELECT COALESCE(MAX(order_index), -1) + 1 FROM training_exercises WHERE training_id = ?',
                     (training_id,)).fetchone()[0]
    db.execute('INSERT INTO training_exercises (training_id, exercise_id, order_index, block, duration) '
               'VALUES (?,?,?,?,?)',
               (training_id, exercise_id, nxt, _clean_block(data.get('block')), _clean_duration(data.get('duration'))))
    db.commit()
    return jsonify({'message': 'Übung hinzugefügt'}), 201


@bp.put('/api/trainings/<int:training_id>/exercises/<int:exercise_id>/meta')
@login_required
def update_training_exercise_meta(training_id, exercise_id):
    get_training(training_id, write=True)
    data = json_body()
    db = get_db()
    row = db.execute('SELECT * FROM training_exercises WHERE training_id = ? AND exercise_id = ?',
                     (training_id, exercise_id)).fetchone()
    if row is None:
        return err('Übung nicht im Training', 404)
    block = _clean_block(data['block']) if 'block' in data else row['block']
    duration = _clean_duration(data['duration']) if 'duration' in data else row['duration']
    db.execute('UPDATE training_exercises SET block = ?, duration = ? WHERE id = ?', (block, duration, row['id']))
    db.commit()
    return jsonify({'block': block, 'duration': duration})


@bp.put('/api/trainings/<int:training_id>/exercises/reorder')
@login_required
def reorder_training_exercises(training_id):
    get_training(training_id, write=True)
    order = json_body().get('order')
    if not isinstance(order, list):
        return err('Ungültige Reihenfolge')
    db = get_db()
    for idx, ex_id in enumerate(order):
        try:
            ex_id = int(ex_id)
        except (TypeError, ValueError):
            return err('Ungültige Reihenfolge')
        db.execute('UPDATE training_exercises SET order_index = ? WHERE training_id = ? AND exercise_id = ?',
                   (idx, training_id, ex_id))
    db.commit()
    return jsonify({'message': 'Reihenfolge gespeichert'})


@bp.delete('/api/trainings/<int:training_id>/exercises/<int:exercise_id>')
@login_required
def remove_training_exercise(training_id, exercise_id):
    get_training(training_id, write=True)
    db = get_db()
    db.execute('DELETE FROM training_exercises WHERE training_id = ? AND exercise_id = ?', (training_id, exercise_id))
    db.commit()
    return jsonify({'message': 'Übung entfernt'})


# ================================================================ Termine

def _parse_event():
    data = json_body()
    title = clean_str(data.get('title'), 120)
    date = data.get('date')
    etype = data.get('type') or 'spiel'
    if not title:
        raise ApiError('Titel ist erforderlich')
    if not valid_date(date):
        raise ApiError('Bitte gib ein gültiges Datum an')
    if etype not in EVENT_TYPES:
        raise ApiError('Ungültiger Termintyp')
    team_id = data.get('team_id')
    if team_id not in (None, ''):
        try:
            team_id = int(team_id)
        except (TypeError, ValueError):
            team_id = None
        if team_id and not get_db().execute('SELECT 1 FROM teams WHERE id = ? AND user_id = ?',
                                            (team_id, uid())).fetchone():
            team_id = None  # fremde Teams werden ignoriert
    else:
        team_id = None
    return (title, date, clean_time(data.get('time')), clean_str(data.get('location'), 200),
            etype, str(data.get('notes') or '')[:5000], team_id)


@bp.get('/api/events')
@role_required('trainer', 'player')
def list_events():
    where, params = visible_events_sql()
    sql = f'''SELECT e.*, tm.name AS team_name FROM events e LEFT JOIN teams tm ON tm.id = e.team_id
              WHERE {where}'''
    month = request.args.get('month')
    if month:
        sql += ' AND substr(e.date, 1, 7) = ?'; params.append(month)
    rows = get_db().execute(sql + " ORDER BY e.date, COALESCE(e.time, '99:99')", params).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d['owned_by_me'] = r['user_id'] == uid()
        out.append(d)
    return jsonify(out)


@bp.post('/api/events')
@role_required('trainer')
def create_event():
    vals = _parse_event()
    db = get_db()
    cur = db.execute('''INSERT INTO events (title, date, time, location, type, notes, team_id, user_id)
                        VALUES (?,?,?,?,?,?,?,?)''', vals + (uid(),))
    db.commit()
    return jsonify({'id': cur.lastrowid, 'message': 'Termin angelegt'}), 201


def _own_event(event_id):
    row = get_db().execute('SELECT * FROM events WHERE id = ? AND user_id = ?', (event_id, uid())).fetchone()
    if row is None:
        raise ApiError('Termin nicht gefunden', 404)
    return row


@bp.put('/api/events/<int:event_id>')
@role_required('trainer')
def update_event(event_id):
    _own_event(event_id)
    vals = _parse_event()
    db = get_db()
    db.execute('''UPDATE events SET title=?, date=?, time=?, location=?, type=?, notes=?, team_id=?
                  WHERE id=?''', vals + (event_id,))
    db.commit()
    return jsonify({'message': 'Termin gespeichert'})


@bp.delete('/api/events/<int:event_id>')
@role_required('trainer')
def delete_event(event_id):
    _own_event(event_id)
    db = get_db()
    db.execute('DELETE FROM events WHERE id = ?', (event_id,))
    db.commit()
    return jsonify({'message': 'Termin gelöscht'})
