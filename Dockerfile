FROM node:22-alpine AS frontend
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim AS python-base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DATA_DIR=/app/data
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./backend/

FROM python-base AS test
RUN pip install --no-cache-dir pytest==8.3.5 httpx==0.28.1
CMD ["python", "-m", "pytest", "backend/test_app.py", "-q", "-p", "no:cacheprovider"]

FROM python-base AS runtime
RUN useradd --create-home bank && mkdir -p /app/data && chown bank:bank /app/data
COPY --from=frontend /build/dist ./static/
USER bank
EXPOSE 8000
CMD ["uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-proxy-headers"]
