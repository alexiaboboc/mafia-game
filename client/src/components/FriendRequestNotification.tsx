import React from 'react';
import '../styles/FriendRequestNotification.css';

interface FriendRequestNotificationProps {
  from: {
    id: string;
    username: string;
  };
  onAccept: () => void;
  onReject: () => void;
}

export default function FriendRequestNotification({ from, onAccept, onReject }: FriendRequestNotificationProps) {
  return (
    <div className="friend-request-notification">
      <div className="notification-content">
        <span className="notification-text">
          {from.username} wants to be your friend
        </span>
        <div className="notification-actions">
          <button className="accept-button" onClick={onAccept}>
            Accept
          </button>
          <button className="reject-button" onClick={onReject}>
            Reject
          </button>
        </div>
      </div>
    </div>
  );
} 