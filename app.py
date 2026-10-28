"""Einstiegspunkt: App-Konfiguration, Sicherheit, Seiten-Routen, Fehlerbehandlung."""
import logging
import os
import secrets
from datetime import timedelta
from urllib.parse import urlparse

from flask import (Flask, abort, jsonify, redirect, render_template, request,
                   send_from_directory)
from werkzeug.exceptions import HTTPException
from werkzeug.middleware.proxy_fix import ProxyFix

import config
from config import APP_NAME, APP_VERSION, BASE_DIR, UPLOAD_DIR, frontend_config
from database import close_db, get_db, init_db
from helpers import ApiError, err, get_training, load_user, login_required, role_required, training_sports

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s: %(message)s')
log = logging.getLogger('app')


def _secret_key():
    key = os.environ.get('SECRET_KEY')
    if key:
        return key
    path = os.path.join(BASE_DIR, 'secret_key.txt')
    if os.path.exists(path):
        with open(path, encoding='utf-8') as fh:
            return fh.read().strip()
    key = secrets.token_hex(32)
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write(key)
    return key


app = Flask(__name__, static_folder='static', template_folder='templates')
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
app.config.update(
    SECRET_KEY=_secret_key(),
    MAX_CONTENT_LENGTH=config.LIMITS['upload_max_bytes'],
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    SESSION_COOKIE_SECURE=os.environ.get('INSECURE_COOKIES') != '1',
    SESSION_COOKIE_NAME='tm_session',
    PERMANENT_SESSION_LIFETIME=timedelta(days=30),
    JSON_AS_ASCII=False,
)
app.json.ensure_ascii = False
app.teardown_appcontext(close_db)

init_db()

with open(os.path.join(BASE_DIR, 'static', 'sw.js'), encoding='utf-8') as _fh:
    if f"CACHE_VERSION = 'v{APP_VERSION}'" not in _fh.read():
        log.warning('static/sw.js: CACHE_VERSION passt nicht zu APP_VERSION %s – bitte anpassen!', APP_VERSION)

from api_auth import bp as auth_bp            # noqa: E402
from api_content import bp as content_bp      # noqa: E402
from api_team import bp as team_bp            # noqa: E402
from api_dashboard import bp as dashboard_bp  # noqa: E402

for blueprint in (auth_bp, content_bp, team_bp, dashboard_bp):
    app.register_blueprint(blueprint)


# ---------------------------------------------------------------- Sicherheit

CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
       "img-src 'self' data: blob: https://res.cloudinary.com; font-src 'self'; connect-src 'self'; "
       "manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; "
       "object-src 'none'")


@app.before_request
def csrf_protect():
    if request.method in ('POST', 'PUT', 'PATCH', 'DELETE'):
        if request.headers.get('X-Requested-With') != 'fetch':
            return err('Ungültige Anfrage', 403)
        origin = request.headers.get('Origin')
        if origin and urlparse(origin).netloc != request.host:
            return err('Ungültige Herkunft der Anfrage', 403)


@app.after_request
def security_headers(resp):
    resp.headers.setdefault('X-Content-Type-Options', 'nosniff')
    resp.headers.setdefault('Referrer-Policy', 'same-origin')
    resp.headers.setdefault('X-Frame-Options', 'DENY')
    resp.headers.setdefault('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()')
    resp.headers.setdefault('Content-Security-Policy', CSP)
    if request.is_secure:
        resp.headers.setdefault('Strict-Transport-Security', 'max-age=31536000')
    if request.path.startswith('/api/'):
        resp.headers['Cache-Control'] = 'no-store'
    elif request.path.startswith('/static/') and resp.status_code == 200:
        # Versionierte Dateien (?v=APP_VERSION) aendern sich nie -> dauerhaft cachen
        if app.config.get('DEV_MODE'):
            resp.headers['Cache-Control'] = 'no-cache'  # lokal: Aenderungen sofort sichtbar
        else:
            resp.headers['Cache-Control'] = ('public, max-age=31536000, immutable' if request.args.get('v')
                                             else 'public, max-age=86400')
    return resp


@app.errorhandler(ApiError)
def handle_api_error(e):
    return err(e.message, e.status, **e.extra)


@app.errorhandler(413)
def too_large(_e):
    return err('Bild zu groß (max. 16 MB)', 413)


@app.errorhandler(HTTPException)
def http_error(e):
    if request.path.startswith('/api/'):
        msgs = {404: 'Nicht gefunden', 405: 'Methode nicht erlaubt', 400: 'Ungültige Anfrage'}
        return err(msgs.get(e.code, 'Fehler'), e.code)
    return render_template('error.html', code=e.code,
                           message='Seite nicht gefunden' if e.code == 404 else 'Etwas ist schiefgelaufen'), e.code


@app.errorhandler(Exception)
def unexpected(e):
    log.exception('Unerwarteter Fehler')
    if request.path.startswith('/api/'):
        return err('Ein unerwarteter Fehler ist aufgetreten. Bitte später erneut versuchen.', 500)
    return render_template('error.html', code=500, message='Etwas ist schiefgelaufen'), 500


