#!/usr/bin/env python
import os
import json
from functools import wraps
from flask import Flask, render_template, request, redirect, session, url_for, jsonify
from flask_socketio import SocketIO, join_room, send

app = Flask(__name__, static_folder='static', template_folder='templates')
app.secret_key = os.environ.get('SECRET_KEY', 'fallback-secret')
socketio = SocketIO(app)

USERS_FILE = 'users.txt'
ROOMS_FILE = 'rooms.json'
MESSAGES_FILE = 'messages.json'
BLOCKS_FILE = 'blocks.json'

# Ініціалізація файлів
for f in (USERS_FILE,):
    if not os.path.exists(f):
        open(f, 'a').close()
for f in (ROOMS_FILE, MESSAGES_FILE, BLOCKS_FILE):
    if not os.path.exists(f):
        with open(f, 'w') as fd:
            json.dump({}, fd)

def load_json(path):
    with open(path, 'r') as fd:
        return json.load(fd)

def save_json(path, data):
    with open(path, 'w') as fd:
        json.dump(data, fd, indent=2)

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'nickname' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated

@app.route('/', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        nick = request.form['nickname'].strip()
        pwd = request.form['password']
        ip = request.remote_addr
        with open(USERS_FILE, 'a') as fd:
            fd.write(f"{ip},{nick},{pwd}\\n")
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
    data = load_json(ROOMS_FILE)
    return jsonify(list(data.keys()))

@app.route('/messages/<room>')
@login_required
def get_messages(room):
    data = load_json(MESSAGES_FILE)
    return jsonify(data.get(room, []))

@app.route('/create_private', methods=['POST'])
@login_required
def create_private():
    nick = request.json.get('nick')
    users = sorted([session['nickname'], nick])
    room = f"private_{users[0]}_{users[1]}"
    rooms = load_json(ROOMS_FILE)
    if room not in rooms:
        rooms[room] = {'members': users, 'admins': [session['nickname']]}
        save_json(ROOMS_FILE, rooms)
    return jsonify(success=True, room=room)

@app.route('/delete_room', methods=['POST'])
@login_required
def delete_room():
    room = request.json.get('room')
    if room == 'general':
        return jsonify(success=False, error='Cannot delete general'), 400
    rooms = load_json(ROOMS_FILE)
    if session['nickname'] in rooms.get(room, {}).get('admins', []):
        rooms.pop(room, None)
        save_json(ROOMS_FILE, rooms)
        msgs = load_json(MESSAGES_FILE)
        msgs.pop(room, None)
        save_json(MESSAGES_FILE, msgs)
        return jsonify(success=True)
    return jsonify(success=False, error='Forbidden'), 403

@app.route('/block_user', methods=['POST'])
@login_required
def block_user():
    room = request.json.get('room')
    blocks = load_json(BLOCKS_FILE)
    blocks.setdefault(session['nickname'], []).append(room)
    save_json(BLOCKS_FILE, blocks)
    return jsonify(success=True)

@socketio.on('join')
def on_join(data):
    join_room(data['room'])
    send(f"[SYSTEM] {data['nickname']} joined {data['room']}", room=data['room'])

@socketio.on('message')
def on_message(data):
    room = data['room']
    nick = data['nickname']
    msg = data['message']
    all_msgs = load_json(MESSAGES_FILE)
    all_msgs.setdefault(room, []).append({'nick': nick, 'text': msg})
    save_json(MESSAGES_FILE, all_msgs)
    send(f"{nick}: {msg}", room=room)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 6280))
    socketio.run(app, host='0.0.0.0', port=port)