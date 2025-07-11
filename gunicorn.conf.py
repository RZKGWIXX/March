import os

# Основні налаштування
bind = "0.0.0.0:5000"
workers = 2
worker_class = "eventlet"
worker_connections = 100
timeout = 120
keepalive = 5

# Налаштування для стабільності
max_requests = 1000
max_requests_jitter = 100
preload_app = True

# Логування
accesslog = "-"
errorlog = "-"
loglevel = "info"

# Restart workers
worker_restart_after_n_requests = 1000

# Graceful timeout
graceful_timeout = 30

def when_ready(server):
    print("OrbitMess Chat Server ready!")

def worker_int(worker):
    worker.log.info("worker received INT or QUIT signal")

def pre_fork(server, worker):
    server.log.info("Worker spawned (pid: %s)", worker.pid)

def post_fork(server, worker):
    server.log.info("Worker ready (pid: %s)", worker.pid)