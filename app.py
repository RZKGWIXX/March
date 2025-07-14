#!/usr/bin/env python
import os
import json
import time
import hashlib
import secrets
import re
import requests
from collections import defaultdict, deque
from functools import wraps
from flask import Flask, render_template, request, redirect, session, url_for, jsonify
from flask_socketio import SocketIO, join_room, leave_room, send, emit

app = Flask(__name__, static_folder='static', template_folder='templates')
app.secret_key = '%637&&7@(_72)(28'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

@app.route('/ping')
def ping():
    """Health check endpoint for keepalive"""
    return jsonify({'status': 'ok', 'timestamp': int(time.time())})

# JSONBin.io configuration
JSONBIN_API_KEY = '$2a$10$RgQMxiMWDn4XRQ70aEs7NuP/rw2z1Ay1qEwR.xrXwTsIIISGQVTVm'
JSONBIN_ACCESS_KEY_ID = '6870d1a46063391d31ab5ece'
JSONBIN_BASE_URL = 'https://api.jsonbin.io/v3/b'

# Bin IDs for different data types - you'll need to create these bins first
BINS = {
    'users': '6870e467afef824ba9f95e49',
    'rooms': '6870e469afef824ba9f95e4c',
    'messages': '6870e46aafef824ba9f95e4e',
    'blocks': '6870e46cafef824ba9f95e50',
    'banned': '6870e46dafef824ba9f95e52',
    'muted': '6870e46fafef824ba9f95e54',
    'hidden_messages': '6870e471afef824ba9f95e58',
    'nickname_cooldowns': '6870e472afef824ba9f95e5a',
    'premium': '6874d691355eab5e8b1b144c',
    'stories': '6874d6926063391d31ad4e12',
    'verification': '6874d692355eab5e8b1b144e'
}

# Track online users
online_users = {}
user_sessions = {}

# Anti-spam and security tracking
message_timestamps = defaultdict(deque)
failed_login_attempts = defaultdict(list)
rate_limits = defaultdict(list)
spam_violations = defaultdict(int)


def create_jsonbin_bin(bin_name, data, collection_id=None):
    """Create a new bin on JSONBin.io"""
    if not JSONBIN_API_KEY:
        print(f"No API key provided for creating {bin_name} bin")
        return None

    headers = {
        'X-Master-Key': JSONBIN_API_KEY,
        'X-Access-Key': JSONBIN_ACCESS_KEY_ID,
        'Content-Type': 'application/json',
        'X-Bin-Name': bin_name
    }

    # Add collection ID if provided
    if collection_id:
        headers['X-Collection-Id'] = collection_id

    try:
        print(f"Making request to create bin: {bin_name}")
        print(f"Headers: {headers}")
        response = requests.post(JSONBIN_BASE_URL,
                                 json=data,
                                 headers=headers,
                                 timeout=10)
        print(f"Response status: {response.status_code}")
        print(f"Response text: {response.text[:200]}...")

        if response.status_code == 200:
            bin_data = response.json()
            bin_id = bin_data.get('metadata', {}).get('id')
            print(f"Created JSONBin for {bin_name}: {bin_id}")
            return bin_id
        else:
            print(
                f"Failed to create bin {bin_name}: {response.status_code} - {response.text}"
            )
            return None
    except requests.RequestException as e:
        print(f"Error creating bin {bin_name}: {e}")
        return None


def check_bin_exists(bin_id):
    """Check if a bin exists on JSONBin.io"""
    if not JSONBIN_API_KEY or not bin_id:
        return False

    headers = {
        'X-Master-Key': JSONBIN_API_KEY,
        'X-Access-Key': JSONBIN_ACCESS_KEY_ID
    }

    try:
        url = f"{JSONBIN_BASE_URL}/{bin_id}"
        response = requests.get(url, headers=headers, timeout=10)
        return response.status_code == 200
    except requests.RequestException:
        return False


def migrate_local_data_to_bins():
    """Migrate existing local data to new JSONBin.io bins"""
    print("Migrating local data to JSONBin.io...")

    for bin_name in BINS.keys():
        local_file = f"{bin_name}.json"
        if os.path.exists(local_file):
            try:
                with open(local_file, 'r', encoding='utf-8') as f:
                    local_data = json.load(f)

                # Skip if it's just placeholder data
                if local_data and not (len(local_data) == 1 and "placeholder" in local_data):
                    print(f"Migrating {bin_name} data...")
                    if save_json(bin_name, local_data):
                        print(f"✓ Successfully migrated {bin_name} data")
                    else:
                        print(f"✗ Failed to migrate {bin_name} data")
                else:
                    print(f"- Skipping {bin_name} (placeholder data)")
            except Exception as e:
                print(f"Error migrating {bin_name}: {e}")


default_data = {
        'users': {"placeholder": "data"},
        'rooms': {"placeholder": "data"},
        'messages': {
            'general': []
        },
        'blocks': {"placeholder": "data"},
        'banned': {
            'users': []
        },
        'muted': {"placeholder": "data"},
        'hidden_messages': {"placeholder": "data"},
        'nickname_cooldowns': {"placeholder": "data"},
        'premium': {"placeholder": "data"},
        'stories': {"placeholder": "data"},
        'verification': {"placeholder": "data"}
    }

def auto_create_bins():
    """Automatically create all required bins if they don't exist"""
    print(f"JSONBin API Key: {'Present' if JSONBIN_API_KEY else 'Missing'}")

    if not JSONBIN_API_KEY:
        print("JSONBin API key not provided - skipping bin creation")
        print("Please set JSONBIN_API_KEY environment variable")
        return

    # Check if we have the Collection ID in environment
    collection_id = '6870ced0c17214220fc74e76'

    default_data = {
        'users': {"placeholder": "data"},
        'rooms': {"placeholder": "data"},
        'messages': {
            'general': []
        },
        'blocks': {"placeholder": "data"},
        'banned': {
            'users': []
        },
        'muted': {"placeholder": "data"},
        'hidden_messages': {"placeholder": "data"},
        'nickname_cooldowns': {"placeholder": "data"},
        'premium': {"placeholder": "data"},
        'stories': {"placeholder": "data"},
        'verification': {"placeholder": "data"}
    }

    print("Checking and creating JSONBin.io bins...")
    print(f"Using Collection ID: {collection_id}")

    bins_created = False
    for bin_name, data in default_data.items():
        bin_id = BINS.get(bin_name)

        if bin_id and check_bin_exists(bin_id):
            print(f"✓ {bin_name} bin already exists: {bin_id}")
        elif bin_id and not check_bin_exists(bin_id):
            print(f"⚠ {bin_name} bin ID configured but bin doesn't exist, creating new one...")
            new_bin_id = create_jsonbin_bin(bin_name, data, collection_id)
            if new_bin_id:
                BINS[bin_name] = new_bin_id
                print(f"✓ Recreated {bin_name} bin: {new_bin_id}")
                print(f"Update your environment: {bin_name.upper()}_BIN_ID={new_bin_id}")
                bins_created = True
            else:
                print(f"✗ Failed to recreate {bin_name} bin")
        else:
            print(f"Creating bin for {bin_name}...")
            bin_id = create_jsonbin_bin(bin_name, data, collection_id)
            if bin_id:
                BINS[bin_name] = bin_id
                print(f"✓ Created {bin_name} bin: {bin_id}")
                print(f"Add to your environment: {bin_name.upper()}_BIN_ID={bin_id}")
                bins_created = True
            else:
                print(f"✗ Failed to create {bin_name} bin")

    # If new bins were created, migrate local data
    if bins_created:
        migrate_local_data_to_bins()


