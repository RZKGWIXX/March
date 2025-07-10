from flask import Flask, render_template, request, redirect, session, url_for, jsonify
from flask_socketio import SocketIO, join_room, leave_room, send
import os
import json
from functools import wraps

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'fallback-secret')
socketio = SocketIO(app)

# Storage files
USERS_FILE = 'users.txt'
ROOMS_FILE = 'rooms.json'
MESSAGES_FILE = 'messages.json'
BLOCKS_FILE = 'blocks.json'

# Initialize storage
if not os.path.exists(USERS_FILE):
    open(USERS_FILE, 'a').close()
for file in [ROOMS_FILE, MESSAGES_FILE, BLOCKS_FILE]:
    if not os.path.exists(file):
        with open(file, 'w') as f:
            json.dump({}, f)

def load_json(f): return json.load(open(f))
def save_json(f, data): json.dump(data, open(f, 'w'), indent=2)

def login_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if 'nickname' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return wrapper

@app.route('/', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        nickname = request.form['nickname']
        password = request.form['password']
        ip = request.remote_addr
        with open(USERS_FILE, 'a') as f:
            f.write(f"{ip},{nickname},{password}\n")
        session['nickname'] = nickname
        return redirect(url_for('chat'))
    return render_template('base.html', title="Login")

@app.route('/chat')
@login_required
def chat():
    return render_template('base.html', title="Chat", nickname=session['nickname'])

@app.route('/rooms')
@login_required
def get_rooms():
    rooms = load_json(ROOMS_FILE)
    return jsonify(list(rooms.keys()))

@app.route('/messages/<room>')
@login_required
def get_messages(room):
    msgs = load_json(MESSAGES_FILE)
    return jsonify(msgs.get(room, []))

@app.route('/create_private', methods=['POST'])
@login_required
def create_private():
    data = load_json(ROOMS_FILE)
    nick = request.json.get('nick')
    room = f"private_{sorted([session['nickname'], nick])}"
    if room not in data:
        # creator is admin
        data[room] = {
            "members": [session['nickname'], nick],
            "admins": [session['nickname']]
        }
        save_json(ROOMS_FILE, data)
    return jsonify(success=True, room=room)

@app.route('/delete_room', methods=['POST'])
@login_required
def delete_room():
    room = request.json.get('room')
    rooms = load_json(ROOMS_FILE)
    if room != 'general' and session['nickname'] in rooms.get(room, {}).get('admins', []):
        rooms.pop(room, None)
        save_json(ROOMS_FILE, rooms)
        msgs = load_json(MESSAGES_FILE)
        msgs.pop(room, None)
        save_json(MESSAGES_FILE, msgs)
        return jsonify(success=True)
    return jsonify(success=False), 403

@app.route('/block_user', methods=['POST'])
@login_required
def block_user():
    blocked = load_json(BLOCKS_FILE)
    room = request.json.get('room')
    # block all members except admin
    rooms = load_json(ROOMS_FILE)
    admins = rooms.get(room, {}).get('admins', [])
    blocked.setdefault(session['nickname'], []).append(room)
    save_json(BLOCKS_FILE, blocked)
    return jsonify(success=True)

# Real-time events
@socketio.on('join')
def handle_join(data):
    room = data['room']
    join_room(room)
    send(jsonify_event(f"{data['nickname']} joined {room}."), room=room)

@socketio.on('message')
def handle_message(data):
    room = data['room']
    nickname = data['nickname']
    text = data['message']
    # Save message
    msgs = load_json(MESSAGES_FILE)
    msgs.setdefault(room, []).append({"nick": nickname, "text": text})
    save_json(MESSAGES_FILE, msgs)
    send(jsonify_event(f"{nickname}: {text}"), room=room)

def jsonify_event(msg):
    # helper to send plain text
    return msg

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, host='0.0.0.0', port=port)
