#!/usr/bin/env python
import os
import json
import time
import hashlib
import secrets
import re
from collections import defaultdict, deque
from functools import wraps
from flask import Flask, render_template, request, redirect, session, url_for, jsonify
from flask_socketio import SocketIO, join_room, leave_room, send, emit

app = Flask(__name__, static_folder='static', template_folder='templates')
app.secret_key = os.environ.get('SECRET_KEY', 'fallback-secret-key-for-development')
socketio = SocketIO(app, cors_allowed_origins="*")

# Track online users
online_users = {}  # {nickname: {'last_seen': timestamp, 'room': current_room}}
user_sessions = {}  # {session_id: nickname}

# Anti-spam and security tracking
message_timestamps = defaultdict(deque)  # {nickname: deque of timestamps}
failed_login_attempts = defaultdict(list)  # {ip: [timestamps]}
rate_limits = defaultdict(list)  # {ip: [timestamps]}
spam_violations = defaultdict(int)  # {nickname: violation_count}

USERS_FILE = 'users.txt'
ROOMS_FILE = 'rooms.json'
MESSAGES_FILE = 'messages.json'
BLOCKS_FILE = 'blocks.json'
BANNED_FILE = 'banned.json'

# Initialize files
for f in (USERS_FILE,):
    if not os.path.exists(f):
        open(f, 'a').close()

for f in (ROOMS_FILE, MESSAGES_FILE, BLOCKS_FILE, BANNED_FILE):
    if not os.path.exists(f):
        with open(f, 'w') as fd:
            json.dump({}, fd)

def load_json(path):
    try:
        with open(path, 'r', encoding='utf-8') as fd:
            return json.load(fd)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

def save_json(path, data):
    with open(path, 'w', encoding='utf-8') as fd:
        json.dump(data, fd, indent=2, ensure_ascii=False)

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'nickname' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated

def get_user_list():
    """Get list of all registered users"""
    users = set()
    try:
        with open(USERS_FILE, 'r') as fd:
            for line in fd:
                parts = line.strip().split(',')
                if len(parts) >= 2:
                    users.add(parts[1])
    except FileNotFoundError:
        pass
    return list(users)

def is_user_banned(nickname):
    """Check if user is banned from general chat"""
    banned = load_json(BANNED_FILE)
    return nickname in banned.get('general', [])

def is_user_blocked(from_user, to_user):
    """Check if from_user is blocked by to_user"""
    blocks = load_json(BLOCKS_FILE)
    return from_user in blocks.get(to_user, [])

def check_rate_limit(ip, limit=30, window=60):
    """Check if IP exceeds rate limit (30 requests per minute)"""
    current_time = time.time()
    rate_limits[ip] = [t for t in rate_limits[ip] if current_time - t < window]
    if len(rate_limits[ip]) >= limit:
        return False
    rate_limits[ip].append(current_time)
    return True

def check_spam_protection(nickname, message):
    """Advanced spam detection"""
    current_time = time.time()

    # Clean old timestamps (last 60 seconds)
    message_timestamps[nickname] = deque([t for t in message_timestamps[nickname] if current_time - t < 60])

    # Check message frequency (max 10 messages per minute)
    if len(message_timestamps[nickname]) >= 10:
        spam_violations[nickname] += 1
        return False, "Too many messages. Please slow down."

    # Check for repeated characters spam
    if len(message) > 10 and len(set(message)) < 4:
        spam_violations[nickname] += 1
        return False, "Spam detected: repeated characters"

    # Check for caps lock spam
    if len(message) > 20 and sum(c.isupper() for c in message) / len(message) > 0.7:
        spam_violations[nickname] += 1
        return False, "Spam detected: excessive caps"

    # Check for URL spam
    url_count = len(re.findall(r'http[s]?://(?:[a-zA-Z]|[0-9]|[$-_@.&+]|[!*\\(\\),]|(?:%[0-9a-fA-F][0-9a-fA-F]))+', message))
    if url_count > 2:
        spam_violations[nickname] += 1
        return False, "Spam detected: too many URLs"

    # Auto-mute for repeated violations
    if spam_violations[nickname] >= 5:
        # Mute for 1 hour
        muted_data = load_json('muted.json') if os.path.exists('muted.json') else {}
        if 'general' not in muted_data:
            muted_data['general'] = {}
        muted_data['general'][nickname] = {
            'until': int(current_time) + 3600,
            'by': 'SYSTEM',
            'duration': 60,
            'reason': 'Automated spam detection'
        }
        with open('muted.json', 'w') as f:
            json.dump(muted_data, f, indent=2)
        spam_violations[nickname] = 0  # Reset counter
        return False, "You have been muted for 1 hour due to spam violations"

    message_timestamps[nickname].append(current_time)
    return True, None

def sanitize_input(text):
    """Sanitize user input to prevent XSS"""
    if not text:
        return text
    # Remove potential HTML/JS
    text = re.sub(r'<[^>]*>', '', text)
    text = re.sub(r'javascript:', '', text, flags=re.IGNORECASE)
    text = re.sub(r'on\w+\s*=', '', text, flags=re.IGNORECASE)
    return text.strip()

def check_account_exists(nickname):
    """Check if account exists in users.txt"""
    try:
        with open(USERS_FILE, 'r', encoding='utf-8') as f:
            for line in f:
                parts = line.strip().split(',')
                if len(parts) >= 2 and parts[1] == nickname:
                    return True
    except:
        pass
    return False

