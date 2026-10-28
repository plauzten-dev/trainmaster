"""Dashboard, Statistik und 'Als Naechstes'-Anzeige der Navigation."""
from datetime import date, datetime, timedelta

from flask import Blueprint, g, jsonify

from config import LIMITS, MONTHS_DE
from database import get_db
from helpers import login_required, readable_training_owner_ids, training_sports, uid, visible_events_sql

bp = Blueprint('dashboard', __name__)


def _trainings_between(start, end):
    owners = readable_training_owner_ids()
    rows = get_db().execute(
        f'''SELECT id, title, date, time, user_id FROM trainings WHERE user_id IN ({",".join("?" * len(owners))})
            AND date BETWEEN ? AND ? ORDER BY date, COALESCE(time, '99:99')''',
        owners + [start, end]).fetchall()
    return rows


def _events_between(start, end):
    where, params = visible_events_sql()
    if where == '0':
        return []
    return get_db().execute(
        f'''SELECT e.id, e.title, e.date, e.time, e.location, e.type, tm.name AS team_name FROM events e
            LEFT JOIN teams tm ON tm.id = e.team_id WHERE {where} AND e.date BETWEEN ? AND ?
            ORDER BY e.date, COALESCE(e.time, '99:99')''', params + [start, end]).fetchall()


@bp.get('/api/dashboard')
@login_required
def dashboard():
    db = get_db()
    me = uid()
    today = date.today()
    owners = readable_training_owner_ids()
    ph = ','.join('?' * len(owners))

    total = db.execute(f'SELECT COUNT(*) FROM trainings WHERE user_id IN ({ph})', owners).fetchone()[0]
    this_month = db.execute(f'SELECT COUNT(*) FROM trainings WHERE user_id IN ({ph}) AND substr(date,1,7) = ?',
                            owners + [today.strftime('%Y-%m')]).fetchone()[0]
    total_ex = db.execute('SELECT COUNT(*) FROM exercises WHERE owner_user_id IS NULL OR owner_user_id = ?',
                          (me,)).fetchone()[0]

    monday = today - timedelta(days=today.weekday())
    sunday = monday + timedelta(days=6)
    last_day = max(sunday, today + timedelta(days=LIMITS['dashboard_upcoming_days'] - 1))
    trainings = _trainings_between(monday.isoformat(), last_day.isoformat())
    events = _events_between(monday.isoformat(), last_day.isoformat())
    sports = training_sports([t['id'] for t in trainings])

    days = []
    week_done = 0
    for i in range(7):
        d = (monday + timedelta(days=i)).isoformat()
        n_tr = sum(1 for t in trainings if t['date'] == d)
        week_done += n_tr
        days.append({'date': d, 'day_num': (monday + timedelta(days=i)).day,
                     'weekday': i, 'has_training': n_tr > 0,
                     'has_event': any(e['date'] == d for e in events), 'is_today': d == today.isoformat()})

    t_iso = today.isoformat()
    today_units = [{'kind': 'training', 'id': t['id'], 'title': t['title'], 'time': t['time'],
                    'sport': sports[t['id']], 'from_trainer': t['user_id'] != me}
                   for t in trainings if t['date'] == t_iso]
    today_units += [{'kind': 'event', 'id': e['id'], 'title': e['title'], 'time': e['time'],
                     'location': e['location'], 'type': e['type'], 'team_name': e['team_name']}
                    for e in events if e['date'] == t_iso]
    today_units.sort(key=lambda u: (u['time'] is None, u['time'] or ''))

    upcoming = []
    for i in range(LIMITS['dashboard_upcoming_days']):
        d = (today + timedelta(days=i)).isoformat()
        upcoming.append({
            'date': d,
            'trainings': [{'id': t['id'], 'title': t['title'], 'time': t['time'], 'sport': sports[t['id']],
                           'from_trainer': t['user_id'] != me} for t in trainings if t['date'] == d],
            'events': [{'id': e['id'], 'title': e['title'], 'time': e['time'], 'location': e['location'],
                        'type': e['type']} for e in events if e['date'] == d],
        })

    suggested = db.execute(
        '''SELECT id, title, core_competency, difficulty, sport FROM exercises
           WHERE sport = ? AND (owner_user_id IS NULL OR owner_user_id = ?) ORDER BY RANDOM() LIMIT ?''',
        (LIMITS['dashboard_suggested_sport'], me, LIMITS['dashboard_suggested_exercises'])).fetchall()

    library = {'favorites': db.execute(
        '''SELECT COUNT(*) FROM exercise_favorites f JOIN exercises e ON e.id = f.exercise_id
           WHERE f.user_id = ? AND (e.owner_user_id IS NULL OR e.owner_user_id = ?)''', (me, me)).fetchone()[0]}
    if g.user['role'] == 'trainer':
        library['teams'] = db.execute('SELECT COUNT(*) FROM teams WHERE user_id = ?', (me,)).fetchone()[0]
        row = db.execute("SELECT COUNT(*), COALESCE(SUM(status != 'fit'), 0) FROM players WHERE user_id = ?",
                         (me,)).fetchone()
        library['players'], library['unwell'] = row[0], row[1]

    return jsonify({
        'library': library,
        'stats': {'trainings_this_month': this_month, 'total_trainings': total, 'total_exercises': total_ex},
        'week': {'goal': g.user['weekly_goal'], 'done': week_done, 'start': monday.isoformat(), 'days': days},
        'today_units': today_units,
        'upcoming': upcoming,
        'suggested': [dict(r) for r in suggested],
    })


