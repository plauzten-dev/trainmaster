"""WSGI-Datei fuer PythonAnywhere.

Inhalt in die WSGI-Datei deiner Web-App auf PythonAnywhere kopieren
(Reiter "Web" -> Abschnitt "Code" -> "WSGI configuration file") und
DEIN_BENUTZERNAME sowie die Betreiberdaten anpassen. Diese Datei bleibt
auf PythonAnywhere und kommt NICHT ins Git-Repo, falls du dort echte Daten eintraegst.
"""
import os
import sys

PROJECT = '/home/DEIN_BENUTZERNAME/trainmaster'
if PROJECT not in sys.path:
    sys.path.insert(0, PROJECT)

# Daten liegen dauerhaft im Projektordner (PythonAnywhere-Dateisystem ist persistent)
os.environ.setdefault('DB_PATH', PROJECT + '/trainmaster.db')
os.environ.setdefault('UPLOAD_DIR', PROJECT + '/uploads')

# Betreiberangaben fuer Impressum und Datenschutzerklaerung
os.environ.setdefault('OPERATOR_NAME', '')
os.environ.setdefault('OPERATOR_ADDRESS', '')
os.environ.setdefault('OPERATOR_EMAIL', '')
os.environ.setdefault('OPERATOR_HOSTING', 'PythonAnywhere LLP, Großbritannien (Server in der EU: eu.pythonanywhere.com)')
os.environ.setdefault('OPERATOR_LOG_DAYS', '')

from app import app as application  # noqa: E402,F401