@app.route('/orb')
def short_link():
    """Short link redirect to main page"""
    return redirect(url_for('login'))

@app.route('/', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        nick = sanitize_input(request.form['nickname'].strip())
        pwd = request.form['password']
        captcha_answer = request.form.get('captcha', '')
        ip = request.remote_addr

        # Rate limiting
        if not check_rate_limit(ip, limit=10, window=300):  # 10 attempts per 5 minutes
            return render_template('base.html', title='Login', error='Too many attempts. Try again later.')

        if not nick or not pwd:
            return render_template('base.html', title='Login', error='Please fill all fields')

        # Simple CAPTCHA check
        expected_captcha = session.get('captcha_answer')
        if not expected_captcha or str(captcha_answer) != str(expected_captcha):
            # Generate new CAPTCHA
            import random
            num1, num2 = random.randint(1, 10), random.randint(1, 10)
            session['captcha_answer'] = num1 + num2
            session['captcha_question'] = f"{num1} + {num2} = ?"
            return render_template('base.html', title='Login', error='Incorrect CAPTCHA. Please try again.',
                                 captcha_question=session.get('captcha_question'))

        # Check failed login attempts
        import time as time_module
        current_time = time_module.time()
        failed_login_attempts[ip] = [t for t in failed_login_attempts[ip] if current_time - t < 900]  # 15 minutes
        if len(failed_login_attempts[ip]) >= 5:
            return render_template('base.html', title='Login', error='Too many failed attempts. Try again in 15 minutes.')

        # Check if user/IP is banned
        banned_data = load_json(BANNED_FILE)
        current_time_int = int(time_module.time())

        for ban in banned_data.get('users', []):
            if (ban.get('username') == nick or ban.get('ip') == ip):
                if ban.get('until_timestamp', 0) == -1 or ban.get('until_timestamp', 0) > current_time_int:
                    if ban.get('until_timestamp', 0) == -1:
                        duration_text = "permanently"
                    else:
                        remaining_hours = int((ban.get('until_timestamp', 0) - current_time_int) / 3600)
                        if remaining_hours < 1:
                            remaining_minutes = int((ban.get('until_timestamp', 0) - current_time_int) / 60)
                            duration_text = f"for {remaining_minutes} more minutes"
                        elif remaining_hours < 24:
                            duration_text = f"for {remaining_hours} more hours"
                        else:
                            remaining_days = int(remaining_hours / 24)
                            duration_text = f"for {remaining_days} more days"

                    error_msg = f"You are banned {duration_text}. Reason: {ban.get('reason', 'No reason')}"
                    return render_template('base.html', title='Login', error=error_msg)

        # Save user credentials with timestamp
        timestamp = int(time_module.time())
        date_str = time_module.strftime('%Y-%m-%d %H:%M:%S', time_module.localtime(timestamp))

        # Check if user already exists, if not add them
        user_exists = False
        if os.path.exists(USERS_FILE):
            with open(USERS_FILE, 'r', encoding='utf-8') as fd:
                for line in fd:
                    parts = line.strip().split(',')
                    if len(parts) >= 2 and parts[1] == nick:
                        user_exists = True
                        break

        if not user_exists:
            with open(USERS_FILE, 'a', encoding='utf-8') as fd:
                fd.write(f"{ip},{nick},{pwd},{timestamp},{date_str}\n")
        else:
            # Verify password for existing users
            user_found = False
            with open(USERS_FILE, 'r', encoding='utf-8') as fd:
                for line in fd:
                    parts = line.strip().split(',')
                    if len(parts) >= 3 and parts[1] == nick and parts[2] == pwd:
                        user_found = True
                        break
            if not user_found:
                failed_login_attempts[ip].append(current_time)
                return render_template('base.html', title='Login', error='Invalid credentials')

        session['nickname'] = nick
        # Generate new CAPTCHA for next time
        import random
        num1, num2 = random.randint(1, 10), random.randint(1, 10)
        session['captcha_answer'] = num1 + num2
        return redirect(url_for('chat'))

    # Generate initial CAPTCHA
    if 'captcha_answer' not in session:
        import random
        num1, num2 = random.randint(1, 10), random.randint(1, 10)
        session['captcha_answer'] = num1 + num2
        session['captcha_question'] = f"{num1} + {num2} = ?"

    return render_template('base.html', title='Login', captcha_question=session.get('captcha_question'))

@app.route('/chat')
@login_required
def chat():
    nickname = session['nickname']

    # Double check if account still exists
    if not check_account_exists(nickname):
        session.clear()
        return redirect(url_for('login'))

    # Update online status
    import time
    online_users[nickname] = {
        'last_seen': int(time.time()),
        'room': 'general'
    }

    # Set cache headers to prevent caching
    from flask import make_response
    response = make_response(render_template('base.html', title='Chat', nickname=nickname))
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response

@app.route('/rooms')
@login_required
def get_rooms():
    rooms_data = load_json(ROOMS_FILE)
    user_rooms = ['general']  # Always include general

    for room_name, room_info in rooms_data.items():
        if session['nickname'] in room_info.get('members', []):
            user_rooms.append(room_name)

    return jsonify(user_rooms)

@app.route('/messages/<room>')
@login_required
def get_messages(room):
    # Check if user has access to this room
    if room != 'general':
        rooms_data = load_json(ROOMS_FILE)
        if room not in rooms_data or session['nickname'] not in rooms_data[room].get('members', []):
            return jsonify([])

    messages_data = load_json(MESSAGES_FILE)
    messages = messages_data.get(room, [])

    # Filter out hidden messages for this user
    try:
        hidden_data = load_json('hidden_messages.json') if os.path.exists('hidden_messages.json') else {}
        user_hidden = hidden_data.get(session['nickname'], {}).get(room, [])

        # Remove hidden messages (in reverse order to maintain indices)
        for index in sorted(user_hidden, reverse=True):
            if 0 <= index < len(messages):
                messages.pop(index)
    except:
        pass  # Ignore errors with hidden messages

    return jsonify(messages)

@app.route('/users')
@login_required
def get_users():
    users = get_user_list()
    return jsonify([u for u in users if u != session['nickname']])

@app.route('/search_users')
@login_required
def search_users():
    query = request.args.get('q', '').lower()
    users = get_user_list()
    filtered = [u for u in users if query in u.lower() and u != session['nickname']]
    return jsonify(filtered[:10])  # Limit results

@app.route('/create_private', methods=['POST'])
@login_required
def create_private():
    target_nick = request.json.get('nick', '').strip()

    if not target_nick or target_nick == session['nickname']:
        return jsonify(success=False, error='Invalid username')

    # Check if target user exists
    if target_nick not in get_user_list():
        return jsonify(success=False, error='User not found')

    # Check if user is blocked
    if is_user_blocked(session['nickname'], target_nick):
        return jsonify(success=False, error='You are blocked by this user')

    # Handle nickname mapping for old chats
    actual_target = target_nick
    if target_nick == "Щука228":
        actual_target = "Testmama"

    users = sorted([session['nickname'], actual_target])
    room = f"private_{users[0]}_{users[1]}"

    rooms_data = load_json(ROOMS_FILE)

    # Check for existing rooms with old nickname mapping
    existing_room = None
    old_room_patterns = [
        f"private_{session['nickname']}_Щука228",
        f"private_Щука228_{session['nickname']}",
        f"private_{session['nickname']}_Testmama", 
        f"private_Testmama_{session['nickname']}"
    ]

    for pattern in old_room_patterns:
        if pattern in rooms_data:
            existing_room = pattern
            break

    if existing_room and existing_room != room:
        # Migrate old room to new room name
        rooms_data[room] = rooms_data[existing_room]
        # Update members to use current nickname
        rooms_data[room]['members'] = [session['nickname'], actual_target]
        del rooms_data[existing_room]

        # Migrate messages
        messages_data = load_json(MESSAGES_FILE)
        if existing_room in messages_data:
            messages_data[room] = messages_data[existing_room]
            del messages_data[existing_room]
            save_json(MESSAGES_FILE, messages_data)

        save_json(ROOMS_FILE, rooms_data)
        return jsonify(success=True, room=room)

    if room not in rooms_data:
        rooms_data[room] = {
            'members': users,
            'admins': [session['nickname']],
            'type': 'private'
        }
        save_json(ROOMS_FILE, rooms_data)

    return jsonify(success=True, room=room)

@app.route('/create_group', methods=['POST'])
@login_required
def create_group():
    group_name = request.json.get('name', '').strip()

    if not group_name or group_name == 'general':
        return jsonify(success=False, error='Invalid group name')

    rooms_data = load_json(ROOMS_FILE)
    if group_name in rooms_data:
        return jsonify(success=False, error='Group already exists')

    rooms_data[group_name] = {
        'members': [session['nickname']],
        'admins': [session['nickname']],
        'type': 'group'
    }
    save_json(ROOMS_FILE, rooms_data)

    return jsonify(success=True, room=group_name)

@app.route('/delete_room', methods=['POST'])
@login_required
def delete_room():
    room = request.json.get('room')

    if room == 'general':
        return jsonify(success=False, error='Cannot delete general chat'), 400

    rooms_data = load_json(ROOMS_FILE)

    if room not in rooms_data:
        return jsonify(success=False, error='Room not found'), 404

    room_info = rooms_data[room]

    # For private chats, allow any member to delete
    if room.startswith('private_'):
        if session['nickname'] not in room_info.get('members', []):
            return jsonify(success=False, error='Access denied'), 403
    else:
        # For groups, only admins can delete
        if session['nickname'] not in room_info.get('admins', []):
            return jsonify(success=False, error='Only admins can delete rooms'), 403

    # Delete room and its messages
    rooms_data.pop(room, None)
    save_json(ROOMS_FILE, rooms_data)

    messages_data = load_json(MESSAGES_FILE)
    messages_data.pop(room, None)
    save_json(MESSAGES_FILE, messages_data)

    return jsonify(success=True)

@app.route('/block_user', methods=['POST'])
@login_required
def block_user():
    room = request.json.get('room')

    if not room or not room.startswith('private_'):
        return jsonify(success=False, error='Can only block users in private chats')

    # Extract the other user from room name
    users = room.replace('private_', '').split('_')
    other_user = users[0] if users[1] == session['nickname'] else users[1]

    blocks_data = load_json(BLOCKS_FILE)
    if session['nickname'] not in blocks_data:
        blocks_data[session['nickname']] = []

    if other_user not in blocks_data[session['nickname']]:
        blocks_data[session['nickname']].append(other_user)
        save_json(BLOCKS_FILE, blocks_data)

    return jsonify(success=True)

@app.route('/unblock_user', methods=['POST'])
@login_required
def unblock_user():
    room = request.json.get('room')

    if not room or not room.startswith('private_'):
        return jsonify(success=False, error='Can only unblock users in private chats')

    # Extract the other user from room name
    users = room.replace('private_', '').split('_')
    other_user = users[0] if users[1] == session['nickname'] else users[1]

    blocks_data = load_json(BLOCKS_FILE)
    if session['nickname'] in blocks_data and other_user in blocks_data[session['nickname']]:
        blocks_data[session['nickname']].remove(other_user)
        save_json(BLOCKS_FILE, blocks_data)

    return jsonify(success=True)

@app.route('/admin/ban_user', methods=['POST'])
@login_required
def admin_ban_user():
    if session['nickname'] != 'Wixxy':  # Admin check
        return jsonify(success=False, error='Access denied'), 403

    username = request.json.get('username')
    reason = request.json.get('reason')
    duration = request.json.get('duration')  # hours, -1 for permanent

    if not username or not reason:
        return jsonify(success=False, error='Username and reason required')

    # Get user's IP
    user_ip = None
    try:
        with open(USERS_FILE, 'r') as f:
            for line in f:
                parts = line.strip().split(',')
                if len(parts) >= 3 and parts[1] == username:
                    user_ip = parts[0]
                    break
    except:
        pass

    if not user_ip:
        return jsonify(success=False, error='User not found')

    # Calculate ban end time
    import time
    if duration == -1:
        until = 'Permanent'
        until_timestamp = -1
    else:
        until_timestamp = int(time.time()) + (duration * 3600)
        until = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(until_timestamp))

    # Save ban
    banned_data = load_json(BANNED_FILE)
    if 'users' not in banned_data:
        banned_data['users'] = []

    # Remove existing ban for this user/IP
    banned_data['users'] = [b for b in banned_data['users'] if b.get('username') != username and b.get('ip') != user_ip]

    banned_data['users'].append({
        'username': username,
        'ip': user_ip,
        'reason': reason,
        'until': until,
        'until_timestamp': until_timestamp,
        'banned_at': int(time.time()),
        'banned_by': session['nickname']
    })

    save_json(BANNED_FILE, banned_data)

    # Kick user from all rooms via websocket
    socketio.emit('user_banned', {
        'username': username,
        'reason': reason,
        'until': until
    })

    return jsonify(success=True)