@bp.get('/api/statistik')
@login_required
def statistik():
    db = get_db()
    owners = readable_training_owner_ids()
    ph = ','.join('?' * len(owners))
    today = date.today()
    months = []
    y, m = today.year, today.month
    for _ in range(LIMITS['statistics_months']):
        months.append((y, m))
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    months.reverse()
    monthly = []
    for y, m in months:
        count = db.execute(f'SELECT COUNT(*) FROM trainings WHERE user_id IN ({ph}) AND substr(date,1,7) = ?',
                           owners + [f'{y:04d}-{m:02d}']).fetchone()[0]
        monthly.append({'month': MONTHS_DE[m - 1], 'count': count, 'key': f'{y:04d}-{m:02d}'})
    top = db.execute(
        f'''SELECT e.id, e.title, e.sport, COUNT(*) AS usage_count FROM training_exercises te
            JOIN trainings t ON t.id = te.training_id JOIN exercises e ON e.id = te.exercise_id
            WHERE t.user_id IN ({ph}) GROUP BY e.id ORDER BY usage_count DESC, e.title LIMIT ?''',
        owners + [LIMITS['statistics_top_exercises']]).fetchall()
    return jsonify({'monthly': monthly, 'top_exercises': [dict(r) for r in top]})


@bp.get('/api/next-up')
@login_required
def next_up():
    """Naechster Eintrag ab jetzt (fuer die 'Als Naechstes'-Leiste in der Navigation)."""
    now = datetime.now()
    start = now.date().isoformat()
    end = (now.date() + timedelta(days=30)).isoformat()
    now_hm = now.strftime('%H:%M')
    items = []
    for t in _trainings_between(start, end):
        items.append({'kind': 'training', 'id': t['id'], 'title': t['title'], 'date': t['date'], 'time': t['time']})
    for e in _events_between(start, end):
        items.append({'kind': 'event', 'id': e['id'], 'title': e['title'], 'date': e['date'], 'time': e['time'],
                      'type': e['type']})
    items = [i for i in items if i['date'] > start or i['time'] is None or i['time'] >= now_hm]
    items.sort(key=lambda i: (i['date'], i['time'] or '99:99'))
    item = items[0] if items else None
    if item and item['kind'] == 'training':
        item['sport'] = training_sports([item['id']])[item['id']]
    return jsonify({'item': item})
