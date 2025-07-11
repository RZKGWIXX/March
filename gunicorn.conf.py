import os

# Основні налаштування
bind = "0.0.0.0:5000"
workers = 1
worker_class = "gevent"
worker_connections = 1000
timeout = 60
keepalive = 5
max_requests = 2000
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
    server.log.info("Worker spawned and ready (pid: %s)", worker.pid)
    server.log.info("Worker ready (pid: %s)", worker.pid)