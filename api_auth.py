"""Auth & Konto: Registrierung, Login, E-Mail-Verifikation, Profil, Passwort, Avatar, Loeschen, Export."""
import json
import logging
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone

from flask import Blueprint, Response, g, jsonify, redirect, request, session

from config import APP_NAME, LIMITS, ROLES, SMTP_ENABLED
from database import get_db, hash_password, verify_password
from helpers import (EMAIL_RE, RateLimiter, client_ip, clean_str, delete_image, err, json_body,
                     login_required, save_image, send_mail, uid)

bp = Blueprint('auth', __name__)
log = logging.getLogger(__name__)

login_limiter = RateLimiter(10, 600)
register_limiter = RateLimiter(20, 3600)
resend_limiter = RateLimiter(5, 3600)
delete_limiter = RateLimiter(10, 600)

PW_MIN = LIMITS['password_min_length']


def _verification_token():
    token = secrets.token_urlsafe(32)
    expires = (datetime.now(timezone.utc) + timedelta(hours=LIMITS['verification_ttl_hours'])).isoformat()
    return token, expires


def _send_verification(email, token):
    link = request.url_root.rstrip('/') + '/verify-email/' + token
    text = (f'Hallo,\n\nbitte bestätige deine E-Mail-Adresse für {APP_NAME}:\n{link}\n\n'
            f'Der Link ist {LIMITS["verification_ttl_hours"]} Stunden gültig. '
            'Falls du dich nicht registriert hast, ignoriere diese Nachricht.\n')
    if not SMTP_ENABLED:
        log.info('[DEV] Bestaetigungslink (kein SMTP konfiguriert): %s', link)
        return
    send_mail(email, f'{APP_NAME}: E-Mail-Adresse bestätigen', text)


def _login_session(user):
    session.clear()
    session.permanent = True
    session['user_id'] = user['id']
    session['username'] = user['username']
    session['user_role'] = user['role']


def _username_taken(db, username, exclude_id=0):
    return db.execute('SELECT 1 FROM users WHERE lower(username) = lower(?) AND id != ?',
                      (username, exclude_id)).fetchone()


def _email_taken(db, email, exclude_id=0):
    return db.execute('SELECT 1 FROM users WHERE lower(email) = lower(?) AND id != ?',
                      (email, exclude_id)).fetchone()


def _validate_username(username):
    if len(username) < 3 or len(username) > 40:
        return 'Benutzername muss 3–40 Zeichen lang sein'
    if '@' in username:
        return 'Benutzername darf kein @ enthalten'
    return None


@bp.post('/api/auth/register')
def register():
    ip = client_ip()
    if register_limiter.blocked(ip):
        return err('Zu viele Registrierungen. Bitte später erneut versuchen.', 429)
    data = json_body()
    username = clean_str(data.get('username'), 60)
    email = clean_str(data.get('email'), 200).lower()
    password = str(data.get('password') or '')
    role = data.get('role') if data.get('role') in ROLES else 'trainer'
    invite = clean_str(data.get('invite_code'), 20).upper()

    if data.get('accept_privacy') is not True:
        return err('Bitte akzeptiere die Datenschutzerklärung')
    msg = _validate_username(username)
    if msg:
        return err(msg)
    if not EMAIL_RE.match(email):
        return err('Bitte gib eine gültige E-Mail-Adresse ein')
    if len(password) < PW_MIN:
        return err(f'Passwort muss mindestens {PW_MIN} Zeichen lang sein')

    db = get_db()
    player = None
    if role == 'player':
        if not invite:
            return err('Einladecode ist für Spieler erforderlich')
        player = db.execute('SELECT id, linked_user_id FROM players WHERE invite_code = ?', (invite,)).fetchone()
        if player is None:
            return err('Einladecode ungültig oder nicht gefunden')
        if player['linked_user_id'] is not None:
            return err('Dieser Einladecode wurde bereits verwendet')
    if _username_taken(db, username):
        return err('Benutzername bereits vergeben')
    if _email_taken(db, email):
        return err('E-Mail bereits registriert')

    register_limiter.hit(ip)
    token, expires = _verification_token()
    try:
        cur = db.execute(
            '''INSERT INTO users (username, email, password_hash, role, weekly_goal, email_verified,
               verification_token, verification_expires) VALUES (?,?,?,?,?,?,?,?)''',
            (username, email, hash_password(password), role, LIMITS['weekly_goal_default'],
             0 if SMTP_ENABLED else 1, token if SMTP_ENABLED else None, expires if SMTP_ENABLED else None))
    except sqlite3.IntegrityError:
        return err('Benutzername oder E-Mail bereits vergeben')
    user_id = cur.lastrowid
    if player is not None:
        res = db.execute('UPDATE players SET linked_user_id = ? WHERE id = ? AND linked_user_id IS NULL',
                         (user_id, player['id']))
        if res.rowcount == 0:
            db.execute('DELETE FROM users WHERE id = ?', (user_id,))
            db.commit()
            return err('Dieser Einladecode wurde bereits verwendet')
    db.commit()

    if SMTP_ENABLED:
        try:
            _send_verification(email, token)
        except Exception:
            log.exception('Bestaetigungsmail fehlgeschlagen')
        return jsonify({'message': 'Fast geschafft! Bitte bestätige deine E-Mail-Adresse über den Link, '
                                   'den wir dir geschickt haben.', 'verification_required': True}), 201
    _send_verification(email, token)  # nur Konsolen-Log
    user = db.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()
    _login_session(user)
    return jsonify({'message': 'Willkommen!', 'role': role}), 201


