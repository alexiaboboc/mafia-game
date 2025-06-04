import express from 'express';
import { Request, Response } from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import mongoose from 'mongoose';

// Define FriendRequest type
interface FriendRequestDocument extends mongoose.Document {
  from: {
    id: string;
    username: string;
  };
  to: {
    id: string;
    username: string;
  };
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: Date;
}

const FriendRequest = mongoose.model<FriendRequestDocument>('FriendRequest');

const app = express();
app.use(cors({
  origin: "http://localhost:3000",
  credentials: true
}));
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST", "DELETE"],
    credentials: true
  }
});

// Online users tracking
const onlineUsers = new Map<string, boolean>();

// Socket.IO connection handling
io.on('connection', (socket: Socket) => {
  console.log('User connected');

  // Handle user status changes
  socket.on('user-status', ({ userId, status }) => {
    console.log(`User ${userId} status changed to ${status}`);
    onlineUsers.set(userId, status === 'online');
    
    // Notify all connected clients about the status change
    io.emit('user-status-changed', { userId, status });
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('User disconnected');
    
    // Find and update status for disconnected user
    const userId = Array.from(socket.rooms).find(room => room !== socket.id);
    if (userId && typeof userId === 'string') {
      onlineUsers.set(userId, false);
      io.emit('user-status-changed', { userId, status: 'offline' });
    }
  });
});

// Add new endpoint for getting online status
app.get('/api/users/online-status', (req: Request, res: Response) => {
  try {
    const userIds = req.query.userIds?.toString().split(',') || [];
    const statuses: Record<string, boolean> = {};
    
    userIds.forEach(userId => {
      statuses[userId] = onlineUsers.get(userId) || false;
    });
    
    res.json({ statuses });
  } catch (error) {
    console.error('Error fetching online status:', error);
    res.status(500).json({ error: 'Failed to fetch online status' });
  }
});

// Add endpoint for removing friends
app.delete('/api/friends/remove', async (req: Request, res: Response) => {
  try {
    const { userId, friendId } = req.body;
    console.log('Removing friendship between:', userId, 'and', friendId);
    
    if (!userId || !friendId) {
      return res.status(400).json({ error: 'Missing userId or friendId' });
    }

    // Find and update all friend requests between these users
    const requests = await FriendRequest.find({
      $or: [
        { 'from.id': userId, 'to.id': friendId },
        { 'from.id': friendId, 'to.id': userId }
      ],
      status: 'accepted'
    });

    if (requests.length === 0) {
      return res.status(404).json({ error: 'Friendship not found' });
    }

    // Delete the friend requests
    await FriendRequest.deleteMany({
      $or: [
        { 'from.id': userId, 'to.id': friendId },
        { 'from.id': friendId, 'to.id': userId }
      ]
    });

    // Notify both users about the friendship removal
    io.to(userId).emit('friend-removed', { userId, friendId });
    io.to(friendId).emit('friend-removed', { userId, friendId });
    
    res.json({ message: 'Friend removed successfully' });
  } catch (error) {
    console.error('Error removing friend:', error);
    res.status(500).json({ error: 'Failed to remove friend' });
  }
});

export { app, httpServer }; 