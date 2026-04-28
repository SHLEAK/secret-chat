let reconnectScheduled = false;
let reconnectAttempts = 0;
let friend = null;
let name = null;
let pc = null;
let dataChannel = null;
let isConnecting = false;
let signalInterval = null;

function updateConnectionStatus(status) {
	const el = document.getElementById("status-connection");
	el.textContent = `🔄 ${status}`;
}
function updateEncryptionStatus(status) {
	const el = document.getElementById("status-encryption");
	el.textContent = status === "encrypted" ? "🔒 Encrypted" : "🔓 Not encrypted";
}
function updateReconnectButton(disabled) {
	document.getElementById("reconnectBtn").disabled = disabled;
}

function autoReconnect() {
	if (!friend || isConnecting || reconnectScheduled) return;

	reconnectScheduled = true;
	const delay = Math.min(3000 * Math.pow(2, reconnectAttempts), 30000); // exponential backoff

	setTimeout(() => {
		reconnectScheduled = false;
		reconnectAttempts++;
		reconnectToPeer();
	}, delay);
}

async function reconnectToPeer() {
	if (!friend || isConnecting) return;
	updateConnectionStatus('connecting');
	updateEncryptionStatus('unknown');
	updateReconnectButton(true);
	await initializeConnection();
}

async function initializeConnection() {
	if (isConnecting) return;
	isConnecting = true;
	updateReconnectButton(true);
	updateConnectionStatus('connecting');
	updateEncryptionStatus('unknown');

	if (pc) pc.close();
	pc = new RTCPeerConnection({
		iceServers: [
			{ urls: 'stun:stun.l.google.com:19302' },
			{ urls: 'stun:stun1.l.google.com:19302' }
		]
	});

	pc.onconnectionstatechange = () => {
		switch(pc.connectionState){
			case 'connected':
				updateConnectionStatus('connected');
				updateEncryptionStatus('encrypted');
				reconnectAttempts = 0;
				break;
			case 'disconnected':
			case 'failed':
				updateConnectionStatus(pc.connectionState);
				autoReconnect();
				break;
			case 'closed':
				updateConnectionStatus('closed');
				break;
			case 'connecting':
				updateConnectionStatus('connecting');
				break;
		}
		isConnecting = false;
		updateReconnectButton(false);
	};

	pc.onicecandidate = e => {
		if (e.candidate) fetch('/signal', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ from: name, to: friend, type: 'candidate', candidate: e.candidate })
		});
	};

	dataChannel = pc.createDataChannel("chat");
	setupDataChannel();

	pc.ondatachannel = e => {
		dataChannel = e.channel;
		setupDataChannel();
	};

	if (signalInterval) clearInterval(signalInterval);
	signalInterval = setInterval(fetchSignals, 1000);

	try {
		const offer = await pc.createOffer();
		await pc.setLocalDescription(offer);
		await fetch('/signal', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ from: name, to: friend, type: 'offer', sdp: offer.sdp })
		});

		const oldInput = document.getElementById('messageInput');
		const newInput = oldInput.cloneNode(true);
		oldInput.replaceWith(newInput);
		newInput.addEventListener('keypress', e => {
			if(e.key === 'Enter'){ e.preventDefault(); sendMessage(); }
		});
		document.getElementById('sendBtn').onclick = sendMessage;

	} catch(e) {
		console.error('Error creating offer:', e);
		updateConnectionStatus('failed');
		updateEncryptionStatus('unencrypted');
		isConnecting = false;
		updateReconnectButton(false);
		autoReconnect();
	}
}

function setupDataChannel() {
	dataChannel.onopen = () => {
		updateEncryptionStatus('encrypted');
		updateReconnectButton(false);
		reconnectAttempts = 0;
	};
	dataChannel.onclose = () => { 
		updateConnectionStatus('disconnected');
		updateEncryptionStatus('unencrypted');
		autoReconnect();
	};
	dataChannel.onerror = () => {
		updateConnectionStatus('failed');
		autoReconnect();
	};
	dataChannel.onmessage = e => {
		const chat = document.getElementById('messages');
		const div = document.createElement('div');
		div.className = 'message friend';
		div.textContent = `${friend}: ${e.data}`;
		chat.appendChild(div);
		chat.scrollTop = chat.scrollHeight;
	};
}

async function fetchSignals() {
	if (!name || !friend) return;
	const res = await fetch(`/fetch_signals?from=${encodeURIComponent(friend)}&to=${encodeURIComponent(name)}`);
	const data = await res.json();
	for (const msg of data.messages) {
		if (msg.type === "offer") {
			await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
			const answer = await pc.createAnswer();
			await pc.setLocalDescription(answer);
			await fetch('/signal', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ from: name, to: friend, type: 'answer', sdp: answer.sdp })
			});
		} else if (msg.type === "answer") {
			await pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
		} else if (msg.type === "candidate" && msg.candidate) {
			try {
				await pc.addIceCandidate(msg.candidate);
			} catch (err) {
				console.error('Error adding candidate:', err);
			}
		}
	}
}

function sendMessage() {
	const input = document.getElementById('messageInput');
	const text = input.value.trim();
	if (text && dataChannel && dataChannel.readyState === "open") {
		dataChannel.send(text);
		const chat = document.getElementById('messages');
		const div = document.createElement('div');
		div.className = 'message self';
		div.textContent = `You: ${text}`;
		chat.appendChild(div);
		chat.scrollTop = chat.scrollHeight;
		input.value = '';
	}
}

window.addEventListener("DOMContentLoaded", () => {
	const joinBtn = document.getElementById("joinBtn");
	const nameInput = document.getElementById("name");
	const loginPanel = document.getElementById("login");
	const userPanel = document.getElementById("user-selection");
	const refreshBtn = document.getElementById("refreshBtn");
	const noUsers = document.getElementById("no-users");
	const userList = document.getElementById("user-list");
	const backBtn = document.getElementById("backBtn");

	joinBtn.addEventListener("click", async () => {
		name = nameInput.value.trim();
		if (!name) {
			alert("Enter your name, diva 💅");
			return;
		}

		const res = await fetch("/register_user", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name })
		});
		const data = await res.json();
		if (!data.success) {
			alert("Could not register user 😭");
			return;
		}

		loginPanel.style.display = "none";
		userPanel.style.display = "block";
		fetchUserList();
		startHeartbeat();
	});

	refreshBtn.addEventListener("click", fetchUserList);
	backBtn.addEventListener("click", () => {
	chatContainer.style.display = "none";
	userPanel.style.display = "block";
	friend = null;
});

	async function fetchUserList() {
		const res = await fetch(`/get_online_users?exclude=${encodeURIComponent(name)}`);
		const data = await res.json();
		userList.innerHTML = "";

		if (!data.users || data.users.length === 0) {
			noUsers.style.display = "block";
			return;
		}

		noUsers.style.display = "none";
		data.users.forEach(u => {
			const btn = document.createElement("button");
			btn.textContent = u;
			btn.addEventListener("click", () => startChat(u));
			userList.appendChild(btn);
		});
	}

	function startHeartbeat() {
		setInterval(() => {
			fetch("/heartbeat", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name })
			});
		}, 5000);
	}

	function startChat(friendName) {
		friend = friendName;
		document.getElementById("user-selection").style.display = "none";
		document.getElementById("chat-container").style.display = "block";
		document.getElementById("friend-name").textContent = friend;
		initializeConnection();
	}
});