@bp.post('/api/auth/login')
def login():
    data = json_body()
    name = clean_str(data.get('username'), 200)
    password = str(data.get('password') or '')
    key = client_ip() + '|' + name.lower()
    if login_limiter.blocked(key):
        return err('Zu viele Anmeldeversuche. Bitte warte einige Minuten.', 429)
    user = get_db().execute(
        'SELECT * FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?)', (name, name)).fetchone()
    if user is None or not verify_password(password, user['password_hash']):
        login_limiter.hit(key)
        return err('Ungültige Anmeldedaten', 401)
    if SMTP_ENABLED and not user['email_verified']:
        return err('Bitte bestätige zuerst deine E-Mail-Adresse.', 403, verification_required=True)
    login_limiter.reset(key)
    _login_session(user)
    return jsonify({'message': 'Angemeldet', 'role': user['role']})


@bp.post('/api/auth/logout')
def logout():
    session.clear()
    return jsonify({'message': 'Abgemeldet'})


@bp.get('/api/auth/me')
def me():
    from helpers import load_user
    user = load_user()
    if user is None:
        return jsonify({'authenticated': False})
    return jsonify({'authenticated': True, 'username': user['username'], 'user_id': user['id'],
                    'role': user['role'], 'email': user['email'], 'avatar_path': user['avatar_path'],
                    'weekly_goal': user['weekly_goal'], 'created_at': user['created_at']})


@bp.get('/verify-email/<token>')
def verify_email(token):
    db = get_db()
    user = db.execute('SELECT * FROM users WHERE verification_token = ?', (token,)).fetchone()
    if user is None:
        return redirect('/login?verify_error=invalid')
    try:
        expired = datetime.fromisoformat(user['verification_expires']) < datetime.now(timezone.utc)
    except (TypeError, ValueError):
        expired = True
    if expired:
        return redirect('/login?verify_error=expired')
    db.execute('UPDATE users SET email_verified = 1, verification_token = NULL, verification_expires = NULL '
               'WHERE id = ?', (user['id'],))
    db.commit()
    return redirect('/login?verified=1')


@bp.post('/api/auth/resend-verification')
def resend_verification():
    generic = jsonify({'message': 'Falls ein unbestätigtes Konto existiert, haben wir eine neue E-Mail gesendet.'})
    ip = client_ip()
    if resend_limiter.blocked(ip):
        return generic
    resend_limiter.hit(ip)
    data = json_body()
    ident = clean_str(data.get('email') or data.get('username'), 200)
    if not ident:
        return generic
    db = get_db()
    user = db.execute('SELECT * FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?)',
                      (ident, ident)).fetchone()
    if user is not None and not user['email_verified']:
        token, expires = _verification_token()
        db.execute('UPDATE users SET verification_token = ?, verification_expires = ? WHERE id = ?',
                   (token, expires, user['id']))
        db.commit()
        try:
            _send_verification(user['email'], token)
        except Exception:
            log.exception('Bestaetigungsmail fehlgeschlagen')
    return generic


@bp.put('/api/auth/change-password')
@login_required
def change_password():
    data = json_body()
    if not verify_password(str(data.get('current_password') or ''), g.user['password_hash']):
        return err('Aktuelles Passwort ist falsch')
    new = str(data.get('new_password') or '')
    if len(new) < PW_MIN:
        return err(f'Neues Passwort muss mindestens {PW_MIN} Zeichen lang sein')
    db = get_db()
    db.execute('UPDATE users SET password_hash = ? WHERE id = ?', (hash_password(new), uid()))
    db.commit()
    return jsonify({'message': 'Passwort geändert'})


@bp.put('/api/auth/change-profile')
@login_required
def change_profile():
    data = json_body()
    username = clean_str(data.get('username'), 60)
    email = clean_str(data.get('email'), 200).lower()
    msg = _validate_username(username)
    if msg:
        return err(msg)
    if not EMAIL_RE.match(email):
        return err('Bitte gib eine gültige E-Mail-Adresse ein')
    db = get_db()
    if _username_taken(db, username, uid()):
        return err('Benutzername bereits vergeben')
    if _email_taken(db, email, uid()):
        return err('E-Mail bereits registriert')
    db.execute('UPDATE users SET username = ?, email = ? WHERE id = ?', (username, email, uid()))
    db.commit()
    session['username'] = username
    return jsonify({'message': 'Profil gespeichert', 'username': username, 'email': email})


