
import os
import json
import time
from datetime import datetime

USERS_FILE = 'users.txt'

def clean_users_file():
    """Clean and reorganize users.txt file - one account per line"""
    if not os.path.exists(USERS_FILE):
        return
    
    users = {}
    with open(USERS_FILE, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line.startswith('#') or not line:
                continue
            
            parts = line.split(',')
            if len(parts) >= 3:
                ip, nick, pwd = parts[0], parts[1], parts[2]
                timestamp = int(parts[3]) if len(parts) > 3 else int(time.time())
                date_str = parts[4] if len(parts) > 4 else datetime.fromtimestamp(timestamp).strftime('%Y-%m-%d %H:%M:%S')
                
                # Keep only the latest entry for each user (by timestamp)
                if nick not in users or users[nick]['timestamp'] < timestamp:
                    users[nick] = {
                        'ip': ip,
                        'password': pwd,
                        'timestamp': timestamp,
                        'date': date_str
                    }
    
    # Write cleaned data back, sorted by username
    with open(USERS_FILE, 'w', encoding='utf-8') as f:
        f.write("# IP,Username,Password,Timestamp,Date\n")
        for nick in sorted(users.keys()):
            data = users[nick]
            f.write(f"{data['ip']},{nick},{data['password']},{data['timestamp']},{data['date']}\n")

def update_user_nickname(old_nickname, new_nickname):
    """Update user's nickname in the users file"""
    if not os.path.exists(USERS_FILE):
        return False
    
    users = {}
    found = False
    
    # Read all users
    with open(USERS_FILE, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line.startswith('#') or not line:
                continue
            
            parts = line.split(',')
            if len(parts) >= 3:
                ip, nick, pwd = parts[0], parts[1], parts[2]
                timestamp = int(parts[3]) if len(parts) > 3 else int(time.time())
                date_str = parts[4] if len(parts) > 4 else datetime.fromtimestamp(timestamp).strftime('%Y-%m-%d %H:%M:%S')
                
                if nick == old_nickname:
                    # Update this user's nickname
                    users[new_nickname] = {
                        'ip': ip,
                        'password': pwd,
                        'timestamp': int(time.time()),  # Update timestamp
                        'date': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                    }
                    found = True
                else:
                    users[nick] = {
                        'ip': ip,
                        'password': pwd,
                        'timestamp': timestamp,
                        'date': date_str
                    }
    
    if found:
        # Write back to file
        with open(USERS_FILE, 'w', encoding='utf-8') as f:
            f.write("# IP,Username,Password,Timestamp,Date\n")
            for nick in sorted(users.keys()):
                data = users[nick]
                f.write(f"{data['ip']},{nick},{data['password']},{data['timestamp']},{data['date']}\n")
    
    return found

def get_user_stats():
    """Get user statistics"""
    if not os.path.exists(USERS_FILE):
        return {'total': 0, 'unique_ips': 0}
    
    users = set()
    ips = set()
    
    with open(USERS_FILE, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line.startswith('#') or not line:
                continue
            parts = line.split(',')
            if len(parts) >= 2:
                ips.add(parts[0])
                users.add(parts[1])
    
    return {'total': len(users), 'unique_ips': len(ips)}

if __name__ == '__main__':
    clean_users_file()
    print("Users file cleaned successfully!")
    stats = get_user_stats()
    print(f"Total users: {stats['total']}")
    print(f"Unique IPs: {stats['unique_ips']}")
