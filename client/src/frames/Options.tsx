import React, { useState } from "react";
import "../styles/Options.css";
import { useNavigate } from "react-router-dom";

export default function Options() {
    const navigate = useNavigate();
    
    const [music, setMusic] = useState(50);
    const [sound, setSound] = useState(50);
    const [notifications, setNotifications] = useState(true);

    return (
        <div className="options-wrapper">
            <div className="top-right-buttons">
                <button className="top-button" onClick={() => navigate("/friends")}>
                    Friends
                </button>
                <button className="top-button" onClick={() => navigate("/account")}>
                    Account
                </button>
            </div>
            <img src="/mafia-logo.png" alt="Mafia Logo" className="options-mafia-logo" />
            <h1 className="options-title">Options</h1>
            <div className="options-panel">
                <div className="option-row">
                    <label>Music</label>
                    <input
                        type="range"
                        min={0}
                        max={100}
                        value={music}
                        onChange={(e) => setMusic(Number(e.target.value))}
                    />
                </div>
                <div className="option-row">
                    <label>Sound</label>
                    <input
                        type="range"
                        min={0}
                        max={100}
                        value={sound}
                        onChange={(e) => setSound(Number(e.target.value))}
                    />
                </div>
                <div className="option-row">
                    <label>Notifications</label>
                    <div className={`toggle-switch ${notifications ? "on" : "off"}`} onClick={() => setNotifications(!notifications)}>
                        <span className="toggle-label">{notifications ? "ON" : "OFF"}</span>
                    </div>
                </div>
                <button className="reset-button">Reset</button>
            </div>
            <button className="options-back-under" onClick={() => navigate("/menu")}>⟵ Back</button>
        </div>
    );
}