def create_default_json_files():
    """Create default JSON files locally if they don't exist"""
    default_data = {
        'users': {"placeholder": "data"},
        'rooms': {"placeholder": "data"},
        'messages': {
            'general': []
        },
        'blocks': {"placeholder": "data"},
        'banned': {
            'users': []
        },
        'muted': {"placeholder": "data"},
        'hidden_messages': {"placeholder": "data"},
        'nickname_cooldowns': {"placeholder": "data"},
        'premium': {"placeholder": "data"},
        'stories': {"placeholder": "data"},
        'verification': {"placeholder": "data"}
    }

    for filename, data in default_data.items():
        filepath = f"{filename}.json"
        if not os.path.exists(filepath):
            try:
                with open(filepath, 'w', encoding='utf-8') as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
                print(f"Created {filepath}")
            except Exception as e:
                print(f"Error creating {filepath}: {e}")


def jsonbin_request(method, bin_name, data=None):
    """Make request to JSONBin.io API with better error handling"""
    if not JSONBIN_API_KEY or not BINS.get(bin_name):
        print(f"Missing API key or bin ID for {bin_name}")
        return {} if method == 'GET' else False

    headers = {
        'X-Master-Key': JSONBIN_API_KEY,
        'X-Access-Key': JSONBIN_ACCESS_KEY_ID,
        'Content-Type': 'application/json'
    }

    bin_id = BINS[bin_name]
    url = f"{JSONBIN_BASE_URL}/{bin_id}"

    try:
        if method == 'GET':
            response = requests.get(url, headers=headers, timeout=5, verify=False)
            if response.status_code == 200:
                return response.json().get('record', {})
            else:
                print(f"Failed to get {bin_name}: {response.status_code}")
                return {}

        elif method == 'PUT':
            headers['X-Bin-Versioning'] = 'false'  # Don't create new versions
            response = requests.put(url,
                                    json=data,
                                    headers=headers,
                                    timeout=5,
                                    verify=False)
            return response.status_code == 200

    except Exception as e:
        print(f"JSONBin API error for {bin_name}: {e}")
        return {} if method == 'GET' else False


def load_json(bin_name):
    """Load data from local file first, then JSONBin.io as backup"""
    # Try local file first for better performance
    filepath = f"{bin_name}.json"
    try:
        if os.path.exists(filepath):
            with open(filepath, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if data and data != {"placeholder": "data"}:
                    return data
    except Exception as e:
        print(f"Error loading {filepath}: {e}")

    # Try JSONBin.io as backup only if local fails
    if JSONBIN_API_KEY and BINS.get(bin_name):
        try:
            data = jsonbin_request('GET', bin_name)
            if data and data != {"placeholder": "data"}:
                # Save to local file for next time
                try:
                    with open(filepath, 'w', encoding='utf-8') as f:
                        json.dump(data, f, indent=2, ensure_ascii=False)
                except Exception as e:
                    print(f"Error saving to local file {filepath}: {e}")
                return data
        except Exception as e:
            print(f"Error loading from JSONBin {bin_name}: {e}")

    # Return default data if both fail
    default_data = {
        'users': {},
        'rooms': {},
        'messages': {
            'general': []
        },
        'blocks': {},
        'banned': {
            'users': []
        },
        'muted': {},
        'hidden_messages': {},
        'nickname_cooldowns': {},
        'premium': {},
        'stories': {},
        'verification': {}
    }
    return default_data.get(bin_name, {})


def save_json(bin_name, data):
    """Save data to JSONBin.io and local file as backup"""
    # Save to local file first
    filepath = f"{bin_name}.json"
    try:
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"Error saving to {filepath}: {e}")

    # Try to save to JSONBin.io
    if JSONBIN_API_KEY and BINS.get(bin_name):
        return jsonbin_request('PUT', bin_name, data)

    return True  # Return True if local save succeeded


def login_required(f):

    @wraps(f)
    def decorated(*args, **kwargs):
        if 'nickname' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)

    return decorated


def get_user_list():
    """Get list of all registered users"""
    users_data = load_json('users')
    users = set()

    for user_id, user_info in users_data.items():
        if isinstance(user_info, dict) and 'nickname' in user_info:
            users.add(user_info['nickname'])

    return list(users)


def save_user(ip, nickname, password):
    """Save user to JSONBin users storage"""
    try:
        users_data = load_json('users')

        # Check if nickname already exists
        for user_info in users_data.values():
            if isinstance(user_info, dict) and user_info.get('nickname') == nickname:
                return False  # User already exists

        user_id = hashlib.md5(f"{ip}_{nickname}".encode()).hexdigest()

        users_data[user_id] = {
            'ip': ip,
            'nickname': nickname.strip(),
            'password': password.strip(),
            'timestamp': int(time.time()),
            'date': time.strftime('%Y-%m-%d %H:%M:%S')
        }

        result = save_json('users', users_data)
        if result:
            print(f"User {nickname} saved successfully")
        else:
            print(f"Failed to save user {nickname}")
        return result
    except Exception as e:
        print(f"Error saving user {nickname}: {e}")
        return False


def verify_user(nickname, password):
    """Verify user credentials"""
    users_data = load_json('users')

    for user_info in users_data.values():
        if (isinstance(user_info, dict)
                and user_info.get('nickname') == nickname):
            # Check if passwords match (handle both string and encoded passwords)
            stored_password = user_info.get('password', '')
            if stored_password == password:
                return True
            # Also try comparing with stripped whitespace
            if stored_password.strip() == password.strip():
                return True

    return False


def check_account_exists(nickname):
    """Check if account exists"""
    return nickname in get_user_list()


def is_user_banned(nickname, ip=None):
    """Check if user is banned"""
    banned_data = load_json('banned')
    current_time = int(time.time())

    for ban in banned_data.get('users', []):
        if (ban.get('username') == nickname or (ip and ban.get('ip') == ip)):
            if ban.get('until_timestamp', 0) == -1 or ban.get(
                    'until_timestamp', 0) > current_time:
                return True, ban

    return False, None


def is_user_blocked(from_user, to_user):
    """Check if from_user is blocked by to_user"""
    blocks = load_json('blocks')
    return from_user in blocks.get(to_user, [])


def check_rate_limit(ip, limit=30, window=60):
    """Check if IP exceeds rate limit"""
    current_time = time.time()
    rate_limits[ip] = [t for t in rate_limits[ip] if current_time - t < window]
    if len(rate_limits[ip]) >= limit:
        return False
    rate_limits[ip].append(current_time)
    return True