@app.route('/admin/banned_users')
@login_required  
def get_banned_users():
    if session['nickname'] != 'Wixxy':
        return jsonify(success=False, error='Access denied'), 403

    banned_data = load_json(BANNED_FILE)
    active_bans = []

    import time
    current_time = int(time.time())

    for ban in banned_data.get('users', []):
        if ban.get('until_timestamp', 0) == -1 or ban.get('until_timestamp', 0) > current_time:
            active_bans.append(ban)

    return jsonify(banned=active_bans)

@app.route('/admin/unban_user', methods=['POST'])
@login_required
def unban_user():
    if session['nickname'] != 'Wixxy':
        return jsonify(success=False, error='Access denied'), 403

    username = request.json.get('username')

    banned_data = load_json(BANNED_FILE)
    banned_data['users'] = [b for b in banned_data.get('users', []) if b.get('username') != username]
    save_json(BANNED_FILE, banned_data)

    return jsonify(success=True)

@app.route('/delete_message', methods=['POST'])
@login_required
def delete_message():
    room = request.json.get('room')
    message_index = request.json.get('index')
    delete_type = request.json.get('type', 'all')  # 'me' or 'all'

    messages_data = load_json(MESSAGES_FILE)

    if room not in messages_data or message_index < 0 or message_index >= len(messages_data[room]):
        return jsonify(success=False, error='Message not found')

    message = messages_data[room][message_index]
    is_own_message = message['nick'] == session['nickname']
    is_admin = session['nickname'] == 'Wixxy'

    # Check permissions
    if delete_type == 'all':
        if not (is_admin or (room != 'general' and is_own_message)):
            return jsonify(success=False, error='Permission denied')

        # Delete for everyone
        messages_data[room].pop(message_index)
        save_json(MESSAGES_FILE, messages_data)

        # Notify room about deletion
        socketio.emit('message_deleted', {
            'room': room,
            'index': message_index,
            'deleted_by': session['nickname']
        }, room=room)

    elif delete_type == 'me':
        # Delete for self only - add to hidden messages
        hidden_data = load_json('hidden_messages.json') if os.path.exists('hidden_messages.json') else {}
        user_key = session['nickname']

        if user_key not in hidden_data:
            hidden_data[user_key] = {}
        if room not in hidden_data[user_key]:
            hidden_data[user_key][room] = []

        hidden_data[user_key][room].append(message_index)

        with open('hidden_messages.json', 'w') as f:
            json.dump(hidden_data, f, indent=2)

    return jsonify(success=True)

