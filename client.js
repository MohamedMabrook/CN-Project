'use strict';

import { io } from "https://cdn.socket.io/4.4.1/socket.io.esm.min.js";

// DOM Elements
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const localPlaceholder = document.getElementById('localPlaceholder');
const remotePlaceholder = document.getElementById('remotePlaceholder');
const joinBtn = document.getElementById('join');
const leaveBtn = document.getElementById('leave');
const toggleVideoBtn = document.getElementById('toggleVideo');
const toggleAudioBtn = document.getElementById('toggleAudio');
const connectionStatus = document.getElementById('connectionStatus');
const statusText = connectionStatus.querySelector('.status-text');
const errorMsg = document.getElementById('errorMsg');

// State
let localStream = null;
let isVideoEnabled = true;
let isAudioEnabled = true;

// Socket connection
const socket = io('http://localhost:3000', {
    transports: ['websocket', 'polling', 'flashsocket'],
    cors: {
        origin: "http://localhost:3000",
        credentials: true
    },
    withCredentials: true
});

// WebRTC configuration
const pc_config = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
    ],
};

let peerConnection = new RTCPeerConnection(pc_config);

// ===== Socket Events =====
socket.on('connect', () => {
    console.log('Connected to signaling server!');
    updateConnectionStatus('connected', 'Connected');
});

socket.on('disconnect', () => {
    console.log('Disconnected from signaling server');
    updateConnectionStatus('disconnected', 'Disconnected');
});

socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    updateConnectionStatus('disconnected', 'Connection Failed');
    showError('Cannot connect to server. Make sure the signaling server is running.');
});

socket.on("room_users", (data) => {
    console.log("Users in room:", data);
    if (data.length > 0) {
        createOffer();
    }
});

socket.on("getOffer", (sdp) => {
    console.log("Received offer");
    createAnswer(sdp);
});

socket.on("getAnswer", (sdp) => {
    console.log("Received answer");
    peerConnection.setRemoteDescription(sdp);
});

socket.on("getCandidate", (candidate) => {
    peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
        .then(() => console.log("ICE candidate added"))
        .catch(err => console.error("Error adding ICE candidate:", err));
});

socket.on("user_exit", (data) => {
    console.log("User left:", data.id);
    if (remoteVideo.srcObject) {
        remoteVideo.srcObject = null;
        remotePlaceholder.classList.remove('hidden');
    }
});

// ===== WebRTC Functions =====
const createOffer = () => {
    console.log("Creating offer...");
    peerConnection
        .createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true })
        .then(sdp => {
            peerConnection.setLocalDescription(sdp);
            socket.emit("offer", sdp);
        })
        .catch(error => {
            console.error("Error creating offer:", error);
            showError("Failed to create connection offer");
        });
};

const createAnswer = (sdp) => {
    peerConnection.setRemoteDescription(sdp)
        .then(() => {
            console.log("Remote description set, creating answer...");
            return peerConnection.createAnswer({
                offerToReceiveVideo: true,
                offerToReceiveAudio: true,
            });
        })
        .then(answerSdp => {
            console.log("Answer created");
            peerConnection.setLocalDescription(answerSdp);
            socket.emit("answer", answerSdp);
        })
        .catch(error => {
            console.error("Error creating answer:", error);
            showError("Failed to establish connection");
        });
};