def check_spam_protection(nickname, message):
    """Advanced spam detection"""
    current_time = time.time()

    message_timestamps[nickname] = deque(
        [t for t in message_timestamps[nickname] if current_time - t < 60])

    if len(message_timestamps[nickname]) >= 10:
        spam_violations[nickname] += 1
        return False, "Too many messages. Please slow down."

    if len(message) > 10 and len(set(message)) < 4:
        spam_violations[nickname] += 1
        return False, "Spam detected: repeated characters"

    if len(message) > 20 and sum(c.isupper()
                                 for c in message) / len(message) > 0.7:
        spam_violations[nickname] += 1
        return False, "Spam detected: excessive caps"

    url_count = len(
        re.findall(
            r'http[s]?://(?:[a-zA-Z]|[0-9]|[$-_@.&+]|[!*\\(\\),]|(?:%[0-9a-fA-F][0-9a-fA-F]))+',
            message))
    if url_count > 2:
        spam_violations[nickname] += 1
        return False, "Spam detected: too many URLs"

    if spam_violations[nickname] >= 5:
        muted_data = load_json('muted')
        if 'general' not in muted_data:
            muted_data['general'] = {}
        muted_data['general'][nickname] = {
            'until': int(current_time) + 3600,
            'by': 'SYSTEM',
            'duration': 60,
            'reason': 'Automated spam detection'
        }
        save_json('muted', muted_data)
        spam_violations[nickname] = 0
        return False, "You have been muted for 1 hour due to spam violations"

    message_timestamps[nickname].append(current_time)
    return True, None


def sanitize_input(text):
    """Sanitize user input to prevent XSS"""
    if not text:
        return text
    text = re.sub(r'<[^>]*>', '', text)
    text = re.sub(r'javascript:', '', text, flags=re.IGNORECASE)
    text = re.sub(r'on\w+\s*=', '', text, flags=re.IGNORECASE)
    return text.strip()


@app.route('/orb')
def short_link():
    return redirect(url_for('login'))


@app.route('/mess')
def mess_link():
    return redirect(url_for('login'))


@app.route('/chat-orb')
def chat_orb_link():
    return redirect(url_for('login'))


@app.route('/om')
def om_link():
    return redirect(url_for('login'))


