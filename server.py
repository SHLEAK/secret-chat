from flask import Flask, render_template, request, jsonify
import time

app = Flask(__name__)
signals = {}
online_users = {}
USER_TIMEOUT = 30  # seconds before user is considered offline

@app.route("/")
def index():
	return render_template("index.html")

@app.route("/register_user", methods=["POST"])
def register_user():
	data = request.get_json()
	name = data.get('name')
	if name:
		online_users[name] = time.time()
		return jsonify(success=True)
	return jsonify(success=False, error="Name required")

@app.route("/get_online_users", methods=["GET"])
def get_online_users():
	current_time = time.time()
	active_users = {n: t for n, t in online_users.items() if current_time - t < USER_TIMEOUT}
	online_users.clear()
	online_users.update(active_users)

	exclude = request.args.get("exclude", "")
	users = [n for n in active_users if n != exclude]
	return jsonify(users=users)

@app.route("/heartbeat", methods=["POST"])
def heartbeat():
	data = request.get_json()
	name = data.get("name")
	if name:
		online_users[name] = time.time()
		return jsonify(success=True)
	return jsonify(success=False)

@app.route("/signal", methods=["POST"])
def signal():
	data = request.get_json()
	key = f"{data['from']}+{data['to']}"
	signals.setdefault(key, []).append(data)
	return jsonify(success=True)

@app.route("/fetch_signals", methods=["GET"])
def fetch_signals():
	from_user = request.args.get("from")
	to_user = request.args.get("to")
	key = f"{from_user}+{to_user}"
	msgs = signals.get(key, [])
	signals[key] = []  # clear after fetching
	return jsonify(messages=msgs)

if __name__ == "__main__":
	app.run(host="0.0.0.0", port=5000, debug=True)
