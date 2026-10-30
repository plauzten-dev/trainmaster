"""Zentrale Konfiguration: App-Name, Version, Konstanten aus data/konstanten.json."""
import json
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')

APP_NAME = 'TrainMaster'
APP_VERSION = '1.6.0'

DB_PATH = os.environ.get('DB_PATH', os.path.join(BASE_DIR, 'training.db'))
UPLOAD_DIR = os.environ.get('UPLOAD_DIR', os.path.join(BASE_DIR, 'uploads'))

with open(os.path.join(DATA_DIR, 'konstanten.json'), encoding='utf-8') as fh:
    CONST = json.load(fh)

LIMITS = CONST['limits']
SPORTS = CONST['sports']
DIFFICULTIES = CONST['difficulties']
FIELD_SIZES = CONST['field_sizes']
CORE_COMPETENCIES = CONST['core_competencies']
PLAYER_POSITIONS = CONST['player_positions']
PLAYER_STATUS = CONST['player_status']
TRAINING_BLOCKS = CONST['training_blocks']
EVENT_TYPES = CONST['event_types']
ROLES = CONST['roles']
MONTHS_DE = CONST['months_de']

CLOUDINARY_ENABLED = all(os.environ.get(k) for k in (
    'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'))
SMTP_ENABLED = bool(os.environ.get('SMTP_HOST'))

# Betreiberangaben fuer Impressum/Datenschutz. Bitte per Env setzen,
# sonst werden deutlich markierte Platzhalter angezeigt.
OPERATOR = {
    'name': os.environ.get('OPERATOR_NAME', ''),
    'address': os.environ.get('OPERATOR_ADDRESS', ''),
    'email': os.environ.get('OPERATOR_EMAIL', ''),
    'phone': os.environ.get('OPERATOR_PHONE', ''),
    'hosting': os.environ.get('OPERATOR_HOSTING', ''),
    'mail_provider': os.environ.get('OPERATOR_MAIL_PROVIDER', ''),
    'log_days': os.environ.get('OPERATOR_LOG_DAYS', ''),
}
FEEDBACK_URL = os.environ.get('FEEDBACK_URL', '')
PRIVACY_DATE = '28. Oktober 2026'


def frontend_config():
    """Konstanten fuer das Frontend (per /api/config und als JSON im Template)."""
    keys = ('roles', 'role_labels', 'sports', 'difficulties', 'field_sizes',
            'core_competencies', 'player_positions', 'player_position_default',
            'player_status', 'player_status_labels', 'training_blocks',
            'training_block_default', 'event_types', 'event_type_labels',
            'event_type_default', 'attendance_percent_thresholds', 'limits',
            'greeting_by_hour', 'relative_day_labels', 'weekday_short_de', 'months_de')
    cfg = {k: CONST[k] for k in keys}
    cfg['app_name'] = APP_NAME
    cfg['app_version'] = APP_VERSION
    return cfg