@bp.put('/api/auth/weekly-goal')
@login_required
def weekly_goal():
    try:
        goal = int(json_body().get('weekly_goal'))
    except (TypeError, ValueError):
        return err('Ungültiges Wochenziel')
    goal = max(LIMITS['weekly_goal_min'], min(LIMITS['weekly_goal_max'], goal))
    db = get_db()
    db.execute('UPDATE users SET weekly_goal = ? WHERE id = ?', (goal, uid()))
    db.commit()
    return jsonify({'weekly_goal': goal})


@bp.post('/api/auth/avatar')
@login_required
def set_avatar():
    path = save_image(request.files.get('image'), 'avatars')
    if not path:
        return err('Bitte wähle ein Bild aus')
    db = get_db()
    old = g.user['avatar_path']
    db.execute('UPDATE users SET avatar_path = ? WHERE id = ?', (path, uid()))
    db.commit()
    delete_image(old)
    return jsonify({'avatar_path': path})


@bp.delete('/api/auth/avatar')
@login_required
def remove_avatar():
    db = get_db()
    old = g.user['avatar_path']
    db.execute('UPDATE users SET avatar_path = NULL WHERE id = ?', (uid(),))
    db.commit()
    delete_image(old)
    return jsonify({'message': 'Profilbild entfernt'})


@bp.delete('/api/auth/account')
@login_required
def delete_account():
    key = client_ip() + '|del|' + str(uid())
    if delete_limiter.blocked(key):
        return err('Zu viele Versuche. Bitte warte einige Minuten.', 429)
    if not verify_password(str(json_body().get('password') or ''), g.user['password_hash']):
        delete_limiter.hit(key)
        return err('Passwort ist falsch')
    db = get_db()
    me_id = uid()
    images = [g.user['avatar_path']]
    images += [r[0] for r in db.execute('SELECT avatar_path FROM players WHERE user_id = ?', (me_id,))]
    images += [r[0] for r in db.execute('SELECT image_path FROM exercises WHERE owner_user_id = ?', (me_id,))]
    db.execute('DELETE FROM users WHERE id = ?', (me_id,))
    db.commit()
    for path in images:
        delete_image(path)
    session.clear()
    return jsonify({'message': 'Konto gelöscht'})


@bp.get('/api/auth/export')
@login_required
def export_data():
    """Datenauskunft / Datenportabilitaet (Art. 15, 20 DSGVO) als JSON-Download."""
    db = get_db()
    me_id = uid()

    def rows(sql, params=(me_id,)):
        return [dict(r) for r in db.execute(sql, params).fetchall()]

    user = dict(g.user)
    for k in ('password_hash', 'verification_token', 'verification_expires'):
        user.pop(k, None)
    data = {
        'app': APP_NAME,
        'exported_at': datetime.now(timezone.utc).isoformat(),
        'account': user,
        'exercises': rows('SELECT * FROM exercises WHERE owner_user_id = ?'),
        'favorites': rows('SELECT exercise_id, created_at FROM exercise_favorites WHERE user_id = ?'),
        'trainings': rows('SELECT * FROM trainings WHERE user_id = ?'),
        'training_exercises': rows('''SELECT te.* FROM training_exercises te JOIN trainings t
                                      ON t.id = te.training_id WHERE t.user_id = ?'''),
        'teams': rows('SELECT * FROM teams WHERE user_id = ?'),
        'players': rows('SELECT * FROM players WHERE user_id = ?'),
        'memberships': rows('''SELECT m.* FROM player_team_memberships m JOIN teams t ON t.id = m.team_id
                               WHERE t.user_id = ?'''),
        'attendance': rows('''SELECT a.* FROM training_attendance a JOIN trainings t ON t.id = a.training_id
                              WHERE t.user_id = ?'''),
        'events': rows('SELECT * FROM events WHERE user_id = ?'),
        'my_player_profiles': rows('SELECT id, name, position, number, status, birthday FROM players '
                                   'WHERE linked_user_id = ?'),
        'my_attendance': rows('''SELECT a.training_id, a.present FROM training_attendance a
                                 JOIN players p ON p.id = a.player_id WHERE p.linked_user_id = ?'''),
    }
    body = json.dumps(data, ensure_ascii=False, indent=2, default=str)
    fname = f'{APP_NAME.lower()}-daten-{datetime.now().strftime("%Y-%m-%d")}.json'
    return Response(body, mimetype='application/json',
                    headers={'Content-Disposition': f'attachment; filename="{fname}"'})
