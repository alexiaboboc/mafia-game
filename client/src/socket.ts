import { io } from "socket.io-client";

// Create a single socket instance for the entire app
export const socket = io("http://localhost:5001", {
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000,
  transports: ['websocket', 'polling'],
  withCredentials: true,
  autoConnect: false
});

// Keep track if we've already connected
let isSocketConnected = false;
let heartbeatInterval: NodeJS.Timeout | null = null;

export const connectSocket = (userId: string) => {
  if (!isSocketConnected) {
    console.log("Connecting socket for user:", userId);
    socket.connect();
    socket.emit('user-connected', { userId });
    isSocketConnected = true;

    // Set up heartbeat to maintain online status
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
      if (socket.connected) {
        socket.emit('heartbeat', { userId });
      }
    }, 15000); // Send heartbeat every 15 seconds

    // Set up reconnection handler
    socket.on('connect', () => {
      console.log('Socket reconnected, re-emitting user-connected');
      socket.emit('user-connected', { userId });
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
      if (reason === 'io server disconnect') {
        // Server initiated disconnect, try to reconnect
        socket.connect();
      }
    });
  }
};

export const disconnectSocket = (userId: string) => {
  if (isSocketConnected) {
    console.log("Disconnecting socket for user:", userId);
    socket.emit('user-disconnected', { userId });
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    socket.disconnect();
    isSocketConnected = false;
  }
};

// Handle page visibility changes
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    const userId = sessionStorage.getItem('id');
    if (!userId) return;

    if (document.visibilityState === 'visible') {
      connectSocket(userId);
    } else {
      // Don't disconnect, just send a status update
      socket.emit('user-status', { userId, status: 'away' });
    }
  });
}

// Handle before unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    const userId = sessionStorage.getItem('id');
    if (userId) {
      socket.emit('user-disconnected', { userId });
    }
  });
} 