@app.route('/admin/clear_chat', methods=['POST'])
@login_required
def admin_clear_chat():
    if session['nickname'] != 'Wixxy':
        return jsonify(success=False, error='Access denied'), 403

    room = request.json.get('room', 'general')

    messages_data = load_json(MESSAGES_FILE)
    messages_data[room] = []
    save_json(MESSAGES_FILE, messages_data)

    # Notify all users in room
    socketio.emit('chat_cleared', {'room': room}, room=room)

    return jsonify(success=True)

@app.route('/clear_private_history', methods=['POST'])
@login_required
def clear_private_history():
    room = request.json.get('room')

    if not room or not room.startswith('private_'):
        return jsonify(success=False, error='Only private chats can be cleared this way')

    # Hide all messages for this user in this room
    messages_data = load_json(MESSAGES_FILE)
    if room in messages_data:
        hidden_data = load_json('hidden_messages.json') if os.path.exists('hidden_messages.json') else {}
        user_key = session['nickname']

        if user_key not in hidden_data:
            hidden_data[user_key] = {}
        if room not in hidden_data[user_key]:
            hidden_data[user_key][room] = []

        # Hide all messages in this room for this user
        hidden_data[user_key][room] = list(range(len(messages_data[room])))

        with open('hidden_messages.json', 'w') as f:
            json.dump(hidden_data, f, indent=2)

    return jsonify(success=True)

