
#!/usr/bin/env python
import os
import json
from functools import wraps
from flask import Flask, render_template, request, redirect, session, url_for, jsonify
from flask_socketio import SocketIO, join_room, leave_room, send, emit

app = Flask(__name__, static_folder='static', template_folder='templates')
app.secret_key = os.environ.get('SECRET_KEY', 'fallback-secret-key-for-development')
socketio = SocketIO(app, cors_allowed_origins="*")

# Track online users
online_users = {}  # {nickname: {'last_seen': timestamp, 'room': current_room}}
user_sessions = {}  # {session_id: nickname}

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

@app.route('/orb')
def short_link():
    """Short link redirect to main page"""
    return redirect(url_for('login'))

@app.route('/', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        nick = request.form['nickname'].strip()
        pwd = request.form['password']
        ip = request.remote_addr
        
        if not nick or not pwd:
            return render_template('base.html', title='Login', error='Please fill all fields')
        
        # Check if user/IP is banned
        banned_data = load_json(BANNED_FILE)
        import time
        current_time = int(time.time())
        
        for ban in banned_data.get('users', []):
            if (ban.get('username') == nick or ban.get('ip') == ip):
                if ban.get('until_timestamp', 0) == -1 or ban.get('until_timestamp', 0) > current_time:
                    error_msg = f"You are banned. Reason: {ban.get('reason', 'No reason')}. Until: {ban.get('until', 'Permanent')}"
                    return render_template('base.html', title='Login', error=error_msg)
        
        # Save user credentials with timestamp
        import time
        timestamp = int(time.time())
        date_str = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(timestamp))
        
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
        
        session['nickname'] = nick
        return redirect(url_for('chat'))
    
    return render_template('base.html', title='Login')

@app.route('/chat')
@login_required
def chat():
    return render_template('base.html', title='Chat', nickname=session['nickname'])

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
    
    users = sorted([session['nickname'], target_nick])
    room = f"private_{users[0]}_{users[1]}"
    
    rooms_data = load_json(ROOMS_FILE)
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
    
    # Check if user is admin
    if session['nickname'] not in rooms_data[room].get('admins', []):
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
        online_count = sum(1 for member in members 
                          if member in online_users and 
                          current_time - online_users[member]['last_seen'] < 300 and
                          online_users[member].get('room') == room)
    
    return jsonify({
        'online_count': online_count,
        'total_count': total_count
    })

@app.route('/change_nickname', methods=['POST'])
@login_required
def change_nickname():
    new_nickname = request.json.get('new_nickname', '').strip()
    
    if not new_nickname or len(new_nickname) < 2 or len(new_nickname) > 20:
        return jsonify(success=False, error='Nickname must be 2-20 characters')
    
    if new_nickname == session['nickname']:
        return jsonify(success=False, error='This is already your nickname')
    
    # Check if nickname is already taken
    existing_users = get_user_list()
    if new_nickname in existing_users:
        return jsonify(success=False, error='Nickname already taken')
    
    old_nickname = session['nickname']
    
    # Update users file
    import time
    timestamp = int(time.time())
    date_str = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(timestamp))
    ip = request.remote_addr
    
    # Read existing users and update the one with old nickname
    users_data = []
    if os.path.exists(USERS_FILE):
        with open(USERS_FILE, 'r', encoding='utf-8') as f:
            for line in f:
                if line.startswith('#'):
                    continue
                parts = line.strip().split(',')
                if len(parts) >= 3:
                    if parts[1] == old_nickname:
                        # Update this user's nickname
                        users_data.append(f"{ip},{new_nickname},{parts[2]},{timestamp},{date_str}")
                    else:
                        users_data.append(line.strip())
    
    # Write back to file
    with open(USERS_FILE, 'w', encoding='utf-8') as f:
        f.write("# IP,Username,Password,Timestamp,Date\n")
        for user_data in users_data:
            f.write(user_data + "\n")
    
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
    
    return jsonify(success=True)

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
    message = data['message'].strip()
    
    if not message:
        return
    
    # Update user activity
    import time
    current_time = int(time.time())
    online_users[nickname] = {
        'last_seen': current_time,
        'room': room
    }
    
    # Check if user is banned (enhanced check)
    banned_data = load_json(BANNED_FILE)
    
    for ban in banned_data.get('users', []):
        if ban.get('username') == nickname:
            if ban.get('until_timestamp', 0) == -1 or ban.get('until_timestamp', 0) > current_time:
                emit('error', {'message': f'You are banned: {ban.get("reason", "No reason")} Until: {ban.get("until", "Permanent")}'})
                return
    
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
    socketio.run(app, host='0.0.0.0', port=port, debug=True)