@app.context_processor
def inject_globals():
    return {'APP_NAME': APP_NAME, 'APP_VERSION': APP_VERSION, 'OPERATOR': config.OPERATOR,
            'FEEDBACK_URL': config.FEEDBACK_URL, 'PRIVACY_DATE': config.PRIVACY_DATE,
            'CLOUDINARY_ENABLED': config.CLOUDINARY_ENABLED, 'SMTP_ENABLED': config.SMTP_ENABLED,
            'current_user': load_user(), 'FRONTEND_CONFIG': frontend_config()}


# ---------------------------------------------------------------- Seiten

@app.route('/')
def index():
    """Gaeste sehen die Landingpage, eingeloggte Nutzer direkt die Uebersicht."""
    if load_user():
        return redirect('/dashboard')
    return render_template('landing.html')


@app.route('/login')
def login_page():
    if load_user():
        return redirect('/dashboard')
    return render_template('login.html')


def _page(template, active, **ctx):
    return render_template(template, active=active, **ctx)


@app.route('/dashboard')
@login_required
def dashboard_page():
    return _page('dashboard.html', 'dashboard')


@app.route('/calendar')
@login_required
def calendar_page():
    return _page('calendar.html', 'calendar')


@app.route('/exercises')
@login_required
def exercises_page():
    return _page('exercises.html', 'exercises')


@app.route('/my-trainings')
@login_required
def my_trainings_page():
    return _page('my_trainings.html', 'trainings')


@app.route('/training/<int:training_id>')
@login_required
def training_page(training_id):
    try:
        get_training(training_id)
    except ApiError:
        return redirect('/calendar')
    return _page('training.html', 'trainings', training_id=training_id)


@app.route('/training/<int:training_id>/pdf')
@login_required
def training_pdf(training_id):
    try:
        t = get_training(training_id)
    except ApiError:
        return redirect('/calendar')
    rows = get_db().execute(
        '''SELECT e.*, te.block, te.duration, te.order_index FROM training_exercises te
           JOIN exercises e ON e.id = te.exercise_id WHERE te.training_id = ?''', (training_id,)).fetchall()
    order = {b: i for i, b in enumerate(config.TRAINING_BLOCKS)}
    exercises = sorted(rows, key=lambda r: (order.get(r['block'], 1), r['order_index']))
    total = sum(r['duration'] or 0 for r in exercises)
    y, m, d = (int(x) for x in t['date'].split('-'))
    date_label = f'{d}. {config.MONTHS_DE[m - 1]} {y}'
    return render_template('pdf.html', t=t, exercises=exercises, total=total, date_label=date_label,
                           sport=training_sports([training_id])[training_id])


@app.route('/players')
@role_required('trainer')
def players_page():
    return _page('players.html', 'team')


@app.route('/settings')
@login_required
def settings_page():
    return _page('settings.html', 'settings')


@app.route('/privacy')
def privacy_page():
    return render_template('privacy.html')


@app.route('/imprint')
def imprint_page():
    return render_template('imprint.html')


@app.route('/offline')
def offline_page():
    return render_template('offline.html')


@app.route('/exercise/share/<token>')
def share_page(token):
    ex = get_db().execute('SELECT * FROM exercises WHERE share_token = ?', (token,)).fetchone()
    return render_template('share.html', ex=ex, token=token), (200 if ex else 404)


@app.route('/sw.js')
def service_worker():
    resp = send_from_directory(app.static_folder, 'sw.js', mimetype='application/javascript')
    resp.headers['Service-Worker-Allowed'] = '/'
    resp.headers['Cache-Control'] = 'no-cache'
    return resp


@app.route('/manifest.json')
def manifest():
    resp = send_from_directory(app.static_folder, 'manifest.json', mimetype='application/manifest+json')
    resp.headers['Cache-Control'] = 'no-cache'
    return resp


@app.route('/uploads/<path:name>')
def uploads(name):
    name = os.path.basename(name)
    if load_user() is None:
        # Gaeste sehen nur Bilder geteilter Uebungen.
        shared = get_db().execute(
            'SELECT 1 FROM exercises WHERE image_path = ? AND share_token IS NOT NULL', (name,)).fetchone()
        if not shared:
            abort(404)
    resp = send_from_directory(UPLOAD_DIR, name)
    resp.headers['Cache-Control'] = 'private, max-age=86400'
    return resp


@app.route('/api/config')
def api_config():
    return jsonify(frontend_config())


if __name__ == '__main__':
    app.config['SESSION_COOKIE_SECURE'] = False  # lokal ohne HTTPS
    app.config['DEV_MODE'] = True
    port = int(os.environ.get('PORT', '5000'))
    log.info('%s %s laeuft auf http://localhost:%d', APP_NAME, APP_VERSION, port)
    app.run(host='0.0.0.0', port=port, debug=os.environ.get('FLASK_DEBUG') == '1')
