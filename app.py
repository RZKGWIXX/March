
#!/usr/bin/env python
import os
import json
from functools import wraps
from flask import Flask, render_template, request, redirect, session, url_for, jsonify
from flask_socketio import SocketIO, join_room, leave_room, send, emit

app = Flask(__name__, static_folder='static', template_folder='templates')
app.secret_key = os.environ.get('SECRET_KEY', 'fallback-secret-key-for-development')
socketio = SocketIO(app, cors_allowed_origins="*")

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

@app.route('/', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        nick = request.form['nickname'].strip()
        pwd = request.form['password']
        ip = request.remote_addr
        
        if not nick or not pwd:
            return render_template('base.html', title='Login', error='Please fill all fields')
        
        # Save user credentials
        with open(USERS_FILE, 'a', encoding='utf-8') as fd:
            fd.write(f"{ip},{nick},{pwd}\n")
        
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
    return jsonify(messages_data.get(room, []))

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

@app.route('/ban_user', methods=['POST'])
@login_required
def ban_user():
    target_user = request.json.get('user')
    room = request.json.get('room', 'general')
    
    if room != 'general':
        return jsonify(success=False, error='Can only ban from general chat')
    
    # Only allow banning in general for now (you can add admin system later)
    banned_data = load_json(BANNED_FILE)
    if 'general' not in banned_data:
        banned_data['general'] = []
    
    if target_user not in banned_data['general']:
        banned_data['general'].append(target_user)
        save_json(BANNED_FILE, banned_data)
    
    return jsonify(success=True)

@app.route('/delete_message', methods=['POST'])
@login_required
def delete_message():
    room = request.json.get('room')
    message_index = request.json.get('index')
    
    if room == 'general':
        return jsonify(success=False, error='Cannot delete messages in general chat')
    
    rooms_data = load_json(ROOMS_FILE)
    if room not in rooms_data or session['nickname'] not in rooms_data[room].get('admins', []):
        return jsonify(success=False, error='Only admins can delete messages')
    
    messages_data = load_json(MESSAGES_FILE)
    if room in messages_data and 0 <= message_index < len(messages_data[room]):
        messages_data[room].pop(message_index)
        save_json(MESSAGES_FILE, messages_data)
        return jsonify(success=True)
    
    return jsonify(success=False, error='Message not found')

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
    # Don't send join messages to reduce spam

@socketio.on('leave')
def on_leave(data):
    leave_room(data['room'])

@socketio.on('message')
def on_message(data):
    room = data['room']
    nickname = data['nickname']
    message = data['message'].strip()
    
    if not message:
        return
    
    # Check if user is banned
    if room == 'general' and is_user_banned(nickname):
        emit('error', {'message': 'You are banned from this chat'})
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
    
    import time
    messages_data[room].append({
        'nick': nickname,
        'text': message,
        'timestamp': int(time.time())
    })
    
    # Keep only last 1000 messages per room
    if len(messages_data[room]) > 1000:
        messages_data[room] = messages_data[room][-1000:]
    
    save_json(MESSAGES_FILE, messages_data)
    
    # Send message to room
    send(f"{nickname}: {message}", room=room)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, host='0.0.0.0', port=port, debug=True)