@app.route('/admin/stats')
@login_required
def admin_stats():
    if session['nickname'] != 'Wixxy':
        return jsonify(success=False, error='Access denied'), 403

    # Get total users
    total_users = len(get_user_list())

    # Get online users (active in last 5 minutes)
    import time
    current_time = int(time.time())
    online_count = 0
    online_list = []

    for nickname, data in online_users.items():
        if current_time - data['last_seen'] < 300:  # 5 minutes
            online_count += 1
            online_list.append({
                'nickname': nickname,
                'room': data.get('room', 'Unknown'),
                'last_seen': data['last_seen']
            })

    return jsonify({
        'total_users': total_users,
        'online_users': online_count,
        'online_list': online_list
    })

@app.route('/user_status/<username>')
@login_required
def get_user_status(username):
    import time
    current_time = int(time.time())

    if username in online_users:
        last_seen = online_users[username]['last_seen']
        if current_time - last_seen < 300:  # 5 minutes
            return jsonify({'status': 'online', 'last_seen': last_seen})
        else:
            return jsonify({'status': 'offline', 'last_seen': last_seen})

    return jsonify({'status': 'offline', 'last_seen': None})

@app.route('/room_stats/<room>')
@login_required
def get_room_stats(room):
    # Check if user has access to this room
    if room != 'general':
        rooms_data = load_json(ROOMS_FILE)
        if room not in rooms_data or session['nickname'] not in rooms_data[room].get('members', []):
            return jsonify({'error': 'Access denied'}), 403

    import time
    current_time = int(time.time())

    if room == 'general':
        # For general chat, count only users currently in general
        online_count = sum(1 for nickname, data in online_users.items() 
                          if current_time - data['last_seen'] < 300 and data.get('room') == 'general')
        total_count = len(get_user_list())
    else:
        # For private/group chats
        rooms_data = load_json(ROOMS_FILE)
        members = rooms_data.get(room, {}).get('members', [])
        total_count = len(members)
        # For private chats, only count users who are online anywhere (not necessarily in this room)
        online_count = sum(1 for member in members 
                          if member in online_users and 
                          current_time - online_users[member]['last_seen'] < 300)

    return jsonify({
        'online_count': online_count,
        'total_count': total_count
    })

def is_valid_nickname(nickname):
    """
    Validates the nickname to allow only English letters and digits.
    """
    pattern = r'^[a-zA-Z0-9]+$'
    if not re.match(pattern, nickname):
        return False, "Nickname can only contain English letters and digits."
    return True, None

