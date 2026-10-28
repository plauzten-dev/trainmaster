"""Gemeinsame Helfer: Login-/Rollen-Decorator, JSON-Fehler, Uploads, Mail, Rate-Limit, Zugriffsregeln."""
import logging
import os
import re
import smtplib
import threading
import time
import uuid
from collections import Counter, defaultdict, deque
from datetime import datetime
from email.message import EmailMessage
from functools import wraps

from flask import g, jsonify, redirect, request, session

from config import (APP_NAME, CLOUDINARY_ENABLED, LIMITS, UPLOAD_DIR)
from database import get_db

log = logging.getLogger(__name__)


class ApiError(Exception):
    def __init__(self, message, status=400, **extra):
        super().__init__(message)
        self.message = message
        self.status = status
        self.extra = extra


def err(message, status=400, **extra):
    body = {'error': message}
    body.update(extra)
    return jsonify(body), status


# ---------------------------------------------------------------- Login / Rollen

def load_user():
    """Liest den Nutzer frisch aus der DB (Rolle nie nur aus der Session)."""
    if 'user' in g:
        return g.user
    uid = session.get('user_id')
    user = None
    if uid:
        user = get_db().execute('SELECT * FROM users WHERE id = ?', (uid,)).fetchone()
        if user is None:
            session.clear()
    g.user = user
    return user


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if load_user() is None:
            if request.path.startswith('/api/'):
                return err('Nicht eingeloggt', 401)
            return redirect('/login')
        return view(*args, **kwargs)
    return wrapper


def role_required(*roles):
    def deco(view):
        @wraps(view)
        @login_required
        def wrapper(*args, **kwargs):
            if g.user['role'] not in roles:
                if request.path.startswith('/api/'):
                    return err('Keine Berechtigung', 403)
                return redirect('/dashboard')
            return view(*args, **kwargs)
        return wrapper
    return deco


def uid():
    return g.user['id']


def json_body():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


# ---------------------------------------------------------------- Zugriffsregeln

def trainer_ids(user=None):
    """IDs der Trainer, mit denen ein Spieler-Konto verknuepft ist (nur Rolle player)."""
    user = user or g.user
    if user['role'] != 'player':
        return []
    rows = get_db().execute(
        'SELECT DISTINCT user_id FROM players WHERE linked_user_id = ?', (user['id'],)).fetchall()
    return [r['user_id'] for r in rows]


def readable_training_owner_ids(user=None):
    user = user or g.user
    return [user['id']] + trainer_ids(user)


def get_training(training_id, write=False):
    """Training laden mit Zugriffspruefung. Fremd -> 404, nur lesbar aber Schreibzugriff -> 403."""
    row = get_db().execute('SELECT * FROM trainings WHERE id = ?', (training_id,)).fetchone()
    if row is None or row['user_id'] not in readable_training_owner_ids():
        raise ApiError('Training nicht gefunden', 404)
    if write and row['user_id'] != uid():
        raise ApiError('Nur der Ersteller darf dieses Training bearbeiten', 403)
    return row


def player_team_ids(user=None):
    """Team-IDs aller Spielerprofile, die mit diesem Konto verknuepft sind."""
    user = user or g.user
    rows = get_db().execute(
        '''SELECT DISTINCT m.team_id FROM player_team_memberships m
           JOIN players p ON p.id = m.player_id WHERE p.linked_user_id = ?''', (user['id'],)).fetchall()
    return [r['team_id'] for r in rows]


def visible_events_sql(user=None):
    """WHERE-Teil + Parameter fuer Termine, die der Nutzer sehen darf (Alias e)."""
    user = user or g.user
    if user['role'] == 'trainer':
        return 'e.user_id = ?', [user['id']]
    if user['role'] == 'player':
        tids, teams = trainer_ids(user), player_team_ids(user)
        if not tids or not teams:
            return '0', []
        return (f'e.user_id IN ({",".join("?" * len(tids))}) AND e.team_id IN ({",".join("?" * len(teams))})',
                tids + teams)
    return '0', []


def training_sports(training_ids):
    """Sportart je Training = haeufigste Sportart seiner Uebungen (Fallback Allgemein)."""
    result = {tid: 'Allgemein' for tid in training_ids}
    if not training_ids:
        return result
    rows = get_db().execute(
        f'''SELECT te.training_id, e.sport FROM training_exercises te JOIN exercises e ON e.id = te.exercise_id
            WHERE te.training_id IN ({",".join("?" * len(training_ids))}) ORDER BY te.order_index''',
        list(training_ids)).fetchall()
    counts = defaultdict(Counter)
    for r in rows:
        counts[r['training_id']][r['sport']] += 1
    for tid, c in counts.items():
        result[tid] = c.most_common(1)[0][0]
    return result


# ---------------------------------------------------------------- Validierung

DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
TIME_RE = re.compile(r'^([01]\d|2[0-3]):[0-5]\d$')
EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')


