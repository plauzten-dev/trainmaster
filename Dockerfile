FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080 \
    DB_PATH=/data/trainmaster.db UPLOAD_DIR=/data/uploads
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN useradd --create-home appuser && mkdir -p /data && chown -R appuser /data /app
USER appuser
EXPOSE 8080
CMD ["sh", "-c", "gunicorn --workers 2 --bind 0.0.0.0:${PORT} --access-logfile - --forwarded-allow-ips='*' app:app"]