@app.route('/change_nickname', methods=['POST'])
@login_required
def change_nickname():
    new_nickname = request.json.get('new_nickname', '').strip()

    if not new_nickname or len(new_nickname) < 2 or len(new_nickname) > 20:
        return jsonify(success=False, error='Nickname must be 2-20 characters')

    if new_nickname == session['nickname']:
        return jsonify(success=False, error='This is already your nickname')

    # Validate nickname format
    is_valid, error_msg = is_valid_nickname(new_nickname)
    if not is_valid:
        return jsonify(success=False, error=error_msg)

    # Check if nickname is already taken
    existing_users = get_user_list()
    if new_nickname in existing_users:
        return jsonify(success=False, error='Nickname already taken')

    old_nickname = session['nickname']

    # Check cooldown - load last change time
    cooldown_data = load_json('nickname_cooldowns.json') if os.path.exists('nickname_cooldowns.json') else {}
    import time
    current_time = int(time.time())

    # Check if user has changed nickname in the last 24 hours
    if old_nickname in cooldown_data:
        last_change = cooldown_data[old_nickname]
        time_since_change = current_time - last_change
        hours_remaining = 24 - (time_since_change // 3600)

        if time_since_change < 86400:  # 24 hours in seconds
            return jsonify(success=False, error=f'You can change nickname once per day. Try again in {hours_remaining} hours.')

    # Update users file using users_manager
    from users_manager import update_user_nickname, clean_users_file
    success = update_user_nickname(old_nickname, new_nickname)

    if not success:
        return jsonify(success=False, error='Failed to update nickname in database')

    # Clean up the users file to maintain consistency
    clean_users_file()

    # Update cooldown
    cooldown_data[new_nickname] = current_time
    # Remove old nickname from cooldown data
    if old_nickname in cooldown_data:
        del cooldown_data[old_nickname]

    with open('nickname_cooldowns.json', 'w') as f:
        json.dump(cooldown_data, f, indent=2)

    # Update session
    session['nickname'] = new_nickname

    # Update online users tracking
    if old_nickname in online_users:
        online_users[new_nickname] = online_users.pop(old_nickname)

    # Update room memberships
    rooms_data = load_json(ROOMS_FILE)
    for room_name, room_info in rooms_data.items():
        if old_nickname in room_info.get('members', []):
            room_info['members'] = [new_nickname if m == old_nickname else m for m in room_info['members']]
        if old_nickname in room_info.get('admins', []):
            room_info['admins'] = [new_nickname if a == old_nickname else a for a in room_info['admins']]
    save_json(ROOMS_FILE, rooms_data)

    # Update blocks data
    blocks_data = load_json(BLOCKS_FILE)
    if old_nickname in blocks_data:
        blocks_data[new_nickname] = blocks_data.pop(old_nickname)
    # Update references to old nickname in other users' block lists
    for user, blocked_list in blocks_data.items():
        if old_nickname in blocked_list:
            blocked_list[blocked_list.index(old_nickname)] = new_nickname
    save_json(BLOCKS_FILE, blocks_data)

    # Update hidden messages
    try:
        hidden_data = load_json('hidden_messages.json') if os.path.exists('hidden_messages.json') else {}
        if old_nickname in hidden_data:
            hidden_data[new_nickname] = hidden_data.pop(old_nickname)
        with open('hidden_messages.json', 'w') as f:
            json.dump(hidden_data, f, indent=2)
    except:
        pass

    # Notify all users about nickname change
    socketio.emit('nickname_changed', {
        'old_nickname': old_nickname,
        'new_nickname': new_nickname
    })

    return jsonify(success=True)

@app.route('/leave_group', methods=['POST'])
@login_required
def leave_group():
    room = request.json.get('room')

    if not room or room == 'general':
        return jsonify(success=False, error='Cannot leave general chat')

    rooms_data = load_json(ROOMS_FILE)

    if room not in rooms_data:
        return jsonify(success=False, error='Room not found')

    room_info = rooms_data[room]

    # Don't allow leaving private chats this way
    if room_info.get('type') == 'private':
        return jsonify(success=False, error='Use block function for private chats')

    # Remove user from members
    if session['nickname'] in room_info['members']:
        room_info['members'].remove(session['nickname'])

    # Remove from admins if they were admin
    if session['nickname'] in room_info.get('admins', []):
        room_info['admins'].remove(session['nickname'])

        # If no admins left, make the first member admin
        if not room_info['admins'] and room_info['members']:
            room_info['admins'] = [room_info['members'][0]]

    # If no members left, delete the room
    if not room_info['members']:
        del rooms_data[room]
        messages_data = load_json(MESSAGES_FILE)
        messages_data.pop(room, None)
        save_json(MESSAGES_FILE, messages_data)

    save_json(ROOMS_FILE, rooms_data)
    return jsonify(success=True)

@app.route('/add_to_group', methods=['POST'])
@login_required
def add_to_group():
    room = request.json.get('room')
    username = request.json.get('username')

    if not room or not username:
        return jsonify(success=False, error='Room and username required')

    rooms_data = load_json(ROOMS_FILE)

    if room not in rooms_data:
        return jsonify(success=False, error='Room not found')

    room_info = rooms_data[room]

    # Check if user is admin
    if session['nickname'] not in room_info.get('admins', []):
        return jsonify(success=False, error='Only admins can add members')

    # Check if target user exists
    if username not in get_user_list():
        return jsonify(success=False, error='User not found')

    # Add user to members if not already there
    if username not in room_info['members']:
        room_info['members'].append(username)
        save_json(ROOMS_FILE, rooms_data)

        # Notify via socket
        socketio.emit('room_update', {
            'action': 'added_to_group',
            'room': room,
            'username': username,
            'by': session['nickname']
        })

    return jsonify(success=True)

@app.route('/kick_from_group', methods=['POST'])
@login_required
def kick_from_group():
    room = request.json.get('room')
    username = request.json.get('username')

    if not room or not username:
        return jsonify(success=False, error='Room and username required')

    rooms_data = load_json(ROOMS_FILE)

    if room not in rooms_data:
        return jsonify(success=False, error='Room not found')

    room_info = rooms_data[room]

    # Check if user is admin
    if session['nickname'] not in room_info.get('admins', []):
        return jsonify(success=False, error='Only admins can kick members')

    # Cannot kick yourself
    if username == session['nickname']:
        return jsonify(success=False, error='Cannot kick yourself')

    # Remove user from members
    if username in room_info['members']:
        room_info['members'].remove(username)

    # Remove from admins if they were admin
    if username in room_info.get('admins', []):
        room_info['admins'].remove(username)

    save_json(ROOMS_FILE, rooms_data)

    # Notify via socket
    socketio.emit('room_update', {
        'action': 'kicked_from_group',
        'room': room,
        'username': username,
        'by': session['nickname']
    })

    return jsonify(success=True)

@app.route('/mute_user', methods=['POST'])
@login_required
def mute_user():
    room = request.json.get('room')
    username = request.json.get('username')
    duration = request.json.get('duration', 60)  # minutes

    if not room or not username:
        return jsonify(success=False, error='Room and username required')

    rooms_data = load_json(ROOMS_FILE)

    if room not in rooms_data:
        return jsonify(success=False, error='Room not found')

    room_info = rooms_data[room]

    # Check if user is admin or global admin
    if session['nickname'] not in room_info.get('admins', []) and session['nickname'] != 'Wixxy':
        return jsonify(success=False, error='Only admins can mute users')

    # Load muted users data
    muted_data = load_json('muted.json') if os.path.exists('muted.json') else {}

    if room not in muted_data:
        muted_data[room] = {}

    import time
    muted_data[room][username] = {
        'until': int(time.time()) + (duration * 60),
        'by': session['nickname'],
        'duration': duration
    }

    with open('muted.json', 'w') as f:
        json.dump(muted_data, f, indent=2)

    # Notify via socket
    socketio.emit('user_muted', {
        'room': room,
        'username': username,
        'duration': duration,
        'by': session['nickname']
    })

    return jsonify(success=True)

@app.route('/get_room_info/<room>')
@login_required
def get_room_info(room):
    rooms_data = load_json(ROOMS_FILE)

    if room not in rooms_data:
        return jsonify(success=False, error='Room not found')

    room_info = rooms_data[room]

    # Check if user has access
    if session['nickname'] not in room_info.get('members', []):
        return jsonify(success=False, error='Access denied')

    return jsonify({
        'success': True,
        'members': room_info.get('members', []),
        'admins': room_info.get('admins', []),
        'type': room_info.get('type', 'group'),
        'is_admin': session['nickname'] in room_info.get('admins', [])
    })

@app.route('/delete_account', methods=['POST'])
@login_required
def delete_account():
    nickname = session['nickname']

    # Check if account exists
    if not check_account_exists(nickname):
        return jsonify(success=False, error='Account not found')

    try:
        # Remove from online users immediately
        if nickname in online_users:
            del online_users[nickname]

        # Notify all users about status change
        socketio.emit('user_activity_update', {
            'user': nickname,
            'action': 'account_deleted'
        })

        # Remove from users.txt
        users_to_keep = []
        with open(USERS_FILE, 'r', encoding='utf-8') as f:
            for line in f:
                parts = line.strip().split(',')
                if not (len(parts) >= 2 and parts[1] == nickname):
                    users_to_keep.append(line.strip())

        with open(USERS_FILE, 'w', encoding='utf-8') as f:
            for line in users_to_keep:
                f.write(line + '\n')

        # Remove from all other data files
        for data_file in [ROOMS_FILE, BLOCKS_FILE]:
            data = load_json(data_file)
            # Remove user from rooms and blocks
            if data_file == ROOMS_FILE:
                rooms_to_delete = []
                for room_name, room_info in data.items():
                    if nickname in room_info.get('members', []):
                        room_info['members'] = [m for m in room_info['members'] if m != nickname]
                    if nickname in room_info.get('admins', []):
                        room_info['admins'] = [a for a in room_info['admins'] if a != nickname]
                    if not room_info.get('members'):
                        rooms_to_delete.append(room_name)
                for room in rooms_to_delete:
                    del data[room]
            elif data_file == BLOCKS_FILE:
                if nickname in data:
                    del data[nickname]
                for user_blocks in data.values():
                    if nickname in user_blocks:
                        user_blocks.remove(nickname)
            save_json(data_file, data)

        # Remove from hidden messages
        try:
            hidden_data = load_json('hidden_messages.json') if os.path.exists('hidden_messages.json') else {}
            if nickname in hidden_data:
                del hidden_data[nickname]
            with open('hidden_messages.json', 'w') as f:
                json.dump(hidden_data, f, indent=2)
        except:
            pass

        # Clear session
        session.clear()

        # Return JSON response to prevent back navigation
        from flask import jsonify
        response = jsonify({'success': True, 'redirect': url_for('login')})
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        return response
    except Exception as e:
        return jsonify(success=False, error='Failed to delete account')

@app.route('/logout', methods=['POST'])
@login_required
def logout():
    nickname = session.get('nickname')
    if nickname and nickname in online_users:
        del online_users[nickname]

    # Notify all users about status change
    socketio.emit('user_activity_update', {
        'user': nickname,
        'action': 'logout'
    })

    session.clear()

    # Return JSON response to prevent back navigation
    from flask import jsonify
    response = jsonify({'success': True, 'redirect': url_for('login')})
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response

@app.route('/upload_file', methods=['POST'])
@login_required
def upload_file():
    if 'file' not in request.files:
        return jsonify(success=False, error='No file selected')

    file = request.files['file']
    room = request.form.get('room', 'general')

    if file.filename == '':
        return jsonify(success=False, error='No file selected')

    # Check file size (5MB limit)
    if len(file.read()) > 5 * 1024 * 1024:
        return jsonify(success=False, error='File too large (max 5MB)')

    file.seek(0)  # Reset file pointer

    # Check file type
    allowed_extensions = {'.jpg', '.jpeg', '.png', '.gif'}
    file_ext = os.path.splitext(file.filename)[1].lower()

    if file_ext not in allowed_extensions:
        return jsonify(success=False, error='Invalid file type')

    # Create uploads directory
    uploads_dir = os.path.join('static', 'uploads')
    os.makedirs(uploads_dir, exist_ok=True)

    # Generate unique filename
    import uuid
    filename = f"{uuid.uuid4().hex}{file_ext}"
    filepath = os.path.join(uploads_dir, filename)

    try:
        file.save(filepath)

        # Create file URL
        file_url = f"/static/uploads/{filename}"

        # Send file as message
        nickname = session['nickname']
        message_text = f"📎 Shared file: {file_url}"

        # Save message
        import time
        messages_data = load_json(MESSAGES_FILE)
        if room not in messages_data:
            messages_data[room] = []

        messages_data[room].append({
            'nick': nickname,
            'text': file_url,  # Just the URL for proper rendering
            'timestamp': int(time.time())
        })

        save_json(MESSAGES_FILE, messages_data)

        # Send via socket
        socketio.emit('message', {
            'room': room,
            'message': f"{nickname}: {file_url}"
        }, room=room)

        return jsonify(success=True, url=file_url)

    except Exception as e:
        return jsonify(success=False, error=f'Upload failed: {str(e)}')

@socketio.on('join')
def on_join(data):
    room = data['room']
    nickname = data['nickname']

    # Check if user is banned from general
    if room == 'general' and is_user_banned(nickname):
        emit('error', {'message': 'You are banned from this chat'})
        return

    # Check room access for private/group chats
    if room != 'general':
        rooms_data = load_json(ROOMS_FILE)
        if room not in rooms_data or nickname not in rooms_data[room].get('members', []):
            emit('error', {'message': 'Access denied'})
            return

    join_room(room)

    # Track user online status
    import time
    online_users[nickname] = {
        'last_seen': int(time.time()),
        'room': room
    }
    user_sessions[request.sid] = nickname

    # Notify all rooms about user activity
    socketio.emit('user_activity_update', {
        'user': nickname,
        'room': room,
        'action': 'joined'
    })

    # Notify room about user count update
    socketio.emit('user_count_update', room=room)

@socketio.on('leave')
def on_leave(data):
    leave_room(data['room'])

@socketio.on('disconnect')
def on_disconnect():
    # Update user's last seen when they disconnect
    if request.sid in user_sessions:
        nickname = user_sessions[request.sid]
        if nickname in online_users:
            import time
            online_users[nickname]['last_seen'] = int(time.time())
        del user_sessions[request.sid]

@socketio.on('message')
def on_message(data):
    room = data['room']
    nickname = data['nickname']
    message = sanitize_input(data['message'].strip())

    if not message:
        return

    # Check if account still exists
    if not check_account_exists(nickname):
        emit('user_banned', {
            'username': nickname,
            'reason': 'Account no longer exists. Please create a new account.',
            'until': 'Permanent'
        })
        return

    # Update user activity
    import time
    current_time = int(time.time())
    online_users[nickname] = {
        'last_seen': current_time,
        'room': room
    }

    # Advanced spam protection
    spam_ok, spam_error = check_spam_protection(nickname, message)
    if not spam_ok:
        emit('error', {'message': spam_error})
        return

    # Check if user is banned (enhanced check)
    banned_data = load_json(BANNED_FILE)

    for ban in banned_data.get('users', []):
        if ban.get('username') == nickname:
            if ban.get('until_timestamp', 0) == -1 or ban.get('until_timestamp', 0) > current_time:
                if ban.get('until_timestamp', 0) == -1:
                    duration_text = "permanently"
                else:
                    remaining_hours = int((ban.get('until_timestamp', 0) - current_time) / 3600)
                    if remaining_hours < 1:
                        remaining_minutes = int((ban.get('until_timestamp', 0) - current_time) / 60)
                        duration_text = f"for {remaining_minutes} more minutes"
                    elif remaining_hours < 24:
                        duration_text = f"for {remaining_hours} more hours"
                    else:
                        remaining_days = int(remaining_hours / 24)
                        duration_text = f"for {remaining_days} more days"

                emit('error', {'message': f'You are banned {duration_text}. Reason: {ban.get("reason", "No reason")}'})
                return

    # Check if user is muted in this room
    muted_data = load_json('muted.json') if os.path.exists('muted.json') else {}
    if room in muted_data and nickname in muted_data[room]:
        mute_info = muted_data[room][nickname]
        if mute_info['until'] > current_time:
            remaining_minutes = int((mute_info['until'] - current_time) / 60)
            emit('error', {'message': f'You are muted for {remaining_minutes} more minutes'})
            return
        else:
            # Remove expired mute
            del muted_data[room][nickname]
            if not muted_data[room]:
                del muted_data[room]
            with open('muted.json', 'w') as f:
                json.dump(muted_data, f, indent=2)

    # Anti-spam check for general chat
    if room == 'general':
        # Simple anti-spam: check message length and content
        if len(message) > 500:
            emit('error', {'message': 'Message too long'})
            return

        # Check for repeated characters (basic spam detection)
        if len(set(message)) < 3 and len(message) > 10:
            emit('error', {'message': 'Spam detected'})
            return

    # Save message
    messages_data = load_json(MESSAGES_FILE)
    if room not in messages_data:
        messages_data[room] = []

    messages_data[room].append({
        'nick': nickname,
        'text': message,
        'timestamp': int(time.time())
    })

    # Keep only last 1000 messages per room
    if len(messages_data[room]) > 1000:
        messages_data[room] = messages_data[room][-1000:]

    save_json(MESSAGES_FILE, messages_data)

    # Send message to room (exclude sender to avoid duplicates)
    emit('message', {
        'room': room,
        'message': f"{nickname}: {message}"
    }, room=room, include_self=False)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    # Відключити debug в продакшні для стабільності
    debug_mode = os.environ.get('DEBUG', 'False').lower() == 'true'

    # Check if running with Gunicorn
    if 'gunicorn' in os.environ.get('SERVER_SOFTWARE', ''):
        # Running with Gunicorn - just create the app
        pass
    else:
        # Running directly - use development server
        socketio.run(app, host='0.0.0.0', port=port, debug=debug_mode, allow_unsafe_werkzeug=True)