FROM python:3.10-slim

LABEL maintainer="Blackhole Web Project"
LABEL description="GPU-accelerated hand gesture recognition server"

WORKDIR /app

RUN apt-get update && apt-get install -y \
    wget \
    libgl1 \
    libegl1 \
    libgles2 \
    libglvnd0 \
    libglx0 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    libgomp1 \
    libjpeg62-turbo \
    libpng16-16 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PYTHONUNBUFFERED=1

EXPOSE 5000

CMD ["python", "server.py"]