def valid_date(value):
    if not isinstance(value, str) or not DATE_RE.match(value):
        return False
    try:
        datetime.strptime(value, '%Y-%m-%d')
        return True
    except ValueError:
        return False


def clean_time(value):
    """'' / None -> None, gueltiges HH:MM -> str, sonst ApiError."""
    if value in (None, ''):
        return None
    if isinstance(value, str) and TIME_RE.match(value):
        return value
    raise ApiError('Ungültige Uhrzeit (HH:MM)')


def clean_str(value, max_len=200):
    return str(value or '').strip()[:max_len]


def int_or_none(value, lo, hi, label):
    if value in (None, ''):
        return None
    try:
        n = int(value)
    except (TypeError, ValueError):
        raise ApiError(f'{label} muss eine Zahl sein')
    if n < lo or n > hi:
        raise ApiError(f'{label} muss zwischen {lo} und {hi} liegen')
    return n


# ---------------------------------------------------------------- Uploads

ALLOWED_EXT = set(LIMITS['upload_allowed_extensions'])

if CLOUDINARY_ENABLED:
    import cloudinary
    import cloudinary.uploader
    cloudinary.config(cloud_name=os.environ['CLOUDINARY_CLOUD_NAME'],
                      api_key=os.environ['CLOUDINARY_API_KEY'],
                      api_secret=os.environ['CLOUDINARY_API_SECRET'], secure=True)


def save_image(file, folder):
    """Speichert ein hochgeladenes Bild. Rueckgabe: lokaler Dateiname oder https-URL."""
    if file is None or not file.filename:
        return None
    ext = file.filename.rsplit('.', 1)[-1].lower() if '.' in file.filename else ''
    if ext not in ALLOWED_EXT:
        raise ApiError('Ungültiges Bildformat. Erlaubt: PNG, JPG, GIF, WEBP, HEIC')
    try:
        if CLOUDINARY_ENABLED:
            opts = {'folder': f'{APP_NAME.lower()}/{folder}', 'resource_type': 'image'}
            if ext in ('heic', 'heif'):
                opts['format'] = 'jpg'
            res = cloudinary.uploader.upload(file, **opts)
            return res['secure_url']
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        name = uuid.uuid4().hex + '.' + ext
        file.save(os.path.join(UPLOAD_DIR, name))
        if os.path.getsize(os.path.join(UPLOAD_DIR, name)) == 0:
            os.remove(os.path.join(UPLOAD_DIR, name))
            raise ApiError('Die Bilddatei ist leer')
        return name
    except ApiError:
        raise
    except Exception:
        log.exception('Bild-Upload fehlgeschlagen')
        raise ApiError('Bild-Upload fehlgeschlagen. Bitte erneut versuchen.')


def delete_image(path):
    if not path:
        return
    try:
        if path.startswith('http'):
            if CLOUDINARY_ENABLED:
                m = re.search(r'/upload/(?:v\d+/)?(.+)\.[a-zA-Z0-9]+$', path)
                if m:
                    cloudinary.uploader.destroy(m.group(1))
        else:
            full = os.path.join(UPLOAD_DIR, os.path.basename(path))
            if os.path.isfile(full):
                os.remove(full)
    except Exception:
        log.exception('Bild konnte nicht geloescht werden: %s', path)


# ---------------------------------------------------------------- Mail

def send_mail(to, subject, text):
    host = os.environ.get('SMTP_HOST')
    if not host:
        log.info('Mail (Dev, nicht versendet) an %s: %s\n%s', to, subject, text)
        return
    msg = EmailMessage()
    msg['Subject'] = subject
    msg['From'] = os.environ.get('SMTP_FROM') or os.environ.get('SMTP_USER')
    msg['To'] = to
    msg.set_content(text)
    port = int(os.environ.get('SMTP_PORT', '587'))
    if port == 465:
        server = smtplib.SMTP_SSL(host, port, timeout=20)
    else:
        server = smtplib.SMTP(host, port, timeout=20)
        server.starttls()
    try:
        if os.environ.get('SMTP_USER'):
            server.login(os.environ['SMTP_USER'], os.environ.get('SMTP_PASSWORD', ''))
        server.send_message(msg)
    finally:
        server.quit()


# ---------------------------------------------------------------- Rate-Limit (in-memory, je Worker)

class RateLimiter:
    def __init__(self, limit, window):
        self.limit, self.window = limit, window
        self.hits = defaultdict(deque)
        self.lock = threading.Lock()

    def _prune(self, q, now):
        while q and q[0] <= now - self.window:
            q.popleft()

    def blocked(self, key):
        now = time.time()
        with self.lock:
            q = self.hits[key]
            self._prune(q, now)
            return len(q) >= self.limit

    def hit(self, key):
        with self.lock:
            self.hits[key].append(time.time())

    def reset(self, key):
        with self.lock:
            self.hits.pop(key, None)


def client_ip():
    return request.remote_addr or 'unknown'