@app.route('/', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        nick = sanitize_input(request.form['nickname'].strip())
        pwd = request.form['password']
        captcha_answer = request.form.get('captcha', '')
        ip = request.remote_addr

        if not check_rate_limit(ip, limit=10, window=300):
            return render_template('base.html',
                                   title='Login',
                                   error='Too many attempts. Try again later.')

        if not nick or not pwd:
            return render_template('base.html',
                                   title='Login',
                                   error='Please fill all fields')

        expected_captcha = session.get('captcha_answer')
        if not expected_captcha or str(captcha_answer) != str(
                expected_captcha):
            import random
            num1, num2 = random.randint(1, 10), random.randint(1, 10)
            session['captcha_answer'] = num1 + num2
            session['captcha_question'] = f"{num1} + {num2} = ?"
            return render_template(
                'base.html',
                title='Login',
                error='Incorrect CAPTCHA. Please try again.',
                captcha_question=session.get('captcha_question'))

        current_time = time.time()
        failed_login_attempts[ip] = [
            t for t in failed_login_attempts[ip] if current_time - t < 900
        ]
        if len(failed_login_attempts[ip]) >= 5:
            return render_template(
                'base.html',
                title='Login',
                error='Too many failed attempts. Try again in 15 minutes.')

        # Check if user is banned
        is_banned, ban_info = is_user_banned(nick, ip)
        if is_banned:
            if ban_info.get('until_timestamp', 0) == -1:
                duration_text = "permanently"
            else:
                current_time_int = int(time.time())
                remaining_hours = int(
                    (ban_info.get('until_timestamp', 0) - current_time_int) /
                    3600)
                if remaining_hours < 1:
                    remaining_minutes = int(
                        (ban_info.get('until_timestamp', 0) - current_time_int)
                        / 60)
                    duration_text = f"for {remaining_minutes} more minutes"
                elif remaining_hours < 24:
                    duration_text = f"for {remaining_hours} more hours"
                else:
                    remaining_days = int(remaining_hours / 24)
                    duration_text = f"for {remaining_days} more days"

            error_msg = f"You are banned {duration_text}. Reason: {ban_info.get('reason', 'No reason')}"
            return render_template('base.html', title='Login', error=error_msg)

        # Check if user exists and verify password
        if check_account_exists(nick):
            if not verify_user(nick, pwd):
                failed_login_attempts[ip].append(current_time)
                print(f"Login failed for user: {nick}")  # Debug logging
                return render_template('base.html',
                                       title='Login',
                                       error='Invalid username or password',
                                       captcha_question=session.get('captcha_question'))
        else:
            # Create new user
            if not save_user(ip, nick, pwd):
                return render_template(
                    'base.html',
                    title='Login',
                    error='Failed to create account. Please try again.',
                    captcha_question=session.get('captcha_question'))

        session['nickname'] = nick
        import random
        num1, num2 = random.randint(1, 10), random.randint(1, 10)
        session['captcha_answer'] = num1 + num2
        return redirect(url_for('chat'))

    if 'captcha_answer' not in session:
        import random
        num1, num2 = random.randint(1, 10), random.randint(1, 10)
        session['captcha_answer'] = num1 + num2
        session['captcha_question'] = f"{num1} + {num2} = ?"

    return render_template('base.html',
                           title='Login',
                           captcha_question=session.get('captcha_question'))


@app.route('/chat')
@login_required
def chat():
    nickname = session['nickname']

    if not check_account_exists(nickname):
        session.clear()
        return redirect(url_for('login'))

    import time
    online_users[nickname] = {'last_seen': int(time.time()), 'room': 'general'}

    from flask import make_response
    response = make_response(
        render_template('base.html', title='Chat', nickname=nickname))
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response


@app.route('/rooms')
@login_required
def get_rooms():
    try:
        rooms_data = load_json('rooms')
        user_rooms = ['general']

        print(f"Loading rooms for user: {session['nickname']}")
        print(f"Rooms data: {rooms_data}")

        if isinstance(rooms_data, dict):
            for room_name, room_info in rooms_data.items():
                if isinstance(room_info, dict) and session['nickname'] in room_info.get('members', []):
                    user_rooms.append(room_name)
                    print(f"Added room: {room_name}")
        else:
            print(f"Warning: rooms_data is not a dict: {type(rooms_data)}")

        print(f"Final user_rooms: {user_rooms}")
        return jsonify(user_rooms)
    except Exception as e:
        print(f"Error in get_rooms: {e}")
        return jsonify(['general'])


@app.route('/messages/<room>')
@login_required
def get_messages(room):
    if room != 'general':
        rooms_data = load_json('rooms')
        if room not in rooms_data or session['nickname'] not in rooms_data[
                room].get('members', []):
            return jsonify([])

    messages_data = load_json('messages')
    messages = messages_data.get(room, [])

    try:
        hidden_data = load_json('hidden_messages')
        user_hidden = hidden_data.get(session['nickname'], {}).get(room, [])

        for index in sorted(user_hidden, reverse=True):
            if 0 <= index < len(messages):
                messages.pop(index)
    except:
        pass

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
    filtered = [
        u for u in users if query in u.lower() and u != session['nickname']
    ]
    return jsonify(filtered[:10])


@app.route('/create_private', methods=['POST'])
@login_required
def create_private():
    target_nick = request.json.get('nick', '').strip()

    if not target_nick or target_nick == session['nickname']:
        return jsonify(success=False, error='Invalid username')

    if target_nick not in get_user_list():
        return jsonify(success=False, error='User not found')

    if is_user_blocked(session['nickname'], target_nick):
        return jsonify(success=False, error='You are blocked by this user')

    users = sorted([session['nickname'], target_nick])
    room = f"private_{users[0]}_{users[1]}"

    rooms_data = load_json('rooms')

    if room not in rooms_data:
        rooms_data[room] = {
            'members': users,
            'admins': [session['nickname']],
            'type': 'private'
        }
        save_json('rooms', rooms_data)

    return jsonify(success=True, room=room)


@app.route('/create_group', methods=['POST'])
@login_required
def create_group():
    group_name = request.json.get('name', '').strip()

    if not group_name or group_name == 'general':
        return jsonify(success=False, error='Invalid group name')

    rooms_data = load_json('rooms')
    if group_name in rooms_data:
        return jsonify(success=False, error='Group already exists')

    rooms_data[group_name] = {
        'members': [session['nickname']],
        'admins': [session['nickname']],
        'type': 'group'
    }
    save_json('rooms', rooms_data)

    return jsonify(success=True, room=group_name)


@app.route('/delete_room', methods=['POST'])
@login_required
def delete_room():
    room = request.json.get('room')

    if room == 'general':
        return jsonify(success=False, error='Cannot delete general chat'), 400

    rooms_data = load_json('rooms')

    if room not in rooms_data:
        return jsonify(success=False, error='Room not found'), 404

    room_info = rooms_data[room]

    if room.startswith('private_'):
        if session['nickname'] not in room_info.get('members', []):
            return jsonify(success=False, error='Access denied'), 403
    else:
        if session['nickname'] not in room_info.get('admins', []):
            return jsonify(success=False,
                           error='Only admins can delete rooms'), 403

    rooms_data.pop(room, None)
    save_json('rooms', rooms_data)

    messages_data = load_json('messages')
    messages_data.pop(room, None)
    save_json('messages', messages_data)

    return jsonify(success=True)


@app.route('/block_user', methods=['POST'])
@login_required
def block_user():
    room = request.json.get('room')

    if not room or not room.startswith('private_'):
        return jsonify(success=False,
                       error='Can only block users in private chats')

    users = room.replace('private_', '').split('_')
    other_user = users[0] if users[1] == session['nickname'] else users[1]

    blocks_data = load_json('blocks')
    if session['nickname'] not in blocks_data:
        blocks_data[session['nickname']] = []

    if other_user not in blocks_data[session['nickname']]:
        blocks_data[session['nickname']].append(other_user)
        save_json('blocks', blocks_data)

    return jsonify(success=True)


@app.route('/unblock_user', methods=['POST'])
@login_required
def unblock_user():
    room = request.json.get('room')

    if not room or not room.startswith('private_'):
        return jsonify(success=False,
                       error='Can only unblock users in private chats')

    users = room.replace('private_', '').split('_')
    other_user = users[0] if users[1] == session['nickname'] else users[1]

    blocks_data = load_json('blocks')
    if session['nickname'] in blocks_data and other_user in blocks_data[
            session['nickname']]:
        blocks_data[session['nickname']].remove(other_user)
        save_json('blocks', blocks_data)

    return jsonify(success=True)


@app.route('/admin/ban_user', methods=['POST'])
@login_required
def admin_ban_user():
    if session['nickname'] != 'Wixxy':
        return jsonify(success=False, error='Access denied'), 403

    username = request.json.get('username')
    reason = request.json.get('reason')
    duration = request.json.get('duration')

    if not username or not reason:
        return jsonify(success=False, error='Username and reason required')

        # Get user's IP from users data
    users_data = load_json('users')
    user_ip = None

    for user_info in users_data.values():
        if isinstance(user_info,
                      dict) and user_info.get('nickname') == username:
            user_ip = user_info.get('ip')
            break

    if not user_ip:
        return jsonify(success=False, error='User not found')

    import time
    if duration == -1:
        until = 'Permanent'
        until_timestamp = -1
    else:
        until_timestamp = int(time.time()) + (duration * 3600)
        until = time.strftime('%Y-%m-%d %H:%M:%S',
                              time.localtime(until_timestamp))

    banned_data = load_json('banned')
    if 'users' not in banned_data:
        banned_data['users'] = []

    banned_data['users'] = [
        b for b in banned_data['users']
        if b.get('username') != username and b.get('ip') != user_ip
    ]

    banned_data['users'].append({
        'username': username,
        'ip': user_ip,
        'reason': reason,
        'until': until,
        'until_timestamp': until_timestamp,
        'banned_at': int(time.time()),
        'banned_by': session['nickname']
    })

    save_json('banned', banned_data)

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

    banned_data = load_json('banned')
    active_bans = []

    import time
    current_time = int(time.time())

    for ban in banned_data.get('users', []):
        if ban.get('until_timestamp', 0) == -1 or ban.get(
                'until_timestamp', 0) > current_time:
            active_bans.append(ban)

    return jsonify(banned=active_bans)


@app.route('/admin/unban_user', methods=['POST'])
@login_required
def unban_user():
    if session['nickname'] != 'Wixxy':
        return jsonify(success=False, error='Access denied'), 403

    username = request.json.get('username')

    banned_data = load_json('banned')
    banned_data['users'] = [
        b for b in banned_data.get('users', [])
        if b.get('username') != username
    ]
    save_json('banned', banned_data)

    return jsonify(success=True)


@app.route('/delete_message', methods=['POST'])
@login_required
def delete_message():
    room = request.json.get('room')
    message_index = request.json.get('index')
    delete_type = request.json.get('type', 'all')

    messages_data = load_json('messages')

    if room not in messages_data or message_index < 0 or message_index >= len(
            messages_data[room]):
        return jsonify(success=False, error='Message not found')

    message = messages_data[room][message_index]
    is_own_message = message['nick'] == session['nickname']
    is_admin = session['nickname'] == 'Wixxy'

    if delete_type == 'all':
        if not (is_admin or (room != 'general' and is_own_message)):
            return jsonify(success=False, error='Permission denied')

        messages_data[room].pop(message_index)
        save_json('messages', messages_data)

        socketio.emit('message_deleted', {
            'room': room,
            'index': message_index,
            'deleted_by': session['nickname']
        },
                      room=room)

    elif delete_type == 'me':
        hidden_data = load_json('hidden_messages')
        user_key = session['nickname']

        if user_key not in hidden_data:
            hidden_data[user_key] = {}
        if room not in hidden_data[user_key]:
            hidden_data[user_key][room] = []

        hidden_data[user_key][room].append(message_index)
        save_json('hidden_messages', hidden_data)

    return jsonify(success=True)


@app.route('/admin/clear_chat', methods=['POST'])
@login_required
def admin_clear_chat():
    if session['nickname'] != 'Wixxy':
        return jsonify(success=False, error='Access denied'), 403

    room = request.json.get('room', 'general')

    messages_data = load_json('messages')
    messages_data[room] = []
    save_json('messages', messages_data)

    socketio.emit('chat_cleared', {'room': room}, room=room)

    return jsonify(success=True)

@app.route('/forward_message', methods=['POST'])
@login_required
def forward_message():
    """Forward a message to another room"""
    data = request.get_json()
    target_room = data.get('target_room')
    message = data.get('message')
    original_sender = data.get('original_sender')
    nickname = session.get('nickname')

    if not target_room or not message:
        return jsonify({'success': False, 'error': 'Missing required fields'})

    rooms_data = load_json('rooms')

    if target_room != 'general':
        if target_room not in rooms_data:
            return jsonify({'success': False, 'error': 'Room not found'})

        room_info = rooms_data[target_room]
        if nickname not in room_info.get('members', []):
            return jsonify({'success': False, 'error': 'Access denied to target room'})

    messages_data = load_json('messages')
    if target_room not in messages_data:
        messages_data[target_room] = []

    # Create forwarded message format
    forwarded_text = f"📤 Forwarded from {original_sender}:\n{message}"

    messages_data[target_room].append({
        'nick': nickname,
        'text': forwarded_text,
        'timestamp': int(time.time()),
        'forwarded': True,
        'original_sender': original_sender
    })

    save_json('messages', messages_data)

    socketio.emit('new_message', {
        'room': target_room,
        'nickname': nickname,
        'message': forwarded_text,
        'timestamp': int(time.time()),
        'forwarded': True,
        'original_sender': original_sender
    }, room=target_room)

    return jsonify({'success': True})


@app.route('/clear_private_history', methods=['POST'])
@login_required
def clear_private_history():
    room = request.json.get('room')

    if not room or not room.startswith('private_'):
        return jsonify(success=False,
                       error='Only private chats can be cleared this way')

    messages_data = load_json('messages')
    if room in messages_data:
        hidden_data = load_json('hidden_messages')
        user_key = session['nickname']

        if user_key not in hidden_data:
            hidden_data[user_key] = {}
        if room not in hidden_data[user_key]:
            hidden_data[user_key][room] = []

        hidden_data[user_key][room] = list(range(len(messages_data[room])))
        save_json('hidden_messages', hidden_data)

    return jsonify(success=True)


@app.route('/admin/stats')
@login_required
def admin_stats():
    if session['nickname'] != 'Wixxy':
        return jsonify(success=False, error='Access denied'), 403

    total_users = len(get_user_list())

    import time
    current_time = int(time.time())
    online_count = 0
    online_list = []

    for nickname, data in online_users.items():
        if current_time - data['last_seen'] < 300:
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
        if current_time - last_seen < 300:
            return jsonify({'status': 'online', 'last_seen': last_seen})
        else:
            return jsonify({'status': 'offline', 'last_seen': last_seen})

    return jsonify({'status': 'offline', 'last_seen': None})


@app.route('/room_stats/<room>')
@login_required
def get_room_stats(room):
    if room != 'general':
        rooms_data = load_json('rooms')
        if room not in rooms_data or session['nickname'] not in rooms_data[
                room].get('members', []):
            return jsonify({'error': 'Access denied'}), 403

    import time
    current_time = int(time.time())

    if room == 'general':
        online_count = sum(
            1 for nickname, data in online_users.items() if current_time -
            data['last_seen'] < 300 and data.get('room') == 'general')
        total_count = len(get_user_list())
    else:
        rooms_data = load_json('rooms')
        members = rooms_data.get(room, {}).get('members', [])
        total_count = len(members)
        online_count = sum(1 for member in members
                           if member in online_users and current_time -
                           online_users[member]['last_seen'] < 300)

    return jsonify({'online_count': online_count, 'total_count': total_count})


@app.route('/get_user_profile/<username>')
@login_required
def get_user_profile(username):
    users_data = load_json('users')
    for user_info in users_data.values():
        if isinstance(user_info, dict) and user_info.get('nickname') == username:
            return jsonify({
                'bio': user_info.get('bio', ''),
                'joined': user_info.get('date', ''),
                'nickname': username
            })
    return jsonify({'bio': '', 'joined': '', 'nickname': username})


def is_valid_nickname(nickname):
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

    is_valid, error_msg = is_valid_nickname(new_nickname)
    if not is_valid:
        return jsonify(success=False, error=error_msg)

    existing_users = get_user_list()
    if new_nickname in existing_users:
        return jsonify(success=False, error='This nickname already exists. Please choose another one.')

    old_nickname = session['nickname']

    cooldown_data = load_json('nickname_cooldowns')
    import time
    current_time = int(time.time())

    if old_nickname in cooldown_data:
        last_change = cooldown_data[old_nickname]
        time_since_change = current_time - last_change
        hours_remaining = 24 - (time_since_change // 3600)

        if time_since_change < 86400:
            return jsonify(
                success=False,
                error=
                f'You can change nickname once per day. Try again in {hours_remaining} hours.'
            )

    # Update user nickname in users data
    users_data = load_json('users')
    for user_info in users_data.values():
        if isinstance(user_info,
                      dict) and user_info.get('nickname') == old_nickname:
            user_info['nickname'] = new_nickname
            break

    save_json('users', users_data)

    # Update cooldown
    cooldown_data[new_nickname] = current_time
    if old_nickname in cooldown_data:
        del cooldown_data[old_nickname]
    save_json('nickname_cooldowns', cooldown_data)

    session['nickname'] = new_nickname

    if old_nickname in online_users:
        online_users[new_nickname] = online_users.pop(old_nickname)

    # Update room memberships
    rooms_data = load_json('rooms')
    for room_name, room_info in rooms_data.items():
        if old_nickname in room_info.get('members', []):
            room_info['members'] = [
                new_nickname if m == old_nickname else m
                for m in room_info['members']
            ]
        if old_nickname in room_info.get('admins', []):
            room_info['admins'] = [
                new_nickname if a == old_nickname else a
                for a in room_info['admins']
            ]
    save_json('rooms', rooms_data)

    # Update blocks data
    blocks_data = load_json('blocks')
    if old_nickname in blocks_data:
        blocks_data[new_nickname] = blocks_data.pop(old_nickname)
    for user, blocked_list in blocks_data.items():
        if old_nickname in blocked_list:
            blocked_list[blocked_list.index(old_nickname)] = new_nickname
    save_json('blocks', blocks_data)

    # Update hidden messages
    try:
        hidden_data = load_json('hidden_messages')
        if old_nickname in hidden_data:
            hidden_data[new_nickname] = hidden_data.pop(old_nickname)
        save_json('hidden_messages', hidden_data)
    except:
        pass

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

    rooms_data = load_json('rooms')

    if room not in rooms_data:
        return jsonify(success=False, error='Room not found')

    room_info = rooms_data[room]

    if room_info.get('type') == 'private':
        return jsonify(success=False,
                       error='Use block function for private chats')

    if session['nickname'] in room_info['members']:
        room_info['members'].remove(session['nickname'])

    if session['nickname'] in room_info.get('admins', []):
        room_info['admins'].remove(session['nickname'])

        if not room_info['admins'] and room_info['members']:
            room_info['admins'] = [room_info['members'][0]]

    if not room_info['members']:
        del rooms_data[room]
        messages_data = load_json('messages')
        messages_data.pop(room, None)
        save_json('messages', messages_data)

    save_json('rooms', rooms_data)
    return jsonify(success=True)


@app.route('/add_to_group', methods=['POST'])
@login_required
def add_to_group():
    room = request.json.get('room')
    username = request.json.get('username')

    if not room or not username:
        return jsonify(success=False, error='Room and username required')

    rooms_data = load_json('rooms')

    if room not in rooms_data:
        return jsonify(success=False, error='Room not found')

    room_info = rooms_data[room]

    if session['nickname'] not in room_info.get('admins', []):
        return jsonify(success=False, error='Only admins can add members')

    if username not in get_user_list():
        return jsonify(success=False, error='User not found')

    if username not in room_info['members']:
        room_info['members'].append(username)
        save_json('rooms', rooms_data)

        socketio.emit(
            'room_update', {
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

    rooms_data = load_json('rooms')

    if room not in rooms_data:
        return jsonify(success=False, error='Room not found')

    room_info = rooms_data[room]

    if session['nickname'] not in room_info.get('admins', []):
        return jsonify(success=False, error='Only admins can kick members')

    if username == session['nickname']:
        return jsonify(success=False, error='Cannot kick yourself')

    if username in room_info['members']:
        room_info['members'].remove(username)

    if username in room_info.get('admins', []):
        room_info['admins'].remove(username)

    save_json('rooms', rooms_data)

    socketio.emit(
        'room_update', {
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
    duration = request.json.get('duration', 60)

    if not room or not username:
        return jsonify(success=False, error='Room and username required')

    rooms_data = load_json('rooms')

    if room not in rooms_data:
        return jsonify(success=False, error='Room not found')

    room_info = rooms_data[room]

    if session['nickname'] not in room_info.get(
            'admins', []) and session['nickname'] != 'Wixxy':
        return jsonify(success=False, error='Only admins can mute users')

    muted_data = load_json('muted')

    if room not in muted_data:
        muted_data[room] = {}

    import time
    muted_data[room][username] = {
        'until': int(time.time()) + (duration * 60),
        'by': session['nickname'],
        'duration': duration
    }

    save_json('muted', muted_data)

    socketio.emit(
        'user_muted', {
            'room': room,
            'username': username,
            'duration': duration,
            'by': session['nickname']
        })

    return jsonify(success=True)


@app.route('/get_room_info/<room>')
@login_required
def get_room_info(room):
    rooms_data = load_json('rooms')

    if room not in rooms_data:
        return jsonify(success=False, error='Room not found')

    room_info = rooms_data[room]

    if session['nickname'] not in room_info.get('members', []):
        return jsonify(success=False, error='Access denied')

    return jsonify({
        'success':
        True,
        'members':
        room_info.get('members', []),
        'admins':
        room_info.get('admins', []),
        'type':
        room_info.get('type', 'group'),
        'is_admin':
        session['nickname'] in room_info.get('admins', [])
    })


@app.route('/delete_account', methods=['POST'])
@login_required
def delete_account():
    nickname = session['nickname']

    if not check_account_exists(nickname):
        return jsonify(success=False, error='Account not found')

    try:
        if nickname in online_users:
            del online_users[nickname]

        socketio.emit('user_activity_update', {
            'user': nickname,
            'action': 'account_deleted'
        })

        # Remove from users data
        users_data = load_json('users')
        users_data = {
            k: v
            for k, v in users_data.items()
            if not (isinstance(v, dict) and v.get('nickname') == nickname)
        }
        save_json('users', users_data)

        # Remove from rooms
        rooms_data = load_json('rooms')
        rooms_to_delete = []
        for room_name, room_info in rooms_data.items():
            if nickname in room_info.get('members', []):
                room_info['members'] = [
                    m for m in room_info['members'] if m != nickname
                ]
            if nickname in room_info.get('admins', []):
                room_info['admins'] = [
                    a for a in room_info['admins'] if a != nickname
                ]
            if not room_info.get('members'):
                rooms_to_delete.append(room_name)

        for room in rooms_to_delete:
            del rooms_data[room]
        save_json('rooms', rooms_data)

        # Remove from blocks
        blocks_data = load_json('blocks')
        if nickname in blocks_data:
            del blocks_data[nickname]
        for user_blocks in blocks_data.values():
            if nickname in user_blocks:
                user_blocks.remove(nickname)
        save_json('blocks', blocks_data)

        # Remove from hidden messages
        try:
            hidden_data = load_json('hidden_messages')
            if nickname in hidden_data:
                del hidden_data[nickname]
            save_json('hidden_messages', hidden_data)
        except:
            pass

        session.clear()

        from flask import jsonify
        response = jsonify({'success': True, 'redirect': url_for('login')})
        response.headers[
            'Cache-Control'] = 'no-cache, no-store, must-revalidate'
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

    socketio.emit('user_activity_update', {
        'user': nickname,
        'action': 'logout'
    })

    session.clear()

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

    # Check file size before reading
    file.seek(0, 2)  # Seek to end
    file_size = file.tell()
    file.seek(0)  # Reset to beginning

    # Different size limits for different file types
    max_size = 50 * 1024 * 1024  # 50MB for all files (increased limit)
    if file_size > max_size:
        return jsonify(success=False, error='File too large (max 50MB)')

    allowed_extensions = {'.jpg', '.jpeg', '.png', '.gif', '.mp4', '.mov', '.avi', '.webm', '.mkv', '.flv', '.wmv'}
    file_ext = os.path.splitext(file.filename)[1].lower()

    if file_ext not in allowed_extensions:
        return jsonify(success=False, error='Invalid file type')

    uploads_dir = os.path.join('static', 'uploads')
    os.makedirs(uploads_dir, exist_ok=True)

    import uuid
    filename = f"{uuid.uuid4().hex}{file_ext}"
    filepath = os.path.join(uploads_dir, filename)

    try:
        file.save(filepath)

        file_url = f"/static/uploads/{filename}"
        nickname = session['nickname']

        import time
        timestamp = int(time.time())

        # Determine file type
        is_video = file_ext in ['.mp4', '.mov', '.avi', '.webm', '.mkv', '.flv', '.wmv']
        file_type = 'video' if is_video else 'image'

        # Save to database
        messages_data = load_json('messages')
        if room not in messages_data:
            messages_data[room] = []

        message_data = {
            'nick': nickname,
            'text': file_url,
            'timestamp': timestamp,
            'type': 'media',
            'file_type': file_type
        }

        messages_data[room].append(message_data)
        save_json('messages', messages_data)

        # Broadcast to all users in room in real-time
        socketio.emit('new_message', {
            'room': room,
            'nickname': nickname,
            'message': file_url,
            'timestamp': timestamp,
            'type': 'media',
            'file_type': file_type
        }, room=room)

        # Also emit to sender for immediate feedback
        socketio.emit('message_sent', {
            'room': room,
            'nickname': nickname,
            'message': file_url,
            'timestamp': timestamp,
            'type': 'media',
            'file_type': file_type
        })

        return jsonify(success=True, url=file_url, type=file_type)

    except Exception as e:
        print(f"Upload error: {e}")
        return jsonify(success=False, error=f'Upload failed: {str(e)}')


@app.route('/upload_avatar', methods=['POST'])
@login_required
def upload_avatar():
    if 'avatar' not in request.files:
        return jsonify(success=False, error='No file selected')

    file = request.files['avatar']

    if file.filename == '':
        return jsonify(success=False, error='No file selected')

    # Check file size
    file.seek(0, 2)
    file_size = file.tell()
    file.seek(0)

    if file_size > 5 * 1024 * 1024:  # 5MB limit
        return jsonify(success=False, error='File too large (max 5MB)')

    # Check file type
    allowed_extensions = {'.jpg', '.jpeg', '.png', '.gif'}
    file_ext = os.path.splitext(file.filename)[1].lower()

    if file_ext not in allowed_extensions:
        return jsonify(success=False, error='Invalid file type')

    # Create avatars directory
    avatars_dir = os.path.join('static', 'avatars')
    os.makedirs(avatars_dir, exist_ok=True)

    # Save file
    filename = f"{session['nickname']}.jpg"
    filepath = os.path.join(avatars_dir, filename)

    try:
        file.save(filepath)
        avatar_url = f"/static/avatars/{filename}"
        return jsonify(success=True, avatar_url=avatar_url)
    except Exception as e:
        print(f"Avatar upload error: {e}")
        return jsonify(success=False, error='Upload failed')


@app.route('/update_bio', methods=['POST'])
@login_required
def update_bio():
    """Update user's bio"""
    try:
        bio = request.json.get('bio', '').strip()
        nickname = session['nickname']

        # Update bio in users data
        users_data = load_json('users')
        for user_info in users_data.values():
            if isinstance(user_info, dict) and user_info.get('nickname') == nickname:
                user_info['bio'] = bio
                break

        save_json('users', users_data)
        return jsonify(success=True)
    except Exception as e:
        print(f"Error updating bio: {e}")
        return jsonify(success=False, error='Failed to update bio')


if __name__ == '__main__':
    # Initialize data files and bins
    create_default_json_files()
    auto_create_bins()
    
    port = int(os.environ.get('PORT', 5000))
    debug_mode = os.environ.get('DEBUG', 'False').lower() == 'true'

    try:
        if 'gunicorn' in os.environ.get('SERVER_SOFTWARE', ''):
            pass
        else:
            socketio.run(app,
                         host='0.0.0.0',
                         port=port,
                         debug=debug_mode,
                         allow_unsafe_werkzeug=True)
    except Exception as e:
        print(f"Error starting with SocketIO: {e}")
        print("Falling back to Flask only...")
        app.run(host='0.0.0.0', port=port, debug=debug_mode)


@app.route('/check_premium')
@login_required
def check_premium():
    """Check if user has premium status"""
    try:
        premium_data = load_json('premium')
        nickname = session['nickname']

        if not premium_data or premium_data == {"placeholder": "data"}:
            return jsonify({'premium': False})

        import time
        current_time = int(time.time())

        if nickname in premium_data:
            user_premium = premium_data[nickname]
            if user_premium.get('until_timestamp', 0) == -1 or user_premium.get('until_timestamp', 0) > current_time:
                return jsonify({
                    'premium': True,
                    'until': user_premium.get('until', 'Permanent'),
                    'features': ['ui_customization', 'stories', 'priority_support']
                })

        return jsonify({'premium': False})
    except Exception as e:
        print(f"Error checking premium for {nickname}: {e}")
        return jsonify({'premium': False})


@app.route('/get_stories')
@login_required
def get_stories():
    """Get all stories"""
    try:
        stories_data = load_json('stories')

        if not stories_data or stories_data == {"placeholder": "data"}:
            return jsonify({})

        # Filter out expired stories (24 hours)
        import time
        current_time = int(time.time())
        active_stories = {}

        for username, user_stories in stories_data.items():
            if username == 'placeholder':
                continue

            if isinstance(user_stories, list):
                active_user_stories = []
                for story in user_stories:
                    if isinstance(story, dict) and story.get('timestamp', 0) > current_time - 86400:
                        active_user_stories.append(story)

                if active_user_stories:
                    active_stories[username] = active_user_stories

        return jsonify(active_stories)
    except Exception as e:
        print(f"Error getting stories: {e}")
        return jsonify({})


@app.route('/upload_story', methods=['POST'])
@login_required
def upload_story():
    """Upload a story (premium feature)"""
    # Check if user has premium
    premium_data = load_json('premium')
    nickname = session['nickname']

    import time
    current_time = int(time.time())

    if nickname not in premium_data:
        return jsonify(success=False, error='Premium subscription required')

    user_premium = premium_data[nickname]
    if user_premium.get('until_timestamp', 0) != -1 and user_premium.get('until_timestamp', 0) <= current_time:
        return jsonify(success=False, error='Premium subscription expired')

    story_text = request.form.get('text', '').strip()
    file = request.files.get('file')

    if not story_text and not file:
        return jsonify(success=False, error='Story content required')

    story_data = {
        'id': f"{nickname}_{int(time.time())}",
        'timestamp': current_time,
        'text': story_text
    }

    # Handle file upload
    if file and file.filename:
        allowed_extensions = {'.jpg', '.jpeg', '.png', '.gif', '.mp4', '.mov', '.avi', '.webm'}
        file_ext = os.path.splitext(file.filename)[1].lower()

        if file_ext not in allowed_extensions:
            return jsonify(success=False, error='Invalid file type')

        if len(file.read()) > 10 * 1024 * 1024:  # 10MB limit for stories
            return jsonify(success=False, error='File too large (max 10MB)')

        file.seek(0)

        stories_dir = os.path.join('static', 'stories')
        os.makedirs(stories_dir, exist_ok=True)

        import uuid
        filename = f"{uuid.uuid4().hex}{file_ext}"
        filepath = os.path.join(stories_dir, filename)

        try:
            file.save(filepath)
            story_data['media_url'] = f"/static/stories/{filename}"
            story_data['media_type'] = 'video' if file_ext in ['.mp4', '.mov', '.avi', '.webm'] else 'image'
        except Exception as e:
            return jsonify(success=False, error='Upload failed')

    # Save story
    stories_data = load_json('stories')
    if nickname not in stories_data:
        stories_data[nickname] = []

    stories_data[nickname].append(story_data)

    # Keep only last 10 stories per user
    stories_data[nickname] = stories_data[nickname][-10:]

    save_json('stories', stories_data)

    return jsonify(success=True)


@app.route('/view_story', methods=['POST'])
@login_required
def view_story():
    """Mark story as viewed"""
    data = request.get_json()
    user = data.get('user')
    story_id = data.get('story_id')

    # Here you could track story views if needed
    return jsonify(success=True)


@app.route('/purchase_premium', methods=['POST'])
@login_required
def purchase_premium():
    """Handle premium purchase with bank transfer"""
    data = request.get_json()
    duration = data.get('duration', 1)  # months
    payment_method = data.get('payment_method', 'card')

    # Bank transfer details
    bank_info = {
        'card_number': '4441114433355573',
        'recipient': 'OrbitMess Admin',
        'duration': duration,
        'user': session['nickname']
    }

    # Log the purchase request
    print(f"Premium purchase request: {session['nickname']} - {duration} months")

    return jsonify(success=True, bank_info=bank_info)


@app.route('/get_ui_settings')
@login_required
def get_ui_settings():
    """Get user's UI customization settings"""
    try:
        premium_data = load_json('premium')
        nickname = session['nickname']

        if not premium_data or premium_data == {"placeholder": "data"}:
            return jsonify({})

        if nickname in premium_data:
            return jsonify(premium_data[nickname].get('ui_settings', {}))

        return jsonify({})
    except Exception as e:
        print(f"Error loading UI settings for {nickname}: {e}")
        return jsonify({})


@app.route('/update_ui_settings', methods=['POST'])
@login_required
def update_ui_settings():
    """Update user's UI customization settings (premium feature)"""
    # Check premium status
    premium_data = load_json('premium')
    nickname = session['nickname']

    import time
    current_time = int(time.time())

    if nickname not in premium_data:
        return jsonify(success=False, error='Premium subscription required')

    user_premium = premium_data[nickname]
    if user_premium.get('until_timestamp', 0) != -1 and user_premium.get('until_timestamp', 0) <= current_time:
        return jsonify(success=False, error='Premium subscription expired')

    ui_settings = request.get_json().get('ui_settings', {})

    premium_data[nickname]['ui_settings'] = ui_settings
    save_json('premium', premium_data)

    return jsonify(success=True)


@app.route('/get_user_verification/<username>')
@login_required
def get_user_verification(username):
    """Check if user has verification badge"""
    try:
        verification_data = load_json('verification')
        if not verification_data or verification_data == {"placeholder": "data"}:
            return jsonify({'verified': False})

        is_verified = username in verification_data
        return jsonify({'verified': is_verified})
    except Exception as e:
        print(f"Error checking verification for {username}: {e}")
        return jsonify({'verified': False})


@app.route('/admin/grant_premium', methods=['POST'])
@login_required
def admin_grant_premium():
    """Grant premium to user (admin only)"""
    if session['nickname'] != 'Wixxy':
        return jsonify(success=False, error='Access denied'), 403

    data = request.get_json()
    username = data.get('username')
    duration = data.get('duration', 1)  # months

    if not username:
        return jsonify(success=False, error='Username required')

    premium_data = load_json('premium')

    import time
    current_time = int(time.time())

    if duration == -1:
        until_timestamp = -1
        until_text = 'Permanent'
    else:
        until_timestamp = current_time + (duration * 30 * 24 * 3600)  # months to seconds
        until_text = time.strftime('%Y-%m-%d', time.localtime(until_timestamp))

    premium_data[username] = {
        'granted_at': current_time,
        'granted_by': session['nickname'],
        'until_timestamp': until_timestamp,
        'until': until_text,
        'duration_months': duration,
        'ui_settings': {}
    }

    save_json('premium', premium_data)

    return jsonify(success=True)


@app.route('/admin/grant_verification', methods=['POST'])
@login_required
def admin_grant_verification():
    """Grant verification badge to user (admin only)"""
    if session['nickname'] != 'Wixxy':
        return jsonify(success=False, error='Access denied'), 403

    data = request.get_json()
    username = data.get('username')

    if not username:
        return jsonify(success=False, error='Username required')

    verification_data = load_json('verification')

    import time
    verification_data[username] = {
        'granted_at': int(time.time()),
        'granted_by': session['nickname']
    }

    save_json('verification', verification_data)

    return jsonify(success=True)


@app.route('/admin/remove_verification', methods=['POST'])
@login_required
def admin_remove_verification():
    """Remove verification badge from user (admin only)"""
    if session['nickname'] != 'Wixxy':
        return jsonify(success=False, error='Access denied'), 403

    data = request.get_json()
    username = data.get('username')

    if not username:
        return jsonify(success=False, error='Username required')

    verification_data = load_json('verification')
    verification_data.pop(username, None)
    save_json('verification', verification_data)

    return jsonify(success=True)


@app.route('/change_password', methods=['POST'])
@login_required
def change_password():
    """Change user password"""
    data = request.get_json()
    current_password = data.get('current_password')
    new_password = data.get('new_password')
    nickname = session['nickname']

    if not current_password or not new_password:
        return jsonify(success=False, error='Both passwords required')

    # Verify current password
    if not verify_user(nickname, current_password):
        return jsonify(success=False, error='Current password incorrect')

    # Update password
    users_data = load_json('users')
    for user_info in users_data.values():
        if isinstance(user_info, dict) and user_info.get('nickname') == nickname:
            user_info['password'] = new_password
            break

    save_json('users', users_data)

    return jsonify(success=True)


@app.route('/purchase_premium_visa', methods=['POST'])
@login_required
def purchase_premium_visa():
    """Handle premium purchase through Visa processing"""
    data = request.get_json()
    duration = data.get('duration', 1)  # months

    # Simulate Visa payment processing
    payment_details = {
        'merchant_id': 'ORBITMESS_UA',
        'transaction_id': f"TXN_{int(time.time())}_{session['nickname']}",
        'amount': 199 if duration == 1 else (999 if duration == 6 else 1799),
        'currency': 'UAH',
        'description': f'OrbitMess Premium {duration} month(s)',
        'redirect_url': '/payment_success',
        'user': session['nickname']
    }

    # In real implementation, you would redirect to Visa payment gateway
    # For now, we'll return payment details for manual processing

    return jsonify(success=True, payment_details=payment_details)


# SocketIO event handlers
@socketio.on('connect')
def handle_connect():
    if 'nickname' in session:
        join_room('general')
        nickname = session['nickname']
        import time
        online_users[nickname] = {'last_seen': int(time.time()), 'room': 'general'}
        
        emit('user_activity_update', {
            'user': nickname,
            'action': 'joined',
            'room': 'general'
        }, broadcast=True)

@socketio.on('disconnect')
def handle_disconnect():
    if 'nickname' in session:
        nickname = session['nickname']
        if nickname in online_users:
            del online_users[nickname]
        
        emit('user_activity_update', {
            'user': nickname,
            'action': 'left'
        }, broadcast=True)

@socketio.on('join_room')
def handle_join_room(data):
    if 'nickname' not in session:
        return
    
    room = data.get('room', 'general')
    nickname = session['nickname']
    
    if room != 'general':
        rooms_data = load_json('rooms')
        if room not in rooms_data or nickname not in rooms_data[room].get('members', []):
            return
    
    join_room(room)
    if nickname in online_users:
        online_users[nickname]['room'] = room
    
    emit('user_activity_update', {
        'user': nickname,
        'action': 'joined',
        'room': room
    }, room=room)

@socketio.on('leave_room')
def handle_leave_room(data):
    if 'nickname' not in session:
        return
    
    room = data.get('room', 'general')
    nickname = session['nickname']
    
    leave_room(room)
    
    emit('user_activity_update', {
        'user': nickname,
        'action': 'left',
        'room': room
    }, room=room)

@socketio.on('send_message')
def handle_message(data):
    if 'nickname' not in session:
        return
    
    nickname = session['nickname']
    message = data.get('message', '').strip()
    room = data.get('room', 'general')
    
    if not message:
        return
    
    # Anti-spam check
    is_allowed, error_msg = check_spam_protection(nickname, message)
    if not is_allowed:
        emit('error_message', {'error': error_msg})
        return
    
    # Check if user is muted
    muted_data = load_json('muted')
    import time
    current_time = int(time.time())
    
    if room in muted_data and nickname in muted_data[room]:
        mute_info = muted_data[room][nickname]
        if mute_info.get('until', 0) > current_time:
            remaining_minutes = int((mute_info['until'] - current_time) / 60)
            emit('error_message', {
                'error': f'You are muted for {remaining_minutes} more minutes'
            })
            return
    
    # Save message
    messages_data = load_json('messages')
    if room not in messages_data:
        messages_data[room] = []
    
    message_data = {
        'nick': nickname,
        'text': sanitize_input(message),
        'timestamp': int(time.time())
    }
    
    messages_data[room].append(message_data)
    save_json('messages', messages_data)
    
    # Broadcast message
    emit('new_message', {
        'room': room,
        'nickname': nickname,
        'message': message_data['text'],
        'timestamp': message_data['timestamp']
    }, room=room)