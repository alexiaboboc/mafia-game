import React, { useState } from "react";
import "../styles/FriendsPage.css";
import { useNavigate } from "react-router-dom";

type Friend = {
  name: string;
  isOnline: boolean;
};

const initialFriends: Friend[] = [
  { name: "Elena", isOnline: true },
  { name: "Mihai", isOnline: false },
  { name: "Andreea", isOnline: true },
  { name: "Bogdan", isOnline: false },
  { name: "Ana", isOnline: true },
];

export default function FriendsPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const navigate = useNavigate();
  

  const filteredFriends = initialFriends.filter((friend) => {
    const matchesSearch = friend.name.toLowerCase().includes(search.toLowerCase());
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "online" && friend.isOnline) ||
      (statusFilter === "offline" && !friend.isOnline);
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="friends-wrapper">
      <div className="friends-header">
        <img src="/mafia-logo.png" alt="Mafia Logo" className="friends-mafia-logo" />
        <h1 className="friends-title">Friends</h1>
      </div>
      <img src="/Start.png" alt="Background" className="friends-background" />
      <div className="friends-panel">
        <div className="filters">
          <input
            type="text"
            placeholder="Search players..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="search-input"
          />
          <select
            className="status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
          </select>
        </div>

        <ul className="friends-list">
          {filteredFriends.map((friend, index) => (
            <li key={index} className="friend-item">
              <span
                className={`status-indicator ${friend.isOnline ? "online" : "offline"}`}
              />
              {friend.name}
            </li>
          ))}
        </ul>
      </div>
      <button className="friends-back-button" onClick={() => navigate("/menu")}>
          ⟵ Back
        </button>
    </div>
  );
}