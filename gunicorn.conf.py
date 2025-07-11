
import os

# Server socket - use PORT from environment for Render
import os
port = os.environ.get('PORT', '5000')
bind = f"0.0.0.0:{port}"
backlog = 2048

# Worker processes - use 1 worker for better compatibility with SocketIO
workers = 1
worker_class = "sync"
worker_connections = 1000
timeout = 120
keepalive = 2

# Restart workers after this many requests, to help prevent memory leaks
max_requests = 1000
max_requests_jitter = 100

# Logging
accesslog = "-"
errorlog = "-"
loglevel = "info"
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s"'

# Process naming
proc_name = 'orbitmess'

# Server mechanics
daemon = False
pidfile = '/tmp/orbitmess.pid'
user = None
group = None
tmp_upload_dir = None

# SSL (if needed later)
# keyfile = None
# certfile = None

# Environment
raw_env = [
    'SECRET_KEY=' + os.environ.get('SECRET_KEY', 'fallback-secret-key-for-development'),
]

# Preload application for better performance
preload_app = True

# Graceful shutdown
graceful_timeout = 30

# Security
limit_request_line = 4096
limit_request_fields = 100
limit_request_field_size = 8190