// ===== Main Init Function =====
async function init() {
    console.log("Initializing video chat...");
    clearError();
    
    try {
        // Get user media
        localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true,
        });
        
        // Show local video
        localVideo.srcObject = localStream;
        localPlaceholder.classList.add('hidden');
        
        // Enable control buttons
        toggleVideoBtn.disabled = false;
        toggleAudioBtn.disabled = false;
        leaveBtn.disabled = false;
        joinBtn.disabled = true;
        
        // Add tracks to peer connection
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        
        // ICE candidate handler
        peerConnection.onicecandidate = (e) => {
            if (e.candidate) {
                console.log("Sending ICE candidate");
                socket.emit("candidate", e.candidate);
            }
        };
        
        // Connection state handler
        peerConnection.oniceconnectionstatechange = () => {
            console.log("ICE connection state:", peerConnection.iceConnectionState);
            
            switch(peerConnection.iceConnectionState) {
                case 'connected':
                    updateConnectionStatus('connected', 'Peer Connected');
                    break;
                case 'disconnected':
                    updateConnectionStatus('disconnected', 'Peer Disconnected');
                    break;
                case 'failed':
                    updateConnectionStatus('disconnected', 'Connection Failed');
                    showError('Peer connection failed. Try rejoining.');
                    break;
            }
        };
        
        // Remote track handler
        peerConnection.ontrack = (ev) => {
            console.log("Received remote track");
            remoteVideo.srcObject = ev.streams[0];
            remotePlaceholder.classList.add('hidden');
        };
        
        // Join the room
        socket.emit("join", {
            room: "1234",
            name: "user_" + Math.random().toString(36).substr(2, 5),
        });
        
        updateConnectionStatus('connected', 'In Room');
        
    } catch (error) {
        console.error("Error initializing:", error);
        
        if (error.name === 'NotAllowedError') {
            showError('Camera/microphone access denied. Please allow permissions and try again.');
        } else if (error.name === 'NotFoundError') {
            showError('No camera or microphone found. Please connect a device.');
        } else {
            showError(`Error: ${error.message}`);
        }
    }
}

// ===== Leave Function =====
function leaveRoom() {
    // Stop all tracks
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    // Clear videos
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    localPlaceholder.classList.remove('hidden');
    remotePlaceholder.classList.remove('hidden');
    
    // Close and recreate peer connection
    peerConnection.close();
    peerConnection = new RTCPeerConnection(pc_config);
    
    // Reset buttons
    joinBtn.disabled = false;
    leaveBtn.disabled = true;
    toggleVideoBtn.disabled = true;
    toggleAudioBtn.disabled = true;
    
    // Reset toggle states
    isVideoEnabled = true;
    isAudioEnabled = true;
    toggleVideoBtn.classList.remove('muted');
    toggleAudioBtn.classList.remove('muted');
    
    updateConnectionStatus('connected', 'Connected');
    clearError();
    
    console.log("Left room");
}

// ===== Toggle Functions =====
function toggleVideo() {
    if (!localStream) return;
    
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
        isVideoEnabled = !isVideoEnabled;
        videoTrack.enabled = isVideoEnabled;
        toggleVideoBtn.classList.toggle('muted', !isVideoEnabled);
        
        // Toggle icon visibility
        const iconOn = toggleVideoBtn.querySelector('.icon-on');
        const iconOff = toggleVideoBtn.querySelector('.icon-off');
        iconOn.style.display = isVideoEnabled ? 'block' : 'none';
        iconOff.style.display = isVideoEnabled ? 'none' : 'block';
    }
}

function toggleAudio() {
    if (!localStream) return;
    
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        isAudioEnabled = !isAudioEnabled;
        audioTrack.enabled = isAudioEnabled;
        toggleAudioBtn.classList.toggle('muted', !isAudioEnabled);
        
        // Toggle icon visibility
        const iconOn = toggleAudioBtn.querySelector('.icon-on');
        const iconOff = toggleAudioBtn.querySelector('.icon-off');
        iconOn.style.display = isAudioEnabled ? 'block' : 'none';
        iconOff.style.display = isAudioEnabled ? 'none' : 'block';
    }
}

// ===== UI Helper Functions =====
function updateConnectionStatus(state, text) {
    connectionStatus.className = 'connection-status ' + state;
    statusText.textContent = text;
}

function showError(message) {
    errorMsg.textContent = message;
}

function clearError() {
    errorMsg.textContent = '';
}

// ===== Event Listeners =====
joinBtn.addEventListener('click', init);
leaveBtn.addEventListener('click', leaveRoom);
toggleVideoBtn.addEventListener('click', toggleVideo);
toggleAudioBtn.addEventListener('click', toggleAudio);