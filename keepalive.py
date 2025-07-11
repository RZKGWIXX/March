
#!/usr/bin/env python3
import requests
import time
import os
from threading import Thread

def keepalive():
    """Функція для підтримки сервера активним"""
    repl_url = os.environ.get('REPL_URL', 'http://0.0.0.0:5000')
    
    while True:
        try:
            response = requests.get(f"{repl_url}/ping", timeout=10)
            if response.status_code == 200:
                print(f"✅ Keepalive ping successful at {time.strftime('%Y-%m-%d %H:%M:%S')}")
            else:
                print(f"⚠️ Keepalive ping returned status {response.status_code}")
        except Exception as e:
            print(f"❌ Keepalive ping failed: {e}")
        
        # Пінгуємо кожні 5 хвилин
        time.sleep(300)

if __name__ == "__main__":
    print("🚀 Starting keepalive service...")
    keepalive_thread = Thread(target=keepalive, daemon=True)
    keepalive_thread.start()
    
    # Тримаємо скрипт активним
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("🛑 Keepalive service stopped")
